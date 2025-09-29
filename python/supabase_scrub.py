#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Scrub care_temp_humidity from plants (Supabase).

Env (required):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE

Install:
  pip install python-dotenv supabase

Usage:
  # Dry run: count rows that would be updated
  python scrub_care_temp_supabase.py

  # Execute (perform updates) in batches of 1000
  python scrub_care_temp_supabase.py --execute --batch 1000

  # Backup matching rows before updating
  python scrub_care_temp_supabase.py --backup-csv backup.csv --execute
"""

import os
import csv
import time
import argparse
from typing import List, Dict, Any

from dotenv import load_dotenv
from supabase import create_client, Client

TABLE = "plants"
COLUMN = "care_temp_humidity"


def get_sb() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    return create_client(url, key)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=f"Null out {COLUMN} for any row where it is set.")
    ap.add_argument("--batch", type=int, default=1000, help="Rows per batch (default: 1000)")
    ap.add_argument("--sleep", type=float, default=0.05, help="Sleep seconds between batches (default: 0.05)")
    ap.add_argument("--backup-csv", help="Path to write a CSV backup of rows before updating.")
    ap.add_argument("--execute", action="store_true", help="Apply changes. Without this flag, runs as a dry run.")
    return ap.parse_args()


def fetch_target_ids(sb: Client, batch: int, after_id: str | None) -> List[str]:
    """
    Returns up to `batch` ids with care_temp_humidity NOT NULL, ordered by id ASC (keyset).
    """
    q = (
        sb.table(TABLE)
        .select("id")
        .order("id", desc=False)
        .limit(batch)
        .not_.is_(COLUMN, "null")  # COLUMN IS NOT NULL
    )
    if after_id:
        q = q.gt("id", after_id)
    res = q.execute()
    rows = getattr(res, "data", None) or []
    return [r["id"] for r in rows]


def backup_rows(sb: Client, ids: List[str], path: str) -> None:
    if not ids:
        print("Backup: no rows to write (none matched).")
        return

    cols = ["id", COLUMN]
    to_write: List[Dict[str, Any]] = []
    CHUNK = 1000
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i : i + CHUNK]
        res = sb.table(TABLE).select(",".join(cols)).in_("id", chunk).execute()
        to_write.extend(getattr(res, "data", None) or [])

    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in to_write:
            w.writerow({c: r.get(c) for c in cols})
    print(f"Backup written: {path} ({len(to_write)} rows)")


def update_batch(sb: Client, ids: List[str], dry_run: bool) -> int:
    if not ids:
        return 0
    if dry_run:
        return len(ids)
    sb.table(TABLE).update({COLUMN: None}).in_("id", ids).execute()
    return len(ids)


def collect_all_matching_ids(sb: Client, batch: int) -> List[str]:
    """Collect all matching ids (for backup or to report a full count)."""
    all_ids: List[str] = []
    cursor = None
    while True:
        got = fetch_target_ids(sb, batch, cursor)
        if not got:
            break
        all_ids.extend(got)
        cursor = got[-1]
    return all_ids


def main():
    args = parse_args()
    sb = get_sb()
    dry_run = not args.execute

    # If backing up, gather all ids first and snapshot
    if args.backup_csv:
        print("Collecting ids for backup…")
        all_ids = collect_all_matching_ids(sb, args.batch)
        if not all_ids:
            print("No matching rows found; nothing to back up.")
        else:
            backup_rows(sb, all_ids, args.backup_csv)

    total = 0
    batches = 0
    cursor = None
    started = time.time()

    while True:
        ids = fetch_target_ids(sb, args.batch, cursor)
        if not ids:
            break
        cursor = ids[-1]
        n = update_batch(sb, ids, dry_run)
        total += n
        batches += 1
        print(
            f"\rBatches: {batches:,}  last_id: {cursor}  batch_size: {len(ids):,}  "
            f"{'would_update' if dry_run else 'updated'}: {n:,}",
            end="",
            flush=True,
        )
        if args.sleep:
            time.sleep(args.sleep)

    dur = time.time() - started
    print("\nDone.")
    print(f"Total rows {'to update' if dry_run else 'updated'}: {total:,} in {dur:.1f}s (batch={args.batch}).")


if __name__ == "__main__":
    main()
