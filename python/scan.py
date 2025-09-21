#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Scan a GBIF Backbone DwC-A directory for "African violets" mentions.

Finds:
  • Scientific-name matches in Taxon.tsv (Plantae, species only)
      - Legacy genus:  Saintpaulia ...
      - Current splits: Streptocarpus ionanthus ... (incl. infraspecific ranks)
  • Vernacular-name matches in VernacularName.tsv (contains "African violet")

Prints a consolidated report keyed by usage/taxon IDs.

Usage:
  python find_african_violets.py --dir /path/to/GBIF_Backbone

Optional flags:
  --sci-pattern REGEX       Override scientific-name regex (default targets Saintpaulia and Streptocarpus ionanth-)
  --vern-pattern REGEX      Override vernacular-name regex (default '(?i)african\\s+violet')
  --lang en,eng             CSV list of 2/3-letter language filters for vernaculars (default 'en,eng')
"""

import argparse
import os
import re
from typing import Dict, Iterable, List, Optional, Tuple

# ---------------- Stream helpers ----------------

def iter_tsv_select(path: str, wanted: List[str]) -> Iterable[dict]:
    """
    Streaming TSV reader for GBIF DwC-A files (unquoted, tab-separated).
    Yields dicts containing only the requested columns (case-insensitive match).
    Missing columns are omitted.
    """
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
        header = f.readline()
        if not header:
            return
        cols = header.rstrip("\r\n").split("\t")
        low_to_idx = {c.lower(): i for i, c in enumerate(cols)}

        # map each wanted name to its column index, if present
        indices: Dict[str, int] = {}
        for w in wanted:
            i = low_to_idx.get(w.lower())
            if i is not None:
                indices[w] = i

        for line in f:
            cells = line.rstrip("\r\n").split("\t")
            out = {}
            for w, i in indices.items():
                if i < len(cells):
                    out[w] = cells[i]
            yield out

def first_nonempty(row: dict, *keys: str) -> Optional[str]:
    for k in keys:
        v = row.get(k)
        if v is not None and v != "":
            return v
    # case-insensitive fallbacks
    low = {kk.lower(): kk for kk in row.keys()}
    for k in keys:
        kk = low.get(k.lower())
        if kk is not None:
            v = row.get(kk)
            if v is not None and v != "":
                return v
    return None

# ---------------- Core search ----------------

def scan_taxon(
    taxon_path: str,
    sci_regex: re.Pattern,
) -> Tuple[Dict[int, dict], Dict[int, dict]]:
    """
    Scan Taxon.tsv and return:
      matches_by_id: {usageKey -> row_info} for rows that match the scientific-name pattern
                     AND are Plantae species.
      index_by_id:   {usageKey -> row_info} lightweight index for lookups (for accepted names, etc.)

    row_info keys: usageKey, canonicalName, scientificName, rank, kingdom,
                   acceptedNameUsageID (if present)
    """
    wanted = [
        "kingdom",
        "taxonRank", "rank",
        "canonicalName", "scientificName",
        "taxonID", "taxonId", "usageID", "usageKey",
        "acceptedNameUsageID", "acceptedNameUsageId", "acceptedUsageID",
    ]
    matches_by_id: Dict[int, dict] = {}
    index_by_id: Dict[int, dict] = {}

    for row in iter_tsv_select(taxon_path, wanted):
        kingdom = (first_nonempty(row, "kingdom") or "").strip().lower()
        # keep a lightweight index for potential accepted-name lookups (even if not Plantae/species)
        usage_s = first_nonempty(row, "usageKey", "usageID", "taxonID", "taxonId")
        if not usage_s:
            continue
        try:
            usage = int(usage_s)
        except ValueError:
            continue

        # Store minimal index
        index_by_id[usage] = {
            "usageKey": usage,
            "kingdom": kingdom,
            "rank": (first_nonempty(row, "taxonRank", "rank") or "").strip(),
            "canonicalName": (first_nonempty(row, "canonicalName") or "").strip(),
            "scientificName": (first_nonempty(row, "scientificName") or "").strip(),
            "acceptedNameUsageID": first_nonempty(row, "acceptedNameUsageID", "acceptedNameUsageId", "acceptedUsageID"),
        }

        # Strict: Plantae + species
        if kingdom != "plantae":
            continue
        rank = (first_nonempty(row, "taxonRank", "rank") or "").strip().lower()
        if rank != "species":
            continue

        sci = (first_nonempty(row, "canonicalName", "scientificName") or "").strip()
        if not sci:
            continue

        if sci_regex.search(sci):
            matches_by_id[usage] = index_by_id[usage]

    return matches_by_id, index_by_id


def scan_vernacular(
    vern_path: str,
    vern_regex: re.Pattern,
    lang_allow: Optional[set] = None,
) -> Dict[int, List[str]]:
    """
    Scan VernacularName.tsv and return vern_by_id: {usageKey -> [vernacularName,...]}
    filtered by optional language set and regex on vernacularName.
    """
    wanted = [
        "taxonID", "taxonId", "usageID", "usageKey",
        "vernacularName", "vernacularname",
        "language", "languageCode",
    ]
    vern_by_id: Dict[int, List[str]] = {}

    for row in iter_tsv_select(vern_path, wanted):
        usage_s = first_nonempty(row, "usageKey", "usageID", "taxonID", "taxonId")
        if not usage_s:
            continue
        try:
            usage = int(usage_s)
        except ValueError:
            continue

        name = (first_nonempty(row, "vernacularName", "vernacularname") or "").strip()
        if not name:
            continue

        if lang_allow is not None:
            lang = (first_nonempty(row, "language", "languageCode") or "").strip().lower()
            if lang and lang not in lang_allow:
                continue

        if not vern_regex.search(name):
            continue

        vern_by_id.setdefault(usage, []).append(name)

    return vern_by_id


def main():
    ap = argparse.ArgumentParser(description="Find African violet mentions in GBIF Backbone DwC-A")
    ap.add_argument("--dir", required=True, help="Path to unzipped GBIF Backbone directory")
    ap.add_argument("--sci-pattern", default=r"(?i)^(saintpaulia(\b|$)|streptocarpus\s+ionanth)", help="Regex for scientific-name match (default matches Saintpaulia* and Streptocarpus ionanth-)")
    ap.add_argument("--vern-pattern", default=r"(?i)\bafrican\s+violet", help="Regex for vernacular-name match")
    ap.add_argument("--lang", default="en,eng", help="Comma-separated allowed language codes for vernaculars (empty = no filter)")
    args = ap.parse_args()

    taxon_path = os.path.join(args.dir, "Taxon.tsv")
    vern_path  = os.path.join(args.dir, "VernacularName.tsv")

    if not os.path.exists(taxon_path):
        print(f"ERROR: Taxon.tsv not found at {taxon_path}")
        return
    if not os.path.exists(vern_path):
        print(f"WARNING: VernacularName.tsv not found at {vern_path} (we'll skip vernacular search)")

    sci_regex  = re.compile(args.sci_pattern)
    vern_regex = re.compile(args.vern_pattern)
    lang_allow = set([s.strip().lower() for s in args.lang.split(",") if s.strip()]) if args.lang.strip() else None

    print("Scanning Taxon.tsv (Plantae, species, scientific-name matches)...")
    sci_matches, taxon_index = scan_taxon(taxon_path, sci_regex)
    sci_ids = set(sci_matches.keys())
    print(f"  Scientific-name hits: {len(sci_ids):,}")

    vern_matches = {}
    vern_ids = set()
    if os.path.exists(vern_path):
        print("Scanning VernacularName.tsv (vernacular-name matches)...")
        vern_matches = scan_vernacular(vern_path, vern_regex, lang_allow=lang_allow)
        vern_ids = set(vern_matches.keys())
        print(f"  Vernacular-name hits: {len(vern_ids):,}")

    all_ids = sci_ids | vern_ids
    if not all_ids:
        print("No matches found.")
        return

    print("\n=== Matches (by usage/taxon ID) ===\n")
    for uid in sorted(all_ids):
        row = taxon_index.get(uid, {})
        sci = row.get("canonicalName") or row.get("scientificName") or ""
        rank = (row.get("rank") or "").lower()
        kingdom = row.get("kingdom") or ""
        acc = row.get("acceptedNameUsageID")

        print(f"ID: {uid}")
        print(f"  Scientific: {sci or '(unknown)'}")
        print(f"  Kingdom/Rank: {kingdom or '?'} / {rank or '?'}")

        if uid in sci_ids:
            print("  Source: Taxon.tsv (scientific match)")

        vlist = vern_matches.get(uid)
        if vlist:
            uniq = sorted(set(vlist), key=lambda s: s.lower())
            preview = "; ".join(uniq[:6]) + (" ..." if len(uniq) > 6 else "")
            print(f"  Vernaculars: {preview}")

        if acc and acc != "" and str(acc).isdigit() and int(acc) != uid:
            acc_row = taxon_index.get(int(acc), {})
            acc_name = acc_row.get("canonicalName") or acc_row.get("scientificName") or "(unknown)"
            print(f"  Accepted usage ID: {acc}  →  {acc_name}")

        print()

    print("Done.")

if __name__ == "__main__":
    main()
