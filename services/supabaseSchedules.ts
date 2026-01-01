// services/supabaseSchedules.ts
import { supabase } from '@/services/supabaseClient';

const NS = '[supabaseSchedules]';

// ───────────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────────

export type ScheduleEventType = 'water' | 'fertilize';

export type ScheduleUpsert = {
  ownerId?: string;             // optional; let RLS/auth.uid() fill if not provided
  userPlantId: string;
  eventType: ScheduleEventType;
  nextRunAt: string;            // ISO timestamptz
  eventData?: Record<string, any>;
};

// Back-compat alias for callers that used Water-specific type
export type WaterScheduleUpsert = ScheduleUpsert;

type IdRow = { id: string };
type PlantLinkRow = { id: string; plants_table_id: string | null };

// Minimal shapes we read from DB
type ScheduleRow = { user_plant_id: string; updated_at: string };
type TimelineRow = { user_plant_id: string; event_time: string };

type LatestEvent = { id: string; event_time: string } | null;

type PlantSchedulingFields =
  | {
      plantId: string;
      schedule_same_year_round: boolean | null;
      active_season_start_date: string | null;
      active_season_end_date: string | null;
      water_interval_days_active: number | null;
      water_interval_days_inactive: number | null;
      fert_interval_days_active: number | null;
      fert_interval_days_inactive: number | null;
      light_type: string | null;
      system_type: string | null;
      water_delay: number | null; // Custom delay from user_plants table
    }
  | null;

function atStartOfTodayLocal(now = new Date()) {
    const local = new Date(now);
    local.setHours(0, 0, 0, 0);
    return local;
}

function addDaysLocal(date: Date, days: number) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
}

// ───────────────────────────────────────────────────────────────────────────────
// Upsert schedule
// ───────────────────────────────────────────────────────────────────────────────

export async function upsertUserPlantSchedule(input: ScheduleUpsert) {
  const row = {
    owner_id: input.ownerId ?? undefined,
    user_plant_id: input.userPlantId,
    event_type: input.eventType,
    next_run_at: input.nextRunAt,
    event_data: input.eventData ?? {},
  };

  const { data, error } = await supabase
    .from('user_plant_schedules')
    .upsert(row, {
      onConflict: 'owner_id,user_plant_id,event_type',
      ignoreDuplicates: false,
    })
    .select()
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`${NS} upsert error`, error);
    throw error;
  }
  return data;
}

// ───────────────────────────────────────────────────────────────────────────────
// Reads to assist scheduling logic
// ───────────────────────────────────────────────────────────────────────────────

/** Returns user_plant_ids that have schedules overdue by next_run_at. */
export async function fetchOverdueUserPlantIdsByType(
    eventType: ScheduleEventType
  ): Promise<string[]> {
    const today = atStartOfTodayLocal().toISOString();
  
    // Filter via the joined parent to be robust (captures rows even if schedules.owner_id is null)
    // For water schedules, exclude reservoir plants
    let query = supabase
      .from('user_plant_schedules')
      .select(`
        user_plant_id,
        user_plants!inner ( owner_id, system_type )
      `)
      .eq('event_type', eventType)
      .lt('next_run_at', today)
      .order('next_run_at', { ascending: true })
      .range(0, 9999); // explicit upper bound
    
    // For water schedules, exclude reservoir plants
    if (eventType === 'water') {
      query = query.neq('user_plants.system_type', 'reservoir');
    }
  
    const { data, error } = await query;
  
    if (error) throw error;
    const rows = (data ?? []) as Array<{ user_plant_id: string }>;
    // Dedupe just in case
    const out = Array.from(new Set(rows.map(r => r.user_plant_id))).filter(Boolean);
    // eslint-disable-next-line no-console
    console.log(`${NS} overdue ${eventType} ->`, out.length);
    return out;
  }

  export async function delayScheduleByDays(
    scheduleId: string,
    days: number
  ) {
    if (!Number.isFinite(days) || days < 0) {
      throw new Error('days must be a non-negative number');
    }
  
    // 1) Fetch the current schedule row
    const { data: current, error: fetchErr } = await supabase
      .from('user_plant_schedules')
      .select('id, next_run_at, event_data, user_plant_id, event_type')
      .eq('id', scheduleId)
      .maybeSingle();
  
    if (fetchErr) throw fetchErr;
    if (!current) throw new Error('Schedule not found');
  
    const nowIso = new Date().toISOString();
    const existingEventData = (current as any).event_data ?? {};
  
    // 2) Compute new next_run_at
    let base = (current as any).next_run_at
      ? new Date((current as any).next_run_at)
      : atStartOfTodayLocal();

    const bumped = addDaysLocal(base, days);
    const newNextRunAt = bumped.toISOString();
  
    // 3) Merge / annotate event_data
    const newEventData = {
      ...existingEventData,
      delayed_by_days: (existingEventData.delayed_by_days ?? 0) + days,
      delayed_at: nowIso,
    };
  
    // 4) Persist
    const { data: updated, error: updateErr } = await supabase
      .from('user_plant_schedules')
      .update({
        next_run_at: newNextRunAt,
        event_data: newEventData,
      })
      .eq('id', scheduleId)
      .select()
      .maybeSingle();
  
    if (updateErr) throw updateErr;

    // 5) If this is a water schedule, coordinate with fertilize schedule
    if ((current as any).event_type === 'water') {
      await coordinateFertilizeWithWater((current as any).user_plant_id);
    }
  
    return updated;
}

/**
 * Coordinates fertilize and water schedules for a plant:
 * 1. If fertilize is before water (and plant is not reservoir), push fertilize to water date
 * 2. If fertilize is within 3 days after water, pull fertilize forward to water date
 */
export async function coordinateFertilizeWithWater(userPlantId: string): Promise<void> {
  // Check if this is a reservoir plant (they only have fertilize, no water)
  const { data: plantData, error: plantError } = await supabase
    .from('user_plants')
    .select('system_type')
    .eq('id', userPlantId)
    .maybeSingle();

  if (plantError) throw plantError;
  const isReservoir = plantData?.system_type === 'reservoir';

  // Fetch both schedules
  const { data: schedules, error: schedError } = await supabase
    .from('user_plant_schedules')
    .select('id, event_type, next_run_at, event_data')
    .eq('user_plant_id', userPlantId)
    .in('event_type', ['water', 'fertilize']);

  if (schedError) throw schedError;
  if (!schedules || schedules.length === 0) {
    console.log(`${NS} coordinateFertilizeWithWater: No schedules found for ${userPlantId}`);
    return;
  }

  const waterSchedule = schedules.find(s => s.event_type === 'water');
  const fertSchedule = schedules.find(s => s.event_type === 'fertilize');

  // For reservoir plants, skip coordination (they only have fertilize)
  if (isReservoir) {
    console.log(`${NS} coordinateFertilizeWithWater: Skipping reservoir plant ${userPlantId}`);
    return;
  }
  
  if (!waterSchedule || !fertSchedule) {
    console.log(`${NS} coordinateFertilizeWithWater: Missing schedule for ${userPlantId}`, {
      hasWater: !!waterSchedule,
      hasFert: !!fertSchedule
    });
    return;
  }

  const waterDate = new Date(waterSchedule.next_run_at);
  const fertDate = new Date(fertSchedule.next_run_at);
  
  // Normalize dates to midnight for accurate day comparison
  const waterDateNormalized = new Date(waterDate);
  waterDateNormalized.setHours(0, 0, 0, 0);
  const fertDateNormalized = new Date(fertDate);
  fertDateNormalized.setHours(0, 0, 0, 0);

  // Calculate days difference (positive = fert is after water, negative = fert is before water)
  const daysDiff = Math.floor((fertDateNormalized.getTime() - waterDateNormalized.getTime()) / (1000 * 60 * 60 * 24));

  console.log(`${NS} coordinateFertilizeWithWater: ${userPlantId}`, {
    waterDate: waterDateNormalized.toISOString(),
    fertDate: fertDateNormalized.toISOString(),
    daysDiff,
    isReservoir
  });

  let newFertDate: Date | null = null;

  // Rule 1: If fertilize is before water, push it to water date
  if (daysDiff < 0) {
    console.log(`${NS} coordinateFertilizeWithWater: Pushing fertilize back from ${fertDateNormalized.toISOString()} to ${waterDateNormalized.toISOString()}`);
    newFertDate = waterDateNormalized;
  }
  // Rule 3: If fertilize is within 3 days after water, pull it forward to water date
  else if (daysDiff > 0 && daysDiff <= 3) {
    console.log(`${NS} coordinateFertilizeWithWater: Pulling fertilize forward from ${fertDateNormalized.toISOString()} to ${waterDateNormalized.toISOString()}`);
    newFertDate = waterDateNormalized;
  }

  // Update fertilize schedule if needed
  if (newFertDate) {
    const existingEventData = (fertSchedule.event_data ?? {}) as any;
    const updatedEventData = {
      ...existingEventData,
      coordinated_with_water: true,
      coordinated_at: new Date().toISOString(),
    };

    console.log(`${NS} coordinateFertilizeWithWater: Updating fertilize schedule ${fertSchedule.id} to ${newFertDate.toISOString()}`);

    const { error: updateError } = await supabase
      .from('user_plant_schedules')
      .update({
        next_run_at: newFertDate.toISOString(),
        event_data: updatedEventData,
      })
      .eq('id', fertSchedule.id);

    if (updateError) {
      console.error(`${NS} coordinateFertilizeWithWater: Update error`, updateError);
      throw updateError;
    }
    console.log(`${NS} coordinateFertilizeWithWater: Successfully updated fertilize schedule`);
  } else {
    console.log(`${NS} coordinateFertilizeWithWater: No coordination needed (daysDiff: ${daysDiff})`);
  }
}

/** Latest timeline event for a userPlant by type (or null). */
export async function fetchLatestTimelineByType(
  userPlantId: string,
  eventType: ScheduleEventType
): Promise<LatestEvent> {
  const { data, error } = await supabase
    .from('user_plant_timeline_events')
    .select('id, event_time')
    .eq('user_plant_id', userPlantId)
    .eq('event_type', eventType)
    .order('event_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`${NS} fetchLatestTimelineByType error`, error);
    throw error;
  }
  return (data as LatestEvent) ?? null;
}

/** Back-compat helper kept for existing imports. */
export async function fetchLatestWaterTimeline(userPlantId: string) {
  return fetchLatestTimelineByType(userPlantId, 'water');
}

/** Resolve scheduling fields by userPlant -> plants join. */
export async function fetchPlantSchedulingFieldsByUserPlant(
  userPlantId: string
): Promise<PlantSchedulingFields> {
  // Expect user_plants(plants_table_id)
  const { data, error } = await supabase
    .from('user_plants')
    .select(`
      id,
      light_type,
      system_type,
      water_delay,
      plants_table_id,
      plants:plants_table_id (
        id,
        schedule_same_year_round,
        active_season_start_date,
        active_season_end_date,
        water_interval_days_active,
        water_interval_days_inactive,
        fert_interval_days_active,
        fert_interval_days_inactive
      )
    `)
    .eq('id', userPlantId)
    .maybeSingle();

  if (error) throw error;
  if (!data || !(data as any).plants) return null;

  const plants = (data as any).plants;
  return {
    plantId: plants.id as string,
    schedule_same_year_round: plants.schedule_same_year_round as boolean | null,
    active_season_start_date: plants.active_season_start_date as string | null,
    active_season_end_date: plants.active_season_end_date as string | null,
    water_interval_days_active: plants.water_interval_days_active as number | null,
    water_interval_days_inactive: plants.water_interval_days_inactive as number | null,
    fert_interval_days_active: plants.fert_interval_days_active as number | null,
    fert_interval_days_inactive: plants.fert_interval_days_inactive as number | null,
    light_type: (data as any).light_type as string | null,
    system_type: (data as any).system_type as string | null,
    water_delay: (data as any).water_delay as number | null,
  };
}

/** List (user_plant_id, plants_table_id) for the current user. */
export async function fetchAllUserPlantsForOwner(): Promise<Array<PlantLinkRow>> {
  const { data, error } = await supabase
    .from('user_plants')
    .select('id, plants_table_id')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as Array<PlantLinkRow>;
}

/** All user_plant_ids for current user (only ids). */
export async function fetchAllUserPlantIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_plants')
    .select('id')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as IdRow[]).map(r => r.id);
}

/** Map of user_plant_id -> updated_at for existing schedules (restricted to provided IDs). */
export async function fetchSchedulesUpdatedAtMap(
  eventType: ScheduleEventType,
  limitToUserPlantIds?: string[]
): Promise<Map<string, string>> {
  let query = supabase
    .from('user_plant_schedules')
    .select('user_plant_id, updated_at')
    .eq('event_type', eventType);

  if (limitToUserPlantIds && limitToUserPlantIds.length > 0) {
    query = query.in('user_plant_id', limitToUserPlantIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const map = new Map<string, string>();
  ((data ?? []) as ScheduleRow[]).forEach(r => {
    if (r.user_plant_id && r.updated_at) map.set(r.user_plant_id, r.updated_at);
  });
  return map;
}

/** Map of user_plant_id -> updated_at for user_plants (restricted to provided IDs). */
export async function fetchUserPlantsUpdatedAtMap(
  limitToUserPlantIds?: string[]
): Promise<Map<string, string>> {
  let query = supabase
    .from('user_plants')
    .select('id, updated_at');

  if (limitToUserPlantIds && limitToUserPlantIds.length > 0) {
    query = query.in('id', limitToUserPlantIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const map = new Map<string, string>();
  ((data ?? []) as Array<{ id: string; updated_at: string }>).forEach(r => {
    if (r.id && r.updated_at) map.set(r.id, r.updated_at);
  });
  return map;
}

export async function fetchLatestEffectiveWateringEvent(
    userPlantId: string
  ): Promise<LatestEvent> {
    const { data, error } = await supabase
      .from('user_plant_timeline_events')
      .select('id, event_time, event_type, event_data')
      .eq('user_plant_id', userPlantId)
      .in('event_type', ['water', 'fertilize'])
      .order('event_time', { ascending: false })
      .limit(25); // a few is enough
  
    if (error) throw error;
  
    const rows = (data ?? []) as Array<{
      id: string;
      event_time: string;
      event_type: 'water' | 'fertilize' | string;
      event_data: any;
    }>;
  
    const found = rows.find(
      (r) => r.event_type === 'water' || (r.event_type === 'fertilize' && r?.event_data?.is_watering === true)
    );
    return found ? { id: found.id, event_time: found.event_time } : null;
  }
  
  /** Map user_plant_id -> latest timestamp that is relevant to a given schedule type.
   *  - For 'water': latest 'water' OR 'fertilize'(is_watering=true)
   *  - For 'fertilize': latest 'fertilize'
   */
  export async function fetchLatestRelevantTimelineByPlant(
    eventType: ScheduleEventType,
    limitToUserPlantIds?: string[]
  ): Promise<Map<string, string>> {
    if (eventType === 'fertilize') {
      // same as before, but restricted to fertilize rows
      let query = supabase
        .from('user_plant_timeline_events')
        .select('user_plant_id, event_time')
        .eq('event_type', 'fertilize')
        .order('event_time', { ascending: false });
  
      if (limitToUserPlantIds?.length) query = query.in('user_plant_id', limitToUserPlantIds);
  
      const { data, error } = await query;
      if (error) throw error;
  
      const map = new Map<string, string>();
      for (const r of (data ?? []) as TimelineRow[]) {
        if (!map.has(r.user_plant_id)) map.set(r.user_plant_id, r.event_time);
      }
      return map;
    }
  
    // WATER: fetch both water & fertilize, then pick the first row per plant
    let query = supabase
      .from('user_plant_timeline_events')
      .select('user_plant_id, event_time, event_type, event_data')
      .in('event_type', ['water', 'fertilize'])
      .order('event_time', { ascending: false });
  
    if (limitToUserPlantIds?.length) query = query.in('user_plant_id', limitToUserPlantIds);
  
    const { data, error } = await query;
    if (error) throw error;
  
    const map = new Map<string, string>();
    for (const r of (data ?? []) as Array<TimelineRow & { event_type: string; event_data: any }>) {
      if (map.has(r.user_plant_id)) continue;
      const countsAsWater =
        r.event_type === 'water' || (r.event_type === 'fertilize' && r?.event_data?.is_watering === true);
      if (countsAsWater) map.set(r.user_plant_id, r.event_time);
    }
    return map;
  }

/**
 * Map of user_plant_id -> latest event_time (any event_type) from timeline,
 * restricted to the provided userPlantIds.
 */
export async function fetchLatestTimelineByPlant(
  limitToUserPlantIds?: string[]
): Promise<Map<string, string>> {
  let query = supabase
    .from('user_plant_timeline_events')
    .select('user_plant_id, event_time')
    .order('event_time', { ascending: false });

  if (limitToUserPlantIds && limitToUserPlantIds.length > 0) {
    query = query.in('user_plant_id', limitToUserPlantIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const map = new Map<string, string>();
  // Because we ordered DESC by time, the first time we see an id is the latest
  for (const r of (data ?? []) as TimelineRow[]) {
    if (!map.has(r.user_plant_id)) {
      map.set(r.user_plant_id, r.event_time);
    }
  }
  return map;
}

/**
 * Compute which plants need a schedule rebuild for a specific type:
 *  - No schedule exists, OR
 *  - latestTimeline(user_plant) > schedule.updated_at, OR
 *  - user_plants.updated_at > schedule.updated_at (plant was updated)
 *
 * All lookups are scoped to the user's current user_plants.
 */
export async function fetchUserPlantIdsNeedingRebuild(
  eventType: ScheduleEventType
): Promise<string[]> {
  const allIds = await fetchAllUserPlantIds();
  if (allIds.length === 0) return [];

  // For water schedules, exclude reservoir plants
  let idsToCheck = allIds;
  if (eventType === 'water') {
    // Fetch system_type for all plants to filter out reservoir plants
    const { data: plantsData, error: plantsError } = await supabase
      .from('user_plants')
      .select('id, system_type')
      .in('id', allIds);
    
    if (plantsError) throw plantsError;
    
    // Filter out reservoir plants for water schedule rebuilds
    idsToCheck = (plantsData ?? [])
      .filter((p: any) => p.system_type !== 'reservoir')
      .map((p: any) => p.id);
  }

  const [schedMap, latestMap, plantsUpdatedMap] = await Promise.all([
    fetchSchedulesUpdatedAtMap(eventType, idsToCheck),
    fetchLatestRelevantTimelineByPlant(eventType, idsToCheck),
    fetchUserPlantsUpdatedAtMap(idsToCheck),
  ]);

  const needs: string[] = [];
  for (const id of idsToCheck) {
    const schedUpdatedAt = schedMap.get(id); // may be undefined
    const latestEventAt = latestMap.get(id); // may be undefined
    const plantUpdatedAt = plantsUpdatedMap.get(id); // may be undefined

    if (!schedUpdatedAt) {
      // No schedule yet → include
      needs.push(id);
      continue;
    }

    // Check if plant was updated after schedule
    if (plantUpdatedAt && new Date(plantUpdatedAt).getTime() > new Date(schedUpdatedAt).getTime()) {
      needs.push(id);
      continue;
    }

    if (!latestEventAt) {
      // No timeline events at all → schedule exists and nothing changed since → skip
      continue;
    }
    // Compare timestamps - if latest event is newer than schedule update, rebuild needed
    if (new Date(latestEventAt).getTime() > new Date(schedUpdatedAt).getTime()) {
      needs.push(id);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`${NS} needsRebuild ${eventType} ->`, needs);

  return needs;
}

/** Back-compat function for existing callers targeting water only. */
export async function fetchUserPlantIdsNeedingWaterRebuild(): Promise<string[]> {
  return fetchUserPlantIdsNeedingRebuild('water');
}
