// services/supabasePlants.ts
import { supabase } from '@/services/supabaseClient';
import type { RowShape } from '@/hooks/generatePlantData/types';

const NS = '[supabasePlants]';
function nowMs() { return Date.now(); }
function durMs(since: number) { return `${Date.now() - since}ms`; }

/**
 * Field mappings: which table each field belongs to
 */
const CORE_FIELDS = [
  'id', 'plant_name', 'plant_scientific_name', 'plant_main_image', 'origin_region',
  'description', 'tags', 'is_obtainable', 'family', 'genus', 'rank',
  'gbif_usage_key', 'gbif_match_type', 'gbif_confidence', 'species_taxon_id',
  'created_by', 'created_at', 'updated_at', 'plant_name_norm', 'plant_sci_norm',
  'genus_norm', 'data_response_version', 'data_response_meta'
];

const CARE_FIELDS = [
  'preferred_humidity', 'preferred_light', 'preferred_temp_min_c', 'preferred_temp_max_c',
  'watering_preference', 'soil_preference', 'soil_description', 'fertilizer_freq_per_month',
  'toxicity', 'toxicity_notes', 'growth_rate', 'care_difficulty',
  'mature_height_cm', 'mature_spread_cm', 'preferred_window_best', 'preferred_window_ok',
  'summer_note', 'care_light', 'care_water', 'care_temp_humidity',
  'care_fertilizer', 'care_pruning', 'propagation_methods_json'
];

const MARKET_FIELDS = [
  'availability', 'rarity'
];

const SCHEDULE_FIELDS = [
  'schedule_same_year_round', 'active_season_start_date', 'active_season_end_date',
  'water_interval_days_active', 'water_interval_days_inactive',
  'fert_interval_days_active', 'fert_interval_days_inactive'
];

/**
 * Split payload into table-specific updates
 */
function splitPayloadByTable<T extends Record<string, any>>(payload: T): {
  core: Record<string, any>;
  care: Record<string, any>;
  market: Record<string, any>;
  schedule: Record<string, any>;
} {
  const core: Record<string, any> = {};
  const care: Record<string, any> = {};
  const market: Record<string, any> = {};
  const schedule: Record<string, any> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (CORE_FIELDS.includes(key)) {
      core[key] = value;
    } else if (CARE_FIELDS.includes(key)) {
      care[key] = value;
    } else if (MARKET_FIELDS.includes(key)) {
      market[key] = value;
    } else if (SCHEDULE_FIELDS.includes(key)) {
      schedule[key] = value;
    } else {
      console.warn(`${NS} Unknown field in payload: ${key}`);
    }
  }

  return { core, care, market, schedule };
}

/**
 * Merge data from all microtables into a single object
 */
function mergePlantData(core: any, care: any, market: any, schedule: any): any {
  return {
    ...core,
    ...(care || {}),
    ...(market || {}),
    ...(schedule || {}),
  };
}

/** ---------- JSONB-safe verification helpers ---------- **/

/** Recursively normalize for JSONB-safe comparison. */
function normalizeForCompare(v: any): any {
  if (v === null || v === undefined) return v;

  if (Array.isArray(v)) {
    return v.map(normalizeForCompare);
  }

  if (typeof v === 'object') {
    // Sort object keys to avoid key-order diffs from JSONB
    const entries = Object.entries(v)
      .map(([k, val]) => [k, normalizeForCompare(val)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }

  if (typeof v === 'string') {
    const t = v.trim();
    // Coerce numeric-like strings to numbers so "7" === 7 after roundtrip
    const n = Number(t);
    if (!Number.isNaN(n) && `${n}` === t) return n;
    return t;
  }

  if (typeof v === 'number') {
    return Number(v);
  }

  return v;
}

function sortArrayOfObjectsDeterministically(arr: any[]): any[] {
  return [...arr]
    .map(normalizeForCompare)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function equalJSONBSafe(key: string, expected: any, actual: any): boolean {
  // Special case: be order-insensitive for arrays-of-objects in propagation_methods_json
  if (key === 'propagation_methods_json' && Array.isArray(expected) && Array.isArray(actual)) {
    const e = sortArrayOfObjectsDeterministically(expected);
    const a = sortArrayOfObjectsDeterministically(actual);
    return JSON.stringify(e) === JSON.stringify(a);
  }

  const eN = normalizeForCompare(expected);
  const aN = normalizeForCompare(actual);
  return JSON.stringify(eN) === JSON.stringify(aN);
}

/** ----------------------------------------------------- **/

/**
 * Read plant data from all microtables
 */
export async function readPlantRow(id: string) {
  const t0 = nowMs();
  console.log(`${NS} readPlantRow(${id})`);
  
  // Fetch from all tables in parallel
  const [coreResult, careResult, marketResult, scheduleResult] = await Promise.all([
    supabase.from('plants_core').select('*').eq('id', id).maybeSingle(),
    supabase.from('plants_care').select('*').eq('plant_id', id).maybeSingle(),
    supabase.from('plants_market_meta').select('*').eq('plant_id', id).maybeSingle(),
    supabase.from('plants_schedule').select('*').eq('plant_id', id).maybeSingle(),
  ]);

  if (coreResult.error) {
    console.warn(`${NS} readPlantRow(${id}) ERROR (core):`, coreResult.error);
    throw coreResult.error;
  }

  if (!coreResult.data) {
    console.warn(`${NS} readPlantRow(${id}) -> no core row`);
    return null;
  }

  // Merge all data
  const merged = mergePlantData(
    coreResult.data,
    careResult.data || null,
    marketResult.data || null,
    scheduleResult.data || null
  );

  console.log(`${NS} readPlantRow(${id}) OK in ${durMs(t0)}`, {
    version: merged?.data_response_version ?? 0,
  });
  return merged as RowShape;
}

/**
 * Save plant data to appropriate microtables
 */
export async function savePlantsRow<T extends Record<string, any>>(id: string, payload: T) {
  const t0 = nowMs();

  // Strip undefined so we don't accidentally nuke columns.
  const clean: Record<string, any> = {};
  for (const k of Object.keys(payload)) {
    const v = (payload as any)[k];
    if (v !== undefined) clean[k] = v;
  }

  if (Object.keys(clean).length === 0) {
    console.log(`${NS} savePlantsRow(${id}) skipped (empty patch)`);
    return null;
  }

  // Split payload by table
  const { core, care, market, schedule } = splitPayloadByTable(clean);

  // Update each table that has changes
  const updates: Promise<any>[] = [];

  if (Object.keys(core).length > 0) {
    updates.push(
      supabase
        .from('plants_core')
        .update(core)
        .eq('id', id)
        .select('*')
        .maybeSingle()
    );
  } else {
    updates.push(Promise.resolve({ data: null, error: null }));
  }

  if (Object.keys(care).length > 0) {
    updates.push(
      supabase
        .from('plants_care')
        .upsert({ plant_id: id, ...care }, { onConflict: 'plant_id' })
        .select('*')
        .maybeSingle()
    );
  } else {
    updates.push(Promise.resolve({ data: null, error: null }));
  }

  if (Object.keys(market).length > 0) {
    updates.push(
      supabase
        .from('plants_market_meta')
        .upsert({ plant_id: id, ...market }, { onConflict: 'plant_id' })
        .select('*')
        .maybeSingle()
    );
  } else {
    updates.push(Promise.resolve({ data: null, error: null }));
  }

  if (Object.keys(schedule).length > 0) {
    updates.push(
      supabase
        .from('plants_schedule')
        .upsert({ plant_id: id, ...schedule }, { onConflict: 'plant_id' })
        .select('*')
        .maybeSingle()
    );
  } else {
    updates.push(Promise.resolve({ data: null, error: null }));
  }

  const [coreResult, careResult, marketResult, scheduleResult] = await Promise.all(updates);

  // Check for errors
  if (coreResult.error) {
    console.warn(`${NS} savePlantsRow(${id}) ERROR (core):`, coreResult.error);
    throw coreResult.error;
  }
  if (careResult.error) {
    console.warn(`${NS} savePlantsRow(${id}) ERROR (care):`, careResult.error);
    throw careResult.error;
  }
  if (marketResult.error) {
    console.warn(`${NS} savePlantsRow(${id}) ERROR (market):`, marketResult.error);
    throw marketResult.error;
  }
  if (scheduleResult.error) {
    console.warn(`${NS} savePlantsRow(${id}) ERROR (schedule):`, scheduleResult.error);
    throw scheduleResult.error;
  }

  // Merge results
  const merged = mergePlantData(
    coreResult.data || {},
    careResult.data || null,
    marketResult.data || null,
    scheduleResult.data || null
  );

  console.log(`${NS} savePlantsRow(${id}) OK in ${durMs(t0)}`, {
    version: merged?.data_response_version ?? null,
  });

  // Verify that returned row reflects what we attempted to write (JSONB/array-order tolerant).
  const mismatches: Array<{ key: string; expected: any; actual: any }> = [];
  for (const k of Object.keys(clean)) {
    if (k === 'data_response_meta') continue; // allow serialization differences
    const expected = clean[k];
    const actual = (merged as any)[k];

    const ok = equalJSONBSafe(k, expected, actual);
    if (!ok) mismatches.push({ key: k, expected, actual });
  }

  if (mismatches.length > 0) {
    // Only hard-fail if mismatches are on fields other than propagation_methods_json
    const hard = mismatches.filter(m => m.key !== 'propagation_methods_json');
    console.warn(
      `${NS} savePlantsRow(${id}) VERIFY MISMATCHES`,
      mismatches.map(m => ({
        key: m.key,
        expected: normalizeForCompare(m.expected),
        actual: normalizeForCompare(m.actual),
      }))
    );
    if (hard.length) {
      throw new Error(`savePlantsRow verify failed: ${hard.length} mismatch(es)`);
    }
  }

  return merged as RowShape;
}
