#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Backfill public.plants_schedule from public.plants in batches of 10,000 using Supabase (PostgREST).

Assumptions:
- public.plants_schedule already exists (PK = plant_id) and references public.plants_core(id)
- Source data is still in public.plants

Env (required):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE

Install:
  pip install python-dotenv supabase

Usage:
  # Dry run
  python backfill_plants_schedule.py

  # Execute (default batch = 10000)
  python backfill_plants_schedule.py --execute

  # Custom batch size / sleep
  python backfill_plants_schedule.py --execute --batch 10000 --sleep 0.05
"""

import os
import time
import argparse
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import create_client, Client

SRC_TABLE = "plants"
DST_TABLE = "plants_schedule"


def get_sb() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    return create_client(url, key)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Backfill plants_schedule from plants in batches.")
    ap.add_argument("--batch", type=int, default=10_000, help="Rows per batch (default: 10000)")
    ap.add_argument("--sleep", type=float, default=0.05, help="Sleep seconds between batches (default: 0.05)")
    ap.add_argument("--execute", action="store_true", help="Apply changes. Without this flag, runs as a dry run.")
    return ap.parse_args()


# Source columns to read from public.plants
SRC_COLS = [
    "id",
    "schedule_same_year_round",
    "active_season_start_date",
    "active_season_end_date",
    "water_interval_days_active",
    "water_interval_days_inactive",
    "fert_interval_days_active",
    "fert_interval_days_inactive",
    "created_by",
    "created_at",
    "updated_at",
]


def fetch_batch(sb: Client, batch: int, after_id: Optional[str]) -> List[Dict[str, Any]]:
    """
    Fetch up to `batch` rows from plants ordered by id ASC (keyset pagination using id > after_id).
    """
    q = sb.table(SRC_TABLE).select(",".join(SRC_COLS)).order("id", desc=False).limit(batch)
    if after_id:
        q = q.gt("id", after_id)
    res = q.execute()
    return getattr(res, "data", None) or []


def normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform a plants row into a plants_schedule row.
    - Map plants.id -> plants_schedule.plant_id
    """
    plant_id = row.get("id")
    if not plant_id:
        return {}

    return {
        "plant_id": plant_id,
        "schedule_same_year_round": row.get("schedule_same_year_round"),
        "active_season_start_date": row.get("active_season_start_date"),
        "active_season_end_date": row.get("active_season_end_date"),
        "water_interval_days_active": row.get("water_interval_days_active"),
        "water_interval_days_inactive": row.get("water_interval_days_inactive"),
        "fert_interval_days_active": row.get("fert_interval_days_active"),
        "fert_interval_days_inactive": row.get("fert_interval_days_inactive"),
        "created_by": row.get("created_by"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def upsert_schedule(sb: Client, rows: List[Dict[str, Any]], dry_run: bool) -> int:
    if not rows:
        return 0
    if dry_run:
        return len(rows)

    sb.table(DST_TABLE).upsert(rows, on_conflict="plant_id").execute()
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

        n = upsert_schedule(sb, payload, dry_run)
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
