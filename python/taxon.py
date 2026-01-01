import csv
import io
import sys
import zipfile
from pathlib import Path
from collections import defaultdict

# Adjust this path if your filename is slightly different
ZIP_PATH = Path(r"C:\Users\jacob\Downloads\wfo_plantlist_2025-06 (1).zip")


def find_file(z: zipfile.ZipFile, basename: str) -> str:
    """
    Find a file inside the zip whose name ends with `basename` (case-insensitive).
    For example: 'taxon.tsv', 'name.tsv'
    """
    target = basename.lower()
    for name in z.namelist():
        if name.lower().endswith(target):
            return name
    raise FileNotFoundError(f"Could not find {basename} in the zip archive.")


def load_names(z: zipfile.ZipFile):
    """Load Name.tsv into memory; return (names_by_id, name_id_field, sci_field, rank_field, status_field)."""
    name_filename = find_file(z, "name.tsv")
    print(f"Using name file inside zip: {name_filename}")

    with z.open(name_filename, "r") as f:
        text_stream = io.TextIOWrapper(f, encoding="utf-8")
        reader = csv.DictReader(text_stream, delimiter="\t")

        fieldnames = reader.fieldnames or []
        lower_fields = {name.lower(): name for name in fieldnames}

        name_id_field = lower_fields.get("id")
        sci_field = (
            lower_fields.get("scientificname")
            or lower_fields.get("scientific_name")
            or lower_fields.get("fullname")
            or lower_fields.get("full_name")
            or lower_fields.get("name")
        )
        rank_field = (
            lower_fields.get("rank")
            or lower_fields.get("taxonrank")
            or lower_fields.get("namerank")
        )
        status_field = lower_fields.get("status") or lower_fields.get("namestatus")

        if not name_id_field or not sci_field:
            raise RuntimeError(
                "Could not infer ID/scientificName fields for Name.tsv. "
                f"Available columns: {fieldnames}"
            )

        names_by_id = {}
        begonia_name_rows = []

        for row in reader:
            nid = row[name_id_field]
            names_by_id[nid] = row

            sci = (row.get(sci_field) or "").lower()
            if "begonia" in sci and "heracleifolia" in sci:
                begonia_name_rows.append(row)

    return names_by_id, name_id_field, sci_field, rank_field, status_field, begonia_name_rows


def load_taxa(z: zipfile.ZipFile):
    """Load Taxon.tsv into memory; return (taxa_by_id, taxa_by_nameid, id_field, nameid_field, parent_field, status_field)."""
    taxon_filename = find_file(z, "taxon.tsv")
    print(f"Using taxon file inside zip: {taxon_filename}")

    with z.open(taxon_filename, "r") as f:
        text_stream = io.TextIOWrapper(f, encoding="utf-8")
        reader = csv.DictReader(text_stream, delimiter="\t")

        fieldnames = reader.fieldnames or []
        lower_fields = {name.lower(): name for name in fieldnames}

        id_field = lower_fields.get("id") or lower_fields.get("taxonid")
        parent_field = lower_fields.get("parentid") or lower_fields.get("parentnameusageid")
        nameid_field = lower_fields.get("nameid")
        status_field = lower_fields.get("status") or lower_fields.get("taxonstatus")

        if not id_field or not parent_field or not nameid_field:
            raise RuntimeError(
                "Could not infer ID/parentID/nameID fields for Taxon.tsv. "
                f"Available columns: {fieldnames}"
            )

        taxa_by_id = {}
        taxa_by_nameid = defaultdict(list)

        for row in reader:
            tid = row[id_field]
            taxa_by_id[tid] = row
            nid = row.get(nameid_field)
            if nid:
                taxa_by_nameid[nid].append(row)

    return taxa_by_id, taxa_by_nameid, id_field, nameid_field, parent_field, status_field


def pick_best_taxon_for_name(name_row, name_id_field, taxa_by_nameid, taxon_status_field):
    """
    Given a Name row, pick the best corresponding Taxon row.
    Prefer 'accepted' if a status field exists; otherwise first hit.
    """
    name_id = name_row[name_id_field]
    candidates = taxa_by_nameid.get(name_id, [])
    if not candidates:
        return None

    if taxon_status_field:
        for row in candidates:
            status = (row.get(taxon_status_field) or "").lower()
            if "accept" in status and "synonym" not in status:
                return row

    return candidates[0]


def build_lineage(
    taxa_by_id,
    names_by_id,
    starting_taxon_row,
    taxon_id_field,
    taxon_parent_field,
    taxon_nameid_field,
):
    """
    Follow parentID links from the starting taxon up to the root,
    joining each taxon to its Name row.

    Returns a list of dicts from root -> leaf, each with:
      - 'taxon': taxon_row
      - 'name': name_row
    """
    lineage = []
    current = starting_taxon_row

    while current:
        name_id = current.get(taxon_nameid_field)
        name_row = names_by_id.get(name_id)
        lineage.append({"taxon": current, "name": name_row})

        parent_id = current.get(taxon_parent_field)
        if not parent_id:
            break
        parent = taxa_by_id.get(parent_id)
        if not parent:
            break
        current = parent

    lineage.reverse()
    return lineage


def main():
    if not ZIP_PATH.exists():
        print(f"Zip file not found: {ZIP_PATH}")
        sys.exit(1)

    try:
        with zipfile.ZipFile(ZIP_PATH, "r") as z:
            # Load Name.tsv
            (
                names_by_id,
                name_id_field,
                sci_field,
                rank_field,
                name_status_field,
                begonia_name_rows,
            ) = load_names(z)

            # Load Taxon.tsv
            (
                taxa_by_id,
                taxa_by_nameid,
                taxon_id_field,
                taxon_nameid_field,
                taxon_parent_field,
                taxon_status_field,
            ) = load_taxa(z)
    except Exception as e:
        print(f"Error loading data: {e}")
        sys.exit(1)

    if not begonia_name_rows:
        print("No names found matching 'Begonia heracleifolia'.")
        sys.exit(0)

    print(f"\nFound {len(begonia_name_rows)} matching name rows for 'Begonia heracleifolia':")
    for i, row in enumerate(begonia_name_rows, start=1):
        sci = row.get(sci_field, "")
        rank = row.get(rank_field, "") if rank_field else ""
        status = row.get(name_status_field, "") if name_status_field else ""
        print(f"  [{i}] {sci}  (rank={rank}, status={status}, nameID={row[name_id_field]})")

    # For this test, just use the first matching Name row
    chosen_name = begonia_name_rows[0]
    print("\nUsing first matching name row as eyelash begonia:")
    print(f"  scientificName: {chosen_name.get(sci_field, '')}")
    print(f"  nameID        : {chosen_name[name_id_field]}")

    chosen_taxon = pick_best_taxon_for_name(
        chosen_name,
        name_id_field,
        taxa_by_nameid,
        taxon_status_field,
    )

    if chosen_taxon is None:
        print("Could not find a Taxon row for that nameID.")
        sys.exit(1)

    print("\nChosen taxon row:")
    print(f"  taxon ID : {chosen_taxon[taxon_id_field]}")
    if taxon_status_field:
        print(f"  status   : {chosen_taxon.get(taxon_status_field, '')}")
    print(f"  parentID : {chosen_taxon.get(taxon_parent_field, '')}")

    # Build the lineage
    lineage = build_lineage(
        taxa_by_id,
        names_by_id,
        chosen_taxon,
        taxon_id_field,
        taxon_parent_field,
        taxon_nameid_field,
    )

    print("\nFull taxonomy (root → Begonia heracleifolia):\n")
    for level in lineage:
        taxon_row = level["taxon"]
        name_row = level["name"]

        taxon_id = taxon_row.get(taxon_id_field, "")
        name_id = taxon_row.get(taxon_nameid_field, "")

        if name_row:
            sci_name = name_row.get(sci_field, "")
            rank = (name_row.get(rank_field) or "").capitalize() if rank_field else ""
        else:
            sci_name = f"[no Name row for nameID={name_id}]"
            rank = ""

        print(f"{rank:<12} {sci_name}  [taxonID: {taxon_id}, nameID: {name_id}]")

    print("\nDone.")


if __name__ == "__main__":
    main()
