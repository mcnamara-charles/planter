#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Export (id, plant_scientific_name) from your Supabase `plants` table to pretaxon.csv.

Behavior:
  • Loads SUPABASE_URL and SUPABASE_SERVICE_ROLE from .env or environment.
  • Connects via supabase-py client (same style as your Plantbook script).
  • Streams the plants table in pages (size BATCH_DB_IN).
  • Filters rows where plant_scientific_name is non-empty.
  • Writes CSV with header:
        id,plant_scientific_name
    to pretaxon.csv in the same directory as this script.

Optional envs:
  BATCH_DB_IN        = page size for DB reads (default 80)
  SB_REQUEST_TIMEOUT = Supabase PostgREST timeout in seconds (default 15)
"""

import csv
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import create_client, Client

# ---------------- Config ----------------

BATCH_DB_IN = int(os.getenv("SUPABASE_IN_MAX", "800"))          # page size for DB reads
SB_REQUEST_TIMEOUT = float(os.getenv("SB_REQUEST_TIMEOUT", "15"))  # seconds

DEBUG = False

# Raise CSV field size limit (copied pattern from your script)
_MAX = sys.maxsize
while True:
    try:
        csv.field_size_limit(_MAX)
        break
    except OverflowError:
        _MAX = int(_MAX / 10)


def dbg(*a, **k):
    if DEBUG:
        print("[DBG]", *a, **k)


# ---------------- Supabase connection ----------------

def _tweak_sb_timeouts(sb: Client):
    """Best-effort: shorten PostgREST timeout so we don't hang forever."""
    try:
        if hasattr(sb, "postgrest") and hasattr(sb.postgrest, "_client"):
            sb.postgrest._client.timeout = SB_REQUEST_TIMEOUT  # type: ignore[attr-defined]
    except Exception as e:
        print("[SB] WARN: could not set PostgREST timeout ->", repr(e))


def get_sb() -> Client:
    """Create a Supabase client using SUPABASE_URL and SUPABASE_SERVICE_ROLE."""
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    sb = create_client(url, key)
    _tweak_sb_timeouts(sb)
    return sb


def _sb_healthcheck(sb: Client) -> bool:
    """Tiny query to verify connectivity quickly."""
    try:
        t0 = time.perf_counter()
        sb.table("plants").select("id").limit(1).execute()
        dt = time.perf_counter() - t0
        print(f"[SB] Supabase healthcheck OK in {dt:.2f}s")
        return True
    except Exception as e:
        print("[SB] ERROR: Supabase healthcheck failed ->", repr(e))
        return False


# ---------------- Core export logic ----------------

def _is_blank(x: Optional[str]) -> bool:
    return x is None or (isinstance(x, str) and x.strip() == "")


def export_pretaxon_csv(
    sb: Client,
    output_csv: Path,
    max_rows: Optional[int] = None,
) -> int:
    """
    Stream `plants` from Supabase and write (id, plant_scientific_name) to CSV.

    Returns the number of rows written.
    """
    page_size = BATCH_DB_IN or 80
    written = 0
    page = 0
    target = max_rows if max_rows is not None and max_rows > 0 else 10**12

    # Ensure directory exists
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    print(f"[SB] Exporting plants in pages of {page_size}, target rows={target if target < 10**12 else 'ALL'}")

    with output_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "plant_scientific_name"])

        while written < target:
            rng_lo = page * page_size
            rng_hi = rng_lo + page_size - 1

            t0 = time.perf_counter()
            res = sb.table("plants").select("id, plant_scientific_name").range(rng_lo, rng_hi).execute()
            rows: List[Dict[str, Any]] = getattr(res, "data", None) or []
            dt = time.perf_counter() - t0

            print(f"[SB] fetched page {page} (rows={len(rows)}) in {dt:.2f}s")
            dbg("rows sample:", rows[:2])

            if not rows:
                break

            for row in rows:
                sci = (row.get("plant_scientific_name") or "").strip()
                if _is_blank(sci):
                    continue
                pid = str(row.get("id"))
                writer.writerow([pid, sci])
                written += 1
                if written >= target:
                    break

            page += 1

    return written


# ---------------- Main ----------------

def main():
    global DEBUG
    # Flip this to True if you want verbose debugging
    DEBUG = bool(int(os.getenv("PRETAXON_DEBUG", "0")))

    script_dir = Path(__file__).resolve().parent
    out_path = script_dir / "pretaxon.csv"

    print("[RUN] export_pretaxon.py")
    print(f"      output -> {out_path}")

    sb = get_sb()
    if not _sb_healthcheck(sb):
        print("[RUN] aborting due to Supabase connectivity error.")
        return

    count = export_pretaxon_csv(sb, out_path, max_rows=None)
    print(f"[RUN] Done. Wrote {count} rows to {out_path}")


if __name__ == "__main__":
    main()
