#!/usr/bin/env python
# -*- coding: utf-8 -*-

import csv
from pathlib import Path

csv_path = Path(__file__).resolve().parent / "posttaxon.csv"

total_rows = 0
all_wfos = set()
species_wfos = set()

with csv_path.open("r", encoding="utf-8", newline="") as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames or []
    print("Fieldnames:", fieldnames)

    # Find the species WFO id column
    species_wfo_col = None
    for col in fieldnames:
        if col.lower() == "species_wfo_id":
            species_wfo_col = col
            break

    if not species_wfo_col:
        raise SystemExit("Could not find Species_wfo_id column in header")

    for row in reader:
        total_rows += 1

        # Count any WFO ids in any *_wfo_id columns
        for k, v in row.items():
            if not k.endswith("_wfo_id"):
                continue
            v = (v or "").strip()
            if v:
                all_wfos.add(v)

        # Specifically track species-level WFO ID
        v = (row.get(species_wfo_col) or "").strip()
        if v:
            species_wfos.add(v)

print(f"Total rows in posttaxon.csv:         {total_rows:,}")
print(f"Distinct WFO IDs (all ranks):       {len(all_wfos):,}")
print(f"Distinct Species WFO IDs:           {len(species_wfos):,}")
print(f"Rows missing Species_wfo_id:        {total_rows - len(species_wfos):,}")
