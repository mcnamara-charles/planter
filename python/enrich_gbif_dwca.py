#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse, csv, os, sys
from typing import Dict, List, Tuple, Optional, Any, Iterable
from collections import defaultdict

from dotenv import load_dotenv
from supabase import create_client, Client
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------- Config ----------------
BATCH_DB_IN      = int(os.getenv("SUPABASE_IN_MAX", "80"))
DB_CONCURRENCY   = int(os.getenv("DB_CONCURRENCY", "8"))
UPSERT_BATCH     = int(os.getenv("UPSERT_BATCH", "1000"))
SET_DISPLAY      = os.getenv("DWCA_SET_DISPLAY", "1") == "1"
DEBUG            = False
SUPPRESS_NO_VERN_DBG = False  # hide only the "no vernacular found" debug entries

_MAX = sys.maxsize
while True:
    try:
        csv.field_size_limit(_MAX); break
    except OverflowError:
        _MAX = int(_MAX / 10)

def dbg(*a, **k):
    if DEBUG: print("[DBG]", *a, **k)

# ---------------- Supabase ----------------
def get_sb() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    return create_client(url, key)

def _new_sb() -> Client:
    load_dotenv()
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE"])

def _parallel_update_plants(pairs: List[Tuple[str, Dict[str, Any]]],
                            workers: int = DB_CONCURRENCY,
                            batch: int = 200) -> int:
    def job(chunk):
        sb2 = _new_sb()
        n = 0
        for pid, payload in chunk:
            if not payload: continue
            try:
                sb2.table("plants").update(payload).eq("id", pid).execute()
                n += 1
            except Exception as e:
                print("WARN: plants update failed for", pid, "->", repr(e))
        return n

    chunks = [pairs[i:i+batch] for i in range(0, len(pairs), batch)]
    updated = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(job, c) for c in chunks]
        for f in as_completed(futs):
            try:
                updated += f.result()
            except Exception as e:
                print("WARN: update batch failed ->", repr(e))
    return updated

def _parallel_upsert_synonyms(rows: List[dict], batch: int = UPSERT_BATCH, workers: int = DB_CONCURRENCY) -> int:
    def job(batch_rows):
        if not batch_rows: return 0
        sb2 = _new_sb()
        seen = set()
        uniq = []
        for r in batch_rows:
            key = (r["plant_id"], (r["name"] or "").lower(), r.get("kind") or "common", r.get("locale") or "")
            if key in seen: continue
            seen.add(key)
            uniq.append(r)
        if not uniq: return 0
        try:
            sb2.table("plant_synonyms").upsert(
                uniq,
                ignore_duplicates=True,
                returning="minimal"
            ).execute()
        except Exception as e:
            print("WARN: synonym upsert failed ->", repr(e))
        return len(uniq)

    chunks = [rows[i:i+batch] for i in range(0, len(rows), batch)]
    sent = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(job, c) for c in chunks]
        for f in as_completed(futs):
            try:
                sent += f.result()
            except Exception as e:
                print("WARN: synonym batch failed ->", repr(e))
    return sent

# ---------------- Helpers ----------------
def canon_binomial(s: str) -> str:
    import re
    if not s: return ""
    s = re.sub(r"[×x]\s*", "", s)
    s = re.sub(r"\b(subsp\.|ssp\.|var\.|f\.|cv\.)\b.*", "", s, flags=re.I)
    parts = s.strip().split()
    return " ".join(parts[:2]) if len(parts) >= 2 else s.strip()

def _get(row: dict, *keys: str) -> Optional[str]:
    for k in keys:
        if k in row and row[k] is not None:
            return str(row[k])
    low = {k.lower(): k for k in row.keys()}
    for k in keys:
        kk = low.get(k.lower())
        if kk and row[kk] is not None:
            return str(row[kk])
    return None

def _pick_score(name: str, preferred: Optional[bool], lang: str, country: Optional[str]) -> int:
    s = 0
    if lang in ("en","eng"): s += 10
    if preferred: s += 5
    if (country or "").upper() in ("US","GB","CA","AU","NZ"): s += 2
    words = name.split()
    s += max(0, 6 - len(words))
    low = name.lower()
    if (" family" in low or low.endswith(" family")
        or " genus" in low or " order" in low
        or " group" in low or " aggregate" in low or " complex" in low):
        s -= 3
    return s

def _best_locale(lang: str, country: Optional[str]) -> str:
    lang = "en" if lang in ("en","eng") else (lang or "en")
    cc = (country or "").upper()
    return f"{lang}-{cc}" if (lang == "en" and cc) else lang

def _is_blank(x: Optional[str]) -> bool:
    return x is None or (isinstance(x, str) and x.strip() == "")

# ---------------- TSV reader ----------------
def iter_tsv_select(path: str, wanted: list[str]):
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
        header = f.readline()
        if not header: return
        cols = header.rstrip("\r\n").split("\t")
        low = {c.lower(): i for i, c in enumerate(cols)}
        idx = {}
        for w in wanted:
            i = low.get(w.lower())
            if i is not None:
                idx[w] = i
        for line in f:
            cells = line.rstrip("\r\n").split("\t")
            yield {w: (cells[i] if i < len(cells) else "") for w, i in idx.items()}

# ---------------- Main enrichment ----------------
def enrich_from_backbone(
    dir_path: str,
    max_rows: Optional[int] = None,
    batch_db: int = 20000,
    only_sci: Optional[str] = None,
    force: bool = False,
    lang_filter: str = "en,eng",
    allow_any_lang_fallback: bool = False
):
    sb = get_sb()

    # 1) Load candidate plants (with optional narrowing + force)
    offset = 0
    need_rows: List[dict] = []
    all_rows_for_index: Dict[str, List[dict]] = defaultdict(list)

    select_cols = "id, plant_scientific_name, plant_name, gbif_usage_key"
    try:
        sb.table("plants").select(select_cols).limit(1).execute()
        has_gbif = True
    except Exception:
        select_cols = "id, plant_scientific_name, plant_name"
        has_gbif = False

    scanned = 0
    while True:
        res = sb.table("plants").select(select_cols).range(offset, offset + batch_db - 1).execute()
        rows = getattr(res, "data", None) or []
        if not rows: break

        for r in rows:
            sci  = (r.get("plant_scientific_name") or "")
            cn   = canon_binomial(sci)
            all_rows_for_index[cn].append(r)

            # if --only-sci is set, skip other species up front
            if only_sci and cn.lower() != canon_binomial(only_sci).lower():
                continue

            name = (r.get("plant_name") or "")
            gate = _is_blank(name) or _is_blank(sci) or (sci.strip() == name.strip())
            if force or gate:
                need_rows.append(r)
            else:
                if only_sci:
                    print(f"[SKIP] id={r['id']} sci='{sci}' name='{name}' -> gate=FALSE (not blank and not equal); use --force to include")

        scanned += len(rows)
        offset  += len(rows)
        if DEBUG and scanned % 10000 == 0:
            print(f"[DBG] scanned={scanned:,} need_rows={len(need_rows):,}")

        if max_rows and len(need_rows) >= max_rows:
            need_rows = need_rows[:max_rows]
            break

    if not need_rows:
        print("Nothing to do: no plants matched filters/gate.")
        if only_sci:
            cn = canon_binomial(only_sci)
            existing = all_rows_for_index.get(cn) or []
            if not existing:
                print(f"[INFO] No plants in DB with canonical sci='{cn}'.")
            else:
                print("[INFO] DB rows for this sci:")
                for r in existing:
                    print("  id=", r["id"], " sci=", r.get("plant_scientific_name"), " name=", r.get("plant_name"),
                          " gbif=", r.get("gbif_usage_key"))
                print("Re-run with --force to include these rows.")
        return

    # diagnostics
    need_with_sci     = [r for r in need_rows if not _is_blank(r.get("plant_scientific_name"))]
    need_without_sci  = [r for r in need_rows if _is_blank(r.get("plant_scientific_name"))]
    need_display_blank= [r for r in need_rows if _is_blank(r.get("plant_name"))]

    print(
        "Backbone-DWCA: scanned_rows={:,}  need_total={:,}  with_scientific={:,}  "
        "without_scientific={:,}  display_blank={:,}"
        .format(scanned, len(need_rows), len(need_with_sci), len(need_without_sci), len(need_display_blank))
    )
    if only_sci:
        print(f"[Focus] only_sci='{only_sci}' (canonical='{canon_binomial(only_sci)}') force={force}")

    # 2) Build target names
    need_names  = set(canon_binomial(r["plant_scientific_name"]) for r in need_rows if r.get("plant_scientific_name"))

    # 3) Strict species-only index from Taxon.tsv
    taxon_path = os.path.join(dir_path, "Taxon.tsv")
    if not os.path.exists(taxon_path):
        print("ERROR: Taxon.tsv not found in", dir_path); return

    name_to_keys: Dict[str, List[int]] = defaultdict(list)
    wanted_taxon_cols = [
        "kingdom",
        "taxonRank", "rank",
        "canonicalName", "scientificName",
        "taxonID", "taxonId", "usageID", "usageKey",
    ]
    for row in iter_tsv_select(taxon_path, wanted_taxon_cols):
        kingdom = (_get(row, "kingdom") or "").strip().lower()
        if kingdom and kingdom != "plantae":
            continue

        rank = (_get(row, "taxonRank", "rank") or "").strip().lower()
        if rank != "species":
            continue

        sci = (_get(row, "canonicalName") or _get(row, "scientificName") or "").strip()
        if not sci:
            continue
        cn = canon_binomial(sci)
        if cn not in need_names:
            continue

        row_key = _get(row, "taxonID", "taxonId", "usageID", "usageKey")
        if not row_key:
            continue
        try:
            k = int(row_key)
        except ValueError:
            continue

        if k not in name_to_keys[cn]:
            name_to_keys[cn].append(k)

    # Print per-species key mapping when focused
    if only_sci:
        cn = canon_binomial(only_sci)
        print(f"[Taxon] species keys for '{cn}':", name_to_keys.get(cn, []))

    target_keys: set[int] = set()
    for ks in name_to_keys.values():
        target_keys.update(ks)

    if not target_keys:
        print("No species GBIF keys found for the needed names.")
        return

    # 4) Vernaculars
    vern_path = os.path.join(dir_path, "VernacularName.tsv")
    if not os.path.exists(vern_path):
        print("ERROR: VernacularName.tsv not found in", dir_path); return

    lang_allow = set(s.strip().lower() for s in lang_filter.split(",") if s.strip())
    # also collect all vernaculars (any language) for diagnostics
    all_vern_by_key: Dict[int, List[Tuple[str,str]]] = defaultdict(list)  # key -> [(name, lang), ...]
    best_by_key: Dict[int, Tuple[int, str, str]] = {}       # allowed langs
    best_any_by_key: Dict[int, Tuple[int, str, str]] = {}   # ANY lang (fallback)

    wanted_vern_cols = [
        "taxonID", "taxonId", "usageID", "usageKey",
        "vernacularName", "vernacularname",
        "language", "languageCode",
        "countryCode", "country",
        "isPreferredName", "preferred", "isPreferred",
    ]
    for row in iter_tsv_select(vern_path, wanted_vern_cols):
        tid = _get(row, "taxonID", "taxonId", "usageID", "usageKey")
        if not tid: continue
        try:
            k = int(tid)
        except ValueError:
            continue
        if k not in target_keys:
            continue

        name = (_get(row, "vernacularName", "vernacularname") or "").strip()
        if not name: continue

        lang = (_get(row, "language", "languageCode") or "").strip().lower()
        country = (_get(row, "countryCode", "country") or "").strip()
        pref_s = (_get(row, "isPreferredName", "preferred", "isPreferred") or "").strip().lower()
        preferred = (pref_s in ("true","t","1","yes","y"))

        # score ANY-language for fallback
        score_any = _pick_score(name, preferred, lang or "en", country)
        locale_any = _best_locale(lang or "en", country)
        prev_any = best_any_by_key.get(k)
        if (prev_any is None) or (score_any > prev_any[0]):
            best_any_by_key[k] = (score_any, name, locale_any)

        # score only if language passes filter
        if (not lang) or (lang in lang_allow):
            score = _pick_score(name, preferred, lang or "en", country)
            locale = _best_locale(lang or "en", country)
            prev = best_by_key.get(k)
            if (prev is None) or (score > prev[0]):
                best_by_key[k] = (score, name, locale)

    if only_sci:
        cn = canon_binomial(only_sci)
        keys = name_to_keys.get(cn, [])
        print(f"[Vernaculars:any-lang] for '{cn}':")
        for k in keys:
            names = all_vern_by_key.get(k, [])
            if not names:
                print(f"  key {k}: (none)")
            else:
                preview = "; ".join([f"{n} [{(lg or '?')}]" for n, lg in names[:10]])
                more = " ..." if len(names) > 10 else ""
                print(f"  key {k}: {preview}{more}")
        print(f"[Vernaculars:filtered={sorted(lang_allow)}] best_by_key:")
        for k in keys:
            b = best_by_key.get(k)
            print("  key", k, "->", b)

    # 5) Build updates
    updates: List[Tuple[str, Dict[str, Any]]] = []
    syns: List[dict] = []
    seen_syn = set()

    best_by_name: Dict[str, Tuple[int, str, str]] = {}
    for cn, keys in name_to_keys.items():
        best = None
        for k in keys:
            b = best_by_key.get(k) or (allow_any_lang_fallback and best_any_by_key.get(k))
            if not b: continue
            if (best is None) or (b[0] > best[0]):
                best = b
        if best:
            best_by_name[cn] = best

    confirmed_candidates = 0
    species_direct_hits = 0

    for r in need_rows:
        pid = r["id"]
        sci = (r.get("plant_scientific_name") or "").strip()
        if not sci:
            continue
        cn = canon_binomial(sci)

        best_name, best_locale = None, None
        current_name = (r.get("plant_name") or "").strip()

        if r.get("gbif_usage_key") is not None:
            try:
                gk = int(r["gbif_usage_key"])
                if gk in set(name_to_keys.get(cn, [])):
                    b = best_by_key.get(gk) or (allow_any_lang_fallback and best_any_by_key.get(gk))
                    if b:
                        _, bn, loc = b
                        best_name, best_locale = bn, loc
                        species_direct_hits += 1
            except (TypeError, ValueError):
                pass

        if not best_name:
            b = best_by_name.get(cn)
            if b:
                _, bn, loc = b
                best_name, best_locale = bn, loc
                species_direct_hits += 1

        if only_sci and cn.lower() == canon_binomial(only_sci).lower():
            print(f"[Row] id={pid} sci='{sci}' current_name='{r.get('plant_name')}' gbif={r.get('gbif_usage_key')} -> chosen='{best_name}'")

        _no_vern = not best_name
        if not (SUPPRESS_NO_VERN_DBG and _no_vern):
            dbg(f"id={pid} sci='{sci}' current='{current_name}' best='{best_name or ''}' loc='{best_locale or ''}'")

        if not best_name:
            if not SUPPRESS_NO_VERN_DBG:
                dbg("  skip: no vernacular found under filter" + (", used ANY fallback but still none" if allow_any_lang_fallback else ""))
            continue
        if best_name.strip().lower() == sci.lower():
            dbg("  skip: best common == scientific")
            continue
        if (not force) and current_name and current_name.strip().lower() != sci.strip().lower():
            dbg("  skip: current display already != scientific; pass --force to override")
            continue

        confirmed_candidates += 1

        syn_key = (pid, best_name.lower(), "common", (best_locale or "en"))
        if syn_key not in seen_syn:
            seen_syn.add(syn_key)
            syns.append({
                "plant_id": pid,
                "name": best_name,
                "kind": "common",
                "locale": best_locale or "en"
            })

        if SET_DISPLAY:
            updates.append((pid, {"plant_name": best_name}))

    print(
        f"DWCA (strict species): confirmed_candidates={confirmed_candidates:,}  "
        f"species_hits={species_direct_hits:,}  updates={len(updates):,}  commons={len(syns):,}"
    )

    if only_sci:
        print("[Preview] first few synonyms to upsert for focus species:")
        for s in syns[:10]:
            print("  ", s)

    # 6) Apply
    if updates:
        updated = _parallel_update_plants(updates, workers=DB_CONCURRENCY, batch=200)
        print("DWCA: rows_updated=", updated)
    if syns:
        sent = _parallel_upsert_synonyms(syns, batch=UPSERT_BATCH, workers=DB_CONCURRENCY)
        print("DWCA: synonym_rows_sent=", sent)

def main():
    global DEBUG
    ap = argparse.ArgumentParser(description="Enrich plants from GBIF Backbone DwC-A (Taxon.tsv + VernacularName.tsv)")
    ap.add_argument("--dir", required=True, help="Unzipped Backbone directory (contains Taxon.tsv & VernacularName.tsv)")
    ap.add_argument("--max-rows", type=int, help="Cap number of DB candidates to process")
    ap.add_argument("--batch-db", type=int, default=20000, help="DB paging size when scanning plants")
    ap.add_argument("--only-sci", help="Process only this canonical binomial (e.g., 'Streptocarpus ionanthus')")
    ap.add_argument("--force", action="store_true", help="Bypass needs-update gate for matched rows")
    ap.add_argument("--lang", default="en,eng", help="CSV language filter for vernaculars (default: en,eng)")
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--allow-any-lang-fallback", action="store_true",
                    help="If no English vernacular exists, fall back to best name in ANY language")
    ap.add_argument("--suppress-no-vernacular-debug",
                    action="store_true",
                    help="Suppress only the '[DBG] ... skip: no vernacular found ...' entries (and their empty-id line)")
    args = ap.parse_args()

    DEBUG = args.debug
    global SUPPRESS_NO_VERN_DBG
    SUPPRESS_NO_VERN_DBG = args.suppress_no_vernacular_debug
    enrich_from_backbone(
        args.dir,
        max_rows=args.max_rows,
        batch_db=args.batch_db,
        only_sci=args.only_sci,
        force=args.force,
        lang_filter=args.lang or "en,eng",
        allow_any_lang_fallback=args.allow_any_lang_fallback,
    )

if __name__ == "__main__":
    main()
