#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Populate public.taxa.parent_id using posttaxon.csv.

Assumes:
  • public.taxa already has rows for every taxon, with:
        id uuid PK,
        name text,
        type text,
        wfo_id text,
        rank smallint,
        parent_id uuid NULL
  • posttaxon.csv (same dir as this script) has columns:
        id,plant_scientific_name,
        Kingdom,Kingdom_wfo_id,
        Subkingdom,Subkingdom_wfo_id,
        ...
        Species,Species_wfo_id,
        Supertribe,Supertribe_wfo_id

Behavior:
  1. Load all taxa from DB and build:
       - wfo_to_id:  WFO ID -> taxa.id
  2. Read posttaxon.csv and, for each row:
       - Build the ordered list of PRESENT ranks (e.g. Kingdom, Subkingdom, Phylum, Order, Family, Genus, Species)
       - Add an edge (parent_wfo -> child_wfo) between each adjacent pair in that list
  3. Deduplicate edges; resolve conflicts if any child has >1 parent.
  4. Translate WFO edges (child_wfo -> parent_wfo) to DB IDs:
       child_id -> parent_id
  5. Upsert parent_id into public.taxa via Supabase in parallel batches.

Env vars:
  SUPABASE_URL          (required)
  SUPABASE_SERVICE_ROLE (required)
  SUPABASE_IN_MAX       (page size for DB reads; default 80)
  UPSERT_BATCH          (default 1000)  - rows per upsert
  DB_CONCURRENCY        (default 8)     - threads for upserts
  SB_REQUEST_TIMEOUT    (default 15)    - PostgREST timeout in seconds
  TAXON_DEBUG           (default 0)     - 1 for verbose debug logging
"""

import csv
import os
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

from dotenv import load_dotenv
from supabase import create_client, Client

# ---------------- Config ----------------

BATCH_DB_IN    = int(os.getenv("SUPABASE_IN_MAX", "80"))
UPSERT_BATCH   = int(os.getenv("UPSERT_BATCH", "1000"))
DB_CONCURRENCY = int(os.getenv("DB_CONCURRENCY", "8"))
SB_REQUEST_TIMEOUT = float(os.getenv("SB_REQUEST_TIMEOUT", "15"))

DEBUG = False

# CSV field size
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


# ---------------- Supabase helpers ----------------

def _tweak_sb_timeouts(sb: Client):
    """Best-effort: shorten PostgREST timeout so we don't hang forever."""
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
    """Tiny query to verify connectivity quickly."""
    try:
        t0 = time.perf_counter()
        sb.table("taxa").select("id").limit(1).execute()
        dt = time.perf_counter() - t0
        print(f"[SB] Supabase healthcheck OK in {dt:.2f}s")
        return True
    except Exception as e:
        print("[SB] ERROR: Supabase healthcheck failed ->", repr(e))
        return False


# ---------------- DB: load taxa map ----------------

def load_taxa_maps(sb: Client) -> Dict[str, str]:
    """
    Load all rows from public.taxa and build:

      wfo_to_id: { wfo_id -> id }

    We rely primarily on WFO ID for uniqueness.
    """
    page_size = BATCH_DB_IN or 80
    page = 0
    wfo_to_id: Dict[str, str] = {}

    print(f"[DB] Loading taxa (page_size={page_size}) to build wfo_to_id map...")
    total_rows = 0

    while True:
        rng_lo = page * page_size
        rng_hi = rng_lo + page_size - 1

        t0 = time.perf_counter()
        res = (
            sb.table("taxa")
            .select("id,name,type,wfo_id")
            .range(rng_lo, rng_hi)
            .execute()
        )
        rows: List[Dict[str, Any]] = getattr(res, "data", None) or []
        dt = time.perf_counter() - t0

        print(f"[DB] fetched taxa page {page} (rows={len(rows)}) in {dt:.2f}s")
        dbg("sample rows:", rows[:2])

        if not rows:
            break

        for r in rows:
            tid = str(r.get("id"))
            wfo = (r.get("wfo_id") or "").strip()
            if wfo:
                # If duplicate WFO ID appears, we just keep the first one and log once
                if wfo in wfo_to_id and wfo_to_id[wfo] != tid:
                    dbg(f"Duplicate wfo_id '{wfo}' for ids {wfo_to_id[wfo]} and {tid} (keeping first)")
                else:
                    wfo_to_id[wfo] = tid

        total_rows += len(rows)
        page += 1

    print(f"[DB] Loaded {total_rows:,} taxa rows; {len(wfo_to_id):,} distinct WFO IDs in map.")
    return wfo_to_id


# ---------------- DB: upsert parents ----------------

def _parallel_upsert_parents(rows: List[Dict[str, Any]],
                             batch: int = UPSERT_BATCH,
                             workers: int = DB_CONCURRENCY) -> int:
    """
    Upsert parent_id for taxa rows in parallel.

    Each row must have: { "id": <uuid>, "parent_id": <uuid> }.
    """

    def job(batch_rows: List[Dict[str, Any]]) -> int:
        if not batch_rows:
            return 0
        sb2 = _new_sb()
        try:
            sb2.table("taxa").upsert(
                batch_rows,
                on_conflict="id",
                returning="minimal"
            ).execute()
        except Exception as e:
            print("WARN: taxa parent upsert failed for batch ->", repr(e))
        return len(batch_rows)

    chunks: List[List[Dict[str, Any]]] = [
        rows[i:i + batch] for i in range(0, len(rows), batch)
    ]
    sent = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(job, chunk) for chunk in chunks]
        for f in as_completed(futs):
            try:
                sent += f.result()
            except Exception as e:
                print("WARN: parent batch failed ->", repr(e))
    return sent


# ---------------- CSV parsing: build edges ----------------

def build_wfo_edges_from_posttaxon(csv_path: Path) -> Dict[str, str]:
    """
    Scan posttaxon.csv and build a mapping:

        child_wfo -> parent_wfo

    using adjacent RANKS in each row's chain.

    Only uses rows where BOTH child and parent WFO IDs are non-empty.
    If multiple parents are seen for the same child, we pick the first
    sorted parent WFO and log a warning.
    """
    if not csv_path.exists():
        raise FileNotFoundError(f"posttaxon.csv not found at {csv_path}")

    print(f"[CSV] Reading posttaxon.csv from {csv_path} ...")

    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        dbg("Fieldnames:", fieldnames)

        fields_set = set(fieldnames)

        # Identify (Rank, Rank_wfo_id) pairs
        rank_pairs: List[Tuple[str, str]] = []
        for col in fieldnames:
            if not col.endswith("_wfo_id"):
                continue
            base = col[:-len("_wfo_id")]
            if base in fields_set:
                rank_pairs.append((base, col))

        if not rank_pairs:
            print("[CSV] No rank/_wfo_id column pairs found. Cannot build edges.")
            return {}

        print(f"[CSV] Rank pairs used for edges: {rank_pairs}")

        # child_wfo -> set of possible parent_wfo (should normally be size 1)
        edges_multi: Dict[str, Set[str]] = defaultdict(set)

        n_rows = 0
        for row in reader:
            n_rows += 1
            if n_rows % 50000 == 0:
                print(f"[CSV] processed posttaxon rows: {n_rows:,}")

            # Collect present nodes in order: [(rank_label, name, wfo_id), ...]
            present: List[Tuple[str, str, str]] = []
            for rank_label, wfo_col in rank_pairs:
                name = (row.get(rank_label) or "").strip()
                wfo = (row.get(wfo_col) or "").strip()
                if not name and not wfo:
                    continue
                present.append((rank_label, name, wfo))

            if len(present) < 2:
                continue

            # Build parent->child edges between adjacent present ranks
            for i in range(len(present) - 1):
                parent_rank, parent_name, parent_wfo = present[i]
                child_rank,  child_name,  child_wfo  = present[i + 1]

                if not parent_wfo or not child_wfo:
                    continue

                edges_multi[child_wfo].add(parent_wfo)

        print(f"[CSV] Finished scanning posttaxon.csv")
        print(f"      rows processed: {n_rows:,}")
        print(f"      unique child_wfo with parents: {len(edges_multi):,}")

        # Collapse edges: if multiple parents, warn and pick one deterministically
        child_to_parent: Dict[str, str] = {}
        for child_wfo, parents in edges_multi.items():
            if not parents:
                continue
            if len(parents) > 1:
                print(f"[WARN] child_wfo '{child_wfo}' has {len(parents)} parents in CSV; "
                      f"choosing the first after sort.")
            parent_wfo = sorted(parents)[0]
            child_to_parent[child_wfo] = parent_wfo

        print(f"[CSV] Final child->parent WFO edges: {len(child_to_parent):,}")
        return child_to_parent


# ---------------- Main logic ----------------

def main():
    global DEBUG
    DEBUG = bool(int(os.getenv("TAXON_DEBUG", "0")))

    script_dir = Path(__file__).resolve().parent
    posttaxon_path = script_dir / "posttaxon.csv"

    print("[RUN] populate_taxa_parents_from_posttaxon.py")
    print(f"      posttaxon -> {posttaxon_path}")

    # 1) Build child_wfo -> parent_wfo from CSV
    child_to_parent_wfo = build_wfo_edges_from_posttaxon(posttaxon_path)
    if not child_to_parent_wfo:
        print("[RUN] No WFO edges to apply. Exiting.")
        return

    # 2) Load taxa maps from DB
    sb = get_sb()
    if not _sb_healthcheck(sb):
        print("[RUN] Aborting due to Supabase connectivity error.")
        return

    wfo_to_id = load_taxa_maps(sb)

    # 3) Translate WFO edges into DB ID edges: child_id -> parent_id
    child_id_to_parent_id: Dict[str, str] = {}
    missing_child = 0
    missing_parent = 0

    for child_wfo, parent_wfo in child_to_parent_wfo.items():
        child_id = wfo_to_id.get(child_wfo)
        parent_id = wfo_to_id.get(parent_wfo)

        if not child_id:
            missing_child += 1
            dbg(f"No taxa.id for child_wfo={child_wfo}")
            continue
        if not parent_id:
            missing_parent += 1
            dbg(f"No taxa.id for parent_wfo={parent_wfo}")
            continue

        child_id_to_parent_id[child_id] = parent_id

    print(f"[MAP] child_id->parent_id pairs: {len(child_id_to_parent_id):,}")
    print(f"[MAP] missing child taxa for edges: {missing_child:,}")
    print(f"[MAP] missing parent taxa for edges: {missing_parent:,}")

    if not child_id_to_parent_id:
        print("[RUN] No valid ID-based edges to upsert. Exiting.")
        return

    # 4) Build update rows
    update_rows: List[Dict[str, Any]] = [
        {"id": cid, "parent_id": pid}
        for cid, pid in child_id_to_parent_id.items()
    ]

    print(f"[RUN] Upserting parent_id for {len(update_rows):,} taxa "
          f"(batch={UPSERT_BATCH}, workers={DB_CONCURRENCY}) ...")

    sent = _parallel_upsert_parents(update_rows, batch=UPSERT_BATCH, workers=DB_CONCURRENCY)

    print(f"[RUN] Done. parent rows attempted={len(update_rows):,}, "
          f"sent in batches={sent:,}")
    print("      Roots (e.g. Plantae) will naturally keep parent_id NULL.")


if __name__ == "__main__":
    main()
