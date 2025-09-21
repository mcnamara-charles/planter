#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse, csv, os, sys, time
from typing import Dict, List, Tuple, Optional, Any
from collections import defaultdict

from dotenv import load_dotenv
from supabase import create_client, Client
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------- Config ----------------
BATCH_DB_IN      = int(os.getenv("SUPABASE_IN_MAX", "80"))    # page size for DB reads
DB_CONCURRENCY   = int(os.getenv("DB_CONCURRENCY", "8"))      # threads for writes
UPSERT_BATCH     = int(os.getenv("UPSERT_BATCH", "1000"))     # upsert batch for synonyms
SET_DISPLAY      = os.getenv("DWCA_SET_DISPLAY", "1") == "1"  # reuse flag: update display name if True
SB_REQUEST_TIMEOUT = float(os.getenv("SB_REQUEST_TIMEOUT", "15"))  # seconds
PLANTBOOK_RATE_DELAY = float(os.getenv("PLANTBOOK_RATE_DELAY", "0.2"))  # throttle PB calls
PLANTBOOK_LANGS = os.getenv("PLANTBOOK_LANGS", "en,eng").lower().split(",")

# If you prefer ENV, set OPENPLANTBOOK_API_KEY. We fall back to your provided token:
PB_API_KEY = os.getenv("OPENPLANTBOOK_API_KEY", "c3c18f15e1cc9f019b7d3e1874f1bd893437bffd")

DEBUG = False

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
    sb = create_client(url, key)
    _tweak_sb_timeouts(sb)
    return sb

def _new_sb() -> Client:
    load_dotenv()
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE"])
    _tweak_sb_timeouts(sb)
    return sb

def _tweak_sb_timeouts(sb: Client):
    """Best-effort: shorten PostgREST timeout so we don't hang forever."""
    try:
        if hasattr(sb, "postgrest") and hasattr(sb.postgrest, "_client"):
            sb.postgrest._client.timeout = SB_REQUEST_TIMEOUT  # type: ignore[attr-defined]
    except Exception as e:
        print("[PB] WARN: could not set PostgREST timeout ->", repr(e))

def _sb_healthcheck(sb: Client) -> bool:
    """Tiny query to verify connectivity quickly."""
    try:
        t0 = time.perf_counter()
        sb.table("plants").select("id").limit(1).execute()
        dt = time.perf_counter() - t0
        print(f"[PB] Supabase healthcheck OK in {dt:.2f}s")
        return True
    except Exception as e:
        print("[PB] ERROR: Supabase healthcheck failed ->", repr(e))
        return False

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

# ---------------- Plantbook HTTP ----------------
def _pb_auth_headers() -> Dict[str, str]:
    if PB_API_KEY:
        return {"x-api-key": PB_API_KEY}
    return {}

def _pb_search_raw(alias: str, limit: int = 10, offset: int = 0) -> List[dict]:
    """Search plants by alias (scientific/common)."""
    import requests
    headers = _pb_auth_headers()
    params = {"alias": alias, "limit": str(limit), "offset": str(offset)}
    url = "https://open.plantbook.io/api/v1/plant/search"
    r = requests.get(url, headers=headers, params=params, timeout=20)
    r.raise_for_status()
    j = r.json()
    return j.get("data", j if isinstance(j, list) else [])

def _pb_get_detail_raw(pid: str) -> dict:
    """Fetch plant detail by id/pid."""
    import requests
    headers = _pb_auth_headers()
    url = f"https://open.plantbook.io/api/v1/plant/{pid}"
    r = requests.get(url, headers=headers, timeout=20)
    r.raise_for_status()
    return r.json()

def _pb_list_page(letter: str, limit: int, offset: int) -> Tuple[List[dict], int]:
    """Rudimentary discovery: search by letter; returns (rows, count_like)."""
    rows = _pb_search_raw(alias=letter, limit=limit, offset=offset)
    return rows, len(rows)

def _pb_extract_sci(detail: dict) -> str:
    return (
        _get(detail, "scientific_name", "scientificName", "binomial_name", "binomialName", "species", "canonicalName")
        or ""
    ).strip()

def _pb_get_pid(r: dict) -> Optional[str]:
    return _get(r, "display_pid", "pid", "id", "plant_id")

def _pb_exact_match(rows: List[dict], sci_canon: str) -> Optional[dict]:
    sci_canon_low = sci_canon.lower()
    for r in rows:
        sci = _pb_extract_sci(r)
        if canon_binomial(sci).lower() == sci_canon_low:
            return r
    return None

def _pb_pick_eng_common(detail: dict) -> Tuple[Optional[str], Optional[str], List[Tuple[str,str]]]:
    """
    Return (best_common_name, best_locale, all_common_pairs)
    Supports:
      - common_names: [{name, language, country}]
      - common_name: "string"
      - aliases/synonyms: ["string", ...]
    """
    commons: List[Tuple[str,str]] = []

    arr = detail.get("common_names") or detail.get("commonNames") or []
    for item in arr if isinstance(arr, list) else []:
        name = _get(item, "name", "value") or ""
        lang = (_get(item, "language", "lang") or "en").lower()
        country = _get(item, "country", "countryCode")
        locale = _best_locale(lang, country)
        if name.strip():
            commons.append((name.strip(), locale))

    single = _get(detail, "common_name", "commonName")
    if single and single.strip():
        commons.append((single.strip(), "en"))

    aliases = detail.get("aliases") or detail.get("synonyms") or []
    for a in aliases if isinstance(aliases, list) else []:
        if isinstance(a, str) and a.strip():
            commons.append((a.strip(), "en"))

    # Dedup
    seen = set()
    uniq: List[Tuple[str,str]] = []
    for n, loc in commons:
        key = (n.lower(), (loc or "").lower())
        if key not in seen:
            seen.add(key)
            uniq.append((n, loc or "en"))

    # Score/pick best
    best = None
    for n, loc in uniq:
        lang = (loc or "en").split("-")[0]
        score = _pick_score(n, preferred=True, lang=lang, country=(loc.split("-")[1] if "-" in (loc or "") else None))
        if (best is None) or (score > best[0]) or (score == best[0] and lang in PLANTBOOK_LANGS):
            best = (score, n, loc)

    if best:
        return best[1], best[2], uniq
    return None, None, uniq

# ---------------- Interactive prompt ----------------
def _prompt_yes_no_one(msg: str) -> str:
    """
    Interactive prompt:
      Y = yes, N = no, A = approve all, S = skip all, Q = quit now
    """
    if not sys.stdin.isatty():
        print("[PB] Non-interactive TTY: default SKIP")
        return 'n'
    while True:
        resp = input(msg + " [Y]es / [N]o / [A]ll yes / [S]kip all / [Q]uit > ").strip().lower()
        if resp in ("y","n","a","s","q"): return resp
        if resp == "": return "n"

# ---------------- Candidate collection ----------------
def _stream_db_candidates(sb: Client, max_rows: int, only_sci: Optional[str], force: bool) -> List[dict]:
    """Scan your plants table page-by-page and pick rows that need update."""
    wanted = max_rows if max_rows else 10**9
    page = 0
    page_size = BATCH_DB_IN or 80
    candidates: List[dict] = []

    print(f"[PB] Collecting candidates from DB (page_size={page_size}, target={wanted})...")
    while len(candidates) < wanted:
        t0 = time.perf_counter()
        rng_lo = page * page_size
        rng_hi = rng_lo + page_size - 1
        res = sb.table("plants").select("id, plant_scientific_name, plant_name").range(rng_lo, rng_hi).execute()
        rows = getattr(res, "data", None) or []
        dt = time.perf_counter() - t0
        print(f"[PB] fetched page {page} rows={len(rows)} in {dt:.2f}s")
        if not rows:
            break

        for row in rows:
            sci = (row.get("plant_scientific_name") or "").strip()
            if not sci:
                continue
            if only_sci and canon_binomial(sci).lower() != canon_binomial(only_sci).lower():
                continue
            name = (row.get("plant_name") or "")
            gate = force or _is_blank(name) or (name.strip() == sci.strip())
            if gate:
                candidates.append(row)
                if len(candidates) >= wanted:
                    break
        page += 1
    return candidates

def _discover_pb_then_match_db(sb: Client, max_rows: int, only_sci: Optional[str], force: bool) -> List[dict]:
    """Discover from Plantbook (A–Z) and match rows in your DB that need updating."""
    wanted = max_rows if max_rows else 10**9
    page = 0
    page_size = BATCH_DB_IN or 80

    # Build a streaming set of DB scientific names (canonical)
    db_seen: set[str] = set()
    def fill_db_seen_until(at_least: int):
        nonlocal page
        while len(db_seen) < at_least:
            rng_lo = page * page_size
            rng_hi = rng_lo + page_size - 1
            res = sb.table("plants").select("plant_scientific_name, id, plant_name").range(rng_lo, rng_hi).execute()
            rows = getattr(res, "data", None) or []
            if not rows:
                break
            for r in rows:
                sci = (r.get("plant_scientific_name") or "").strip()
                if sci:
                    db_seen.add(canon_binomial(sci).lower())
            page += 1

    candidates: List[dict] = []
    letters = list("abcdefghijklmnopqrstuvwxyz")
    per_page = 100
    total_added = 0
    fill_db_seen_until(2000)  # seed a bit

    print(f"[PB] Discovering from Plantbook and matching DB (target={wanted})...")
    for ch in letters:
        offset = 0
        while True:
            try:
                t0 = time.perf_counter()
                rows = _pb_search_raw(alias=ch, limit=per_page, offset=offset)
                dt = time.perf_counter() - t0
                print(f"[PB] PB[{ch}] offset={offset} -> {len(rows)} rows in {dt:.2f}s")
                time.sleep(PLANTBOOK_RATE_DELAY)
            except Exception as e:
                print("WARN: Plantbook search failed for", ch, "->", repr(e))
                break
            if not rows:
                break
            for r in rows:
                sci = canon_binomial(_pb_extract_sci(r))
                if not sci:
                    continue
                if only_sci and sci.lower() != canon_binomial(only_sci).lower():
                    continue
                if sci.lower() in db_seen:
                    # Fetch matching DB row
                    try:
                        res = sb.table("plants").select("id, plant_scientific_name, plant_name").eq(
                            "plant_scientific_name", sci
                        ).limit(1).execute()
                        row = (getattr(res, "data", None) or [None])[0]
                    except Exception:
                        row = None
                    if row:
                        name = (row.get("plant_name") or "")
                        gate = force or _is_blank(name) or (name.strip() == (row.get("plant_scientific_name") or "").strip())
                        if gate:
                            candidates.append(row)
                            total_added += 1
                            if len(candidates) >= wanted:
                                break
            if len(candidates) >= wanted:
                break
            if len(rows) < per_page:
                break
            offset += per_page
        if len(candidates) >= wanted:
            break
    return candidates

# ---------------- Main enrichment ----------------
def enrich_from_plantbook(max_rows: Optional[int] = None, only_sci: Optional[str] = None, force: bool = False,
                          mode: str = "scan_db"):
    """
    mode = "scan_db" : iterate your plants table and query Plantbook per species (default)
    mode = "scan_pb" : discover from Plantbook (A–Z) and match against your DB
    """
    sb = get_sb()
    print("[PB] starting enrich_from_plantbook...", "mode=", mode, "SET_DISPLAY=", int(os.getenv("DWCA_SET_DISPLAY","1")))
    if not _sb_healthcheck(sb):
        print("[PB] Aborting due to Supabase connectivity error.")
        return

    # Collect candidates
    if mode == "scan_db":
        candidates = _stream_db_candidates(sb, max_rows or 0, only_sci, force)
    else:
        candidates = _discover_pb_then_match_db(sb, max_rows or 0, only_sci, force)

    print(f"[PB] candidates to check = {len(candidates):,}")
    if not candidates:
        print("[PB] nothing to update.")
        return

    updates_approved: List[Tuple[str, Dict[str, Any]]] = []
    syns: List[dict] = []
    seen_syn = set()
    approve_all = False
    skip_all = False

    for i, row in enumerate(candidates, 1):
        pid = row["id"]
        sci = canon_binomial(row["plant_scientific_name"])
        current_name = (row.get("plant_name") or "").strip()

        # Search Plantbook
        try:
            results = _pb_search_raw(alias=sci, limit=10, offset=0)
            time.sleep(PLANTBOOK_RATE_DELAY)
        except Exception as e:
            print("WARN: Plantbook search failed for", sci, "->", repr(e))
            continue

        hit = _pb_exact_match(results, sci) or (results[0] if results else None)
        if not hit:
            continue

        # Detail fetch
        detail = None
        pid2 = _pb_get_pid(hit)
        if pid2:
            try:
                detail = _pb_get_detail_raw(pid2)
                time.sleep(PLANTBOOK_RATE_DELAY)
            except Exception as e:
                print("WARN: Plantbook detail failed for", pid2, "->", repr(e))
        detail = detail or hit

        sci2 = _pb_extract_sci(detail) or sci
        best_name, best_loc, commons = _pb_pick_eng_common(detail)

        # Collect synonyms silently
        for name, loc in commons:
            key = (pid, name.lower(), "common", (loc or "en"))
            if key in seen_syn:
                continue
            seen_syn.add(key)
            syns.append({"plant_id": pid, "name": name, "kind": "common", "locale": loc or "en"})

        # Propose display update
        if not (best_name and SET_DISPLAY):
            continue
        if best_name.strip().lower() == sci2.lower():
            continue
        if not force and current_name and current_name.strip().lower() != sci.strip().lower():
            # Current name already looks like a non-scientific common; skip unless --force
            continue

        if skip_all:
            continue

        proposal = (
            f"\n[PB] id={pid}\n"
            f"     scientific: '{sci2}'\n"
            f"     current:    '{current_name or '(blank)'}'\n"
            f"     proposed:   '{best_name}'  (locale={best_loc or 'en'})\n"
        )
        alt = [n for n,_ in commons if n.strip() and n.strip().lower() != (best_name or "").strip().lower()]
        if alt:
            preview = ", ".join(alt[:5])
            proposal += f"     other commons: {preview}{' ...' if len(alt) > 5 else ''}\n"

        if approve_all:
            updates_approved.append((pid, {"plant_name": best_name}))
            print(proposal + "     -> AUTO-APPROVED (All)\n")
        else:
            ans = _prompt_yes_no_one(proposal + "Approve?")
            if ans == 'y':
                updates_approved.append((pid, {"plant_name": best_name}))
                print("     -> approved.\n")
            elif ans == 'a':
                approve_all = True
                updates_approved.append((pid, {"plant_name": best_name}))
                print("     -> approved, and ALL subsequent will be auto-approved.\n")
            elif ans == 's':
                skip_all = True
                print("     -> skipping this and ALL subsequent proposals.\n")
            elif ans == 'q':
                print("     -> quitting early; applying approved updates so far.\n")
                break
            else:
                print("     -> skipped.\n")

        if i % 100 == 0:
            print(f"[PB] processed {i}/{len(candidates)}")

    # Apply DB changes
    if updates_approved:
        updated = _parallel_update_plants(updates_approved, workers=DB_CONCURRENCY, batch=200)
        print(f"Plantbook: rows_updated={updated} (approved={len(updates_approved)})")
    else:
        print("Plantbook: no display name updates approved.")

    if syns:
        sent = _parallel_upsert_synonyms(syns, batch=UPSERT_BATCH, workers=DB_CONCURRENCY)
        print(f"Plantbook: synonym_rows_sent={sent}")
    else:
        print("Plantbook: no synonyms to upsert.")

# ---------------- Main ----------------
def main():
    global DEBUG
    ap = argparse.ArgumentParser(description="Enrich plants using Open Plantbook (interactive approvals)")
    ap.add_argument("--max", type=int, help="Cap rows to process")
    ap.add_argument("--only-sci", help="Process only this canonical binomial (e.g., 'Streptocarpus ionanthus')")
    ap.add_argument("--force", action="store_true", help="Update even if a non-scientific display name already exists")
    ap.add_argument("--mode", choices=["scan_db","scan_pb"], default="scan_db",
                    help="Where to iterate from: your DB (default) or Plantbook discovery")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    DEBUG = args.debug
    print("[RUN] Plantbook enrichment")
    print("      max=", args.max, " only_sci=", args.only_sci, " mode=", args.mode, " force=", args.force)

    enrich_from_plantbook(
        max_rows=args.max,
        only_sci=args.only_sci,
        force=args.force,
        mode=args.mode,
    )

if __name__ == "__main__":
    main()
