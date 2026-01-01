#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Populate public.plants.species_taxon_id from posttaxon.csv and public.taxa.

Assumes:
  • public.plants has:
        id uuid primary key,
        species_taxon_id uuid null
  • public.taxa has:
        id uuid,
        wfo_id text,
        type text,
        ...
  • posttaxon.csv (same dir as this script) has:
        id              -> plant id (UUID from public.plants.id)
        Species_wfo_id  -> species-level WFO ID (full, e.g. 'wfo-0000873059-2025-06')

Env vars:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE
  UPSERT_BATCH       (default 1000)
  DB_CONCURRENCY     (default 8)
  SB_REQUEST_TIMEOUT (default 15)
  TAXA_PAGE_SIZE     (default 1000)  # rows per page from taxa
  TAXON_DEBUG        (default 0)
"""

import csv
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Tuple

from dotenv import load_dotenv
from supabase import create_client, Client

UPSERT_BATCH       = int(os.getenv("UPSERT_BATCH", "1000"))
DB_CONCURRENCY     = int(os.getenv("DB_CONCURRENCY", "8"))
SB_REQUEST_TIMEOUT = float(os.getenv("SB_REQUEST_TIMEOUT", "15"))

DEBUG = False

_MAX = sys.maxsize
while True:
    try:
        csv.field_size_limit(_MAX)
        break
    except OverflowError:
        _MAX = int(_MAX / 10)


def dbg(*a, **k):
    if DEBUG:
        print("[DBG]", *a, **k)


# ---------------- helpers ----------------

def base_wfo_id(w: str) -> str:
    """
    Strip the version suffix from a WFO ID.
    Example: 'wfo-0000873059-2025-06' -> 'wfo-0000873059'.
    If it doesn't look versioned, return as-is.
    """
    if not w:
        return ""
    w = w.strip()
    parts = w.split("-")
    # typical WFO pattern: wfo-XXXXXXXXXX-YYYY-MM
    if len(parts) >= 3 and parts[0].lower() == "wfo":
        return "-".join(parts[:2])
    return w


# ---------------- Supabase helpers ----------------

def _tweak_sb_timeouts(sb: Client):
    try:
        if hasattr(sb, "postgrest") and hasattr(sb.postgrest, "_client"):
            sb.postgrest._client.timeout = SB_REQUEST_TIMEOUT  # type: ignore[attr-defined]
    except Exception as e:
        print("[SB] WARN: could not set PostgREST timeout ->", repr(e))


def get_sb() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    sb = create_client(url, key)
    _tweak_sb_timeouts(sb)
    return sb


def _new_sb() -> Client:
    load_dotenv()
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE"])
    _tweak_sb_timeouts(sb)
    return sb


def _sb_healthcheck(sb: Client) -> bool:
    try:
        t0 = time.perf_counter()
        sb.table("plants").select("id").limit(1).execute()
        dt = time.perf_counter() - t0
        print(f"[SB] Supabase healthcheck OK in {dt:.2f}s")
        return True
    except Exception as e:
        print("[SB] ERROR: Supabase healthcheck failed ->", repr(e))
        return False


# ---------------- DB: load WFO -> taxa.id (all ranks) ----------------

def load_taxa_wfo_map(sb: Client) -> Tuple[Dict[str, str], Dict[str, str]]:
    """
    Load ALL taxa rows and build:

        full_wfo_to_id: { full_wfo_id           -> taxa.id }
        base_wfo_to_id: { base_wfo_id(full_wfo) -> taxa.id }

    Uses correct paging so we actually fetch all ~252k rows.
    """
    page_size = int(os.getenv("TAXA_PAGE_SIZE", "1000"))
    offset = 0
    page = 0

    full_wfo_to_id: Dict[str, str] = {}
    base_wfo_to_id: Dict[str, str] = {}

    print(f"[DB] Loading taxa (all ranks) (page_size={page_size}) ...")

    # Optional: log Supabase's count
    try:
        count_res = sb.table("taxa").select("id", count="exact").limit(1).execute()
        print(f"[DB] Supabase-reported taxa count: {count_res.count}")
    except Exception as e:
        print("[DB] WARN: could not get exact taxa count ->", repr(e))

    total_rows = 0

    while True:
        t0 = time.perf_counter()
        res = (
            sb.table("taxa")
            .select("id,wfo_id,type")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows: List[Dict[str, Any]] = getattr(res, "data", None) or []
        dt = time.perf_counter() - t0

        print(f"[DB] fetched taxa page {page} (offset={offset}, rows={len(rows)}) in {dt:.2f}s")
        if not rows:
            break

        for r in rows:
            tid = str(r.get("id"))
            wfo = (r.get("wfo_id") or "").strip()
            if not wfo:
                continue

            # exact map
            if wfo not in full_wfo_to_id:
                full_wfo_to_id[wfo] = tid

            # base map
            b = base_wfo_id(wfo)
            if b and b not in base_wfo_to_id:
                base_wfo_to_id[b] = tid

        total_rows += len(rows)
        offset += len(rows)   # step by ACTUAL rows returned
        page += 1

    print(
        f"[DB] Loaded {total_rows:,} taxa rows; "
        f"{len(full_wfo_to_id):,} distinct full WFO IDs; "
        f"{len(base_wfo_to_id):,} distinct base WFO IDs."
    )
    return full_wfo_to_id, base_wfo_to_id


# ---------------- CSV: plant -> Species_wfo_id ----------------

def load_plant_species_wfo_from_csv(csv_path: Path) -> Dict[str, str]:
    if not csv_path.exists():
        raise FileNotFoundError(f"posttaxon.csv not found at {csv_path}")

    print(f"[CSV] Reading posttaxon.csv from {csv_path} ...")

    plant_to_species_wfo: Dict[str, str] = {}
    total_rows = 0
    rows_with_species_wfo = 0

    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        dbg("Fieldnames:", fieldnames)

        plant_id_col = None
        species_wfo_col = None

        for col in fieldnames:
            if col.lower() == "id":
                plant_id_col = col
            if col.lower() == "species_wfo_id":
                species_wfo_col = col

        if not plant_id_col:
            raise SystemExit("Could not find 'id' column (plant id) in posttaxon header")
        if not species_wfo_col:
            raise SystemExit("Could not find 'Species_wfo_id' column in posttaxon header")

        for row in reader:
            total_rows += 1
            if total_rows % 50000 == 0:
                print(f"[CSV] processed posttaxon rows: {total_rows:,}")

            plant_id = (row.get(plant_id_col) or "").strip()
            species_wfo = (row.get(species_wfo_col) or "").strip()

            if not plant_id or not species_wfo:
                continue

            rows_with_species_wfo += 1

            # If the same plant appears multiple times, keep first mapping and log if different
            if plant_id in plant_to_species_wfo:
                if plant_to_species_wfo[plant_id] != species_wfo:
                    dbg(
                        f"Plant {plant_id} has multiple Species_wfo_id values: "
                        f"{plant_to_species_wfo[plant_id]} vs {species_wfo} (keeping first)"
                    )
                continue

            plant_to_species_wfo[plant_id] = species_wfo

    print(f"[CSV] Total rows:                     {total_rows:,}")
    print(f"[CSV] Rows with Species_wfo_id:      {rows_with_species_wfo:,}")
    print(f"[CSV] Distinct plants with species:  {len(plant_to_species_wfo):,}")
    return plant_to_species_wfo


# ---------------- DB: parallel update ----------------

def _parallel_update_species_taxon_id(
    pairs: List[Tuple[str, str]],
    batch: int = UPSERT_BATCH,
    workers: int = DB_CONCURRENCY,
) -> int:

    def job(chunk: List[Tuple[str, str]]) -> int:
        if not chunk:
            return 0
        sb2 = _new_sb()
        updated = 0
        for plant_id, species_taxon_id in chunk:
            try:
                sb2.table("plants").update(
                    {"species_taxon_id": species_taxon_id}
                ).eq("id", plant_id).execute()
                updated += 1
            except Exception as e:
                print("WARN: plants species_taxon_id update failed for", plant_id, "->", repr(e))
        return updated

    chunks: List[List[Tuple[str, str]]] = [
        pairs[i:i + batch] for i in range(0, len(pairs), batch)
    ]

    total = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(job, c) for c in chunks]
        for f in as_completed(futs):
            try:
                total += f.result()
            except Exception as e:
                print("WARN: species_taxon_id update batch failed ->", repr(e))
    return total


# ---------------- Main ----------------

def main():
    global DEBUG
    DEBUG = bool(int(os.getenv("TAXON_DEBUG", "0")))

    script_dir = Path(__file__).resolve().parent
    posttaxon_path = script_dir / "posttaxon.csv"

    print("[RUN] populate_plants_species_taxon_id.py")
    print(f"      posttaxon -> {posttaxon_path}")

    # 1) CSV: plant -> Species_wfo_id
    plant_to_species_wfo = load_plant_species_wfo_from_csv(posttaxon_path)
    if not plant_to_species_wfo:
        print("[RUN] No plant/species mappings from CSV. Exiting.")
        return

    # 2) Supabase + healthcheck
    sb = get_sb()
    if not _sb_healthcheck(sb):
        print("[RUN] Aborting due to Supabase connectivity error.")
        return

    # 3) DB: load ALL taxa WFO maps
    full_wfo_to_taxon_id, base_wfo_to_taxon_id = load_taxa_wfo_map(sb)
    if not full_wfo_to_taxon_id and not base_wfo_to_taxon_id:
        print("[RUN] No taxa in DB (WFO maps empty). Exiting.")
        return

    # 4) Translate plant -> Species_wfo_id to plant -> species_taxon_id
    pairs: List[Tuple[str, str]] = []
    missing_exact = 0
    missing_even_base = 0
    matched_exact = 0
    matched_base = 0

    for plant_id, species_wfo in plant_to_species_wfo.items():
        taxon_id = full_wfo_to_taxon_id.get(species_wfo)
        if taxon_id:
            matched_exact += 1
            pairs.append((plant_id, taxon_id))
            continue

        missing_exact += 1
        base = base_wfo_id(species_wfo)
        if base:
            taxon_id2 = base_wfo_to_taxon_id.get(base)
        else:
            taxon_id2 = None

        if taxon_id2:
            matched_base += 1
            pairs.append((plant_id, taxon_id2))
        else:
            missing_even_base += 1
            dbg(f"No taxa.id found for Species_wfo_id={species_wfo} (plant {plant_id})")

    print(f"[MAP] plant/species pairs (valid):         {len(pairs):,}")
    print(f"[MAP]   matched by exact WFO:             {matched_exact:,}")
    print(f"[MAP]   matched by base WFO fallback:     {matched_base:,}")
    print(f"[MAP] plants with species WFO missing exact match: {missing_exact:,}")
    print(f"[MAP] plants whose species WFO has no matching taxon even by base: {missing_even_base:,}")

    if not pairs:
        print("[RUN] Nothing to update. Exiting.")
        return

    # 5) Parallel update
    print(
        f"[RUN] Updating species_taxon_id for {len(pairs):,} plants "
        f"(batch={UPSERT_BATCH}, workers={DB_CONCURRENCY}) ..."
    )

    updated = _parallel_update_species_taxon_id(
        pairs, batch=UPSERT_BATCH, workers=DB_CONCURRENCY
    )

    print(f"[RUN] Done. plants attempted={len(pairs):,}, updated={updated:,}")


if __name__ == "__main__":
    main()
