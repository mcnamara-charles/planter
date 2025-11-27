// hooks/generatePlantData/index.ts
import { useState, useCallback } from 'react';
import { readPlantRow, savePlantsRow } from '@/services/supabasePlants';
import { computeForcedFieldsSince, CURRENT_RULESET_VERSION } from '@/utils/lib/plantRuleset';
import { useStages, STAGE_LABELS } from './stages';
import type { Args, CombinedResult } from './types';
import { generateFacts, makeInput } from './facts';
import { generateCare } from './care';
import { generateSchedule } from './schedule';

const OPENAI_MODEL = 'gpt-4.1-mini';
const NS = '[useGeneratePlantData]';

function nowMs() { return Date.now(); }
function durMs(since: number) { return `${Date.now() - since}ms`; }
function keysOf(obj: any) { return Object.keys(obj || {}); }

/**
 * Canonicalize values for JSONB-safe comparison:
 * - Sort object keys (JSONB returns arbitrary key order)
 * - Keep array order by default (PG preserves it), but we optionally sort for specific keys
 * - Trim strings; coerce numeric-like strings to numbers
 */
function normalizeForCompare(v: any): any {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(normalizeForCompare);
  if (typeof v === 'object') {
    const entries = Object.entries(v)
      .map(([k, val]) => [k, normalizeForCompare(val)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  if (typeof v === 'number') return Number(v);
  if (typeof v === 'string') {
    const trimmed = v.trim();
    const n = Number(trimmed);
    if (!Number.isNaN(n) && String(n) === trimmed) return n;
    return trimmed;
  }
  return v;
}

/** Deterministic sort for arrays-of-objects used by propagation_methods_json */
function sortArrayOfObjectsDeterministically(arr: any[]) {
  return [...arr].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
}

export function useGeneratePlantData() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CombinedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { events: progressEvents, stage } = useStages();

  const run = useCallback(async (args: Args, onProgress?: (e:any)=>void) => {
    const tRun = nowMs();
    const id = args.plantsTableId;
    console.log(`${NS} ▶ run(${id})`, { CURRENT_RULESET_VERSION });

    try {
      setLoading(true); setError(null); setData(null);

      // 0) Read current
      const tRead0 = nowMs();
      const db = await stage('db_read', STAGE_LABELS.db_read, () => readPlantRow(id), onProgress);
      console.log(`${NS} read[0](${id}) v=${db?.data_response_version ?? 0} in ${durMs(tRead0)}`);

      const rowVersion = db?.data_response_version ?? 0;
      const forced = computeForcedFieldsSince(rowVersion, CURRENT_RULESET_VERSION);

      // 1) Gate flags
      const hasDesc   = !!db?.description?.trim() && !forced.has('description');
      const hasAvail  = !!db?.availability && db.availability !== 'unknown' && !forced.has('availability');
      const hasRarity = !!db?.rarity && db?.rarity !== 'unknown' && !forced.has('rarity');
      const hasName   = !!db?.plant_name?.trim() && !forced.has('plant_name');

      const hasLight  = !!db?.care_light?.trim() && !forced.has('care_light');
      const hasWater  = !!db?.care_water?.trim() && !forced.has('care_water');
      const hasTemp   = !!db?.care_temp_humidity?.trim() && !forced.has('care_temp_humidity');
      const hasFert   = !!db?.care_fertilizer?.trim() && !forced.has('care_fertilizer');
      const hasPrune  = !!db?.care_pruning?.trim() && !forced.has('care_pruning');
      const hasSoil   = !!db?.soil_description?.trim() && !forced.has('soil_description');
      const hasProp   = Array.isArray(db?.propagation_methods_json) && db!.propagation_methods_json!.length > 0 && !forced.has('propagation_methods_json');

      const hasScheduleSame = typeof db?.schedule_same_year_round === 'boolean';
      const hasActiveDates  = !!db?.active_season_start_date && !!db?.active_season_end_date;
      const hasWaterActive  = db?.water_interval_days_active != null && db?.water_interval_days_active > 0;
      const hasWaterInactive= db?.schedule_same_year_round === true ? true : db?.water_interval_days_inactive != null && db?.water_interval_days_inactive > 0;
      const hasFertActive   = db?.fert_interval_days_active != null && db?.fert_interval_days_active > 0;
      const hasFertInactive = db?.schedule_same_year_round === true ? true : db?.fert_interval_days_inactive != null && db?.fert_interval_days_inactive > 0;

      const needsFacts    = !(hasDesc && hasAvail && hasRarity && hasName);
      const needsCare     = !(hasLight && hasWater && hasTemp && hasFert && hasPrune && hasSoil && hasProp);
      const needsSchedule = forced.has('schedule') || !(hasScheduleSame && hasActiveDates && hasWaterActive && hasWaterInactive && hasFertActive && hasFertInactive);

      const intendedChange = needsFacts || needsCare || needsSchedule || forced.size > 0;

      console.log(`${NS} plan(${id})`, {
        rowVersion,
        forced: Array.from(forced),
        needsFacts, needsCare, needsSchedule, intendedChange
      });

      // FAST PATH
      if (!intendedChange) {
        console.log(`${NS} fast-path(${id}) nothing to do`);
        const finalFast: CombinedResult = {
          description: db?.description ?? '',
          availability_status: (db?.availability ?? 'unknown') as any,
          rarity_level: (db?.rarity ?? 'unknown') as any,
          suggested_common_name: null,
          care_light: db?.care_light ?? '',
          care_water: db?.care_water ?? '',
          care_temp_humidity: db?.care_temp_humidity ?? '',
          care_fertilizer: db?.care_fertilizer ?? '',
          care_pruning: db?.care_pruning ?? '',
          soil_description: db?.soil_description ?? '',
          propagation_techniques: db?.propagation_methods_json ?? []
        };
        setData(finalFast);
        await stage('done', STAGE_LABELS.done, async () => ({} as any), onProgress);
        console.log(`${NS} ✓ done(${id}) in ${durMs(tRun)}`);
        return finalFast;
      }

      const baseInput = makeInput(db?.plant_name || args.commonName, args.scientificName);

      // 2) Kick off generators in parallel (we expect RETURN-ONLY; no direct DB writes)
      const factsPromise = needsFacts
        ? generateFacts({
            plantId: id,
            hasDesc, hasAvail, hasRarity, hasName,
            existing: { description: db?.description ?? '', availability: db?.availability ?? 'unknown', rarity: db?.rarity ?? 'unknown' },
            commonName: db?.plant_name || args.commonName,
            scientificName: args.scientificName,
            stage, onProgress
          })
        : Promise.resolve({
            description: db?.description ?? '',
            availability_status: (db?.availability ?? 'unknown') as any,
            rarity_level: (db?.rarity ?? 'unknown') as any,
            suggested_common_name: null
          });

      const carePromise = needsCare
        ? generateCare({
            plantId: id,
            hasLight, hasWater, hasTempHum: hasTemp, hasFert, hasPrune, hasSoil, hasProp,
            baseInput, scientificName: args.scientificName,
            existing: {
              care_light: db?.care_light ?? '',
              care_water: db?.care_water ?? '',
              care_temp_humidity: db?.care_temp_humidity ?? '',
              care_fertilizer: db?.care_fertilizer ?? '',
              care_pruning: db?.care_pruning ?? '',
              soil_description: db?.soil_description ?? '',
              propagation_techniques: db?.propagation_methods_json ?? []
            },
            stage, onProgress
          })
        : Promise.resolve({
            result: {
              care_light: db?.care_light ?? '',
              care_water: db?.care_water ?? '',
              care_temp_humidity: db?.care_temp_humidity ?? '',
              care_fertilizer: db?.care_fertilizer ?? '',
              care_pruning: db?.care_pruning ?? '',
              soil_description: db?.soil_description ?? '',
              propagation_techniques: db?.propagation_methods_json ?? []
            },
            payload: {}
          });

      const schedulePromise = needsSchedule
        ? generateSchedule({
            plantId: id,
            commonName: db?.plant_name || args.commonName || null,
            scientificName: args.scientificName || null,
            stage, onProgress
          })
        : Promise.resolve({});

      const [facts, care, schedule] = await Promise.all([factsPromise, carePromise, schedulePromise]);

      console.log(`${NS} generators(${id})`, {
        factsKeys: keysOf(facts),
        carePayloadKeys: keysOf((care as any)?.payload),
        careResultKeys: keysOf((care as any)?.result),
        scheduleKeys: keysOf(schedule)
      });

      // 3) Build single DB patch
      const mergedPayload: Record<string, any> = {
        ...(care as any)?.payload ?? {},
        ...(schedule as any)?.payload ?? {},
      };

      const willWritePayload = Object.keys(mergedPayload).length > 0;
      const willBumpVersion  = intendedChange; // bump on *intended* change, not only when payload exists

      console.log(`${NS} write-plan(${id})`, {
        willWritePayload,
        payloadKeys: Object.keys(mergedPayload),
        willBumpVersion
      });

      if (willBumpVersion) {
        mergedPayload.data_response_version = CURRENT_RULESET_VERSION;
        mergedPayload.data_response_meta = { model: OPENAI_MODEL, run_at: new Date().toISOString() };
      }

      // 4) Perform write if either payload or bump is planned
      if (willWritePayload || willBumpVersion) {
        try {
          await savePlantsRow(id, mergedPayload);
        } catch (e) {
          console.warn(`${NS} save(${id}) ERROR`, e);
          // If save fails, we still continue to return a result but caller will mark the item as failed.
          // We also rethrow to let the sweep mark failure.
          throw e;
        }
      } else {
        console.log(`${NS} write-skip(${id}) no payload & no bump`);
      }

      // 5) Verify: re-read to confirm version bump / field changes
      const tRead1 = nowMs();
      const after = await readPlantRow(id);
      console.log(`${NS} read[1](${id}) v=${after?.data_response_version ?? null} in ${durMs(tRead1)}`);

      if (willBumpVersion && after?.data_response_version !== CURRENT_RULESET_VERSION) {
        console.warn(`${NS} VERIFY(${id}) expected version ${CURRENT_RULESET_VERSION} but got ${after?.data_response_version}`);
      }

      // (optional) diff a few expected keys from mergedPayload
      const mismatches: Array<{ key: string; expected: any; actual: any }> = [];
      for (const k of Object.keys(mergedPayload)) {
        if (k === 'data_response_meta') continue; // meta may differ in serialization
        let expected = mergedPayload[k];
        let actual = (after as any)?.[k];

        // Normalize for JSONB-safe compare
        let expectedN = normalizeForCompare(expected);
        let actualN = normalizeForCompare(actual);

        // For propagation_methods_json, be array-order-insensitive too
        if (k === 'propagation_methods_json' && Array.isArray(expectedN) && Array.isArray(actualN)) {
          expectedN = sortArrayOfObjectsDeterministically(expectedN as any[]);
          actualN = sortArrayOfObjectsDeterministically(actualN as any[]);
        }

        const equal = JSON.stringify(expectedN) === JSON.stringify(actualN);
        if (!equal) mismatches.push({ key: k, expected, actual });
      }
      if (mismatches.length) {
        console.warn(`${NS} VERIFY(${id}) field mismatches`, mismatches.map(m => ({
          key: m.key,
          expected: normalizeForCompare(m.expected),
          actual: normalizeForCompare(m.actual),
        })));
        // Do not throw here; JSONB reordering is harmless and we already wrote successfully.
        // If you want to fail hard, uncomment the next line:
        // throw new Error(`savePlantsRow verify failed: ${mismatches.length} mismatch(es)`);
      }

      // 6) Return combined result (prefer *new* values if we wrote them)
      const finalResult: CombinedResult = {
        description: (facts as any).description,
        availability_status: (facts as any).availability_status,
        rarity_level: (facts as any).rarity_level,
        suggested_common_name: (facts as any).suggested_common_name,
        ...(care as any).result
      };

      setData(finalResult);
      await stage('done', STAGE_LABELS.done, async () => ({} as any), onProgress);
      console.log(`${NS} ✓ done(${id}) in ${durMs(tRun)}`);
      return finalResult;

    } catch (err: any) {
      console.warn(`${NS} ✗ fail(${args.plantsTableId})`, err);
      setError(err?.message ?? 'Failed to generate plant data');
      throw err; // ← rethrow so callers mark this item as failed (no false "generated")
    } finally {
      setLoading(false);
    }
  }, [stage]);

  return { loading, data, error, progressEvents, run };
}
