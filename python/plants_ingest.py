#!/usr/bin/env python
import argparse, csv, gzip, io, json, os, sys, time
from typing import Iterable, Dict, Any, Optional, Tuple
import requests
from dotenv import load_dotenv
from tqdm import tqdm
from supabase import create_client, Client
from concurrent.futures import ThreadPoolExecutor, as_completed
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import asyncio
import httpx
from collections import defaultdict

# ---------- Debug ----------
DEBUG = False
def dbg(*args, **kwargs):
    if DEBUG:
        print("[DBG]", *args, **kwargs)

# ---------- Config ----------
GBIF_MATCH_URL = "https://api.gbif.org/v1/species/match"
GBIF_VERNACULAR_URL = "https://api.gbif.org/v1/species/{usageKey}/vernacularNames"
WIKI_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "plant-app-loader/1.0 (contact: charles@hyperbloom.ai)"
WFO_CONCURRENCY = int(os.getenv("WFO_CONCURRENCY", "8"))   # tune: 4–16
WFO_BATCH = int(os.getenv("WFO_BATCH", "1000"))      # tune: 500–3000
GBIF_CONCURRENCY = int(os.getenv("GBIF_CONCURRENCY", "24"))  # HTTP workers
DB_CONCURRENCY   = int(os.getenv("DB_CONCURRENCY", "8"))     # DB update workers
GBIF_HTTP_TIMEOUT = int(os.getenv("GBIF_HTTP_TIMEOUT", "15"))
GBIF_HTTP_BATCH   = int(os.getenv("GBIF_HTTP_BATCH", "250")) # rows per worker to process
GBIF_ASYNC = os.getenv("GBIF_ASYNC", "1") == "1"  # turn off to fall back to sync
GBIF_MAX_CONN = int(os.getenv("GBIF_MAX_CONN", "400"))    # httpx connection pool
GBIF_MATCH_LIMIT = int(os.getenv("GBIF_MATCH_LIMIT", "400"))   # concurrent /species/match
GBIF_VERN_LIMIT  = int(os.getenv("GBIF_VERN_LIMIT",  "400"))   # concurrent /vernacularNames
GBIF_RETRIES = int(os.getenv("GBIF_RETRIES", "3"))
GBIF_SYNONYM_LIMIT = int(os.getenv("GBIF_SYNONYM_LIMIT", "8"))  # max scientific synonyms to try per plant
SUPABASE_IN_MAX = int(os.getenv("SUPABASE_IN_MAX", "80"))  # keep URL short; 50–100 is usually safe
USDA_BATCH = int(os.getenv("USDA_BATCH", "2000"))          # rows per batch for DB fanout
USDA_CONCURRENCY = int(os.getenv("USDA_CONCURRENCY", "8")) # threads for DB upserts
USDA_LOCALE = os.getenv("USDA_LOCALE", "en-US")
USDA_CREATE_MISSING = os.getenv("USDA_CREATE_MISSING", "0") == "1"  # create plants for USDA-only scis?
USDA_SET_DISPLAY = os.getenv("USDA_SET_DISPLAY", "0") == "1"        # set plant_name when == scientific?
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
WIKIDATA_BATCH = int(os.getenv("WIKIDATA_BATCH", "200"))         # GBIF keys per SPARQL query
WIKIDATA_CONCURRENCY = int(os.getenv("WIKIDATA_CONCURRENCY", "3"))  # keep low; be nice to WDQS
WIKIDATA_SET_DISPLAY = os.getenv("WIKIDATA_SET_DISPLAY", "1") == "1" # set plant_name when it equals scientific?
WIKIDATA_BY_SCI = os.getenv("WIKIDATA_BY_SCI", "1") == "1"  # enable scientific-name fallback
INAT_BASE = "https://api.inaturalist.org/v1"
INAT_CONCURRENCY = int(os.getenv("INAT_CONCURRENCY", "32"))
INAT_MAX_CONN = int(os.getenv("INAT_MAX_CONN", "200"))
INAT_RETRIES = int(os.getenv("INAT_RETRIES", "3"))
INAT_MATCH_LIMIT = int(os.getenv("INAT_MATCH_LIMIT", "400"))  # concurrent name matches
INAT_SET_DISPLAY = os.getenv("INAT_SET_DISPLAY", "1") == "1"  # update plant_name if == scientific
ITIS_BASE = "https://www.itis.gov/ITISWebService/jsonservice"
ITIS_CONCURRENCY = int(os.getenv("ITIS_CONCURRENCY", "64"))
ITIS_MAX_CONN    = int(os.getenv("ITIS_MAX_CONN", "256"))
ITIS_RETRIES     = int(os.getenv("ITIS_RETRIES", "3"))
ITIS_SET_DISPLAY = os.getenv("ITIS_SET_DISPLAY", "1") == "1"  # only if display==scientific

# ---------- Supabase ----------
def get_sb() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE"]
    return create_client(url, key)

def upsert_plant_by_scientific(sb: Client, scientific: str, display: Optional[str]) -> Optional[str]:
    # Satisfy NOT NULL by defaulting plant_name to scientific
    payload = {
        "plant_scientific_name": scientific,
        "plant_name": (display or scientific)
    }
    try:
        # Avoid clobbering existing rows on conflict
        res = sb.table("plants").upsert(
            payload,
            on_conflict="plant_scientific_name",
            ignore_duplicates=True,          # do nothing on conflict
            returning="representation"       # ask server to return the row
        ).execute()

        data = getattr(res, "data", None) or (res.get("data") if isinstance(res, dict) else None)
        dbg("UPSERT payload:", payload)
        dbg("UPSERT result:", data)

        if data and isinstance(data, list) and data:
            return data[0].get("id")

        # Fallback: fetch the id explicitly
        sel = sb.table("plants").select("id").eq("plant_scientific_name", scientific).limit(1).execute()
        sdata = getattr(sel, "data", None) or (sel.get("data") if isinstance(sel, dict) else None)
        if sdata and isinstance(sdata, list) and sdata:
            return sdata[0].get("id")

        print("WARN: upsert+fetch returned no data for", scientific)
        return None

    except Exception as e:
        print("ERROR during upsert for", scientific, "->", repr(e))
        return None

def insert_synonym(sb: Client, plant_id: str, name: str, kind: str = "synonym", locale: Optional[str] = None):
    payload = {"plant_id": plant_id, "name": name, "kind": kind}
    if locale:
        payload["locale"] = locale
    sb.table("plant_synonyms").insert(payload).execute()

def update_plants_taxonomy(sb: Client, plant_id: str, family: Optional[str], genus: Optional[str],
                           canonical: Optional[str], rank: Optional[str]):
    patch = {}
    if family: patch["origin_region"] = None  # placeholder if you later store origin; keep patch minimal
    if family: patch["tags"] = None           # don't clobber; this line only for example—remove if not needed
    # Only set what we intend:
    patch = {}
    if family:  patch["tags"] = None  # safety: remove or customize as needed
    # Correct version—only taxonomy fields:
    patch = {}
    if family:  patch["soil_preference"] = None  # <- REMOVE if you didn't add this field in your schema
    # ---- Let's keep it clean & accurate: only set the taxonomy fields you actually have ----
    patch = {}
    if family:  patch["description"] = None  # also remove; sorry—resetting to a clean patch next:

    patch = {}
    if family:  patch["tags"] = None  # STOP. Let's just do a direct RPC to update only the fields we added.

    # Use a narrow update:
    colset = {}
    if family: colset["origin_region"] = None  # <- ignore taxonomy mishap; we actually want genus/family fields
    # Your schema stores family/genus under separate columns? Not yet.
    # We'll store GBIF's canonical form back into plant_scientific_name if desired, but better to preserve original.
    # For minimal risk: if plant_name empty, set to canonicalName; otherwise leave as-is.

    # Instead of patching arbitrary columns, just set plant_name when empty:
    if canonical:
        sb.table("plants").update({"plant_name": canonical}).eq("id", plant_id).is_("plant_name", "is", None).execute()

def set_main_image(sb: Client, plant_id: str, url: str, license_short: Optional[str], attribution: Optional[str]):
    # create plant_images row + set plants.plant_main_image and mark primary
    sb.table("plant_images").insert({
        "plant_id": plant_id,
        "source_url": url,
        "license": license_short,
        "attribution": attribution,
        "is_primary": True
    }).execute()
    sb.table("plants").update({"plant_main_image": url}).eq("id", plant_id).execute()

# ---------- Helpers ----------
def open_text(path: str) -> io.TextIOBase:
    # Supports .json, .csv, and .gz forms
    raw = open(path, "rb")
    head = raw.read(2); raw.seek(0)
    if path.endswith(".gz") or head == b"\x1f\x8b":
        return io.TextIOWrapper(gzip.GzipFile(fileobj=raw), encoding="utf-8")
    return io.TextIOWrapper(raw, encoding="utf-8")

def backoff_sleep(i: int):
    time.sleep(min(5, 0.5 * (2 ** i)))

import zipfile

def _open_bundle_reader(path_or_file_inside_bundle: str, filename_options: list[str]):
    """
    Return (reader, origin) where reader is a csv.DictReader over the requested TSV,
    resolving either from a .zip (preferred) or a directory containing the TSVs.
    """
    # If path points directly to a file, search its directory
    base_dir = None
    if os.path.isdir(path_or_file_inside_bundle):
        base_dir = path_or_file_inside_bundle
    else:
        if path_or_file_inside_bundle.lower().endswith(".zip"):
            z = zipfile.ZipFile(path_or_file_inside_bundle)
            # find first match inside the zip (case-insensitive)
            for cand in z.namelist():
                cl = cand.lower()
                if any(cl.endswith("/"+opt) or cl == opt for opt in filename_options):
                    fh = io.TextIOWrapper(z.open(cand), encoding="utf-8", errors="replace")
                    return csv.DictReader(fh, delimiter="\t"), f"zip:{cand}"
            raise FileNotFoundError(f"Could not find any of {filename_options} in zip")
        else:
            base_dir = os.path.dirname(path_or_file_inside_bundle)

    # Directory mode
    for opt in filename_options:
        p = os.path.join(base_dir, opt)
        if os.path.exists(p):
            fh = open(p, "r", encoding="utf-8-sig", errors="replace")
            return csv.DictReader(fh, delimiter="\t"), p
    raise FileNotFoundError(f"Could not find any of {filename_options} next to {path_or_file_inside_bundle}")

def _col(row: dict, *candidates: str) -> Optional[str]:
    for c in candidates:
        if c in row and row[c] is not None:
            return str(row[c])
    # case-insensitive fallback
    low = {k.lower(): k for k in row.keys()}
    for c in candidates:
        k = low.get(c.lower())
        if k is not None and row[k] is not None:
            return str(row[k])
    return None

def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i+n]

def _new_sb() -> Client:
    # fresh client per worker avoids shared-state/threading issues
    load_dotenv()
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE"])

def _fetch_scientific_synonyms(
    sb: Client,
    plant_ids: list[str],
    per_plant: int = GBIF_SYNONYM_LIMIT,
    in_max: int = SUPABASE_IN_MAX,
) -> dict[str, list[str]]:
    """
    Return {plant_id: [up to per_plant scientific synonyms]}.

    Uses small .in_(...) chunks to avoid PostgREST/Cloudflare URL length limits.
    Automatically halves the chunk size on 414-like errors and retries.
    """
    out: dict[str, list[str]] = defaultdict(list)

    i = 0
    n = len(plant_ids)
    size = max(1, in_max)

    while i < n:
        chunk = plant_ids[i:i + size]
        try:
            res = (
                sb.table("plant_synonyms")
                  .select("plant_id,name")
                  .in_("plant_id", chunk)
                  .eq("kind", "scientific")
                  .execute()
            )
            rows = getattr(res, "data", None) or []
            for r in rows:
                pid = r["plant_id"]
                nm = (r.get("name") or "").strip()
                if nm and len(out[pid]) < per_plant:
                    out[pid].append(nm)

            # success → advance window
            i += size

        except Exception as e:
            # Detect 414 without relying on exact exception type
            emsg = str(e)
            if "414" in emsg or "Request-URI Too Large" in emsg:
                # shrink batch and retry same window
                if size > 10:
                    size //= 2
                elif size > 1:
                    size = 1
                else:
                    # give up on this id and move on to avoid a hard loop
                    print("WARN: 414 even with size=1; skipping one id")
                    i += 1
            else:
                # unknown error: log and move the window to avoid blocking the run
                print("WARN: synonym fetch batch failed ->", repr(e))
                i += size

    return out

async def _async_matches_pairs(client: httpx.AsyncClient, pairs: list[tuple[str, str]]) -> list[tuple[str, Optional[dict]]]:
    """
    pairs: [(plant_id, scientific_name_to_query), ...]
    Returns list of (plant_id, match_json_or_None) in the same order.
    """
    sem = asyncio.Semaphore(GBIF_MATCH_LIMIT)
    async def one(pid, name):
        async with sem:
            js = await _aget(client, GBIF_MATCH_URL, params={"name": name})
        return pid, js
    return await asyncio.gather(*[one(pid, nm) for pid, nm in pairs])

def _wikidata_session() -> requests.Session:
    s = requests.Session()
    retries = Retry(
        total=4,
        backoff_factor=0.8,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    s.mount("https://", HTTPAdapter(max_retries=retries,
                                    pool_connections=WIKIDATA_CONCURRENCY,
                                    pool_maxsize=WIKIDATA_CONCURRENCY))
    # PLEASE include a real contact so WDQS is happy
    s.headers.update({"User-Agent": USER_AGENT})
    return s

def _pick_preferred_en_common_from_wikidata(names: list[str]) -> Optional[str]:
    if not names: return None
    names = [n.strip() for n in names if n and n.strip()]
    if not names: return None
    def keyfn(s: str): return (-len(s.split()), -len(s), s.lower())
    return max(set(names), key=keyfn)

def _escape_q(s: str) -> str:
    # scientific names rarely contain quotes, but be safe
    return s.replace('"', '\\"')

async def _inat_get(client: httpx.AsyncClient, path: str, params: dict, tries: int = INAT_RETRIES):
    url = f"{INAT_BASE}{path}"
    for i in range(tries):
        try:
            r = await client.get(url, params=params, timeout=GBIF_HTTP_TIMEOUT)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                await asyncio.sleep(0.4 * (i + 1))
            else:
                return None
        except httpx.RequestError:
            await asyncio.sleep(0.3 * (i + 1))
    return None

def _inat_pick_en_common(taxon: dict) -> Optional[str]:
    """
    Prefer iNat's localized English common name.
    We’ll first look at 'preferred_common_name' (already localized if we set locale=en),
    else scan 'names' payload when available (rarely present in the /taxa?name= response).
    """
    if not taxon:
        return None
    # iNat puts localized common in preferred_common_name when locale=en is passed
    pc = (taxon.get("preferred_common_name") or "").strip()
    if pc:
        return pc
    # Fallback: scan embedded names if present (not always included here)
    for n in (taxon.get("names") or []) + (taxon.get("taxon_names") or []):
        # English-only
        if (n.get("lexicon") or "").lower() == "english":
            nm = (n.get("name") or "").strip()
            if nm:
                return nm
    return None

async def _inat_match_name(client: httpx.AsyncClient, name: str) -> Optional[dict]:
    """
    Exact-name match first. iNat returns an array of taxa; we’ll take the top result
    when the 'name' field matches ignoring case, else the highest score.
    """
    if not name:
        return None
    js = await _inat_get(client, "/taxa", {"name": name, "locale": "en"})
    if not js or not isinstance(js, dict):
        return None
    results = js.get("results") or []
    if not results:
        # Try a looser query if exact didn't hit
        js2 = await _inat_get(client, "/taxa", {"q": name, "locale": "en"})
        results = (js2 or {}).get("results") or []
        if not results:
            return None
    # Prefer exact scientific name matches on 'name'
    name_low = name.strip().lower()
    exact = [t for t in results if (t.get("name") or "").strip().lower() == name_low]
    return (exact[0] if exact else results[0])

def _canon_binomial_only(s: str) -> str:
    # strip hybrid marks and infraspecific/authors → keep "Genus species"
    import re
    if not s: return ""
    s = re.sub(r"[×x]\s*", "", s)
    s = re.sub(r"\b(subsp\.|ssp\.|var\.|f\.|cv\.)\b.*", "", s, flags=re.I)
    parts = s.strip().split()
    return " ".join(parts[:2]) if len(parts) >= 2 else s.strip()

async def _itis_get(client, endpoint: str, params: dict):
    url = f"{ITIS_BASE}/{endpoint}"
    for i in range(ITIS_RETRIES):
        try:
            r = await client.get(url, params=params, timeout=GBIF_HTTP_TIMEOUT)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                await asyncio.sleep(0.4 * (i + 1))
            else:
                return None
        except httpx.RequestError:
            await asyncio.sleep(0.3 * (i + 1))
    return None

async def _itis_search_tsn(client, name: str) -> Optional[str]:
    """Return a likely TSN for a scientific name; tolerates authors, ranks, and hybrid marks."""
    import re
    def _canon_bino(s: Any) -> str:
        s = str(s or "")
        s = re.sub(r"[×x]\s*", "", s)  # drop hybrid sign
        s = re.sub(r"\b(subsp\.|ssp\.|var\.|f\.|cv\.)\b.*", "", s, flags=re.I)
        parts = s.strip().split()
        return " ".join(parts[:2]) if len(parts) >= 2 else s.strip()

    if not name:
        return None

    # 1) try full string
    js = await _itis_get(client, "searchByScientificName", {"srchKey": name})
    results = (js or {}).get("scientificNames") or []

    # 2) fallback: binomial only
    if not results:
        bino = _canon_bino(name)
        if bino and bino != name:
            js2 = await _itis_get(client, "searchByScientificName", {"srchKey": bino})
            results = (js2 or {}).get("scientificNames") or []
    if not results:
        return None

    target_bino = _canon_bino(name).lower()

    # ITIS has used several keys here; try a few
    def _combined(row: dict) -> str:
        for k in ("combinedName", "combinedname", "sciName", "scientificName"):
            v = row.get(k)
            if v:
                return str(v)
        return ""

    exact = [r for r in results if _canon_bino(_combined(r)).lower() == target_bino]
    pick = exact[0] if exact else results[0]

    tsn = str(pick.get("tsn") or "").strip()
    return tsn or None

async def _itis_common_en(client, tsn: str) -> list[str]:
    """Return English common names for a TSN."""
    js = await _itis_get(client, "getCommonNamesForTSN", {"tsn": tsn})
    rows = (js or {}).get("commonNames") or []
    out = []
    for r in rows:
        if (r.get("language") or "").lower().startswith("english"):
            nm = (r.get("commonName") or "").strip()
            if nm: out.append(nm)
    return out

def _pick_preferred_en_common_from_wikidata(names: list[str]) -> Optional[str]:
    """
    Quick heuristic: favor fewer words, then shorter length, then alphabetical.
    """
    if not names:
        return None
    cleaned = [n.strip() for n in names if n and n.strip()]
    if not cleaned:
        return None
    def keyfn(s: str):
        return (-len(s.split()), -len(s), s.lower())
    # max() with negative parts gives: fewest words, shortest len, then a stable tiebreak
    return max(set(cleaned), key=keyfn)

def _parallel_upsert_plants(scis: list[str], batch: int = WFO_BATCH, workers: int = WFO_CONCURRENCY) -> int:
    """
    Bulk upsert plants(plant_scientific_name, plant_name=scientific) in parallel.
    Returns number of rows sent (not necessarily inserted if duplicates).
    """
    def job(rows):
        sb2 = _new_sb()
        payload = [{"plant_scientific_name": s, "plant_name": s} for s in rows]
        # on_conflict + ignore_duplicates → ON CONFLICT DO NOTHING
        sb2.table("plants").upsert(
            payload,
            on_conflict="plant_scientific_name",
            ignore_duplicates=True,
            returning="minimal",
        ).execute()
        return len(payload)

    chunks = [scis[i:i+batch] for i in range(0, len(scis), batch)]
    sent = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for fut in tqdm(as_completed([ex.submit(job, c) for c in chunks]), total=len(chunks), desc="Upserting plants", unit="batch"):
            try:
                sent += fut.result()
            except Exception as e:
                print("WARN: plant upsert batch failed ->", repr(e))
    return sent

def _parallel_fetch_ids(scis: list[str], batch: int = WFO_BATCH, workers: int = WFO_CONCURRENCY) -> Dict[str, str]:
    """
    Map plant_scientific_name -> id in parallel.
    """
    def job(rows):
        sb2 = _new_sb()
        res = sb2.table("plants").select("id, plant_scientific_name").in_("plant_scientific_name", rows).execute()
        data = getattr(res, "data", None) or []
        return {r["plant_scientific_name"]: r["id"] for r in data}

    chunks = [scis[i:i+batch] for i in range(0, len(scis), batch)]
    out: Dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for fut in tqdm(as_completed([ex.submit(job, c) for c in chunks]), total=len(chunks), desc="Resolving plant IDs", unit="batch"):
            try:
                out.update(fut.result())
            except Exception as e:
                print("WARN: id fetch batch failed ->", repr(e))
    return out

def _parallel_upsert_synonyms(rows: list[dict], batch: int = WFO_BATCH, workers: int = WFO_CONCURRENCY) -> int:
    """
    rows: [{"plant_id":..., "name":..., "kind":"scientific", "locale":None}, ...]
    Uses upsert(ignore_duplicates) so we can blast rows without pre-fetching.
    Returns number of rows sent (duplicates silently ignored by DB).
    """
    # light client-side de-dupe inside each batch to cut down conflicts
    def job(batch_rows):
        sb2 = _new_sb()
        # de-dupe within batch on (plant_id, lower(name), kind, locale or "")
        seen = set()
        unique_rows = []
        for r in batch_rows:
            key = (r["plant_id"], (r["name"] or "").lower(), r.get("kind") or "scientific", r.get("locale") or "")
            if key in seen: 
                continue
            seen.add(key)
            unique_rows.append(r)
        if not unique_rows:
            return 0
        sb2.table("plant_synonyms").upsert(
            unique_rows,
            ignore_duplicates=True,      # hits your unique index; conflicts are skipped
            returning="minimal"
        ).execute()
        return len(unique_rows)

    chunks = [rows[i:i+batch] for i in range(0, len(rows), batch)]
    sent = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for fut in tqdm(as_completed([ex.submit(job, c) for c in chunks]), total=len(chunks), desc="Upserting synonyms", unit="batch"):
            try:
                sent += fut.result()
            except Exception as e:
                print("WARN: synonym upsert batch failed ->", repr(e))
    return sent

def seed_wfo_bundle(sb: Client, path: str, limit: Optional[int] = None):
    """
    Ingest from the WFO bundle (taxon.tsv + name.tsv + synonym.tsv).
    We:
      1) Read taxon.tsv → collect accepted taxonIDs + their nameIDs
      2) Read name.tsv → map nameID → (scientificName, rank)
      3) Insert only species-like accepted names
      4) Read synonym.tsv → add scientific synonyms (nameID → string)
    """
    # ---------- 1) taxon.tsv ----------
    tax_reader, tax_origin = _open_bundle_reader(path, ["taxon.tsv", "taxon.txt"])
    first_tax = next(iter(tax_reader), None)
    if not first_tax:
        print("ERROR: taxon.tsv is empty"); return
    dbg("taxon.tsv header from", tax_origin, "=>", list(first_tax.keys()))

    # Reconstruct reader including first row
    def again(reader, first):
        yield first
        for r in reader:
            yield r

    tax_reader = again(tax_reader, first_tax)

    # Column detection
    # taxon row should have: ID (the taxon concept id) + nameID (FK into name.tsv)
    # headers vary in case; use _col(...) for safety
    taxon_to_name: dict[str, str] = {}
    name_ids_needed: set[str] = set()

    for row in tax_reader:
        tid = _col(row, "ID", "taxonID", "taxonId")
        nid = _col(row, "nameID", "nameId", "name_id")
        if not tid or not nid:
            continue
        taxon_to_name[tid] = nid
        name_ids_needed.add(nid)

    dbg("taxon concepts:", len(taxon_to_name), "distinct nameIDs needed:", len(name_ids_needed))
    if not taxon_to_name:
        print("ERROR: taxon.tsv did not contain ID/nameID columns I recognize."); return

    # ---------- 2) name.tsv ----------
    name_reader, name_origin = _open_bundle_reader(path, ["name.tsv", "names.tsv"])
    first_name = next(iter(name_reader), None)
    if not first_name:
        print("ERROR: name.tsv is empty"); return
    dbg("name.tsv header from", name_origin, "=>", list(first_name.keys()))
    name_reader = again(name_reader, first_name)

    # Build map only for the nameIDs we need (memory-friendly)
    # Detect plausible columns for the full scientific string and rank
    name_map: dict[str, tuple[str, str]] = {}  # nameID -> (scientific, rank_lower)
    for row in name_reader:
        nid = _col(row, "ID", "nameID", "nameId")
        if not nid or nid not in name_ids_needed:
            continue
        sci = _col(row, "fullName", "scientificName", "name", "scientific name")
        rank = (_col(row, "rank", "taxonRank", "nameRank", "rankName") or "").strip().lower()

        # If we didn't get a full string, try to build from parts (genus + specificEpithet)
        if not sci:
            genus = _col(row, "genus")
            species = _col(row, "specificEpithet", "speciesEpithet")
            uninomial = _col(row, "uninomial")  # for genera etc.
            if genus and species:
                sci = f"{genus} {species}"
            elif uninomial:
                sci = uninomial

        if not sci:
            continue
        name_map[nid] = (sci.strip(), rank)

    dbg("name map size:", len(name_map))
    # Mark species-like accepted taxa so we only process those synonyms
    def _is_species_like(rank: str) -> bool:
        r = (rank or "").lower()
        return r in ("species", "nothospecies", "hybrid", "hybrid species", "species aggregate", "species group")

    species_like_taxa: set[str] = set()
    for tid, nid in taxon_to_name.items():
        tup = name_map.get(nid)
        if tup and _is_species_like(tup[1]):  # tup = (scientific, rank)
            species_like_taxa.add(tid)

    # Accepted taxonID -> accepted scientific name (for DB lookup later)
    accepted_name_by_taxon: dict[str, str] = {}
    for tid, nid in taxon_to_name.items():
        tup = name_map.get(nid)
        if tup:
            accepted_name_by_taxon[tid] = tup[0]

    # ---------- 3) Insert accepted species-like names ----------
    def is_species_like(rank: str) -> bool:
        r = (rank or "").lower()
        return r in ("species", "nothospecies", "hybrid", "hybrid species", "species aggregate", "species group")

    # -------- NEW: bulk + parallel upsert accepted species --------
    accepted_scis: list[str] = []
    accepted_taxon_to_nameid: dict[str, str] = {}  # tid -> nid kept for later
    for tid, nid in taxon_to_name.items():
        tup = name_map.get(nid)
        if not tup:
            continue
        sci, rank = tup
        if not is_species_like(rank):
            continue
        accepted_scis.append(sci)
        accepted_taxon_to_nameid[tid] = nid

    if limit:
        accepted_scis = accepted_scis[:limit]
        # Reduce accepted_taxon_to_nameid accordingly
        keep = set(accepted_scis)
        accepted_taxon_to_nameid = {tid: nid for tid, nid in accepted_taxon_to_nameid.items() if name_map.get(nid, ("", ""))[0] in keep}

    sent = _parallel_upsert_plants(accepted_scis)
    print(f"Accepted upserts sent: {sent}")

    # Resolve IDs in parallel
    sci_to_id = _parallel_fetch_ids(accepted_scis)

    accepted_taxon_to_plant: dict[str, str] = {}
    for tid, nid in accepted_taxon_to_nameid.items():
        sci = name_map.get(nid, ("", ""))[0]
        pid = sci_to_id.get(sci)
        if pid:
            accepted_taxon_to_plant[tid] = pid

    inserted = len(accepted_taxon_to_plant)
    print(f"Accepted resolved to plant_ids: {inserted}")

    if limit and inserted >= limit:
        print("Limit reached; skipping synonyms stage for this run.")
        return

    # ---------- 4) synonym.tsv → add scientific synonyms (PARALLEL BULK) ----------
    try:
        syn_reader, syn_origin = _open_bundle_reader(path, ["synonym.tsv", "synonyms.tsv"])
    except FileNotFoundError:
        print("No synonym.tsv found — skipping synonym ingest.")
        return

    first_syn = next(iter(syn_reader), None)
    if not first_syn:
        print("synonym.tsv empty — skipping.")
        return
    dbg("synonym.tsv header from", syn_origin, "=>", list(first_syn.keys()))
    syn_reader = again(syn_reader, first_syn)

    syn_taxon_col = next((k for k in first_syn.keys() if "taxon" in k.lower() and "id" in k.lower()), None)
    syn_name_col  = next((k for k in first_syn.keys() if "name"  in k.lower() and "id" in k.lower()), None)
    if not syn_taxon_col or not syn_name_col:
        print("WARN: Could not find taxonID/nameID columns in synonym.tsv; skipping synonyms.")
        return

    # Collect synonym nameIDs tied to our accepted taxa
    syn_pairs: list[tuple[str, str]] = []
    syn_name_ids_needed: set[str] = set()
    for row in syn_reader:
        tid = row.get(syn_taxon_col)
        nid = row.get(syn_name_col)
        if not tid or not nid:
            continue
        if tid in accepted_taxon_to_plant:
            syn_pairs.append((tid, nid))
            if nid not in name_map:
                syn_name_ids_needed.add(nid)

    dbg("synonym pairs:", len(syn_pairs), "new nameIDs to resolve:", len(syn_name_ids_needed))

    # Resolve any missing synonym names from name.tsv once
    if syn_name_ids_needed:
        name_reader2, _ = _open_bundle_reader(path, ["name.tsv", "names.tsv"])
        for row in name_reader2:
            nid = _col(row, "ID", "nameID", "nameId")
            if not nid or nid not in syn_name_ids_needed:
                continue
            sci = _col(row, "fullName", "scientificName", "name")
            if not sci:
                genus = _col(row, "genus")
                species = _col(row, "specificEpithet", "speciesEpithet")
                if genus and species:
                    sci = f"{genus} {species}"
            if sci:
                name_map[nid] = (sci.strip(), (_col(row, "rank", "taxonRank") or "").lower())

    # Build synonym rows (client-side de-dupe by pid + lower(name))
    rows_to_insert: list[dict] = []
    seen = set()
    for tid, nid in syn_pairs:
        pid = accepted_taxon_to_plant.get(tid)
        syn_entry = name_map.get(nid)
        if not pid or not syn_entry:
            continue
        syn_name, _ = syn_entry
        nm = (syn_name or "").strip()
        if not nm:
            continue
        key = (pid, nm.lower(), "scientific", "")
        if key in seen:
            continue
        seen.add(key)
        rows_to_insert.append({
            "plant_id": pid,
            "name": nm,
            "kind": "scientific",
            "locale": None
        })

    sent = _parallel_upsert_synonyms(rows_to_insert)
    print(f"Synonym rows sent: {sent} (duplicates ignored by DB)")


# ---------- Step 3: Seed from WFO ----------
def iter_wfo_records(path: str):
    logged_header = False
    logged_samples = 0

    def _log_row(row):
        nonlocal logged_header, logged_samples
        if not logged_header:
            dbg("WFO columns:", list(row.keys()))
            logged_header = True
        if logged_samples < 3:
            dbg("WFO sample row:", {k: row.get(k) for k in list(row)[:8]})
            logged_samples += 1

    if path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            name = None
            for n in z.namelist():
                if n.lower().endswith("/taxon.txt") or n.lower() == "taxon.txt":
                    name = n; break
            if not name:
                raise FileNotFoundError("taxon.txt not found inside ZIP")
            with z.open(name) as fh:
                text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace")
                reader = csv.DictReader(text, delimiter="\t")
                for row in reader:
                    _log_row(row)
                    yield row
        return

    if path.lower().endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
            head = f.read(1); f.seek(0)
            if head == "[":
                data = json.load(f)
                for row in data:
                    _log_row(row)
                    yield row
            else:
                base = os.path.basename(path).lower()
                delim = "\t" if base.endswith(("taxon.txt.gz", ".tsv.gz")) or "taxon" in base else None
                if not delim:
                    sample = f.read(4096); f.seek(0)
                    delim = csv.Sniffer().sniff(sample, delimiters=",\t|").delimiter
                reader = csv.DictReader(f, delimiter=delim)
                for row in reader:
                    _log_row(row)
                    yield row
        return

    if path.lower().endswith(".json"):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            for row in data:
                _log_row(row)
                yield row
        return

    base = os.path.basename(path).lower()
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        if base.endswith((".tsv", ".txt")) or "taxon" in base:
            reader = csv.DictReader(f, delimiter="\t")
        else:
            sample = f.read(4096); f.seek(0)
            delim = csv.Sniffer().sniff(sample, delimiters=",\t|").delimiter
            reader = csv.DictReader(f, delimiter=delim)
        for row in reader:
            _log_row(row)
            yield row

def seed_wfo(sb: Client, path: str, limit: Optional[int] = None):
    # Delegate to the bundle loader (taxon.tsv + name.tsv + synonym.tsv)
    return seed_wfo_bundle(sb, path, limit)

# ---------- Step 4a: GBIF enrichment ----------
def gbif_vernaculars(usage_key: int, session: Optional[requests.Session] = None) -> list[dict]:
    ses = session or _make_session()
    try:
        r = ses.get(
            GBIF_VERNACULAR_URL.format(usageKey=usage_key),
            timeout=GBIF_HTTP_TIMEOUT,
            params={"limit": 300}
        )
        if r.status_code == 200:
            js = r.json()
            if isinstance(js, dict):
                return js.get("results", [])
            if isinstance(js, list):
                return js
    except requests.RequestException:
        pass
    return []

async def _aget(client: httpx.AsyncClient, url: str, params=None, tries: int = GBIF_RETRIES):
    for i in range(tries):
        try:
            r = await client.get(url, params=params, timeout=GBIF_HTTP_TIMEOUT)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                await asyncio.sleep(0.4 * (i + 1))
            else:
                return None
        except httpx.RequestError:
            await asyncio.sleep(0.3 * (i + 1))
    return None

async def _async_matches(client: httpx.AsyncClient, rows: list[dict]) -> dict[str, dict]:
    sem = asyncio.Semaphore(GBIF_MATCH_LIMIT)
    async def one(r):
        sci = r.get("plant_scientific_name")
        if not sci: return None, None
        async with sem:
            js = await _aget(client, GBIF_MATCH_URL, params={"name": sci})
        return r["id"], js
    tasks = [one(r) for r in rows]
    out = {}
    for pid, js in await asyncio.gather(*tasks):
        if pid and js:
            out[pid] = js
    return out

async def _async_vernaculars(client: httpx.AsyncClient, keys: list[int]) -> dict[int, list[dict]]:
    sem = asyncio.Semaphore(GBIF_VERN_LIMIT)
    async def one(k):
        url = GBIF_VERNACULAR_URL.format(usageKey=k)
        async with sem:
            js = await _aget(client, url, params={"limit": 300})
        if js is None:
            return k, []
        if isinstance(js, dict):
            return k, js.get("results", []) or []
        return k, js
    tasks = [one(k) for k in keys]
    out = {}
    for k, v in await asyncio.gather(*tasks):
        out[k] = v
    return out

def _pick_best_common_name(vns: list[dict]) -> tuple[Optional[str], Optional[str]]:
    """
    Choose a good English common name. Return (name, locale) where locale might be 'en' or 'en-XX'.
    Scoring:
      - language en/eng first
      - preferred=True wins
      - country US/GB/CA/AU slightly preferred for tie-breaks
      - longest-wordy weird names de-prioritized implicitly by pref flag
    """
    if not vns:
        return None, None

    def lang_code(v):
        # GBIF can use 'eng' or 'en'
        l = (v.get("language") or "").lower()
        if l == "eng": return "en"
        if len(l) == 2: return l
        return l  # could be empty or something else

    def score(v):
        lang = lang_code(v)
        base = 0
        if lang == "en": base += 10
        if v.get("preferred") is True: base += 5
        country = (v.get("country") or "").upper()
        if country in ("US","GB","CA","AU","NZ"): base += 2
        # very rough: shorter names are usually the “main” label
        name = v.get("vernacularName") or ""
        base += max(0, 6 - len(name.split()))
        return base

    english = [v for v in vns if lang_code(v) == "en" and v.get("vernacularName")]
    pool = english if english else [v for v in vns if v.get("vernacularName")]
    if not pool:
        return None, None

    best = max(pool, key=score)
    name = best.get("vernacularName")
    lang = "en" if (lang_code(best) == "en") else (lang_code(best) or None)
    # include country if present to make a locale like en-US
    country = (best.get("country") or "").upper()
    locale = f"{lang}-{country}" if (lang == "en" and country) else lang
    return (name.strip() if name else None), locale

def _make_session() -> requests.Session:
    s = requests.Session()
    # Retry on 429/5xx with small backoff; share pooled connections
    retries = Retry(
        total=3,
        backoff_factor=0.3,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"]
    )
    adapter = HTTPAdapter(max_retries=retries, pool_connections=GBIF_CONCURRENCY, pool_maxsize=GBIF_CONCURRENCY)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers.update({"User-Agent": USER_AGENT})
    return s

def _pick_usage_key(m: dict) -> Optional[int]:
    return m.get("acceptedUsageKey") or m.get("usageKey") or m.get("speciesKey")

def gbif_match(scientific: str, session: Optional[requests.Session] = None) -> Optional[Dict[str, Any]]:
    ses = session or _make_session()
    params = {"name": scientific}
    for i in range(3):
        try:
            r = ses.get(GBIF_MATCH_URL, params=params, timeout=GBIF_HTTP_TIMEOUT)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                time.sleep(0.5 * (i + 1))
        except requests.RequestException:
            pass
    return None

def _parallel_update_plants(pairs: list[tuple[str, Dict[str, Any]]],
                            workers: int = DB_CONCURRENCY,
                            batch: int = 200) -> int:
    """
    pairs: [(plant_id, payload_dict), ...]
    Executes per-row updates in parallel, chunked to keep request count sane.
    """
    def job(chunk):
        sb2 = _new_sb()
        n = 0
        for pid, payload in chunk:
            if not payload:
                continue
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
        for fut in tqdm(as_completed(futs), total=len(futs), desc="Updating plants", unit="batch"):
            try:
                updated += fut.result()
            except Exception as e:
                print("WARN: update batch failed ->", repr(e))
    return updated

def _gbif_http_worker(rows: list[dict]) -> tuple[list[tuple[str, Dict[str, Any]]], list[dict]]:
    """
    rows: [{id, plant_scientific_name, plant_name}, ...]  (already filtered to disp==sci)
    Returns:
      updates -> [(id, payload), ...]
      syn_rows -> rows for plant_synonyms upsert [{"plant_id","name","kind","locale"}, ...]
    """
    ses = _make_session()
    updates: list[tuple[str, Dict[str, Any]]] = []
    syn_rows: list[dict] = []

    for r in rows:
        pid = r["id"]
        sci = r.get("plant_scientific_name")
        if not sci:
            continue

        m = gbif_match(sci, session=ses)
        if not m:
            continue

        payload = {}
        canonical = m.get("canonicalName") or sci
        usage_key = _gbif_pick_usage_key(m)   # <-- use accepted key when present
        if usage_key is not None and not r.get("gbif_usage_key"):
            payload["gbif_usage_key"] = usage_key  # remember it for future runs

        best_common, locale = (None, None)
        if usage_key is not None:
            vns = gbif_vernaculars(usage_key, session=ses)
            best_common, locale = _pick_best_common_name(vns)

        new_display = best_common or canonical
        if new_display and new_display != r.get("plant_name"):
            payload["plant_name"] = new_display

        # Optional taxonomy
        fam = m.get("family"); gen = m.get("genus"); rnk = m.get("rank")
        if fam: payload["family"] = fam
        if gen: payload["genus"] = gen
        if rnk: payload["rank"] = rnk

        # Provenance/debug
        uk = m.get("usageKey"); mt = m.get("matchType"); conf = m.get("confidence")
        if uk is not None: payload["gbif_usage_key"] = uk
        if mt: payload["gbif_match_type"] = mt
        if conf is not None: payload["gbif_confidence"] = int(conf)

        if payload:
            updates.append((pid, payload))

        if best_common:
            syn_rows.append({
                "plant_id": pid,
                "name": best_common,
                "kind": "common",
                "locale": locale
            })

    return updates, syn_rows

def enrich_gbif(sb: Client, batch_size: int = 20000, max_rows: Optional[int] = None):
    """
    Async GBIF enrichment with synonym fallback:
      1) Try GBIF /match and /vernacularNames for each row's scientific name.
      2) If the chosen 'common' is empty or equals the scientific, retry using the plant's scientific synonyms.
      3) Update plant_name only with the chosen common name (never a synonym string).
    """
    processed = 0
    offset = 0
    allowed = set((os.getenv("ALLOWED_PLANT_FIELDS") or
                  "plant_name,gbif_usage_key,gbif_match_type,gbif_confidence,family,genus,rank").split(","))

    while True:
        res = sb.table("plants").select(
            "id, plant_scientific_name, plant_name, gbif_usage_key"
        ).range(offset, offset + batch_size - 1).execute()

        rows = res.data or []
        if not rows:
            break

        need = [r for r in rows
                if r.get("plant_scientific_name") and r.get("plant_name")
                and r["plant_scientific_name"] == r["plant_name"]]

        if not need:
            offset += batch_size
            continue

        if max_rows is not None:
            if processed >= max_rows:
                return
            budget = max_rows - processed
            if len(need) > budget:
                need = need[:budget]

        # ---------------- Phase A: base scientific name ----------------
        have_key = [r for r in need if r.get("gbif_usage_key")]
        no_key   = [r for r in need if not r.get("gbif_usage_key")]

        canonical_by_pid: dict[str, str] = {}
        key_by_pid: dict[str, int] = {}
        match_map: dict[str, dict] = {}

        if GBIF_ASYNC and no_key:
            async def _do_matches():
                async with httpx.AsyncClient(http2=True,
                                             limits=httpx.Limits(max_keepalive_connections=GBIF_MAX_CONN,
                                                                 max_connections=GBIF_MAX_CONN),
                                             headers={"User-Agent": USER_AGENT}) as client:
                    return await _async_matches(client, no_key)
            match_map = asyncio.run(_do_matches())
        else:
            # sync fallback
            for r in tqdm(no_key, desc="GBIF match (sync)"):
                m = gbif_match(r["plant_scientific_name"])
                if m:
                    match_map[r["id"]] = m

        for r in no_key:
            pid = r["id"]
            m = match_map.get(pid)
            if not m:
                continue
            canonical_by_pid[pid] = m.get("canonicalName") or r["plant_scientific_name"]
            k = _pick_usage_key(m)
            if k:
                key_by_pid[pid] = k

        for r in have_key:
            key_by_pid[r["id"]] = int(r["gbif_usage_key"])

        unique_keys = sorted(set(key_by_pid.values()))
        vern_by_key: dict[int, list[dict]] = {}

        if unique_keys:
            if GBIF_ASYNC:
                async def _do_vern():
                    async with httpx.AsyncClient(http2=True,
                                                 limits=httpx.Limits(max_keepalive_connections=GBIF_MAX_CONN,
                                                                     max_connections=GBIF_MAX_CONN),
                                                 headers={"User-Agent": USER_AGENT}) as client:
                        return await _async_vernaculars(client, unique_keys)
                vern_by_key = asyncio.run(_do_vern())
            else:
                for k in tqdm(unique_keys, desc="GBIF vernaculars (sync)"):
                    vern_by_key[k] = gbif_vernaculars(k)

        best_name_by_key: dict[int, tuple[Optional[str], Optional[str]]] = {}
        for k, vns in vern_by_key.items():
            best_name_by_key[k] = _pick_best_common_name(vns)  # (name, locale)

        # Build updates/synonyms from Phase A; collect alt targets needing synonym fallback
        updates: list[tuple[str, Dict[str, Any]]] = []
        syns: list[dict] = []
        syn_seen = set()  # (pid, lower(name))

        alt_target_ids: list[str] = []

        for r in need:
            pid = r["id"]
            sci = r["plant_scientific_name"]
            k = key_by_pid.get(pid)
            common, locale = (None, None)
            if k is not None:
                common, locale = best_name_by_key.get(k, (None, None))

            # Do we still need help? (no common OR common equals the scientific string)
            need_alt = (not common) or (common.strip().lower() == sci.strip().lower())

            if not need_alt:
                payload = {}
                new_display = common  # safe: non-empty and != sci
                if new_display and new_display != r.get("plant_name"):
                    payload["plant_name"] = new_display

                if pid in canonical_by_pid:
                    m = match_map.get(pid)
                    if m:
                        fam = m.get("family"); gen = m.get("genus"); rnk = m.get("rank")
                        if fam: payload["family"] = fam
                        if gen: payload["genus"] = gen
                        if rnk: payload["rank"] = rnk
                        mt = m.get("matchType"); conf = m.get("confidence")
                        if k is not None: payload["gbif_usage_key"] = k
                        if mt: payload["gbif_match_type"] = mt
                        if conf is not None: payload["gbif_confidence"] = int(conf)

                if payload:
                    payload = {kk: vv for kk, vv in payload.items() if kk in allowed}
                    if payload:
                        updates.append((pid, payload))

                # store the chosen common as a synonym too
                if common:
                    key = (pid, common.lower())
                    if key not in syn_seen:
                        syn_seen.add(key)
                        syns.append({"plant_id": pid, "name": common, "kind": "common", "locale": locale})
            else:
                alt_target_ids.append(pid)

        # ---------------- Phase B: retry using scientific synonyms ----------------
        # Only for rows that still lack a good common name
        if alt_target_ids:
            syn_map = _fetch_scientific_synonyms(sb, alt_target_ids, per_plant=GBIF_SYNONYM_LIMIT)

            # Prepare (pid, synonym) pairs for matching
            pairs: list[tuple[str, str]] = []
            for pid, names in syn_map.items():
                sci = next((r["plant_scientific_name"] for r in need if r["id"] == pid), "")
                for nm in names:
                    if nm and nm.strip().lower() != (sci or "").strip().lower():  # skip identical string
                        pairs.append((pid, nm))

            if pairs:
                if GBIF_ASYNC:
                    async def _do_pairs():
                        async with httpx.AsyncClient(http2=True,
                                                     limits=httpx.Limits(max_keepalive_connections=GBIF_MAX_CONN,
                                                                         max_connections=GBIF_MAX_CONN),
                                                     headers={"User-Agent": USER_AGENT}) as client:
                            return await _async_matches_pairs(client, pairs)
                    alt_results = asyncio.run(_do_pairs())
                else:
                    # sync fallback
                    alt_results = []
                    for pid, nm in tqdm(pairs, desc="GBIF match via synonyms (sync)"):
                        alt_results.append((pid, gbif_match(nm)))

                keys_by_pid: dict[str, set[int]] = defaultdict(set)
                match_by_key: dict[int, dict] = {}
                canonical_by_pid2: dict[str, str] = {}

                for pid, m in alt_results:
                    if not m:
                        continue
                    k = _pick_usage_key(m)
                    if k:
                        keys_by_pid[pid].add(k)
                        match_by_key[k] = m
                        if pid not in canonical_by_pid2:
                            canonical_by_pid2[pid] = m.get("canonicalName")

                # Fetch vernaculars for *new* keys not covered in Phase A
                alt_keys = set(k for s in keys_by_pid.values() for k in s)
                need_keys = sorted(alt_keys - set(unique_keys))
                vern_by_key2: dict[int, list[dict]] = {}

                if need_keys:
                    if GBIF_ASYNC:
                        async def _do_vern2():
                            async with httpx.AsyncClient(http2=True,
                                                         limits=httpx.Limits(max_keepalive_connections=GBIF_MAX_CONN,
                                                                             max_connections=GBIF_MAX_CONN),
                                                         headers={"User-Agent": USER_AGENT}) as client:
                                return await _async_vernaculars(client, need_keys)
                        vern_by_key2 = asyncio.run(_do_vern2())
                    else:
                        for k in tqdm(need_keys, desc="GBIF vernaculars via synonyms (sync)"):
                            vern_by_key2[k] = gbif_vernaculars(k)

                # Combine vernaculars maps
                combined_vern = dict(vern_by_key)
                combined_vern.update(vern_by_key2)

                # Choose best name per key
                best_by_key2: dict[int, tuple[Optional[str], Optional[str]]] = {
                    k: _pick_best_common_name(vns) for k, vns in combined_vern.items()
                }

                # For each alt target, pick the first key that yields a valid English common (≠ sci)
                for pid in alt_target_ids:
                    r = next((x for x in need if x["id"] == pid), None)
                    if not r: 
                        continue
                    sci = r["plant_scientific_name"]

                    chosen_name, chosen_loc, chosen_key = None, None, None
                    for k in keys_by_pid.get(pid, []):
                        nm, lc = best_by_key2.get(k, (None, None))
                        if nm and nm.strip().lower() != sci.strip().lower():
                            chosen_name, chosen_loc, chosen_key = nm, lc, k
                            break

                    if chosen_name:
                        payload = {"plant_name": chosen_name}
                        # Add taxonomy/provenance from the match that produced the chosen key
                        m = match_by_key.get(chosen_key)
                        if m:
                            fam = m.get("family"); gen = m.get("genus"); rnk = m.get("rank")
                            if fam: payload["family"] = fam
                            if gen: payload["genus"] = gen
                            if rnk: payload["rank"] = rnk
                            mt = m.get("matchType"); conf = m.get("confidence")
                            payload["gbif_usage_key"] = chosen_key
                            if mt: payload["gbif_match_type"] = mt
                            if conf is not None: payload["gbif_confidence"] = int(conf)

                        payload = {kk: vv for kk, vv in payload.items() if kk in allowed}
                        updates.append((pid, payload))

                        key = (pid, chosen_name.lower())
                        if key not in syn_seen:
                            syn_seen.add(key)
                            syns.append({"plant_id": pid, "name": chosen_name, "kind": "common", "locale": chosen_loc})

        # ---------------- Apply DB changes ----------------
        total_keys = set(unique_keys)
        # (we only counted new keys if we created them above)
        print(f"GBIF: candidates={len(need)} unique_keys={len(total_keys)} updates={len(updates)} commons={len(syns)}")

        if updates:
            updated = _parallel_update_plants(updates, workers=DB_CONCURRENCY, batch=200)
            processed += updated
            print(f"GBIF: rows_updated={updated}")

        if syns:
            _parallel_upsert_synonyms(syns, batch=WFO_BATCH, workers=DB_CONCURRENCY)

        offset += batch_size

# ---------- Step 4b: Wikimedia lead image + license ----------
def wiki_lead_image(scientific: str) -> Optional[Tuple[str, Optional[str], Optional[str]]]:
    """
    Return (image_url, license_short, attribution) or None
    """
    # 1) Try pageimages (original)
    p = {
        "action": "query",
        "format": "json",
        "prop": "pageimages",
        "piprop": "original",
        "titles": scientific
    }
    try:
        r = requests.get(WIKI_API, params=p, headers={"User-Agent": USER_AGENT}, timeout=20)
        r.raise_for_status()
        data = r.json()
        pages = data.get("query", {}).get("pages", {})
        if pages:
            page = next(iter(pages.values()))
            original = page.get("original")
            if original and "source" in original:
                url = original["source"]
                # 2) Ask imageinfo for license + attribution
                # We need a File: title; use the 'pageimage' if present, else infer from URL (best-effort)
                # Fallback: query imageinfo by URL via titles=File:... is more reliable; skip if unknown.
    except Exception:
        original = None

    # Safer generic: search, then pick first pageimage -> imageinfo
    p = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": scientific,
        "gsrlimit": 1,
        "prop": "pageimages|images|pageprops",
        "piprop": "thumbnail",
        "pithumbsize": 1600
    }
    try:
        r = requests.get(WIKI_API, params=p, headers={"User-Agent": USER_AGENT}, timeout=20)
        r.raise_for_status()
        data = r.json()
        pages = data.get("query", {}).get("pages", {})
        if not pages:
            return None
        page = next(iter(pages.values()))
        # prefer thumbnail URL if present
        thumb = page.get("thumbnail", {}).get("source")
        # license via imageinfo: we need file title from 'pageimage' or first 'images' entry
        file_title = page.get("pageimage")
        if not file_title:
            imgs = page.get("images", [])
            if imgs:
                file_title = imgs[0].get("title")

        license_short, artist = None, None
        if file_title:
            ii = requests.get(WIKI_API, params={
                "action": "query",
                "format": "json",
                "titles": file_title,
                "prop": "imageinfo",
                "iiprop": "url|extmetadata"
            }, headers={"User-Agent": USER_AGENT}, timeout=20).json()
            ipages = ii.get("query", {}).get("pages", {})
            if ipages:
                ipage = next(iter(ipages.values()))
                info = (ipage.get("imageinfo") or [{}])[0]
                url = info.get("url") or thumb
                meta = info.get("extmetadata") or {}
                license_short = (meta.get("LicenseShortName") or {}).get("value")
                artist = (meta.get("Artist") or {}).get("value")
                if url:
                    return url, license_short, artist
        # Fallback: just return the thumb if we have it
        if thumb:
            return thumb, None, None
    except requests.RequestException:
        pass
    return None

def enrich_wikimedia(sb: Client, max_rows: Optional[int] = 500):
    res = sb.table("plants").select("id, plant_scientific_name, plant_main_image").is_("plant_main_image", "is", None).limit(max_rows).execute()
    rows = res.data or []
    for r in tqdm(rows):
        sci = r["plant_scientific_name"]
        if not sci: continue
        out = wiki_lead_image(sci)
        if not out: continue
        url, lic, artist = out
        set_main_image(sb, r["id"], url, lic, artist)

# ---------- Step 4c: USDA common names from CSV ----------
def _pick_preferred_common(cands: list[str]) -> str:
    """
    Choose a single display string from multiple USDA 'National Common Name' values:
      1) most frequent
      2) fewest words
      3) shortest length
    """
    if not cands:
        return ""
    freq = {}
    for c in cands:
        k = c.strip()
        if not k: 
            continue
        freq[k] = freq.get(k, 0) + 1
    if not freq:
        return ""
    # tie-breakers
    def keyfn(s: str):
        return (freq[s], -len(s.split()), -len(s))  # max() → highest freq, then fewer words, then shorter
    return max(freq.keys(), key=keyfn)

def _safe_in_select(
    sb: Client,
    table: str,
    cols: str,
    colname: str,
    values: list[str],
    extra_filters: Optional[list[tuple[str, str, Any]]] = None,
    start_size: int = None,
) -> list[dict]:
    """
    Robust IN(...) paging that halves the batch on 400/414 (URL too big) and retries.
    extra_filters: e.g. [("eq","kind","scientific")]
    """
    if start_size is None:
        start_size = max(1, int(os.getenv("SUPABASE_IN_MAX", "80")))  # conservative default
    out: list[dict] = []
    vals = [v for v in values if v]
    i, size, n = 0, start_size, len(vals)

    while i < n:
        chunk = vals[i:i+size]
        try:
            q = sb.table(table).select(cols).in_(colname, chunk)
            if extra_filters:
                for op, k, v in extra_filters:
                    if op == "eq": q = q.eq(k, v)
                    elif op == "neq": q = q.neq(k, v)
                    elif op == "is": q = q.is_(k, v)
                    elif op == "like": q = q.like(k, v)
                    else: pass
            res = q.execute()
            out.extend(getattr(res, "data", None) or [])
            i += size  # success → advance window
        except Exception as e:
            msg = str(e)
            if "414" in msg or "Request-URI Too Large" in msg or "JSON could not be generated" in msg or "Bad Request" in msg:
                if size > 10:
                    size //= 2
                elif size > 1:
                    size = 1
                else:
                    # give up on this one item if even size=1 keeps failing
                    print(f"WARN: IN() still failing for single value; skipping 1 name. err={repr(e)}")
                    i += 1
            else:
                print("WARN: IN-select batch failed ->", repr(e))
                i += size
    return out

def enrich_usda_common_names(sb: Client, csv_path: str, limit: Optional[int] = None):
    """
    Fast USDA loader for the “PLANTS” flat file format you pasted.

    - Uses `Symbol` to group an accepted taxon + its synonyms.
    - Accepted row is the one with empty `Synonym Symbol`.
    - Reads common name from `Common Name` (or `National Common Name` if present).
    - Adds:
        * common synonym (kind='common', locale='en-US') for the accepted plant
        * scientific synonyms (kind='scientific') for each synonym row
    - If env USDA_SET_DISPLAY=1, also sets plants.plant_name to the USDA common
      only when plant_name currently equals plant_scientific_name (safe, non-clobber).
    """
    import re
    from collections import defaultdict, deque

    def canon_binomial(s: str) -> str:
        # keep Genus + species only; strip ranks/author strings
        if not s: return s
        s = re.sub(r"[×x]\s*", "", s)                 # drop hybrid marker
        s = re.sub(r"\b(subsp\.|ssp\.|var\.|f\.|cv\.)\b.*", "", s, flags=re.I)
        parts = s.strip().split()
        return " ".join(parts[:2]) if len(parts) >= 2 else s.strip()

    with open_text(csv_path) as f:
        sample = f.read(4096); f.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t|")
        reader = csv.DictReader(f, dialect=dialect)

        # Resolve header names
        def get(row, *cands):
            for c in cands:
                if c in row and row[c] is not None:
                    return row[c]
            return None

        groups = defaultdict(lambda: {"accepted_sci": None, "common": None, "syn_sci": []})
        rows_seen = 0

        for row in reader:
            rows_seen += 1
            sym      = (get(row, "Symbol") or "").strip()
            synsym   = (get(row, "Synonym Symbol") or "").strip()
            sci_auth = (get(row, "Scientific Name with Author", "Scientific Name with Authors", "Scientific Name") or "").strip()
            common   = (get(row, "Common Name", "National Common Name") or "").strip()

            if not sym or not sci_auth:
                continue

            g = groups[sym]
            if synsym:  # synonym row
                g["syn_sci"].append(sci_auth)
            else:       # accepted row
                # prefer the first accepted sci we see; keep the best common if present
                if not g["accepted_sci"]:
                    g["accepted_sci"] = sci_auth
                if common:
                    g["common"] = common

            if limit and len(groups) >= limit:
                # limit by number of accepted taxa processed, not raw rows
                pass

    print(f"USDA: groups={len(groups)} (rows read={rows_seen})")

    # Build lookup keys to resolve plant_ids quickly
    accepted_names = []
    for g in groups.values():
        if g["accepted_sci"]:
            accepted_names.append(g["accepted_sci"])
    # Try exact first, then canonicalized binomials
    all_lookup = set(accepted_names + [canon_binomial(s) for s in accepted_names])

    # Map name -> plant_id via plants table
    name_to_id: Dict[str, str] = {}
    def _fetch_ids_by_name(names: list[str]):
        out = {}
        chunk = 600  # safe for URL length
        names = [n for n in names if n]
        for i in range(0, len(names), chunk):
            batch = names[i:i+chunk]
            try:
                res = sb.table("plants").select("id, plant_scientific_name").in_("plant_scientific_name", batch).execute()
                for r in (res.data or []):
                    out[r["plant_scientific_name"]] = r["id"]
            except Exception as e:
                print("WARN: plants lookup batch failed ->", repr(e))
        return out

    name_to_id.update(_fetch_ids_by_name(list(all_lookup)))

    matched_exact = sum(1 for s in accepted_names if s in name_to_id)
    matched_binom = sum(1 for s in accepted_names if s not in name_to_id and canon_binomial(s) in name_to_id)
    print(f"USDA: matched_exact={matched_exact} matched_binomial={matched_binom}")

    # Fallback: resolve via scientific synonyms table (if accepted name in USDA is stored as a scientific synonym in DB)
    unresolved = [n for n in accepted_names if n not in name_to_id and canon_binomial(n) not in name_to_id]
    print(f"USDA: unresolved after exact+binomial = {len(unresolved)}")
    if unresolved:
        rows = _safe_in_select(
            sb,
            table="plant_synonyms",
            cols="plant_id,name",
            colname="name",
            values=unresolved,
            extra_filters=[("eq","kind","scientific")],
            start_size=int(os.getenv("SUPABASE_IN_MAX", "80")),
        )
        for r in rows:
            name_to_id[r["name"]] = r["plant_id"]
        print(f"USDA: resolved via scientific synonyms = {len(rows)}")

    # Build updates + synonym inserts
    set_display = os.getenv("USDA_SET_DISPLAY", "1") == "1"
    updates: list[tuple[str, Dict[str, Any]]] = []
    to_insert: list[dict] = []
    seen_common = set()
    seen_scient = set()

    # For checking plant_name==plant_scientific_name safely we fetch current values in one more pass
    # Gather plant_ids we intend to update with display
    candidate_for_display = set()

    for sym, g in groups.items():
        acc = g["accepted_sci"]
        if not acc:
            continue
        pid = (name_to_id.get(acc) or name_to_id.get(canon_binomial(acc)))
        if not pid:
            # Skip groups we can't resolve to an existing plant (avoid creating new plants from USDA)
            continue

        # common synonym
        if g["common"]:
            key = (pid, g["common"].lower(), "common", "en-US")
            if key not in seen_common:
                seen_common.add(key)
                to_insert.append({"plant_id": pid, "name": g["common"], "kind": "common", "locale": "en-US"})
            if set_display:
                candidate_for_display.add(pid)

        # scientific synonyms
        for syn_sci in g["syn_sci"]:
            nm = syn_sci.strip()
            if not nm:
                continue
            key = (pid, nm.lower(), "scientific", "")
            if key not in seen_scient:
                seen_scient.add(key)
                to_insert.append({"plant_id": pid, "name": nm, "kind": "scientific", "locale": None})

    print(f"USDA: prepared common_synonyms={len([x for x in to_insert if x['kind']=='common'])} scientific_synonyms={len([x for x in to_insert if x['kind']=='scientific'])}")

    # Only set display where plant_name still equals plant_scientific_name (safe, non-clobber)
    if set_display and candidate_for_display:
        # fetch current names for those pids
        pids = list(candidate_for_display)
        chunk = 600
        safe_updates = 0
        for i in range(0, len(pids), chunk):
            batch = pids[i:i+chunk]
            try:
                res = sb.table("plants").select("id,plant_name,plant_scientific_name").in_("id", batch).execute()
                rows = res.data or []
                wanted = set(r["id"] for r in rows if (r.get("plant_name") or "").strip() == (r.get("plant_scientific_name") or "").strip())
                # map pid → USDA common we computed above
                # build a quick index pid -> common
                common_by_pid = {}
                for sym, g in groups.items():
                    acc = g["accepted_sci"]
                    if not acc or not g["common"]: continue
                    pid = (name_to_id.get(acc) or name_to_id.get(canon_binomial(acc)))
                    if pid in wanted:
                        common_by_pid[pid] = g["common"]
                updates.extend([(pid, {"plant_name": nm}) for pid, nm in common_by_pid.items()])
                safe_updates += len(common_by_pid)
            except Exception as e:
                print("WARN: fetch current names failed ->", repr(e))
        print(f"USDA: display_name_safe_updates={safe_updates}")

    # Apply DB writes
    if updates:
        updated = _parallel_update_plants(updates, workers=DB_CONCURRENCY, batch=200)
        print(f"USDA: rows_updated={updated}")

    if to_insert:
        _parallel_upsert_synonyms(to_insert, batch=WFO_BATCH, workers=DB_CONCURRENCY)

def _wikidata_fetch_common_by_gbif_keys(keys: list[int]) -> dict[int, list[str]]:
    if not keys: return {}
    ses = _wikidata_session()
    out: dict[int, list[str]] = defaultdict(list)

    for i in range(0, len(keys), WIKIDATA_BATCH):
        batch = keys[i:i+WIKIDATA_BATCH]
        values = " ".join(f"\"{k}\"" for k in batch)

        q = f"""
        PREFIX wdt: <http://www.wikidata.org/prop/direct/>
        SELECT ?gbif ?common WHERE {{
          ?taxon wdt:P846 ?gbif ;
                 wdt:P1843 ?common .
          FILTER(lang(?common) = "en")
          VALUES ?gbif {{ {values} }}
        }}
        """

        try:
            r = ses.get(WIKIDATA_SPARQL, params={"query": q, "format": "json"}, timeout=40)
            if r.status_code != 200:
                time.sleep(0.8)
                continue
            data = r.json()
            for b in data.get("results", {}).get("bindings", []):
                gbif_str = b.get("gbif", {}).get("value")
                common   = b.get("common", {}).get("value")
                if gbif_str and common:
                    try:
                        out[int(gbif_str)].append(common)
                    except ValueError:
                        pass
        except Exception as e:
            print("WARN: WDQS P846 batch failed ->", repr(e))
        time.sleep(0.15)  # be nice

    return out

def _wikidata_fetch_common_by_scientific(scis: list[str]) -> dict[str, list[str]]:
    """
    Return {scientific_name_input: [english common names]} via P225 -> P1843.
    We send VALUES for *exact* strings; call this with both full and canonical names.
    """
    if not scis: return {}
    ses = _wikidata_session()
    out: dict[str, list[str]] = defaultdict(list)

    for i in range(0, len(scis), WIKIDATA_BATCH):
        batch = scis[i:i+WIKIDATA_BATCH]
        # Dedup + escape
        batch = sorted(set(_escape_q(s) for s in batch if s))
        if not batch: 
            continue
        values = " ".join(f"\"{s}\"" for s in batch)

        q = f"""
        PREFIX wdt: <http://www.wikidata.org/prop/direct/>
        SELECT ?sci ?common WHERE {{
          ?taxon wdt:P225 ?sci ;
                 wdt:P1843 ?common .
          FILTER(lang(?common) = "en")
          VALUES ?sci {{ {values} }}
        }}
        """

        try:
            r = ses.get(WIKIDATA_SPARQL, params={"query": q, "format": "json"}, timeout=40)
            if r.status_code != 200:
                time.sleep(0.8)
                continue
            data = r.json()
            for b in data.get("results", {}).get("bindings", []):
                sci    = b.get("sci", {}).get("value")
                common = b.get("common", {}).get("value")
                if sci and common:
                    out[sci].append(common)
        except Exception as e:
            print("WARN: WDQS P225 batch failed ->", repr(e))
        time.sleep(0.15)

    return out

def enrich_wikidata(sb: Client, batch_size: int = 20000, max_rows: Optional[int] = None):
    """
    Wikidata enrichment:
      A) P846 (GBIF key) -> P1843 en common names
      B) Fallback: P225 (scientific name / canonical binomial) -> P1843
      Insert as common synonyms; optionally set plant_name when == scientific.
    """
    processed = 0
    offset = 0
    set_display = WIKIDATA_SET_DISPLAY

    # reuse your canon_binomial from USDA section
    import re
    def canon_binomial(s: str) -> str:
        if not s: return s
        s = re.sub(r"[×x]\s*", "", s)
        s = re.sub(r"\b(subsp\.|ssp\.|var\.|f\.|cv\.)\b.*", "", s, flags=re.I)
        parts = s.strip().split()
        return " ".join(parts[:2]) if len(parts) >= 2 else s.strip()

    while True:
        res = sb.table("plants").select(
            "id, plant_scientific_name, plant_name, gbif_usage_key"
        ).range(offset, offset + batch_size - 1).execute()
        rows = res.data or []
        if not rows:
            break

        need = [r for r in rows
                if r.get("plant_scientific_name") and r.get("plant_name")
                and r["plant_scientific_name"].strip() == r["plant_name"].strip()]

        if not need:
            offset += batch_size
            continue

        if max_rows is not None:
            if processed >= max_rows:
                return
            budget = max_rows - processed
            if len(need) > budget:
                need = need[:budget]

        # -------- A) P846 path
        keyed = [r for r in need if r.get("gbif_usage_key") is not None]
        keys  = sorted({int(r["gbif_usage_key"]) for r in keyed if r.get("gbif_usage_key") is not None})
        wd_by_key: dict[int, list[str]] = _wikidata_fetch_common_by_gbif_keys(keys) if keys else {}

        # -------- B) P225 fallback (both full + canonical)
        wd_by_sci: dict[str, list[str]] = {}
        if WIKIDATA_BY_SCI:
            sci_full  = [r["plant_scientific_name"].strip() for r in need]
            sci_canon = [canon_binomial(s) for s in sci_full]
            # Query in two passes to maximize hits
            m_full  = _wikidata_fetch_common_by_scientific(sci_full)
            m_canon = _wikidata_fetch_common_by_scientific(sci_canon)
            wd_by_sci.update(m_full)
            # merge canon results (don’t overwrite full-name matches)
            for k, v in m_canon.items():
                wd_by_sci.setdefault(k, []).extend(v)

        updates: list[tuple[str, Dict[str, Any]]] = []
        syns: list[dict] = []
        seen_syn = set()

        def take_best(cands: list[str]) -> Optional[str]:
            return _pick_preferred_en_common_from_wikidata(cands or [])

        # Build updates
        for r in need:
            pid = r["id"]
            sci = (r["plant_scientific_name"] or "").strip()

            best = None
            if r.get("gbif_usage_key") is not None:
                k = int(r["gbif_usage_key"])
                best = take_best(wd_by_key.get(k, []))
            if not best and WIKIDATA_BY_SCI:
                # prefer full-name match; else canonical
                best = take_best(wd_by_sci.get(sci, [])) or take_best(wd_by_sci.get(canon_binomial(sci), []))

            if not best or best.strip().lower() == sci.lower():
                continue

            # add synonym
            syn_key = (pid, best.strip().lower(), "common", "en")
            if syn_key not in seen_syn:
                seen_syn.add(syn_key)
                syns.append({"plant_id": pid, "name": best, "kind": "common", "locale": "en"})

            # optionally set display if still equal to scientific
            if set_display:
                updates.append((pid, {"plant_name": best}))

        print(f"Wikidata: candidates={len(need)} updates={len(updates)} commons={len(syns)} (keys_queried={len(keys)} key_hits={len(wd_by_key)})")

        if updates:
            updated = _parallel_update_plants(updates, workers=DB_CONCURRENCY, batch=200)
            processed += updated
            print(f"Wikidata: rows_updated={updated}")

        if syns:
            _parallel_upsert_synonyms(syns, batch=WFO_BATCH, workers=DB_CONCURRENCY)

        offset += batch_size

def enrich_inat(sb: Client, batch_size: int = 20000, max_rows: Optional[int] = None):
    """
    iNaturalist enrichment with synonym fallback:
      - For plants where display == scientific, try iNat to get English preferred_common_name.
      - If none found or equals scientific, retry using up to GBIF_SYNONYM_LIMIT scientific synonyms to search iNat.
      - Insert common-name synonyms (locale='en') and safely set display where allowed.

    This complements USDA + GBIF + WD and usually adds many thousands.
    """
    processed = 0
    offset = 0

    allowed = set((os.getenv("ALLOWED_PLANT_FIELDS") or
                   "plant_name,family,genus,rank").split(","))

    async def _batch_inat(need_rows: list[dict], syn_map: dict[str, list[str]]):
        """
        For each plant row, try scientific -> then synonyms. Build updates + common synonyms.
        """
        updates: list[tuple[str, Dict[str, Any]]] = []
        syns: list[dict] = []
        syn_seen = set()  # (pid, lower(name))

        sem = asyncio.Semaphore(INAT_MATCH_LIMIT)

        async with httpx.AsyncClient(
            http2=True,
            limits=httpx.Limits(max_keepalive_connections=INAT_MAX_CONN, max_connections=INAT_MAX_CONN),
            headers={"User-Agent": USER_AGENT},
        ) as client:

            async def resolve_one(r):
                pid = r["id"]
                sci = r.get("plant_scientific_name") or ""
                display_now = r.get("plant_name") or ""
                # Try scientific first
                async with sem:
                    taxon = await _inat_match_name(client, sci)
                common = _inat_pick_en_common(taxon) if taxon else None

                def same_as_scientific(c: Optional[str]) -> bool:
                    return c and c.strip().lower() == sci.strip().lower()

                # If empty or same as scientific, try synonyms
                if (not common) or same_as_scientific(common):
                    for nm in syn_map.get(pid, []):
                        async with sem:
                            taxon2 = await _inat_match_name(client, nm)
                        common = _inat_pick_en_common(taxon2) if taxon2 else None
                        if common and not same_as_scientific(common):
                            break  # good enough

                # If we found a usable English common, stage writes
                if common and not same_as_scientific(common):
                    # store synonym
                    key = (pid, common.lower(), "common", "en")
                    if key not in syn_seen:
                        syn_seen.add(key)
                        syns.append({"plant_id": pid, "name": common, "kind": "common", "locale": "en"})

                    # safe display update (if enabled)
                    if INAT_SET_DISPLAY and (display_now.strip() == sci.strip()):
                        payload = {"plant_name": common}
                        payload = {k: v for k, v in payload.items() if k in allowed}
                        if payload:
                            updates.append((pid, payload))
                # else nothing to do

            await asyncio.gather(*[resolve_one(r) for r in need_rows])

        return updates, syns

    while True:
        res = sb.table("plants").select("id, plant_scientific_name, plant_name").range(offset, offset + batch_size - 1).execute()
        rows = res.data or []
        if not rows:
            break

        need = [r for r in rows
                if r.get("plant_scientific_name") and r.get("plant_name")
                and r["plant_scientific_name"].strip() == r["plant_name"].strip()]

        if not need:
            offset += batch_size
            continue

        if max_rows is not None:
            if processed >= max_rows:
                return
            budget = max_rows - processed
            if len(need) > budget:
                need = need[:budget]

        # Pull up to N scientific synonyms per plant to search against
        alt_target_ids = [r["id"] for r in need]
        syn_map = _fetch_scientific_synonyms(sb, alt_target_ids, per_plant=GBIF_SYNONYM_LIMIT)

        # Do the async iNat round
        updates, syns = asyncio.run(_batch_inat(need, syn_map))

        print(f"Wikidata/USDA/GBIF gaps via iNat this page: candidates={len(need)} updates={len(updates)} commons={len(syns)}")

        # Apply
        if updates:
            updated = _parallel_update_plants(updates, workers=DB_CONCURRENCY, batch=200)
            processed += updated
            print(f"iNat: rows_updated={updated}")

        if syns:
            _parallel_upsert_synonyms(syns, batch=WFO_BATCH, workers=DB_CONCURRENCY)

        offset += batch_size

def enrich_itis(sb: Client, batch_size: int = 20000, max_rows: Optional[int] = None):
    """
    ITIS enrichment with synonym fallback:
      - For rows where display == scientific, try ITIS for English common names.
      - If none from accepted name, retry using scientific synonyms (your DB).
      - Insert common-name synonyms (locale='en'); set plant_name only when safe.
    """
    processed = 0
    offset = 0
    allowed = set((os.getenv("ALLOWED_PLANT_FIELDS") or "plant_name").split(","))

    async def _batch_itis(need_rows: list[dict], syn_map: dict[str, list[str]]):
        updates: list[tuple[str, Dict[str, Any]]] = []
        syns: list[dict] = []
        syn_seen = set()

        tsn_cache: dict[str, Optional[str]] = {}     # name -> tsn
        name_common_cache: dict[str, list[str]] = {} # tsn -> commons

        sem = asyncio.Semaphore(ITIS_CONCURRENCY)
        async with httpx.AsyncClient(
            http2=True,
            limits=httpx.Limits(max_keepalive_connections=ITIS_MAX_CONN, max_connections=ITIS_MAX_CONN),
            headers={"User-Agent": USER_AGENT},
        ) as client:

            async def tsn_for(name: str) -> Optional[str]:
                if not name: return None
                if name in tsn_cache: return tsn_cache[name]
                async with sem:
                    tsn = await _itis_search_tsn(client, name)
                tsn_cache[name] = tsn
                return tsn

            async def commons_for_tsn(tsn: str) -> list[str]:
                if not tsn: return []
                if tsn in name_common_cache: return name_common_cache[tsn]
                async with sem:
                    arr = await _itis_common_en(client, tsn)
                name_common_cache[tsn] = arr
                return arr

            async def resolve_one(r):
                pid = r["id"]
                sci = r.get("plant_scientific_name") or ""
                display_now = r.get("plant_name") or ""
                chosen = None

                # accepted name
                tsn = await tsn_for(sci)
                commons = await commons_for_tsn(tsn) if tsn else []
                # prefer shortest/most frequent; ITIS doesn't rank, so take the first,
                # but pick a short one if there are multiple
                if commons:
                    chosen = sorted(commons, key=lambda s: (len(s.split()), len(s)))[0]

                # fallback via scientific synonyms
                if not chosen or chosen.strip().lower() == sci.strip().lower():
                    for nm in syn_map.get(pid, []):
                        tsn2 = await tsn_for(nm)
                        commons2 = await commons_for_tsn(tsn2) if tsn2 else []
                        if commons2:
                            c2 = sorted(commons2, key=lambda s: (len(s.split()), len(s)))[0]
                            if c2 and c2.strip().lower() != sci.strip().lower():
                                chosen = c2
                                break

                if chosen and chosen.strip().lower() != sci.strip().lower():
                    key = (pid, chosen.lower(), "common", "en")
                    if key not in syn_seen:
                        syn_seen.add(key)
                        syns.append({"plant_id": pid, "name": chosen, "kind": "common", "locale": "en"})
                    if ITIS_SET_DISPLAY and (display_now.strip() == sci.strip()):
                        payload = {"plant_name": chosen}
                        payload = {k: v for k, v in payload.items() if k in allowed}
                        if payload:
                            updates.append((pid, payload))

            await asyncio.gather(*[resolve_one(r) for r in need_rows])
        return updates, syns

    while True:
        res = sb.table("plants").select("id, plant_scientific_name, plant_name").range(offset, offset + batch_size - 1).execute()
        rows = res.data or []
        if not rows: break

        need = [r for r in rows
                if r.get("plant_scientific_name") and r.get("plant_name")
                and r["plant_scientific_name"].strip() == r["plant_name"].strip()]
        if not need:
            offset += batch_size
            continue

        if max_rows is not None:
            if processed >= max_rows: return
            budget = max_rows - processed
            if len(need) > budget: need = need[:budget]

        # synonyms to widen search
        syn_map = _fetch_scientific_synonyms(sb, [r["id"] for r in need], per_plant=GBIF_SYNONYM_LIMIT)

        updates, syns = asyncio.run(_batch_itis(need, syn_map))

        print(f"ITIS: candidates={len(need)} updates={len(updates)} commons={len(syns)}")

        if updates:
            updated = _parallel_update_plants(updates, workers=DB_CONCURRENCY, batch=200)
            processed += updated
            print(f"ITIS: rows_updated={updated}")
        if syns:
            _parallel_upsert_synonyms(syns, batch=WFO_BATCH, workers=DB_CONCURRENCY)

        offset += batch_size


# ---------- CLI ----------
def main():
    global DEBUG
    ap = argparse.ArgumentParser(description="Plant encyclopedia loader")
    ap.add_argument("--debug", action="store_true", help="Verbose debug logging")

    sub = ap.add_subparsers(dest="cmd", required=True)

    seed = sub.add_parser("seed-wfo", help="Seed accepted names + scientific synonyms from WFO")
    seed.add_argument("--path", required=True, help="Path to WFO JSON/CSV/TSV (supports .gz or DwC zip)")
    seed.add_argument("--limit", type=int)

    gbif = sub.add_parser("enrich-gbif", help="Fill display names from GBIF canonicalName when missing")
    gbif.add_argument("--max-rows", type=int, default=1000)

    wik = sub.add_parser("enrich-images", help="Attach lead image + license from Wikimedia")
    wik.add_argument("--max-rows", type=int, default=500)

    usda = sub.add_parser("enrich-usda", help="Add common names from USDA PLANTS CSV")
    usda.add_argument("--csv", required=True)
    usda.add_argument("--limit", type=int)

    wikidata = sub.add_parser("enrich-wikidata", help="Add English common names from Wikidata (via GBIF key P846)")
    wikidata.add_argument("--max-rows", type=int, default=100000)

    inat = sub.add_parser("enrich-inat", help="Add English common names from iNaturalist")
    inat.add_argument("--max-rows", type=int, default=1000000)

    itis = sub.add_parser("enrich-itis", help="Add English common names from ITIS")
    itis.add_argument("--max-rows", type=int, default=1000000)

    args = ap.parse_args()
    DEBUG = args.debug

    sb = get_sb()
    # quick sanity: show envs (masked) and table reachability
    from os import environ as _e
    dbg("SUPABASE_URL:", _e.get("SUPABASE_URL"))
    sr = _e.get("SUPABASE_SERVICE_ROLE", "")
    dbg("SERVICE_ROLE len:", len(sr), "prefix:", sr[:8] if sr else None)

    try:
        ping = sb.table("plants").select("id, plant_scientific_name").limit(1).execute()
        dbg("plants table reachable; sample:", getattr(ping, "data", None) or getattr(ping, "json", None))
    except Exception as e:
        print("ERROR: cannot access plants table:", repr(e))

    if args.cmd == "seed-wfo":
        seed_wfo(sb, args.path, args.limit)
    elif args.cmd == "enrich-gbif":
        enrich_gbif(sb, max_rows=args.max_rows)
    elif args.cmd == "enrich-images":
        enrich_wikimedia(sb, max_rows=args.max_rows)
    elif args.cmd == "enrich-usda":
        enrich_usda_common_names(sb, args.csv, args.limit)
    elif args.cmd == "enrich-wikidata":
        enrich_wikidata(sb, max_rows=args.max_rows)
    elif args.cmd == "enrich-inat":
        enrich_inat(sb, max_rows=args.max_rows)
    elif args.cmd == "enrich-itis":
        enrich_itis(sb, max_rows=args.max_rows)

if __name__ == "__main__":
    main()