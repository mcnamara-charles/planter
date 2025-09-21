#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Fix TSV files for tools that treat double-quotes as CSV quotes (e.g., Tablab/DuckDB).
- Escapes embedded `"` by doubling them and wraps affected fields in quotes.
- Keeps tab as the delimiter.
- Preserves header and column order; enforces a consistent column count.
- Streams line-by-line to handle very large files.

Usage:
  python fix_tablab_tsv.py /path/to/input.tsv [--out /path/to/output.tsv]
                           [--strict-columns] [--drop-extra]
                           [--clean-control]

Notes:
  - If you prefer a lighter touch (just double quotes without wrapping),
    set WRAP_WHEN_ESCAPED=True below (defaults to True already).
"""

import argparse
import csv
import io
import os
import re
import sys

TAB = "\t"
NEWLINE = "\n"
WRAP_WHEN_ESCAPED = True  # When a field contains quotes/tabs/newlines, wrap it in quotes after escaping.
ENCODING = "utf-8"        # Change if your file is Latin-1, etc.

CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")  # keep \t (\x09), \n (\x0A), \r (\x0D)

def sanitize_field(val: str, clean_control: bool = False) -> str:
    """Return a TSV-safe field that also satisfies CSV quote rules."""
    if clean_control and val:
        val = CONTROL_CHARS_RE.sub("", val)

    needs_wrap = False

    if '"' in val:
        # Double the quotes for CSV-compat
        val = val.replace('"', '""')
        needs_wrap = True

    # In strict CSV, fields with delimiters or newlines should be wrapped.
    if TAB in val or "\n" in val or "\r" in val:
        needs_wrap = True

    if needs_wrap and WRAP_WHEN_ESCAPED:
        return f'"{val}"'
    return val

def write_row(out_fh: io.TextIOBase, cols) -> None:
    """Write a row as TSV with normalized newline."""
    out_fh.write(TAB.join(cols) + NEWLINE)

def main():
    ap = argparse.ArgumentParser(description="Fix TSV for Tablab/DuckDB by escaping quotes and normalizing rows.")
    ap.add_argument("input", help="Path to the input TSV file")
    ap.add_argument("--out", help="Path to the output TSV file (default: <input>.fixed.tsv)")
    ap.add_argument("--strict-columns", action="store_true",
                    help="Enforce the exact header column count; pad missing with empty, truncate extras.")
    ap.add_argument("--drop-extra", action="store_true",
                    help="If --strict-columns, drop extra columns rather than truncating silently.")
    ap.add_argument("--clean-control", action="store_true",
                    help="Remove non-printable control characters (except TAB/CR/LF) from fields.")
    args = ap.parse_args()

    in_path = args.input
    out_path = args.out or (os.path.splitext(in_path)[0] + ".fixed.tsv")

    if not os.path.exists(in_path):
        print(f"Input file not found: {in_path}", file=sys.stderr)
        sys.exit(1)

    # Open input in universal newline mode; we will normalize to '\n' on output.
    with open(in_path, "r", encoding=ENCODING, newline="") as inf, \
         open(out_path, "w", encoding=ENCODING, newline="") as outf:

        # Read the first line as header (raw TSV split; we do NOT honor quotes in input).
        header_line = inf.readline()
        if not header_line:
            print("Input is empty.", file=sys.stderr)
            sys.exit(1)

        # Normalize possible CRLF/CR
        header_line = header_line.rstrip("\r\n")
        header_cols = header_line.split(TAB)

        # Sanitize header (generally should not need quotes but we stay consistent)
        fixed_header = [sanitize_field(h, args.clean_control) for h in header_cols]
        write_row(outf, fixed_header)

        expected_cols = len(header_cols)

        # Process remaining lines
        for lineno, raw in enumerate(inf, start=2):
            # Normalize EOL
            raw = raw.rstrip("\r\n")

            # Split STRICTLY by TAB; we ignore quotes in the source (TSV convention)
            cols = raw.split(TAB)

            if args.strict_columns:
                if len(cols) < expected_cols:
                    # Pad missing columns with empty strings
                    cols = cols + [""] * (expected_cols - len(cols))
                elif len(cols) > expected_cols:
                    # Either drop extras or truncate
                    if args.drop_extra:
                        cols = cols[:expected_cols]
                    else:
                        cols = cols[:expected_cols]
                # else: exact match; do nothing

            # Sanitize each field
            cols = [sanitize_field(c, args.clean_control) for c in cols]

            write_row(outf, cols)

    print(f"Fixed file written to: {out_path}")

if __name__ == "__main__":
    main()
