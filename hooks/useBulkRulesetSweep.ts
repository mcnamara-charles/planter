import { useCallback, useMemo, useRef, useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { useGeneratePlantData } from '@/hooks/generatePlantData';
import {
  computeForcedFieldsSince,
  CURRENT_RULESET_VERSION,
  type ForceField,
} from '@/utils/lib/plantRuleset';

export type SweepItemStatus = 'up_to_date' | 'generated' | 'failed';
export type SweepItem = {
  id: string;
  rowVersion: number;
  forced: ForceField[];
  needsFacts: boolean;
  needsCare: boolean;
  needsSchedule: boolean;
  requiresProfile: boolean;
};

export type SweepResult = {
  id: string;
  status: SweepItemStatus;
  error?: string | null;
};

export type SweepProgress = {
  total: number;
  queued: number;
  running: number;
  done: number;
  percent: number;
};

export type SweepOptions = {
  concurrency?: number;              // default 10
  ownerId?: string;                  // optional filter
  ids?: string[];                    // optional explicit subset
  onProgress?: (p: SweepProgress) => void;
  chunkSize?: number;                // batch read chunk size (default 500)
};

/** ---------------- internal logging helpers ---------------- */

const NS = '[useBulkRulesetSweep]';
function nowMs() { return Date.now(); }
function durMs(since: number) { return `${Date.now() - since}ms`; }
function makeRunId() {
  const rnd = Math.random().toString(36).slice(2, 7);
  return `${Date.now().toString(36)}-${rnd}`;
}

/** Global lock to ensure only one sweep runs app-wide. */
let GLOBAL_SWEEP_LOCK = false;

/** ---------------- DB Shape & helpers ---------------- */

type PlantRow = {
  id: string;
  description: string | null;
  availability: string | null;
  rarity: string | null;
  plant_name: string | null;

  care_light: string | null;
  care_water: string | null;
  care_temp_humidity: string | null;
  care_fertilizer: string | null;
  care_pruning: string | null;
  soil_description: string | null;
  propagation_methods_json: any[] | null;

  schedule_same_year_round: boolean | null;
  active_season_start_date: string | null;
  active_season_end_date: string | null;
  water_interval_days_active: number | null;
  water_interval_days_inactive: number | null;
  fert_interval_days_active: number | null;
  fert_interval_days_inactive: number | null;

  data_response_version: number | null;
  owner_id?: string | null;
};

const REQUIRED_SELECT = `
  id,
  description, availability, rarity, plant_name,
  care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning, soil_description, propagation_methods_json,
  schedule_same_year_round, active_season_start_date, active_season_end_date,
  water_interval_days_active, water_interval_days_inactive,
  fert_interval_days_active,  fert_interval_days_inactive,
  data_response_version
`;

function needsScheduleBlock(p: PlantRow) {
  // helpers
  const isPos = (n: number | null | undefined) => typeof n === 'number' && n > 0;

  const hasActiveDates =
    !!p.active_season_start_date && !!p.active_season_end_date;

  const hasActiveWater = isPos(p.water_interval_days_active);
  const hasActiveFert  = isPos(p.fert_interval_days_active);

  // If same-year-round, we ignore inactive fields entirely
  const inactiveOK = p.schedule_same_year_round === true
    ? true
    : (
        // Accept NULL as "do not do this in inactive season"
        (p.water_interval_days_inactive === null || isPos(p.water_interval_days_inactive)) &&
        (p.fert_interval_days_inactive  === null || isPos(p.fert_interval_days_inactive))
      );

  const hasSameFlag = typeof p.schedule_same_year_round === 'boolean';

  // Require: flag present, active dates, active water+fert, and inactive OK (with null allowed)
  return !(hasSameFlag && hasActiveDates && hasActiveWater && hasActiveFert && inactiveOK);
}

function computePlan(row: PlantRow): SweepItem {
  const rowVersion = row.data_response_version ?? 0;
  const forcedSet = computeForcedFieldsSince(rowVersion, CURRENT_RULESET_VERSION);
  const forced = Array.from(forcedSet);

  const hasDesc   = !!row.description?.trim() && !forcedSet.has('description');
  const hasAvail  = !!row.availability && row.availability !== 'unknown' && !forcedSet.has('availability');
  const hasRarity = !!row.rarity && row.rarity !== 'unknown' && !forcedSet.has('rarity');
  const hasName   = !!row.plant_name?.trim() && !forcedSet.has('plant_name');

  const hasLight  = !!row.care_light?.trim() && !forcedSet.has('care_light');
  const hasWater  = !!row.care_water?.trim() && !forcedSet.has('care_water');
  const hasTemp   = !!row.care_temp_humidity?.trim() && !forcedSet.has('care_temp_humidity');
  const hasFert   = !!row.care_fertilizer?.trim() && !forcedSet.has('care_fertilizer');
  const hasPrune  = !!row.care_pruning?.trim() && !forcedSet.has('care_pruning');
  const hasSoil   = !!row.soil_description?.trim() && !forcedSet.has('soil_description');
  const hasProp   = Array.isArray(row.propagation_methods_json) && row.propagation_methods_json.length > 0 && !forcedSet.has('propagation_methods_json');

  const needsFacts = !(hasDesc && hasAvail && hasRarity && hasName);
  const needsCare  = !(hasLight && hasWater && hasTemp && hasFert && hasPrune && hasSoil && hasProp);

  const scheduleForced = forcedSet.has('schedule');
  const needsSchedule  = scheduleForced || needsScheduleBlock(row);

  const requiresProfile = (!hasLight || !hasWater) || forcedSet.has('profile');

  return {
    id: row.id,
    rowVersion,
    forced,
    needsFacts,
    needsCare,
    needsSchedule,
    requiresProfile,
  };
}

/** Fetch candidates by ruleset (null or < CURRENT_RULESET_VERSION) with logging */
async function fetchCandidatesByRuleset(opts: { ownerId?: string; ids?: string[]; chunkSize?: number }, runId: string) {
  const t0 = nowMs();
  const { ownerId, ids, chunkSize = 500 } = opts;
  console.log(`${NS} [${runId}] fetchCandidatesByRuleset() ownerId=${ownerId ?? '—'} ids=${ids?.length ?? 0} chunkSize=${chunkSize}`);

  // If explicit IDs were provided, fetch those (in chunks)
  if (ids && ids.length > 0) {
    const out: PlantRow[] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      const slice = ids.slice(i, i + chunkSize);
      let q = supabase.from('plants').select(REQUIRED_SELECT).in('id', slice);
      if (ownerId) q = q.eq('owner_id', ownerId as any);
      const tBatch = nowMs();
      const { data, error } = await q;
      if (error) {
        console.warn(`${NS} [${runId}] fetch chunk error (offset=${i}, size=${slice.length}):`, error);
      } else {
        console.log(`${NS} [${runId}] fetched chunk (offset=${i}, size=${slice.length}) -> rows=${(data as PlantRow[] | null)?.length ?? 0} in ${durMs(tBatch)}`);
        out.push(...(data as PlantRow[]));
      }
    }
    console.log(`${NS} [${runId}] fetch by IDs complete, total rows=${out.length} in ${durMs(t0)}`);
    return out;
  }

  // Otherwise, sweep by version (two passes: null & < CURRENT_RULESET_VERSION)
  const out: PlantRow[] = [];

  // null version
  {
    const tNull = nowMs();
    let q = supabase.from('plants').select(REQUIRED_SELECT).is('data_response_version', null);
    if (ownerId) q = q.eq('owner_id', ownerId as any);
    const { data, error } = await q;
    if (error) {
      console.warn(`${NS} [${runId}] fetch null-version error:`, error);
    } else {
      console.log(`${NS} [${runId}] fetched null-version rows=${(data as PlantRow[] | null)?.length ?? 0} in ${durMs(tNull)}`);
      if (data) out.push(...(data as PlantRow[]));
    }
  }

  // less than current version
  {
    const tLt = nowMs();
    let q = supabase
      .from('plants')
      .select(REQUIRED_SELECT)
      .lt('data_response_version', CURRENT_RULESET_VERSION);
    if (ownerId) q = q.eq('owner_id', ownerId as any);
    const { data, error } = await q;
    if (error) {
      console.warn(`${NS} [${runId}] fetch lt-version error:`, error);
    } else {
      console.log(`${NS} [${runId}] fetched lt-version rows=${(data as PlantRow[] | null)?.length ?? 0} in ${durMs(tLt)}`);
      if (data) out.push(...(data as PlantRow[]));
    }
  }

  // de-dupe by id
  const map = new Map<string, PlantRow>();
  out.forEach(r => map.set(r.id, r));
  const deduped = Array.from(map.values());
  console.log(`${NS} [${runId}] fetch complete total=${out.length} deduped=${deduped.length} in ${durMs(t0)}`);
  return deduped;
}

/** ---------------- Hook ---------------- */

export function useBulkRulesetSweep() {
  const { run: generatePlantData } = useGeneratePlantData();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SweepProgress>({ total: 0, queued: 0, running: 0, done: 0, percent: 0 });
  const [results, setResults] = useState<Record<string, SweepResult>>({});
  const [plans, setPlans] = useState<Record<string, SweepItem>>({});
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    cancelRef.current = false;
    setRunning(false);
    setProgress({ total: 0, queued: 0, running: 0, done: 0, percent: 0 });
    setResults({});
    setPlans({});
  }, []);

  const cancel = useCallback(() => {
    console.warn(`${NS} cancel() requested`);
    cancelRef.current = true;
  }, []);

  const run = useCallback(
    async (opts: SweepOptions = {}) => {
      const runId = makeRunId();
      const tRun = nowMs();

      if (GLOBAL_SWEEP_LOCK) {
        console.log(`${NS} [${runId}] Global lock active, skipping run`);
        return { results: {}, plans: {}, progress: { total: 0, queued: 0, running: 0, done: 0, percent: 100 } };
      }

      GLOBAL_SWEEP_LOCK = true;
      console.log(`${NS} [${runId}] run() options=`, {
        concurrency: opts.concurrency ?? 10,
        idsCount: opts.ids?.length ?? 0,
        ownerId: opts.ownerId ?? null,
        chunkSize: opts.chunkSize ?? 500,
        CURRENT_RULESET_VERSION,
      });

      const failures: { id: string; error: string }[] = [];

      const finishAndReturn = (payload: { results: Record<string, SweepResult>; plans: Record<string, SweepItem>; progress: SweepProgress }) => {
        const counts = Object.values(payload.results).reduce<Record<SweepItemStatus, number>>((acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1;
          return acc;
        }, { up_to_date: 0, generated: 0, failed: 0 });

        console.log(`${NS} [${runId}] SUMMARY: up_to_date=${counts.up_to_date || 0} generated=${counts.generated || 0} failed=${counts.failed || 0} total=${Object.keys(payload.results).length} duration=${durMs(tRun)}`);

        if (failures.length > 0) {
          console.warn(`${NS} [${runId}] ERROR LIST (${failures.length})`);
          failures.forEach((f, i) => {
            console.warn(`${NS} [${runId}]  ${i + 1}. ${f.id} :: ${f.error}`);
          });
        } else {
          console.log(`${NS} [${runId}] No errors.`);
        }

        GLOBAL_SWEEP_LOCK = false;
        return payload;
      };

      try {
        const concurrency = Math.max(1, Math.min(64, opts.concurrency ?? 10));
        const chunkSize = Math.max(50, Math.min(2000, opts.chunkSize ?? 500));

        reset();
        setRunning(true);

        // 1) Fetch candidates (instant validation inputs)
        console.log(`${NS} [${runId}] Fetching candidates...`);
        const rows = await fetchCandidatesByRuleset(
          { ownerId: opts.ownerId, ids: opts.ids, chunkSize },
          runId
        );

        console.log(`${NS} [${runId}] Fetched ${rows?.length || 0} candidate rows`);

        // If no candidates, quit early
        if (!rows || rows.length === 0) {
          console.log(`${NS} [${runId}] No candidates to process, exiting (fast)`);
          setRunning(false);
          const progressPayload = { total: 0, queued: 0, running: 0, done: 0, percent: 100 };
          setProgress(progressPayload);
          return finishAndReturn({ results: {}, plans: {}, progress: progressPayload });
        }

        // 2) Compute plans locally (instant)
        console.log(`${NS} [${runId}] Computing plans for ${rows.length} rows`);
        const tPlans = nowMs();
        const localPlans: Record<string, SweepItem> = {};
        const localResults: Record<string, SweepResult> = {};
        const toGenerate: string[] = [];

        let needsFactsCount = 0;
        let needsCareCount = 0;
        let needsScheduleCount = 0;
        let forcedCount = 0;

        for (const r of rows) {
          const plan = computePlan(r);
          localPlans[r.id] = plan;

          if (plan.needsFacts) needsFactsCount++;
          if (plan.needsCare) needsCareCount++;
          if (plan.needsSchedule) needsScheduleCount++;
          if (plan.forced.length > 0) forcedCount++;

          const needs = plan.needsFacts || plan.needsCare || plan.needsSchedule || plan.forced.length > 0;
          if (needs) {
            toGenerate.push(r.id);
          } else {
            localResults[r.id] = { id: r.id, status: 'up_to_date' };
          }
        }

        setPlans(localPlans);
        if (Object.keys(localResults).length) {
          setResults(prev => ({ ...prev, ...localResults }));
        }

        console.log(`${NS} [${runId}] Plan summary: needsFacts=${needsFactsCount}, needsCare=${needsCareCount}, needsSchedule=${needsScheduleCount}, forced=${forcedCount}, totalGenerate=${toGenerate.length}, computed in ${durMs(tPlans)}`);

        // 3) Concurrency-limited generation for needed IDs
        const total = toGenerate.length;
        const progressRef = { done: 0, running: 0, queued: total };

        const updateProgress = () => {
          const percent = total === 0 ? 100 : Math.round((progressRef.done / total) * 100);
          const p = { total, queued: progressRef.queued, running: progressRef.running, done: progressRef.done, percent };
          setProgress(p);
          try {
            opts.onProgress?.(p);
          } catch (cbErr) {
            console.warn(`${NS} [${runId}] onProgress callback threw:`, cbErr);
          }
        };
        updateProgress();

        if (total === 0 || cancelRef.current) {
          if (cancelRef.current) {
            console.warn(`${NS} [${runId}] Sweep canceled before work started.`);
          }
          setRunning(false);
          updateProgress();
          return finishAndReturn({ results: localResults, plans: localPlans, progress: { total, queued: 0, running: 0, done: 0, percent: 100 } });
        }

        const queue = [...toGenerate];

        const workOne = async (id: string): Promise<void> => {
          if (cancelRef.current) {
            console.warn(`${NS} [${runId}] Skipping ${id} (cancel requested).`);
            return;
          }

          const tItem = nowMs();
          console.log(`${NS} [${runId}] ▶ start ${id}`);

          try {
            const result = await generatePlantData({ plantsTableId: id } as any);
            console.log(`${NS} [${runId}] ✅ success ${id} in ${durMs(tItem)}`, result ? { returned: true, keys: Object.keys(result || {}) } : { returned: false });

            // keep local authoritative
            localResults[id] = { id, status: 'generated' };
            // and update UI state
            setResults(prev => ({ ...prev, [id]: { id, status: 'generated' } }));
          } catch (err: any) {
            const msg = err?.message || err?.toString?.() || 'Generation failed';
            console.warn(`${NS} [${runId}] ❌ fail ${id} in ${durMs(tItem)} ::`, err);
            failures.push({ id, error: msg });
            localResults[id] = { id, status: 'failed', error: msg };
            setResults(prev => ({ ...prev, [id]: { id, status: 'failed', error: msg } }));
          } finally {
            progressRef.done += 1;
            progressRef.running -= 1;
            progressRef.queued = Math.max(0, total - progressRef.done - progressRef.running);
            updateProgress();
          }
        };

        const processQueue = async (): Promise<void> => {
          while (queue.length > 0 && !cancelRef.current) {
            const id = queue.shift();
            if (!id) break;

            console.log(`${NS} [${runId}] dequeued ${id} (remaining=${queue.length})`);
            progressRef.running += 1;
            progressRef.queued -= 1;
            updateProgress();

            await workOne(id);
          }
        };

        console.log(`${NS} [${runId}] Starting worker pool with concurrency=${Math.min(concurrency, total)} for ${toGenerate.length} plants`);
        const tWorkers = nowMs();

        const workers: Promise<void>[] = [];
        const numWorkers = Math.min(concurrency, total);
        for (let i = 0; i < numWorkers; i++) {
          workers.push(processQueue());
        }

        await Promise.all(workers);
        console.log(`${NS} [${runId}] All workers completed, total done: ${progressRef.done} in ${durMs(tWorkers)}`);

        setRunning(false);
        updateProgress();

        return finishAndReturn({
          results: localResults,
          plans: localPlans,
          progress: { total, queued: 0, running: 0, done: progressRef.done, percent: 100 },
        });
      } catch (unhandled: any) {
        console.error(`${NS} [${runId}] UNHANDLED ERROR:`, unhandled);
        setRunning(false);
        const payload = { results: {}, plans: {}, progress: { total: 0, queued: 0, running: 0, done: 0, percent: 0 as number } };
        GLOBAL_SWEEP_LOCK = false;
        return payload;
      }
    },
    [generatePlantData, reset]
  );

  const summary = useMemo(() => {
    const vals = Object.values(results);
    return vals.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<SweepItemStatus, number>
    );
  }, [results]);

  return {
    // state
    running,
    progress,
    results,
    plans,
    summary,

    // controls
    run,
    cancel,
    reset,
  };
}
