#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Backfill public.plants_core from public.plants in batches of 10,000 using Supabase (PostgREST).

Env (required):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE

Install:
  pip install python-dotenv supabase

Usage:
  # Dry run (counts what would be copied)
  python backfill_plants_core.py

  # Execute (default batch = 10000)
  python backfill_plants_core.py --execute

  # Custom batch size / sleep
  python backfill_plants_core.py --execute --batch 10000 --sleep 0.05
"""

import os
import time
import argparse
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import create_client, Client

SRC_TABLE = "plants"
DST_TABLE = "plants_core"


def get_sb() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    return create_client(url, key)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Backfill plants_core from plants in batches.")
    ap.add_argument("--batch", type=int, default=10_000, help="Rows per batch (default: 10000)")
    ap.add_argument("--sleep", type=float, default=0.05, help="Sleep seconds between batches (default: 0.05)")
    ap.add_argument("--execute", action="store_true", help="Apply changes. Without this flag, runs as a dry run.")
    return ap.parse_args()


CORE_COLS = [
    "id",
    "plant_name",
    "plant_scientific_name",
    "plant_main_image",
    "origin_region",
    "family",
    "genus",
    "rank",
    "gbif_usage_key",
    "gbif_match_type",
    "gbif_confidence",
    "species_taxon_id",
    "description",
    "tags",
    "created_by",
    "created_at",
    "updated_at",
    "is_obtainable",
]


def fetch_batch(sb: Client, batch: int, after_id: Optional[str]) -> List[Dict[str, Any]]:
    """
    Fetch up to `batch` rows from plants with plant_scientific_name NOT NULL,
    ordered by id ASC (keyset pagination using id > after_id).
    """
    q = (
        sb.table(SRC_TABLE)
        .select(",".join(CORE_COLS))
        .order("id", desc=False)
        .limit(batch)
        .not_.is_("plant_scientific_name", "null")
    )
    if after_id:
        q = q.gt("id", after_id)

    res = q.execute()
    return getattr(res, "data", None) or []


def normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Ensure the payload matches plants_core constraints.
    - tags must not be null (table is NOT NULL with default)
    - plant_scientific_name must be present (we already filter, but be safe)
    """
    out = {k: row.get(k) for k in CORE_COLS}

    sci = out.get("plant_scientific_name")
    if sci is None or (isinstance(sci, str) and not sci.strip()):
        return {}  # skip

    # tags: ensure it's a list if null
    if out.get("tags") is None:
        out["tags"] = []

    return out


def upsert_core(sb: Client, rows: List[Dict[str, Any]], dry_run: bool) -> int:
    if not rows:
        return 0
    if dry_run:
        return len(rows)

    # Upsert by PK "id"
    # supabase-py passes through to PostgREST upsert
    sb.table(DST_TABLE).upsert(rows, on_conflict="id").execute()
    return len(rows)


def main() -> None:
    args = parse_args()
    sb = get_sb()
    dry_run = not args.execute

    total = 0
    batches = 0
    cursor: Optional[str] = None
    started = time.time()

    while True:
        raw = fetch_batch(sb, args.batch, cursor)
        if not raw:
            break

        cursor = raw[-1]["id"]

        payload: List[Dict[str, Any]] = []
        skipped = 0
        for r in raw:
            nr = normalize_row(r)
            if not nr:
                skipped += 1
                continue
            payload.append(nr)

        n = upsert_core(sb, payload, dry_run)
        total += n
        batches += 1

        print(
            f"\rBatches: {batches:,}  last_id: {cursor}  fetched: {len(raw):,}  "
            f"payload: {len(payload):,}  skipped: {skipped:,}  "
            f"{'would_upsert' if dry_run else 'upserted'}: {n:,}",
            end="",
            flush=True,
        )

        if args.sleep:
            time.sleep(args.sleep)

    dur = time.time() - started
    print("\nDone.")
    print(f"Total rows {'to upsert' if dry_run else 'upserted'}: {total:,} in {dur:.1f}s (batch={args.batch}).")


if __name__ == "__main__":
    main()
