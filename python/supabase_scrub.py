#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Scrub AI-generated care fields using Supabase Python client.

Env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE

Install:
  pip install python-dotenv supabase

Usage examples:
  # Dry-run on explicit ids
  python scrub_care_columns_supabase.py --ids 123,456

  # Dry-run, find ALL rows that have any touched field set, show count only
  python scrub_care_columns_supabase.py --all

  # Execute with backup, batching
  python scrub_care_columns_supabase.py --all --backup-csv backup.csv --batch 1000 --execute

  # Include extra profile-ish columns too
  python scrub_care_columns_supabase.py --all --include-profile --execute
"""

import os
import csv
import time
import argparse
from typing import List, Dict, Any

from dotenv import load_dotenv
from supabase import create_client, Client

# Fields actually written by useGenerateCare (default target)
TOUCHED_BY_HOOK: Dict[str, Any] = {
    "care_light": None,
    "care_water": None,
    "care_temp_humidity": None,
    "care_fertilizer": None,
    "care_pruning": None,
    "soil_description": None,
    "propagation_methods_json": [],  # reset to [] (since DEFAULT isn't available via PostgREST)
}

# Optional extras (off by default)
OPTIONAL_PROFILE_COLUMNS: Dict[str, Any] = {
    "preferred_humidity": None,
    "preferred_light": None,              # cannot set DEFAULT; we null it if included
    "watering_preference": None,          # same
    "fertilizer_freq_per_month": None,    # same
    "growth_rate": None,                  # same
    "preferred_window_best": None,
    "preferred_window_ok": [],            # reset to empty array
    "summer_note": None,
    "is_succulent": None,
    "growth_form": None,
}

TABLE = "plants"


def get_sb() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    return create_client(url, key)


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Scrub AI-generated care fields from plants (Supabase).")
    tgt = ap.add_mutually_exclusive_group(required=True)
    tgt.add_argument("--ids", help="Comma-separated list of plant ids to scrub.")
    tgt.add_argument("--ids-file", help="File with one plant id per line.")
    tgt.add_argument("--all", action="store_true",
                     help="Target ALL rows that currently have any touched care fields set.")
    # (Note: PostgREST raw SQL WHERE is not supported here. Use --ids/--ids-file/--all.)
    ap.add_argument("--include-profile", action="store_true",
                    help="Also scrub additional profile-ish columns.")
    ap.add_argument("--batch", type=int, default=1000, help="Rows per batch (default: 1000)")
    ap.add_argument("--sleep", type=float, default=0.05, help="Sleep seconds between batches (default: 0.05)")
    ap.add_argument("--backup-csv", help="Path to write a CSV backup of rows before updating.")
    ap.add_argument("--execute", action="store_true",
                    help="Apply changes. Without this flag, runs as a dry run.")
    return ap.parse_args()


def read_ids_file(path: str) -> List[str]:
    out: List[str] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s:
                out.append(s)
    return out


def touched_or_filter_expr() -> str:
    """
    PostgREST `or` expression matching rows that have something to scrub.
    """
    # For jsonb array, comparing to [] works (different from null).
    parts = [
        "care_light.not.is.null",
        "care_water.not.is.null",
        "care_temp_humidity.not.is.null",
        "care_fertilizer.not.is.null",
        "care_pruning.not.is.null",
        "soil_description.not.is.null",
        "propagation_methods_json.neq.[]",
    ]
    return ",".join(parts)


def fetch_target_ids(sb: Client, batch: int, after_id: str | None, mode_all: bool,
                     explicit_ids: List[str] | None) -> List[str]:
    """
    Returns up to `batch` ids either from explicit_ids (paged) or by scanning with OR filter.
    """
    if explicit_ids is not None:
        # keyset by id
        slice_ids = [i for i in explicit_ids if (after_id is None or i > after_id)]
        slice_ids.sort()
        return slice_ids[:batch]

    q = (sb.table(TABLE)
           .select("id")
           .order("id", desc=False)
           .limit(batch))

    # When scanning all, restrict to rows that have at least one touched field set
    if mode_all:
        q = q.or_(touched_or_filter_expr())

    if after_id:
        q = q.gt("id", after_id)

    res = q.execute()
    rows = getattr(res, "data", None) or []
    return [r["id"] for r in rows]


def backup_rows(sb: Client, ids: List[str], include_profile: bool, path: str) -> None:
    cols = ["id"] + list(TOUCHED_BY_HOOK.keys())
    if include_profile:
        cols += list(OPTIONAL_PROFILE_COLUMNS.keys())

    # Pull in chunks to avoid URL size issues
    to_write: List[Dict[str, Any]] = []
    CHUNK = 1000
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i:i + CHUNK]
        res = (sb.table(TABLE)
                 .select(",".join(cols))
                 .in_("id", chunk)
                 .execute())
        to_write.extend(getattr(res, "data", None) or [])

    if not to_write:
        print("Backup: no rows to write (none matched).")
        return

    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in to_write:
            w.writerow({c: r.get(c) for c in cols})
    print(f"Backup written: {path} ({len(to_write)} rows)")


def update_batch(sb: Client, ids: List[str], include_profile: bool, dry_run: bool) -> int:
    if not ids:
        return 0

    payload = dict(TOUCHED_BY_HOOK)
    if include_profile:
        payload.update(OPTIONAL_PROFILE_COLUMNS)

    if dry_run:
        return len(ids)

    # IMPORTANT: We null things we can’t set to DEFAULT via PostgREST.
    # If you prefer to restore actual defaults, run a follow-up SQL on the server.
    (sb.table(TABLE)
       .update(payload)
       .in_("id", ids)
       .execute())
    return len(ids)


def main():
    args = parse_args()
    sb = get_sb()

    explicit_ids: List[str] | None = None
    if args.ids:
        explicit_ids = [s.strip() for s in args.ids.split(",") if s.strip()]
    elif args.ids_file:
        explicit_ids = read_ids_file(args.ids_file)

    dry_run = not args.execute

    total = 0
    batches = 0
    cursor = None
    started = time.time()

    # If backing up, we need the full set of ids up-front to snapshot pre-change state.
    all_ids_for_backup: List[str] = []
    if args.backup_csv:
        # Gather all ids first (respecting selection mode)
        print("Collecting ids for backup...")
        tmp_cursor = None
        while True:
            got = fetch_target_ids(sb, args.batch, tmp_cursor, args.all, explicit_ids)
            if not got:
                break
            all_ids_for_backup.extend(got)
            tmp_cursor = got[-1]
        if not all_ids_for_backup:
            print("No matching rows found; nothing to back up.")
        else:
            backup_rows(sb, all_ids_for_backup, args.include_profile, args.backup_csv)

    # Main loop (use explicit ids list if provided; otherwise scan)
    while True:
        ids = fetch_target_ids(sb, args.batch, cursor, args.all, explicit_ids)
        if not ids:
            break

        cursor = ids[-1]
        n = update_batch(sb, ids, args.include_profile, dry_run)
        total += n
        batches += 1

        # progress line
        print(f"\rBatches: {batches:,}  last_id: {cursor}  batch_size: {len(ids):,}  {'would_update' if dry_run else 'updated'}: {n:,}",
              end="", flush=True)

        if args.sleep:
            time.sleep(args.sleep)

        # If we were given an explicit, finite id list, stop after first pass
        if explicit_ids is not None and cursor == explicit_ids[-1]:
            break

    dur = time.time() - started
    print("\nDone.")
    print(f"Total rows {'to update' if dry_run else 'updated'}: {total:,} in {dur:.1f}s (batch={args.batch}).")


if __name__ == "__main__":
    main()
