// services/supabasePlants.ts
import { supabase } from '@/services/supabaseClient';
import type { RowShape } from '@/hooks/generatePlantData/types';

const NS = '[supabasePlants]';
function nowMs() { return Date.now(); }
function durMs(since: number) { return `${Date.now() - since}ms`; }

const READ_COLUMNS = `
  id, plant_name, description, availability, rarity,
  care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning,
  soil_description, propagation_methods_json,
  schedule_same_year_round, active_season_start_date, active_season_end_date,
  water_interval_days_active, water_interval_days_inactive,
  fert_interval_days_active, fert_interval_days_inactive,
  data_response_version, data_response_meta
`;

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

export async function readPlantRow(id: string) {
  const t0 = nowMs();
  console.log(`${NS} readPlantRow(${id})`);
  const { data, error } = await supabase
    .from('plants')
    .select(READ_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.warn(`${NS} readPlantRow(${id}) ERROR:`, error);
    throw error;
  }
  if (!data) {
    console.warn(`${NS} readPlantRow(${id}) -> no row`);
    return null;
  }
  console.log(`${NS} readPlantRow(${id}) OK in ${durMs(t0)}`, {
    version: (data as any)?.data_response_version ?? 0,
  });
  return data as RowShape;
}

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

  console.log(`${NS} savePlantsRow(${id}) WRITE`, clean);

  const { data, error, count } = await supabase
    .from('plants')
    .update(clean, { count: 'exact' })
    .eq('id', id)
    .select(READ_COLUMNS)
    .maybeSingle();

  if (error) {
    console.warn(`${NS} savePlantsRow(${id}) ERROR:`, error);
    throw error;
  }

  if (!count || !data) {
    console.warn(`${NS} savePlantsRow(${id}) anomaly: count=${count} data=${!!data}`);
    throw new Error('savePlantsRow: update did not affect any rows (RLS? bad id?)');
  }

  console.log(`${NS} savePlantsRow(${id}) OK in ${durMs(t0)}`, {
    count,
    version: (data as any)?.data_response_version ?? null,
  });

  // Verify that returned row reflects what we attempted to write (JSONB/array-order tolerant).
  const mismatches: Array<{ key: string; expected: any; actual: any }> = [];
  for (const k of Object.keys(clean)) {
    if (k === 'data_response_meta') continue; // allow serialization differences
    const expected = clean[k];
    const actual = (data as any)[k];

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

  return data as RowShape;
}
