#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Backfill:
- plants_core.data_response_version + plants_core.data_response_meta
- plants_care.propagation_methods_json

Key detail:
plants_core.plant_scientific_name is NOT NULL.
Even for an upsert, Postgres must be able to INSERT rows that don't exist yet.
So the core upsert payload MUST include plant_scientific_name.

Env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE

Install:
  pip install python-dotenv supabase

Run:
  python backfill_extras.py --execute
"""

import os
import time
import argparse
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import create_client, Client

SRC_TABLE = "plants"
CORE_TABLE = "plants_core"
CARE_TABLE = "plants_care"


def get_sb() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    return create_client(url, key)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Backfill plants_core data_response_* and plants_care propagation_methods_json.")
    ap.add_argument("--batch", type=int, default=10_000)
    ap.add_argument("--sleep", type=float, default=0.05)
    ap.add_argument("--execute", action="store_true")
    return ap.parse_args()


SRC_COLS = [
    "id",
    "plant_scientific_name",
    "plant_name",  # optional, but nice to keep core inserts reasonable
    "data_response_version",
    "data_response_meta",
    "propagation_methods_json",
]


def fetch_batch(sb: Client, batch: int, after_id: Optional[str]) -> List[Dict[str, Any]]:
    q = (
        sb.table(SRC_TABLE)
        .select(",".join(SRC_COLS))
        .order("id", desc=False)
        .limit(batch)
        .not_.is_("plant_scientific_name", "null")
    )
    if after_id:
        q = q.gt("id", after_id)
    res = q.execute()
    return getattr(res, "data", None) or []


def build_core_payload(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in rows:
        pid = r.get("id")
        sci = r.get("plant_scientific_name")
        if not pid or not sci:
            continue

        ver = r.get("data_response_version")
        if ver is None:
            ver = 0

        out.append(
            {
                "id": pid,
                "plant_scientific_name": sci,   # REQUIRED for inserts
                "plant_name": r.get("plant_name"),
                "data_response_version": ver,
                "data_response_meta": r.get("data_response_meta"),
            }
        )
    return out


def build_care_payload(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in rows:
        pid = r.get("id")
        sci = r.get("plant_scientific_name")
        if not pid or not sci:
            continue  # keep aligned with core eligibility / FK

        pm = r.get("propagation_methods_json")
        if pm is None:
            pm = []

        out.append(
            {
                "plant_id": pid,
                "propagation_methods_json": pm,
            }
        )
    return out


def upsert(sb: Client, table: str, rows: List[Dict[str, Any]], on_conflict: str, dry_run: bool) -> int:
    if not rows:
        return 0
    if dry_run:
        return len(rows)
    sb.table(table).upsert(rows, on_conflict=on_conflict).execute()
    return len(rows)


def main() -> None:
    args = parse_args()
    sb = get_sb()
    dry_run = not args.execute

    total_core = 0
    total_care = 0
    batches = 0
    cursor: Optional[str] = None
    started = time.time()

    while True:
        raw = fetch_batch(sb, args.batch, cursor)
        if not raw:
            break

        cursor = raw[-1]["id"]

        core_payload = build_core_payload(raw)
        care_payload = build_care_payload(raw)

        n_core = upsert(sb, CORE_TABLE, core_payload, on_conflict="id", dry_run=dry_run)
        n_care = upsert(sb, CARE_TABLE, care_payload, on_conflict="plant_id", dry_run=dry_run)

        total_core += n_core
        total_care += n_care
        batches += 1

        print(
            f"\rBatches: {batches:,} last_id: {cursor} fetched: {len(raw):,} "
            f"{'would_upsert' if dry_run else 'upserted'} core: {n_core:,} "
            f"{'would_upsert' if dry_run else 'upserted'} care: {n_care:,}",
            end="",
            flush=True,
        )

        if args.sleep:
            time.sleep(args.sleep)

    dur = time.time() - started
    print("\nDone.")
    print(
        f"Total {'to upsert' if dry_run else 'upserted'}: "
        f"core={total_core:,}, care={total_care:,} in {dur:.1f}s (batch={args.batch})."
    )


if __name__ == "__main__":
    main()
