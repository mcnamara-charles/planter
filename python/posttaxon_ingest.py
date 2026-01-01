#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Take pretaxon.csv (plant_id, plant_scientific_name) and resolve full WFO taxonomy.

Steps:
  1. Load WFO CoLDP zip (wfo_plantlist_2025-06.zip):
       - Name.tsv   -> names_by_id
       - Taxon.tsv  -> taxa_by_id, taxa_by_nameid
       - Build canonical-name index from Name.tsv (species level)
  2. Read pretaxon.csv, collect unique canonical scientific names.
  3. For each canonical name, find best-matching WFO taxon and build full lineage
     from root -> leaf (kingdom -> ... -> species).
     This is done in parallel over chunks of names.
  4. Determine which ranks actually appear (Kingdom, Subkingdom, Phylum, Section, ...),
     sorted according to a predefined biological rank order.
  5. Re-read pretaxon.csv and write posttaxon.csv with columns:

       plant_id,plant_scientific_name,
       <Rank>,<Rank>_wfo_id, ...

     e.g. Kingdom,Kingdom_wfo_id,Subkingdom,Subkingdom_wfo_id,...,Species,Species_wfo_id

Notes:
  - 400k+ plants is fine; most work is dict lookups in memory.
  - Multi-threading is done per chunk of canonical names (not per row),
    so overhead stays low.

Usage:
  Just run:

    python build_posttaxon.py

  after export_pretaxon.py has produced pretaxon.csv.
"""

import csv
import io
import os
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Set

# ---------------- Paths / Config ----------------

# 🔧 Adjust if your WFO file lives elsewhere or has a different name
WFO_ZIP_PATH = Path(r"C:\Users\jacob\Downloads\wfo_plantlist_2025-06 (1).zip")

# pretaxon.csv (input) and posttaxon.csv (output) are next to this script by default
SCRIPT_DIR = Path(__file__).resolve().parent
PRETAXON_CSV = SCRIPT_DIR / "pretaxon.csv"
POSTTAXON_CSV = SCRIPT_DIR / "posttaxon.csv"

# Concurrency
WORKERS = max(4, os.cpu_count() or 4)         # number of threads
CHUNK_SIZE = 1000                             # canonical-name chunk size per task

DEBUG = False


def dbg(*a, **k):
    if DEBUG:
        print("[DBG]", *a, **k)


# ---------------- Canonical name helper ----------------

def canon_binomial(s: str) -> str:
    """
    Reduce a scientific name to a canonical binomial for matching.

    - Remove hybrid multiplier symbols (×, x)
    - Strip rank markers and anything after (subsp., var., f., etc.)
    - Keep at most the first two words (Genus + species epithet)
    """
    import re
    if not s:
        return ""
    s = s.strip()
    # Remove hybrid markers
    s = re.sub(r"[×x]\s*", "", s)
    # Cut off infraspecific rank markers and everything after
    s = re.sub(r"\b(subsp\.|ssp\.|var\.|f\.|forma|cv\.)\b.*", "", s, flags=re.IGNORECASE)
    parts = s.split()
    if len(parts) >= 2:
        return f"{parts[0]} {parts[1]}".strip()
    return s.strip()


# ---------------- WFO loading ----------------

def find_file_in_zip(z: zipfile.ZipFile, basename: str) -> str:
    """Find a file inside the zip whose name ends with `basename` (case-insensitive)."""
    target = basename.lower()
    for name in z.namelist():
        if name.lower().endswith(target):
            return name
    raise FileNotFoundError(f"Could not find {basename} in WFO zip.")


def load_wfo(zip_path: Path):
    """
    Load WFO Name.tsv and Taxon.tsv into memory and build basic indexes.

    Returns:
      names_by_id:        {nameID -> Name-row-dict}
      taxa_by_id:         {taxonID -> Taxon-row-dict}
      taxa_by_nameid:     {nameID -> [Taxon-row-dict,...]}
      name_id_field:      column name for ID in Name.tsv
      name_sci_field:     column name for scientific name in Name.tsv
      name_rank_field:    column name for rank in Name.tsv
      taxon_id_field:     column name for ID in Taxon.tsv
      taxon_nameid_field: column name for nameID in Taxon.tsv
      taxon_parent_field: column name for parentID in Taxon.tsv
      taxon_status_field: column name for taxon status in Taxon.tsv (or None)
    """
    if not zip_path.exists():
        raise FileNotFoundError(f"WFO zip not found: {zip_path}")

    print(f"[WFO] Loading from {zip_path} ...")
    with zipfile.ZipFile(zip_path, "r") as z:
        # ---- Load Name.tsv ----
        name_filename = find_file_in_zip(z, "name.tsv")
        print(f"[WFO] Using Name file: {name_filename}")
        with z.open(name_filename, "r") as f:
            text_stream = io.TextIOWrapper(f, encoding="utf-8")
            reader = csv.DictReader(text_stream, delimiter="\t")

            nf = reader.fieldnames or []
            low = {c.lower(): c for c in nf}

            name_id_field = low.get("id")
            name_sci_field = (
                low.get("scientificname")
                or low.get("scientific_name")
                or low.get("fullname")
                or low.get("full_name")
                or low.get("name")
            )
            name_rank_field = low.get("rank") or low.get("namerank") or low.get("taxonrank")

            if not name_id_field or not name_sci_field:
                raise RuntimeError(
                    "Could not infer ID/scientificName fields in Name.tsv. "
                    f"Columns: {nf}"
                )

            names_by_id: Dict[str, Dict[str, Any]] = {}
            for row in reader:
                nid = row[name_id_field]
                names_by_id[nid] = row

        # ---- Load Taxon.tsv ----
        taxon_filename = find_file_in_zip(z, "taxon.tsv")
        print(f"[WFO] Using Taxon file: {taxon_filename}")
        with z.open(taxon_filename, "r") as f:
            text_stream = io.TextIOWrapper(f, encoding="utf-8")
            reader = csv.DictReader(text_stream, delimiter="\t")

            tf = reader.fieldnames or []
            lowt = {c.lower(): c for c in tf}

            taxon_id_field = lowt.get("id") or lowt.get("taxonid")
            taxon_nameid_field = lowt.get("nameid")
            taxon_parent_field = lowt.get("parentid") or lowt.get("parentnameusageid")
            taxon_status_field = lowt.get("status") or lowt.get("taxonstatus")

            if not taxon_id_field or not taxon_nameid_field or not taxon_parent_field:
                raise RuntimeError(
                    "Could not infer ID/nameID/parentID fields in Taxon.tsv. "
                    f"Columns: {tf}"
                )

            taxa_by_id: Dict[str, Dict[str, Any]] = {}
            taxa_by_nameid: Dict[str, List[Dict[str, Any]]] = {}

            for row in reader:
                tid = row[taxon_id_field]
                taxa_by_id[tid] = row
                nid = row.get(taxon_nameid_field)
                if nid:
                    taxa_by_nameid.setdefault(nid, []).append(row)

    print(f"[WFO] Loaded {len(names_by_id):,} Name rows, {len(taxa_by_id):,} Taxon rows.")
    return (
        names_by_id,
        taxa_by_id,
        taxa_by_nameid,
        name_id_field,
        name_sci_field,
        name_rank_field,
        taxon_id_field,
        taxon_nameid_field,
        taxon_parent_field,
        taxon_status_field,
    )


def build_canonical_index(
    names_by_id: Dict[str, Dict[str, Any]],
    name_id_field: str,
    name_sci_field: str,
    name_rank_field: Optional[str],
) -> Dict[str, List[str]]:
    """
    Build mapping: canonical binomial -> [nameID,...] using Name.tsv rows.

    We index only species-ish ranks (species, subspecies, variety, form, etc.)
    and only names that yield a 2-word canonical binomial.
    """
    allowed_ranks: Set[str] = {
        "species",
        "subspecies",
        "variety",
        "forma",
        "form",
        "subvariety",
    }

    index: Dict[str, List[str]] = {}
    n_indexed = 0

    for nid, row in names_by_id.items():
        sci = (row.get(name_sci_field) or "").strip()
        if not sci:
            continue

        canon = canon_binomial(sci)
        if not canon:
            continue

        parts = canon.split()
        if len(parts) < 2:
            # skip pure genera etc.
            continue

        if name_rank_field:
            r = (row.get(name_rank_field) or "").strip().lower()
            if r and r not in allowed_ranks:
                continue

        key = canon.lower()
        index.setdefault(key, []).append(nid)
        n_indexed += 1

    print(f"[WFO] Indexed {n_indexed:,} species-level names (canonical binomials).")
    return index


# ---------------- Matching & lineage building ----------------

def pick_best_taxon_for_name_ids(
    name_ids: List[str],
    names_by_id: Dict[str, Dict[str, Any]],
    taxa_by_nameid: Dict[str, List[Dict[str, Any]]],
    name_rank_field: Optional[str],
    taxon_status_field: Optional[str],
) -> Optional[Dict[str, Any]]:
    """
    Given a list of Name IDs, choose the best Taxon row:

      - Prefer taxon status containing 'accept' and not 'synonym'
      - Prefer Name rank 'species' over infraspecific (if rank info exists)
      - Otherwise just pick the first one deterministically.
    """
    best = None
    best_score = -10

    for nid in name_ids:
        taxon_rows = taxa_by_nameid.get(nid, [])
        if not taxon_rows:
            continue
        name_row = names_by_id.get(nid, {})
        name_rank = (name_row.get(name_rank_field) or "").strip().lower() if name_rank_field else ""

        for trow in taxon_rows:
            score = 0
            status = (trow.get(taxon_status_field) or "").strip().lower() if taxon_status_field else ""
            if "accept" in status and "synonym" not in status:
                score += 10
            if name_rank == "species":
                score += 3
            elif name_rank:
                score += 1  # infraspecific
            if score > best_score:
                best_score = score
                best = trow

    return best


def build_lineage_for_taxon(
    taxon_row: Dict[str, Any],
    taxa_by_id: Dict[str, Dict[str, Any]],
    names_by_id: Dict[str, Dict[str, Any]],
    taxon_id_field: str,
    taxon_nameid_field: str,
    taxon_parent_field: str,
    name_sci_field: str,
    name_rank_field: Optional[str],
) -> Dict[str, Tuple[str, str]]:
    """
    From a starting taxon row, walk parentID up to the root.

    Returns:
      rank_to_tuple: {rank_key (lowercase) -> (scientific_name, wfo_taxon_id)}

    e.g. {
      "kingdom": ("Plantae", "wfo-4100001250-2025-06"),
      "family": ("Begoniaceae", "wfo-7000000068-2025-06"),
      "genus": ("Begonia", "wfo-4000004308-2025-06"),
      "species": ("Begonia heracleifolia", "wfo-0000824247-2025-06"),
      ...
    }
    """
    lineage: List[Tuple[str, str, str]] = []  # (rank_key, name, taxon_id)
    current = taxon_row

    seen_ids: Set[str] = set()

    while current:
        tid = current.get(taxon_id_field)
        if not tid or tid in seen_ids:
            break
        seen_ids.add(tid)

        nid = current.get(taxon_nameid_field)
        name_row = names_by_id.get(nid, {}) if nid else {}
        sci = (name_row.get(name_sci_field) or "").strip()
        rank = (name_row.get(name_rank_field) or "").strip().lower() if name_rank_field else ""

        if sci and rank:
            lineage.append((rank, sci, tid))

        parent_id = current.get(taxon_parent_field)
        if not parent_id:
            break
        parent = taxa_by_id.get(parent_id)
        if not parent:
            break
        current = parent

    # reverse to go root -> leaf
    lineage.reverse()

    rank_to_tuple: Dict[str, Tuple[str, str]] = {}
    for rank, sci, tid in lineage:
        # If repeated rank appears, keep the lowest (leaf-most) one by overriding or vice versa.
        rank_to_tuple[rank] = (sci, tid)

    return rank_to_tuple


# ---------------- Rank ordering ----------------

# Preferred biological rank order (lowercase keys)
RANK_ORDER_BASE = [
    "kingdom",
    "subkingdom",
    "phylum",
    "division",
    "subdivision",
    "class",
    "subclass",
    "superorder",
    "order",
    "suborder",
    "family",
    "subfamily",
    "tribe",
    "subtribe",
    "genus",
    "subgenus",
    "section",
    "subsection",
    "series",
    "species",
    "subspecies",
    "variety",
    "forma",
    "form",
]


def canonical_rank_label(rank_key: str) -> str:
    """
    Convert rank_key ('kingdom') into a column label ('Kingdom').
    """
    if not rank_key:
        return ""
    return rank_key[0].upper() + rank_key[1:]


# ---------------- Canonical-name processing (parallel) ----------------

def resolve_canon_chunk(
    canons: List[str],
    canonical_index: Dict[str, List[str]],
    names_by_id: Dict[str, Dict[str, Any]],
    taxa_by_nameid: Dict[str, List[Dict[str, Any]]],
    taxa_by_id: Dict[str, Dict[str, Any]],
    name_id_field: str,
    name_sci_field: str,
    name_rank_field: Optional[str],
    taxon_id_field: str,
    taxon_nameid_field: str,
    taxon_parent_field: str,
    taxon_status_field: Optional[str],
) -> Tuple[Dict[str, Dict[str, Tuple[str, str]]], Set[str]]:
    """
    Worker function: resolve a chunk of canonical names to their rank->(name, wfo_id) mapping.

    Returns:
      (canon_to_rankmap, used_ranks_in_this_chunk)
    """
    canon_to_rankmap: Dict[str, Dict[str, Tuple[str, str]]] = {}
    used_ranks: Set[str] = set()

    for canon in canons:
        key = canon.lower()
        name_ids = canonical_index.get(key)
        if not name_ids:
            canon_to_rankmap[key] = {}
            continue

        best_taxon = pick_best_taxon_for_name_ids(
            name_ids,
            names_by_id,
            taxa_by_nameid,
            name_rank_field,
            taxon_status_field,
        )
        if not best_taxon:
            canon_to_rankmap[key] = {}
            continue

        rank_map = build_lineage_for_taxon(
            best_taxon,
            taxa_by_id,
            names_by_id,
            taxon_id_field,
            taxon_nameid_field,
            taxon_parent_field,
            name_sci_field,
            name_rank_field,
        )

        canon_to_rankmap[key] = rank_map
        used_ranks.update(rank_map.keys())

    return canon_to_rankmap, used_ranks


# ---------------- Main pipeline ----------------

def main():
    global DEBUG
    DEBUG = bool(int(os.getenv("TAXON_DEBUG", "0")))

    print("[RUN] build_posttaxon.py")
    print(f"      WFO zip  : {WFO_ZIP_PATH}")
    print(f"      pretaxon : {PRETAXON_CSV}")
    print(f"      posttaxon: {POSTTAXON_CSV}")

    if not PRETAXON_CSV.exists():
        print(f"[ERR] pretaxon.csv not found at {PRETAXON_CSV}")
        sys.exit(1)

    # 1) Load WFO dataset
    (
        names_by_id,
        taxa_by_id,
        taxa_by_nameid,
        name_id_field,
        name_sci_field,
        name_rank_field,
        taxon_id_field,
        taxon_nameid_field,
        taxon_parent_field,
        taxon_status_field,
    ) = load_wfo(WFO_ZIP_PATH)

    canonical_index = build_canonical_index(
        names_by_id,
        name_id_field,
        name_sci_field,
        name_rank_field,
    )

    # 2) Read pretaxon.csv and collect unique canonical names
    canon_set: Set[str] = set()
    print("[STEP] Collecting canonical names from pretaxon.csv ...")

    with PRETAXON_CSV.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if "plant_scientific_name" not in reader.fieldnames:
            print("[ERR] pretaxon.csv must contain 'plant_scientific_name' column.")
            sys.exit(1)

        for row in reader:
            sci = (row.get("plant_scientific_name") or "").strip()
            if not sci:
                continue
            canon = canon_binomial(sci)
            if canon:
                canon_set.add(canon.lower())

    print(f"[STEP] Found {len(canon_set):,} unique canonical names to resolve.")

    # 3) Resolve canonical names in parallel
    canon_list = list(canon_set)
    chunks: List[List[str]] = [
        canon_list[i : i + CHUNK_SIZE] for i in range(0, len(canon_list), CHUNK_SIZE)
    ]

    canon_to_rankmap: Dict[str, Dict[str, Tuple[str, str]]] = {}
    used_ranks: Set[str] = set()

    print(f"[STEP] Resolving canonical names in {len(chunks)} chunks, workers={WORKERS} ...")

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = [
            ex.submit(
                resolve_canon_chunk,
                chunk,
                canonical_index,
                names_by_id,
                taxa_by_nameid,
                taxa_by_id,
                name_id_field,
                name_sci_field,
                name_rank_field,
                taxon_id_field,
                taxon_nameid_field,
                taxon_parent_field,
                taxon_status_field,
            )
            for chunk in chunks
        ]

        processed_chunks = 0
        for fut in as_completed(futures):
            chunk_map, chunk_ranks = fut.result()
            canon_to_rankmap.update(chunk_map)
            used_ranks.update(chunk_ranks)
            processed_chunks += 1
            if processed_chunks % 10 == 0 or processed_chunks == len(chunks):
                print(f"[STEP] chunks done: {processed_chunks}/{len(chunks)}")

    print(f"[STEP] Finished resolving canonical names. Used ranks: {sorted(used_ranks)}")

    # 4) Determine final ordered ranks for header
    ordered_ranks: List[str] = []
    for rk in RANK_ORDER_BASE:
        if rk in used_ranks:
            ordered_ranks.append(rk)
    for rk in sorted(used_ranks):
        if rk not in ordered_ranks:
            ordered_ranks.append(rk)

    print(f"[STEP] Final rank order: {ordered_ranks}")

    # 5) Re-read pretaxon.csv and write posttaxon.csv
    print("[STEP] Writing posttaxon.csv ...")
    with PRETAXON_CSV.open("r", encoding="utf-8", newline="") as fin, \
         POSTTAXON_CSV.open("w", encoding="utf-8", newline="") as fout:

        reader = csv.DictReader(fin)
        base_fields = ["id", "plant_scientific_name"]

        header: List[str] = base_fields[:]
        for rk in ordered_ranks:
            label = canonical_rank_label(rk)
            header.append(label)
            header.append(f"{label}_wfo_id")

        writer = csv.writer(fout)
        writer.writerow(header)

        n_rows = 0
        n_matched = 0
        n_unmatched = 0

        for row in reader:
            plant_id = row.get("id") or ""
            sci = (row.get("plant_scientific_name") or "").strip()
            canon = canon_binomial(sci).lower() if sci else ""

            # base columns
            out = [plant_id, sci]

            rankmap = canon_to_rankmap.get(canon) or {}
            if rankmap:
                n_matched += 1
            else:
                n_unmatched += 1

            for rk in ordered_ranks:
                t = rankmap.get(rk)
                if t:
                    name, tid = t
                    out.append(name)
                    out.append(tid)
                else:
                    out.append("")
                    out.append("")

            writer.writerow(out)
            n_rows += 1
            if n_rows % 50000 == 0:
                print(f"[STEP] wrote {n_rows:,} rows ...")

    print(f"[DONE] posttaxon.csv written to {POSTTAXON_CSV}")
    print(f"       total rows   : {n_rows:,}")
    print(f"       matched taxa : {n_matched:,}")
    print(f"       unmatched    : {n_unmatched:,}")


if __name__ == "__main__":
    main()
