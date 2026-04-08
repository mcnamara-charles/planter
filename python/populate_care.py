#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Backfill public.plants_care from public.plants in batches of 10,000 using Supabase (PostgREST).

Assumptions:
- public.plants_care already exists (PK = plant_id) and references public.plants_core(id)
- Source data is still in public.plants

Env (required):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE

Install:
  pip install python-dotenv supabase

Usage:
  # Dry run
  python backfill_plants_care.py

  # Execute (default batch = 10000)
  python backfill_plants_care.py --execute

  # Custom batch size / sleep
  python backfill_plants_care.py --execute --batch 10000 --sleep 0.05
"""

import os
import time
import argparse
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import create_client, Client

SRC_TABLE = "plants"
DST_TABLE = "plants_care"


def get_sb() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    return create_client(url, key)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Backfill plants_care from plants in batches.")
    ap.add_argument("--batch", type=int, default=10_000, help="Rows per batch (default: 10000)")
    ap.add_argument("--sleep", type=float, default=0.05, help="Sleep seconds between batches (default: 0.05)")
    ap.add_argument("--execute", action="store_true", help="Apply changes. Without this flag, runs as a dry run.")
    return ap.parse_args()


# Columns to read from public.plants
SRC_COLS = [
    "id",
    "preferred_humidity",
    "preferred_light",
    "preferred_temp_min_c",
    "preferred_temp_max_c",
    "watering_preference",
    "soil_preference",
    "soil_description",
    "fertilizer_freq_per_month",
    "toxicity",
    "toxicity_notes",
    "growth_rate",
    "care_difficulty",
    "mature_height_cm",
    "mature_spread_cm",
    "preferred_window_best",
    "preferred_window_ok",
    "summer_note",
    "care_light",
    "care_water",
    "care_temp_humidity",
    "care_fertilizer",
    "care_pruning",
    "created_by",
    "created_at",
    "updated_at",
]

# Columns to write to public.plants_care
DST_COLS = [
    "plant_id",
    "preferred_humidity",
    "preferred_light",
    "preferred_temp_min_c",
    "preferred_temp_max_c",
    "watering_preference",
    "soil_preference",
    "soil_description",
    "fertilizer_freq_per_month",
    "toxicity",
    "toxicity_notes",
    "growth_rate",
    "care_difficulty",
    "mature_height_cm",
    "mature_spread_cm",
    "preferred_window_best",
    "preferred_window_ok",
    "summer_note",
    "care_light",
    "care_water",
    "care_temp_humidity",
    "care_fertilizer",
    "care_pruning",
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
    Transform a plants row into a plants_care row.
    - Map plants.id -> plants_care.plant_id
    - Ensure preferred_window_ok is not null (table defaults to '{}')
    """
    out: Dict[str, Any] = {}

    plant_id = row.get("id")
    if not plant_id:
        return {}

    out["plant_id"] = plant_id

    for k in DST_COLS:
        if k == "plant_id":
            continue
        out[k] = row.get(k)

    # Ensure arrays aren't null
    if out.get("preferred_window_ok") is None:
        out["preferred_window_ok"] = []

    return out


def upsert_care(sb: Client, rows: List[Dict[str, Any]], dry_run: bool) -> int:
    if not rows:
        return 0
    if dry_run:
        return len(rows)

    # Upsert by PK "plant_id"
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

        n = upsert_care(sb, payload, dry_run)
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
