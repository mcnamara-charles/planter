#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Wipe all plant_name values by updating in batches to avoid API timeouts.

Requirements:
  pip install python-dotenv supabase

Env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE   (service role key)

Usage:
  python wipe_plant_names.py [--batch 2000] [--dry-run]
"""

import os
import sys
import time
import argparse
from typing import List

from dotenv import load_dotenv
from supabase import create_client, Client

def get_sb() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    return create_client(url, key)

def fetch_batch_ids(sb: Client, after_id: str | None, batch: int) -> List[str]:
    """
    Fetch a stable, keyset-ordered batch of ids where plant_name <> ''.
    We use ORDER BY id and a 'gt' cursor on id for efficient paging.
    """
    q = sb.table("plants") \
          .select("id") \
          .neq("plant_name", "") \
          .order("id", desc=False) \
          .limit(batch)
    if after_id:
        q = q.gt("id", after_id)

    res = q.execute()
    rows = getattr(res, "data", None) or []
    return [r["id"] for r in rows]

def wipe_batch(sb: Client, ids: List[str], dry_run: bool = False) -> int:
    if not ids:
        return 0
    if dry_run:
        return len(ids)
    # Let your BEFORE UPDATE trigger set updated_at
    sb.table("plants").update({"plant_name": ""}).in_("id", ids).execute()
    return len(ids)

def main():
    ap = argparse.ArgumentParser(description="Wipe plant_name in batches to avoid timeouts.")
    ap.add_argument("--batch", type=int, default=2000, help="Rows per batch (default: 2000)")
    ap.add_argument("--dry-run", action="store_true", help="Scan & count, but do not update")
    ap.add_argument("--sleep", type=float, default=0.05, help="Sleep seconds between batches")
    args = ap.parse_args()

    sb = get_sb()

    total = 0
    batches = 0
    cursor = None
    started = time.time()

    while True:
        ids = fetch_batch_ids(sb, cursor, args.batch)
        if not ids:
            break

        # advance cursor using the last id in the ordered batch
        cursor = ids[-1]

        n = wipe_batch(sb, ids, dry_run=args.dry_run)
        total += n
        batches += 1

        # progress line
        sys.stdout.write(f"\rBatches: {batches:,}  last_id: {cursor}  wiped_this_batch: {n:,}  total_wiped: {total:,}")
        sys.stdout.flush()

        # small pause to be gentle on the API
        if args.sleep:
            time.sleep(args.sleep)

    dur = time.time() - started
    print(f"\nDone. Total rows {'to wipe' if args.dry_run else 'wiped'}: {total:,} in {dur:.1f}s (batch={args.batch}).")

if __name__ == "__main__":
    main()
