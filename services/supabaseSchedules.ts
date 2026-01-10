// services/supabaseSchedules.ts
import { supabase } from '@/services/supabaseClient';

const NS = '[supabaseSchedules]';

// ───────────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────────

export type ScheduleEventType = 'water' | 'fertilize' | 'pest_treat';

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

export function atStartOfTodayLocal(now = new Date()) {
    const local = new Date(now);
    local.setHours(0, 0, 0, 0);
    return local;
}

export function addDaysLocal(date: Date, days: number) {
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

/**
 * Batch upsert multiple schedules for a single plant in one database operation
 * This is more efficient than calling upsertUserPlantSchedule multiple times
 */
export async function upsertPlantSchedulesBatch(
  userPlantId: string,
  schedules: Array<{
    eventType: ScheduleEventType;
    nextRunAt: string;
    eventData?: Record<string, any>;
    ownerId?: string;
  }>
): Promise<any[]> {
  if (schedules.length === 0) return [];

  const rows = schedules.map(schedule => ({
    owner_id: schedule.ownerId ?? undefined,
    user_plant_id: userPlantId,
    event_type: schedule.eventType,
    next_run_at: schedule.nextRunAt,
    event_data: schedule.eventData ?? {},
  }));

  const { data, error } = await supabase
    .from('user_plant_schedules')
    .upsert(rows, {
      onConflict: 'owner_id,user_plant_id,event_type',
      ignoreDuplicates: false,
    })
    .select();

  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`${NS} batch upsert error`, error);
    throw error;
  }
  return data ?? [];
}

/**
 * Batch upsert schedules for multiple plants in one database operation
 * This is the most efficient way to update many schedules at once
 */
export async function upsertSchedulesBatchAll(
  schedules: Array<{
    userPlantId: string;
    eventType: ScheduleEventType;
    nextRunAt: string;
    eventData?: Record<string, any>;
    ownerId: string; // Required - must be provided
  }>
): Promise<any[]> {
  if (schedules.length === 0) return [];

  const rows = schedules.map(schedule => {
    if (!schedule.ownerId) {
      throw new Error(`ownerId is required for schedule upsert (plant: ${schedule.userPlantId})`);
    }
    return {
      owner_id: schedule.ownerId,
      user_plant_id: schedule.userPlantId,
      event_type: schedule.eventType,
      next_run_at: schedule.nextRunAt,
      event_data: schedule.eventData ?? {},
    };
  });

  const { data, error } = await supabase
    .from('user_plant_schedules')
    .upsert(rows, {
      onConflict: 'owner_id,user_plant_id,event_type',
      ignoreDuplicates: false,
    })
    .select();

  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`${NS} batch upsert all error`, error);
    throw error;
  }
  return data ?? [];
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
    const { data, error } = await supabase
      .from('user_plant_schedules')
      .select('user_plant_id')
      .eq('event_type', eventType)
      .lt('next_run_at', today);
  
    if (error) throw error;
    return ((data ?? []) as ScheduleRow[]).map(r => r.user_plant_id);
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
  ((data ?? []) as ScheduleRow[]).forEach(row => {
    map.set(row.user_plant_id, row.updated_at);
  });
  return map;
}

/**
 * Fallback method that queries all events and filters client-side (less efficient but works without RPC).
 * Should only be used if RPC function is not available.
 */
async function fetchLatestEventsPerPlantFallback(
  plantIds: string[],
  eventTypes: string[]
): Promise<Map<string, { id: string; event_time: string; event_type: string; event_data?: any } | null>> {
  if (plantIds.length === 0) return new Map();

  // Fetch all events for these plants and types, ordered by event_time DESC
  // We'll still get too many rows, but it's the best we can do without RPC
  const { data, error } = await supabase
    .from('user_plant_timeline_events')
    .select('user_plant_id, id, event_time, event_type, event_data')
    .in('user_plant_id', plantIds)
    .in('event_type', eventTypes)
    .order('user_plant_id', { ascending: true })
    .order('event_time', { ascending: false });

  if (error) throw error;

  // Take first event per plant (since they're ordered by event_time DESC)
  const map = new Map<string, { id: string; event_time: string; event_type: string; event_data?: any } | null>();
  const seen = new Set<string>();
  
  (data || []).forEach((row: any) => {
    if (!seen.has(row.user_plant_id)) {
      seen.add(row.user_plant_id);
      map.set(row.user_plant_id, {
        id: row.id,
        event_time: row.event_time,
        event_type: row.event_type,
        event_data: row.event_data,
      });
    }
  });

  // Fill in nulls for plants with no events
  plantIds.forEach(plantId => {
    if (!map.has(plantId)) {
      map.set(plantId, null);
    }
  });

  return map;
}

/** Map of user_plant_id -> event_time for timeline events (restricted to provided IDs). */
export async function fetchTimelineEventTimeMap(
  eventType: ScheduleEventType,
  limitToUserPlantIds?: string[]
): Promise<Map<string, string>> {
  if (!limitToUserPlantIds || limitToUserPlantIds.length === 0) {
    return new Map();
  }

  // Use efficient RPC method
  const eventsMap = await fetchLatestEventsPerPlantRPC(limitToUserPlantIds, [eventType]);
  
  // Convert to event_time map
  const map = new Map<string, string>();
  eventsMap.forEach((event, plantId) => {
    if (event) {
      map.set(plantId, event.event_time);
    }
  });
  
  return map;
}

/**
 * Fetch latest timeline events per plant efficiently using RPC (or fallback).
 * Exported for use in rebuild hooks.
 */
export async function fetchLatestEventsPerPlantRPC(
  plantIds: string[],
  eventTypes: string[]
): Promise<Map<string, { id: string; event_time: string; event_type: string; event_data?: any } | null>> {
  if (plantIds.length === 0) return new Map();

  try {
    // Call RPC function that uses DISTINCT ON to get latest event per plant
    const { data, error } = await supabase.rpc('get_latest_timeline_events_per_plant', {
      p_plant_ids: plantIds,
      p_event_types: eventTypes,
    });

    if (error) {
      // If RPC function doesn't exist, fall back to manual query (less efficient)
      console.warn(`${NS} RPC function 'get_latest_timeline_events_per_plant' not found or error:`, error);
      return fetchLatestEventsPerPlantFallback(plantIds, eventTypes);
    }

    const map = new Map<string, { id: string; event_time: string; event_type: string; event_data?: any } | null>();
    (data || []).forEach((row: any) => {
      map.set(row.user_plant_id, {
        id: row.id,
        event_time: row.event_time,
        event_type: row.event_type,
        event_data: row.event_data,
      });
    });

    // Fill in nulls for plants that had no events
    plantIds.forEach(plantId => {
      if (!map.has(plantId)) {
        map.set(plantId, null);
      }
    });

    return map;
  } catch (err) {
    console.warn(`${NS} Error calling RPC, falling back:`, err);
    return fetchLatestEventsPerPlantFallback(plantIds, eventTypes);
  }
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
 * Coordinates fertilize and water schedules in memory (pure function, no DB calls):
 * 1. If fertilize is before water (and plant is not reservoir), push fertilize to water date
 * 2. If fertilize is within 3 days after water, pull fertilize forward to water date
 * 
 * Returns the adjusted fertilize schedule nextRunAt, or null if no coordination needed.
 */
export function coordinateFertilizeWithWaterInMemory(
  waterSchedule: { nextRunAt: string; eventData?: Record<string, any> } | null,
  fertSchedule: { nextRunAt: string; eventData?: Record<string, any> } | null,
  isReservoir: boolean
): { adjustedNextRunAt: string; adjustedEventData: Record<string, any> } | null {
  // For reservoir plants, skip coordination (they only have fertilize)
  if (isReservoir) {
    return null;
  }
  
  if (!waterSchedule || !fertSchedule) {
    return null;
  }

  const waterDate = new Date(waterSchedule.nextRunAt);
  const fertDate = new Date(fertSchedule.nextRunAt);
  
  // Normalize dates to midnight for accurate day comparison
  const waterDateNormalized = new Date(waterDate);
  waterDateNormalized.setHours(0, 0, 0, 0);
  const fertDateNormalized = new Date(fertDate);
  fertDateNormalized.setHours(0, 0, 0, 0);

  // Calculate days difference (positive = fert is after water, negative = fert is before water)
  const daysDiff = Math.floor((fertDateNormalized.getTime() - waterDateNormalized.getTime()) / (1000 * 60 * 60 * 24));

  let newFertDate: Date | null = null;

  // Rule 1: If fertilize is before water, push it to water date
  if (daysDiff < 0) {
    newFertDate = waterDateNormalized;
  }
  // Rule 2: If fertilize is within 3 days after water, pull it forward to water date
  else if (daysDiff > 0 && daysDiff <= 3) {
    newFertDate = waterDateNormalized;
  }

  // Update fertilize schedule if needed
  if (newFertDate) {
    const existingEventData = fertSchedule.eventData ?? {};
    const adjustedEventData = {
      ...existingEventData,
      coordinated_with_water: true,
      coordinated_at: new Date().toISOString(),
    };

    return {
      adjustedNextRunAt: newFertDate.toISOString(),
      adjustedEventData,
    };
  }

  return null;
}

/**
 * Coordinates fertilize and water schedules for a plant (legacy function with DB calls):
 * 1. If fertilize is before water (and plant is not reservoir), push fertilize to water date
 * 2. If fertilize is within 3 days after water, pull fertilize forward to water date
 * 
 * @deprecated Use coordinateFertilizeWithWaterInMemory instead for rebuild operations
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

  const waterDate = new Date((waterSchedule as any).next_run_at);
  const fertDate = new Date((fertSchedule as any).next_run_at);
  
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
    const existingEventData = ((fertSchedule as any).event_data ?? {}) as any;
    const updatedEventData = {
      ...existingEventData,
      coordinated_with_water: true,
      coordinated_at: new Date().toISOString(),
    };

    console.log(`${NS} coordinateFertilizeWithWater: Updating fertilize schedule ${(fertSchedule as any).id} to ${newFertDate.toISOString()}`);

    const { error: updateError } = await supabase
      .from('user_plant_schedules')
      .update({
        next_run_at: newFertDate.toISOString(),
        event_data: updatedEventData,
      })
      .eq('id', (fertSchedule as any).id);

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

/** Fetch the most recent pest_id or pest_treat event for a plant, with event_data. */
export async function fetchLatestPestEvent(
  userPlantId: string
): Promise<{ id: string; event_time: string; event_type: string; event_data: any } | null> {
  const { data, error } = await supabase
    .from('user_plant_timeline_events')
    .select('id, event_time, event_type, event_data')
    .eq('user_plant_id', userPlantId)
    .in('event_type', ['pest_id', 'pest_treat'])
    .order('event_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`${NS} fetchLatestPestEvent error`, error);
    throw error;
  }
  return (data as any) ?? null;
}

/** Calculate the next pest treatment date based on pest events (5-day cycle). */
export function calculateNextPestTreatmentDate(
  latestPestEvent: { event_time: string; event_type: string; event_data: any } | null,
  now: Date = new Date()
): Date | null {
  if (!latestPestEvent) return null;

  const PEST_TREATMENT_INTERVAL_DAYS = 5;
  const today = atStartOfTodayLocal(now);

  // If it's a pest_treat event, next treatment is 5 days from that event
  if (latestPestEvent.event_type === 'pest_treat') {
    const treatDate = new Date(latestPestEvent.event_time);
    const treatDateMidnight = atStartOfTodayLocal(treatDate);
    const nextDate = addDaysLocal(treatDateMidnight, PEST_TREATMENT_INTERVAL_DAYS);
    // If next date is in the past, push to today
    return nextDate < today ? today : nextDate;
  }

  // If it's a pest_id event, check if it's active
  if (latestPestEvent.event_type === 'pest_id') {
    const eventData = latestPestEvent.event_data || {};
    if (eventData.status === 'active') {
      // Use last_treatment_date if available, otherwise use event_time
      const baseDate = eventData.last_treatment_date 
        ? new Date(eventData.last_treatment_date)
        : new Date(latestPestEvent.event_time);
      const baseDateMidnight = atStartOfTodayLocal(baseDate);
      
      const nextDate = addDaysLocal(baseDateMidnight, PEST_TREATMENT_INTERVAL_DAYS);
      // If next date is in the past, push to today
      return nextDate < today ? today : nextDate;
    }
  }

  return null;
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
    idsToCheck = ((plantsData ?? []) as Array<{ id: string; system_type: string | null }>)
      .filter(p => p.system_type !== 'reservoir')
      .map(p => p.id);
  }

  const [schedulesMap, timelineMap] = await Promise.all([
    fetchSchedulesUpdatedAtMap(eventType, idsToCheck),
    fetchTimelineEventTimeMap(eventType, idsToCheck),
  ]);

  const needsRebuild: string[] = [];
  for (const userPlantId of idsToCheck) {
    const scheduleUpdated = schedulesMap.get(userPlantId);
    const timelineEventTime = timelineMap.get(userPlantId);

    // If there's a timeline event but no schedule, or timeline event is newer than schedule, rebuild
    if (timelineEventTime) {
      if (!scheduleUpdated || new Date(timelineEventTime) > new Date(scheduleUpdated)) {
        needsRebuild.push(userPlantId);
      }
    }
  }

  return needsRebuild;
}

/** All user_plant_ids for current user (only ids). */
export async function fetchAllUserPlantIds(): Promise<string[]> {
  // Fetch all rows - Supabase default limit is 1000, but we'll handle pagination if needed
  let allIds: string[] = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('user_plants')
      .select('id')
      .order('created_at', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    
    const pageIds = ((data ?? []) as IdRow[]).map(r => r.id);
    allIds = [...allIds, ...pageIds];
    
    // If we got fewer results than the page size, we've reached the end
    hasMore = pageIds.length === pageSize;
    page++;
    
    // Safety limit to prevent infinite loops
    if (page > 100) {
      console.warn('[fetchAllUserPlantIds] Stopped pagination after 100 pages (100k+ plants)');
      break;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[fetchAllUserPlantIds] Fetched ${allIds.length} total user plant IDs`);
  return allIds;
}

export async function updatePestTreatSchedule(userPlantId: string): Promise<any> {
  const today = atStartOfTodayLocal();
  const latestPestEvent = await fetchLatestPestEvent(userPlantId);
  const nextPestTreatment = calculateNextPestTreatmentDate(latestPestEvent, today);

  if (!nextPestTreatment) {
    // No active pest, remove schedule if it exists
    const { error } = await supabase
      .from('user_plant_schedules')
      .delete()
      .eq('user_plant_id', userPlantId)
      .eq('event_type', 'pest_treat');
    
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(`${NS} updatePestTreatSchedule delete error`, error);
      throw error;
    }
    // eslint-disable-next-line no-console
    console.log(`${NS} updatePestTreatSchedule: No active pest for ${userPlantId}, removed schedule`);
    return null;
  }

  // Check if next treatment is today or in the past - if so, push to today
  const nextPestMidnight = atStartOfTodayLocal(nextPestTreatment);
  const todayMidnight = atStartOfTodayLocal(today);
  const finalNextDate = nextPestMidnight < todayMidnight ? todayMidnight : nextPestMidnight;

  // Upsert the schedule with the calculated next treatment date
  const saved = await upsertUserPlantSchedule({
    userPlantId,
    eventType: 'pest_treat',
    nextRunAt: finalNextDate.toISOString(),
    eventData: { 
      reason: finalNextDate <= todayMidnight ? 'due' : 'projected',
      intervalDays: 5,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`${NS} updatePestTreatSchedule: Updated ${userPlantId} to ${finalNextDate.toISOString()} (${finalNextDate <= todayMidnight ? 'due' : 'projected'})`);
  return saved;
}

/** Fetch user_plant_ids that have pest events and need pest_treat schedule updates. */
export async function fetchUserPlantIdsNeedingPestScheduleUpdate(): Promise<string[]> {
  const allIds = await fetchAllUserPlantIds();
  if (allIds.length === 0) return [];

  // Get pest_treat schedules and their updated_at times
  const schedulesMap = await fetchSchedulesUpdatedAtMap('pest_treat', allIds);

  // Get latest pest_id and pest_treat events for all plants
  const pestIdEventsMap = await fetchLatestEventsPerPlantRPC(allIds, ['pest_id']);
  const pestTreatEventsMap = await fetchLatestEventsPerPlantRPC(allIds, ['pest_treat']);

  const needsRebuild: string[] = [];
  
  for (const userPlantId of allIds) {
    const pestIdEvent = pestIdEventsMap.get(userPlantId);
    const pestTreatEvent = pestTreatEventsMap.get(userPlantId);
    const scheduleUpdated = schedulesMap.get(userPlantId);
    
    // Check if this plant has an active pest_id event
    const eventData = pestIdEvent?.event_data as any;
    const hasActivePest = eventData?.status === 'active';
    
    if (hasActivePest) {
      // Plant has an active pest - needs a pest_treat schedule
      // Find the most recent relevant event (pest_id or pest_treat)
      let latestEventTime: string | null = null;
      if (pestTreatEvent && pestIdEvent) {
        latestEventTime = pestTreatEvent.event_time > pestIdEvent.event_time 
          ? pestTreatEvent.event_time 
          : pestIdEvent.event_time;
      } else if (pestTreatEvent) {
        latestEventTime = pestTreatEvent.event_time;
      } else if (pestIdEvent) {
        latestEventTime = pestIdEvent.event_time;
      }
      
      // If no schedule exists, or the latest relevant event is newer than the schedule, rebuild
      if (!scheduleUpdated || (latestEventTime && new Date(latestEventTime) > new Date(scheduleUpdated))) {
        needsRebuild.push(userPlantId);
      }
    }
    // Note: Plants with schedules but no active pest will have their schedules deleted
    // during the rebuild process, but we don't need to trigger a rebuild just for deletion
  }

  return needsRebuild;
}

/** Fetch latest effective watering event (water or fertilize for reservoir plants). */
export async function fetchLatestEffectiveWateringEvent(userPlantId: string): Promise<LatestEvent> {
  // For reservoir plants, fertilize events count as "watering" events
  // For normal plants, water events OR fertilize events with is_watering=true count
  // Check if this is a reservoir plant first
  const { data: plantData, error: plantError } = await supabase
    .from('user_plants')
    .select('system_type')
    .eq('id', userPlantId)
    .maybeSingle();

  if (plantError) throw plantError;
  const isReservoir = plantData?.system_type === 'reservoir';

  if (isReservoir) {
    // For reservoir plants, use fertilize events
    return fetchLatestTimelineByType(userPlantId, 'fertilize');
  } else {
    // For normal plants, fetch both water events and fertilize events with is_watering=true
    // and return the most recent one
    const { data: waterData, error: waterError } = await supabase
      .from('user_plant_timeline_events')
      .select('id, event_time, event_data')
      .eq('user_plant_id', userPlantId)
      .eq('event_type', 'water')
      .order('event_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fetch fertilize events and filter client-side for is_watering=true
    // (Supabase JSONB filtering with boolean values can be inconsistent)
    // We fetch the most recent ones (limit 10) and find the first with is_watering=true
    const { data: fertDataRaw, error: fertError } = await supabase
      .from('user_plant_timeline_events')
      .select('id, event_time, event_data')
      .eq('user_plant_id', userPlantId)
      .eq('event_type', 'fertilize')
      .order('event_time', { ascending: false })
      .limit(10);
    
    if (waterError) throw waterError;
    if (fertError) throw fertError;
    
    const fertData = fertDataRaw?.find(event => event.event_data?.is_watering === true) || null;

    // Return the most recent of the two
    if (!waterData && !fertData) return null;
    if (!waterData) return fertData as LatestEvent;
    if (!fertData) return waterData as LatestEvent;

    const waterTime = new Date(waterData.event_time).getTime();
    const fertTime = new Date(fertData.event_time).getTime();
    return (waterTime >= fertTime ? waterData : fertData) as LatestEvent;
  }
}

/** Fetch latest relevant timeline event for scheduling purposes. */
export async function fetchLatestRelevantTimelineByPlant(
  userPlantId: string
): Promise<{ event_type: string; event_time: string } | null> {
  const { data, error } = await supabase
    .from('user_plant_timeline_events')
    .select('event_type, event_time')
    .eq('user_plant_id', userPlantId)
    .in('event_type', ['water', 'fertilize', 'pest_id', 'pest_treat'])
    .order('event_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`${NS} fetchLatestRelevantTimelineByPlant error`, error);
    throw error;
  }
  return (data as any) ?? null;
}

// ───────────────────────────────────────────────────────────────────────────────
// Schedule calculation functions (no database writes - pure calculations)
// ───────────────────────────────────────────────────────────────────────────────

export function toMD(dateStr: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return { m: d.getMonth() + 1, d: d.getDate() };
}

export function isTodayInActive(
  todayLocal: Date,
  startStr: string | null,
  endStr: string | null,
  sameAllYear?: boolean | null
) {
  if (sameAllYear) return true;
  if (!startStr || !endStr) return true;
  const s = toMD(startStr)!;
  const e = toMD(endStr)!;
  const m = todayLocal.getMonth() + 1;
  const d = todayLocal.getDate();
  const afterStart = m > s.m || (m === s.m && d >= s.d);
  const beforeEnd = m < e.m || (m === e.m && d <= e.d);
  if (s.m < e.m || (s.m === e.m && s.d <= e.d)) {
    return afterStart && beforeEnd;
  } else {
    return afterStart || beforeEnd;
  }
}

export function nextOccurrenceOfMonthDay(month: number, day: number, fromDate: Date = new Date()): Date {
  const currentYear = fromDate.getFullYear();
  const currentMonth = fromDate.getMonth() + 1;
  const currentDay = fromDate.getDate();
  const thisYear = new Date(currentYear, month - 1, day);
  thisYear.setHours(0, 0, 0, 0);
  if (month > currentMonth || (month === currentMonth && day >= currentDay)) {
    return thisYear;
  }
  const nextYear = new Date(currentYear + 1, month - 1, day);
  nextYear.setHours(0, 0, 0, 0);
  return nextYear;
}

export type CalculatedSchedule = {
  eventType: ScheduleEventType;
  nextRunAt: string;
  eventData: Record<string, any>;
} | null;

/**
 * Calculate water or fertilize schedule for a plant WITHOUT upserting to database
 * Returns the schedule data that would be upserted, or null if skipped
 */
export async function calculateScheduleForPlant(
  userPlantId: string,
  eventType: 'water' | 'fertilize',
  sched: NonNullable<PlantSchedulingFields>,
  lastEvent: LatestEvent | null,
  latestPestEvent: { event_time: string; event_type: string; event_data: any } | null
): Promise<CalculatedSchedule> {
  // For reservoir plants: skip water schedules entirely
  if (eventType === 'water' && sched.system_type === 'reservoir') {
    return null;
  }

  // For reservoir plants: always set fertilize to 7 days
  if (eventType === 'fertilize' && sched.system_type === 'reservoir') {
    const today = atStartOfTodayLocal();
    const intervalDays = 7;
    let nextAt = today;
    let reason: 'initial' | 'due' | 'projected' = 'initial';

    if (lastEvent?.event_time) {
      const lastAt = new Date(lastEvent.event_time);
      const lastMidnightLocal = new Date(lastAt);
      lastMidnightLocal.setHours(0, 0, 0, 0);
      const todayMidnightLocal = new Date(today);
      todayMidnightLocal.setHours(0, 0, 0, 0);

      const daysSince = Math.floor(
        (todayMidnightLocal.getTime() - lastMidnightLocal.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSince >= intervalDays) {
        reason = 'due';
        nextAt = today;
      } else {
        reason = 'projected';
        nextAt = addDaysLocal(lastMidnightLocal, intervalDays);
        if (nextAt < today) nextAt = today;
      }
    }

    return {
      eventType: 'fertilize',
      nextRunAt: nextAt.toISOString(),
      eventData: { reason, activeNow: true, intervalDays, isReservoir: true },
    };
  }

  const today = atStartOfTodayLocal();
  const activeNow = sched.light_type === 'grow_light' 
    ? true 
    : isTodayInActive(
        today,
        sched.active_season_start_date,
        sched.active_season_end_date,
        sched.schedule_same_year_round ?? null
      );

  // Pick interval based on event type
  let intervalDays: number | null;
  if (eventType === 'water') {
    if (sched.water_delay !== null && sched.water_delay !== undefined) {
      intervalDays = sched.water_delay;
    } else {
      intervalDays = activeNow ? sched.water_interval_days_active ?? null : sched.water_interval_days_inactive ?? null;
    }
  } else {
    intervalDays = activeNow ? sched.fert_interval_days_active ?? null : sched.fert_interval_days_inactive ?? null;
  }

  // If nothing configured during inactive season, schedule for next active season start
  if (!intervalDays || intervalDays <= 0) {
    if (!activeNow && sched.active_season_start_date) {
      const startMD = toMD(sched.active_season_start_date);
      if (startMD) {
        const nextSeasonStart = nextOccurrenceOfMonthDay(startMD.m, startMD.d, today);
        return {
          eventType,
          nextRunAt: nextSeasonStart.toISOString(),
          eventData: { reason: 'next_season', activeNow: false, intervalDays: null },
        };
      }
    }
    return null; // No interval configured
  }

  // Calculate next run date based on last event
  let nextAt = today;
  let reason: 'initial' | 'due' | 'projected' = 'initial';

  if (lastEvent?.event_time) {
    const lastAt = new Date(lastEvent.event_time);
    const lastMidnightLocal = new Date(lastAt);
    lastMidnightLocal.setHours(0, 0, 0, 0);
    const todayMidnightLocal = new Date(today);
    todayMidnightLocal.setHours(0, 0, 0, 0);

    const daysSince = Math.floor(
      (todayMidnightLocal.getTime() - lastMidnightLocal.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSince >= intervalDays) {
      reason = 'due';
      nextAt = today;
    } else {
      reason = 'projected';
      nextAt = addDaysLocal(lastMidnightLocal, intervalDays);
      if (nextAt < today) nextAt = today;
    }
  }

  // Check for pest events and adjust schedule to avoid conflicts
  const nextPestTreatment = calculateNextPestTreatmentDate(latestPestEvent, today);
  if (nextPestTreatment) {
    const pestDateMidnight = new Date(nextPestTreatment);
    pestDateMidnight.setHours(0, 0, 0, 0);
    const nextAtMidnight = new Date(nextAt);
    nextAtMidnight.setHours(0, 0, 0, 0);
    
    const daysDiff = Math.abs(
      (nextAtMidnight.getTime() - pestDateMidnight.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysDiff <= 1 && nextAtMidnight <= pestDateMidnight) {
      nextAt = addDaysLocal(pestDateMidnight, 1);
    }
  }

  return {
    eventType,
    nextRunAt: nextAt.toISOString(),
    eventData: { reason, activeNow, intervalDays },
  };
}

/**
 * Calculate pest treat schedule for a plant WITHOUT upserting to database
 */
export async function calculatePestTreatScheduleForPlant(
  userPlantId: string,
  latestPestEvent: { event_time: string; event_type: string; event_data: any } | null
): Promise<CalculatedSchedule> {
  const today = atStartOfTodayLocal();
  const nextPestTreatment = calculateNextPestTreatmentDate(latestPestEvent, today);

  if (!nextPestTreatment) {
    return null; // No active pest - schedule should be deleted (handled separately)
  }

  const nextPestMidnight = atStartOfTodayLocal(nextPestTreatment);
  const todayMidnight = atStartOfTodayLocal(today);
  const finalNextDate = nextPestMidnight < todayMidnight ? todayMidnight : nextPestMidnight;

  return {
    eventType: 'pest_treat',
    nextRunAt: finalNextDate.toISOString(),
    eventData: { 
      reason: finalNextDate <= todayMidnight ? 'due' : 'projected',
      intervalDays: 5,
    },
  };
}
