#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse, csv, io, os, sys, re
from typing import Dict, List, Optional, Tuple, Any, Set

# Make csv robust to very large fields
_MAX = sys.maxsize
while True:
    try:
        csv.field_size_limit(_MAX)
        break
    except OverflowError:
        _MAX = int(_MAX / 10)

def open_tsv(path: str) -> csv.DictReader:
    # errors="replace" so we never crash on odd bytes
    f = open(path, "r", encoding="utf-8", errors="replace", newline="")
    return csv.DictReader(f, delimiter="\t")

def _get(row: dict, *keys: str) -> Optional[str]:
    """Case-insensitive column getter."""
    for k in keys:
        if k in row and row[k] is not None:
            return str(row[k])
    low = {k.lower(): k for k in row.keys()}
    for k in keys:
        kk = low.get(k.lower())
        if kk and row[kk] is not None:
            return str(row[kk])
    return None

SPECIES_LIKE = {
    "species", "nothospecies", "hybrid", "hybrid species",
    "species aggregate", "species group"
}

def main():
    ap = argparse.ArgumentParser(
        description="Verify VernacularName.tsv → Taxon.tsv mapping for African violet (or any regex)."
    )
    ap.add_argument("--dir", help="Directory containing Taxon.tsv and VernacularName.tsv")
    ap.add_argument("--vern", help="Path to VernacularName.tsv (overrides --dir)")
    ap.add_argument("--taxon", help="Path to Taxon.tsv (overrides --dir)")
    ap.add_argument("--out", default="vernacular_check.csv", help="Output CSV")
    ap.add_argument(
        "--pattern",
        default=r"\bAfrican[\s-]*violet(s)?\b|\bUsambara\s+violet\b|\bfalse\s+African[\s-]*violet\b",
        help="Regex to match vernacularName lines"
    )
    ap.add_argument("--species-only", action="store_true",
                    help="If set, only keep results where Taxon rank is species-like")
    args = ap.parse_args()

    if not (args.vern and args.taxon):
        if not args.dir:
            ap.error("Use --dir or provide both --vern and --taxon")
        args.vern = args.vern or os.path.join(args.dir, "VernacularName.tsv")
        args.taxon = args.taxon or os.path.join(args.dir, "Taxon.tsv")

    if not os.path.exists(args.vern):
        sys.exit(f"VernacularName.tsv not found: {args.vern}")
    if not os.path.exists(args.taxon):
        sys.exit(f"Taxon.tsv not found: {args.taxon}")

    rx = re.compile(args.pattern, re.IGNORECASE)

    # -------- 1) Scan VernacularName.tsv for matches, collect keys --------
    vern_rows: List[dict] = []
    target_keys: Set[int] = set()

    print("Scanning VernacularName.tsv for matches…")
    v_reader = open_tsv(args.vern)
    for row in v_reader:
        name = (_get(row, "vernacularName", "vernacularname") or "").strip()
        if not name: 
            continue
        if not rx.search(name):
            continue

        # keep a small copy of the row’s useful fields
        r = {
            "taxonKey": _get(row, "taxonKey", "taxonID", "taxonId", "usageKey", "usageID") or "",
            "vernacularName": name,
            "language": _get(row, "language") or "",
            "languageCode": _get(row, "languageCode") or "",
            "countryCode": _get(row, "countryCode", "country") or "",
            "isPreferredName": _get(row, "isPreferredName", "preferred", "isPreferred") or "",
        }
        vern_rows.append(r)

        # stash key
        tid = r["taxonKey"]
        try:
            target_keys.add(int(tid))
        except Exception:
            pass

    if not vern_rows:
        print("No vernacular matches found for pattern. Exiting.")
        return

    print(f"Matched vernacular rows: {len(vern_rows)}  | distinct taxon keys: {len(target_keys)}")

    # -------- 2) First pass over Taxon.tsv: find accepted keys for our targets --------
    accepted_by_key: Dict[int, int] = {}         # key -> acceptedKey (if any)
    rank_by_key: Dict[int, str] = {}             # key -> rank
    status_by_key: Dict[int, str] = {}           # key -> taxonomicStatus (accepted/synonym/…)
    name_by_key: Dict[int, Tuple[str, str]] = {} # key -> (canonicalName, scientificName)

    print("Taxon.tsv pass 1: gathering accepted keys for matched taxon IDs…")
    t_reader1 = open_tsv(args.taxon)
    for row in t_reader1:
        taxon_id = _get(row, "taxonKey", "taxonID", "taxonId", "usageKey", "usageID")
        if not taxon_id:
            continue
        try:
            k = int(taxon_id)
        except Exception:
            continue

        if k not in target_keys:
            continue

        # record rank/status/names for fallback
        rank_by_key[k] = (_get(row, "taxonRank", "rank") or "").lower()
        status_by_key[k] = (_get(row, "taxonomicStatus", "status") or "").lower()
        name_by_key[k] = (
            (_get(row, "canonicalName") or "").strip(),
            (_get(row, "scientificName") or "").strip()
        )

        acc = _get(row, "acceptedTaxonKey", "acceptedTaxonID", "acceptedNameUsageID", "acceptedNameUsageKey")
        if acc:
            try:
                accepted_by_key[k] = int(acc)
            except Exception:
                pass

    accepted_keys = set(accepted_by_key.values())
    all_needed_keys = set(target_keys) | accepted_keys

    print(f"Distinct accepted keys referenced: {len(accepted_keys)}  | total keys to resolve: {len(all_needed_keys)}")

    # -------- 3) Second pass: resolve names for all needed keys --------
    # Fill name_by_key, rank_by_key, status_by_key for accepted keys too
    print("Taxon.tsv pass 2: resolving canonical/scientific names for all needed keys…")
    t_reader2 = open_tsv(args.taxon)
    for row in t_reader2:
        taxon_id = _get(row, "taxonKey", "taxonID", "taxonId", "usageKey", "usageID")
        if not taxon_id:
            continue
        try:
            k = int(taxon_id)
        except Exception:
            continue
        if k not in all_needed_keys:
            continue

        if k not in name_by_key:
            name_by_key[k] = (
                (_get(row, "canonicalName") or "").strip(),
                (_get(row, "scientificName") or "").strip()
            )
        if k not in rank_by_key:
            rank_by_key[k] = (_get(row, "taxonRank", "rank") or "").lower()
        if k not in status_by_key:
            status_by_key[k] = (_get(row, "taxonomicStatus", "status") or "").lower()

    # -------- 4) Build output rows --------
    out_rows: List[Dict[str, Any]] = []
    for r in vern_rows:
        key_s = r["taxonKey"]
        try:
            k = int(key_s)
        except Exception:
            k = None

        accepted_key = accepted_by_key.get(k) if k is not None else None
        # choose accepted canonicalName when possible, else the key’s canonical/scientific
        if accepted_key and accepted_key in name_by_key:
            can, sci = name_by_key[accepted_key]
            chosen_key = accepted_key
        else:
            can, sci = name_by_key.get(k, ("", ""))
            chosen_key = k

        chosen_name = can or sci
        chosen_rank = rank_by_key.get(chosen_key, "")
        chosen_status = status_by_key.get(chosen_key, "")

        if args.species_only and chosen_rank and (chosen_rank not in SPECIES_LIKE):
            continue

        out_rows.append({
            "taxonKey": key_s,
            "vernacularName": r["vernacularName"],
            "language": r["language"],
            "languageCode": r["languageCode"],
            "countryCode": r["countryCode"],
            "isPreferredName": r["isPreferredName"],
            "resolvedScientificName": chosen_name,
            "resolvedRank": chosen_rank,
            "resolvedStatus": chosen_status,
            "acceptedTaxonKey": str(accepted_key) if accepted_key is not None else "",
        })

    print(f"Writing {len(out_rows)} rows → {args.out}")
    with open(args.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=[
            "taxonKey","vernacularName","language","languageCode","countryCode","isPreferredName",
            "resolvedScientificName","resolvedRank","resolvedStatus","acceptedTaxonKey"
        ])
        w.writeheader()
        w.writerows(out_rows)

    # quick summary
    species_rows = sum(1 for r in out_rows if r["resolvedRank"] in SPECIES_LIKE)
    print(f"Done. Species-like rows: {species_rows} / {len(out_rows)}")

if __name__ == "__main__":
    main()