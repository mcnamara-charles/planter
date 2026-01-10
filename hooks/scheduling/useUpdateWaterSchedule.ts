// hooks/schedules/useUpdateWaterSchedule.ts
import { useCallback, useState } from 'react';
import {
  fetchLatestTimelineByType,
  fetchPlantSchedulingFieldsByUserPlant,
  upsertUserPlantSchedule,
  ScheduleEventType,
  fetchLatestEffectiveWateringEvent,
  coordinateFertilizeWithWater,
  fetchLatestPestEvent,
  calculateNextPestTreatmentDate,
} from '@/services/supabaseSchedules';

const NS = '[useUpdatePlantSchedule]';

function toMD(dateStr: string | null) {
  if (!dateStr) return null;
  // Use month/day from the stored date (year-agnostic)
  // Parse as local time to match the local date comparisons
  const d = new Date(dateStr);
  return { m: d.getMonth() + 1, d: d.getDate() };
}

function isTodayInActive(
  todayLocal: Date,
  startStr: string | null,
  endStr: string | null,
  sameAllYear?: boolean | null
) {
  if (sameAllYear) return true;
  if (!startStr || !endStr) return true; // if not configured, treat as active

  const s = toMD(startStr)!;
  const e = toMD(endStr)!;
  const m = todayLocal.getMonth() + 1;
  const d = todayLocal.getDate();

  const afterStart = m > s.m || (m === s.m && d >= s.d);
  const beforeEnd = m < e.m || (m === e.m && d <= e.d);

  // Season might wrap year (e.g., Nov–Mar)
  if (s.m < e.m || (s.m === e.m && s.d <= e.d)) {
    // normal, non-wrapping
    return afterStart && beforeEnd;
  } else {
    // wrapping: active if (after start) OR (before end)
    return afterStart || beforeEnd;
  }
}

function addDaysLocal(date: Date, days: number) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function atStartOfTodayLocal(now = new Date()) {
  const local = new Date(now);
  local.setHours(0, 0, 0, 0);
  return local;
}

/**
 * Calculate the next occurrence of a month/day date (ignoring year).
 * Returns the date in the current year if it hasn't passed, otherwise next year.
 */
function nextOccurrenceOfMonthDay(month: number, day: number, fromDate: Date = new Date()): Date {
  const currentYear = fromDate.getFullYear();
  const currentMonth = fromDate.getMonth() + 1; // 1-12
  const currentDay = fromDate.getDate();
  
  // Try current year first
  const thisYear = new Date(currentYear, month - 1, day);
  thisYear.setHours(0, 0, 0, 0);
  
  // If the date hasn't passed this year, use it
  if (month > currentMonth || (month === currentMonth && day >= currentDay)) {
    return thisYear;
  }
  
  // Otherwise, use next year
  const nextYear = new Date(currentYear + 1, month - 1, day);
  nextYear.setHours(0, 0, 0, 0);
  return nextYear;
}

type IntervalPick = (args: {
  activeNow: boolean;
  water_interval_days_active: number | null;
  water_interval_days_inactive: number | null;
  fert_interval_days_active: number | null;
  fert_interval_days_inactive: number | null;
  water_delay: number | null;
}) => number | null;

const pickWaterInterval: IntervalPick = ({
  activeNow,
  water_interval_days_active,
  water_interval_days_inactive,
  water_delay,
}) => {
  // If water_delay is set in user_plants, use that instead of the default intervals
  if (water_delay !== null && water_delay !== undefined) {
    return water_delay;
  }
  // Otherwise, use the default active/inactive intervals
  return activeNow ? water_interval_days_active ?? null : water_interval_days_inactive ?? null;
};

const pickFertInterval: IntervalPick = ({
  activeNow,
  fert_interval_days_active,
  fert_interval_days_inactive,
}) => (activeNow ? fert_interval_days_active ?? null : fert_interval_days_inactive ?? null);

function makeUseUpdateSchedule(eventType: ScheduleEventType, pickInterval: IntervalPick) {
  return function useUpdatePlantSchedule() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const updateOne = useCallback(async (userPlantId: string) => {
      setLoading(true);
      setError(null);
      try {
        // 1) Pull plant scheduling fields via user_plant -> plants join
        const sched = await fetchPlantSchedulingFieldsByUserPlant(userPlantId);
        if (!sched) throw new Error('Plant scheduling fields not found');

        // For reservoir plants: skip water schedules entirely
        if (eventType === 'water' && sched.system_type === 'reservoir') {
          // eslint-disable-next-line no-console
          console.log(`${NS}(${eventType}:${userPlantId}) reservoir plant - skipping water schedule`);
          return null;
        }

        // For reservoir plants: always set fertilize to 7 days
        if (eventType === 'fertilize' && sched.system_type === 'reservoir') {
          const today = atStartOfTodayLocal();
          const intervalDays = 7; // Always 7 days for reservoir plants
          
          // Get last fertilize event
          const last = await fetchLatestTimelineByType(userPlantId, 'fertilize');
          let nextAt = today;
          let reason: 'initial' | 'due' | 'projected' = 'initial';

          if (last?.event_time) {
            const lastAt = new Date(last.event_time);
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

          const saved = await upsertUserPlantSchedule({
            userPlantId,
            eventType: 'fertilize',
            nextRunAt: nextAt.toISOString(),
            eventData: { reason, activeNow: true, intervalDays, isReservoir: true },
          });

          // For reservoir plants, no coordination needed (they only have fertilize)
          return saved;
        }

        const today = atStartOfTodayLocal();
        // If plant uses grow lights, always treat as active season (grow lights provide consistent light year-round)
        const activeNow = sched.light_type === 'grow_light' 
          ? true 
          : isTodayInActive(
              today,
              sched.active_season_start_date,
              sched.active_season_end_date,
              sched.schedule_same_year_round ?? null
            );

        const intervalDays = pickInterval({
          activeNow,
          water_interval_days_active: sched.water_interval_days_active ?? null,
          water_interval_days_inactive: sched.water_interval_days_inactive ?? null,
          fert_interval_days_active: sched.fert_interval_days_active ?? null,
          fert_interval_days_inactive: sched.fert_interval_days_inactive ?? null,
          water_delay: sched.water_delay ?? null,
        });

        // If nothing configured during inactive season, schedule for next active season start
        if (!intervalDays || intervalDays <= 0) {
          if (!activeNow && sched.active_season_start_date) {
            // We're in inactive season and have a start date - schedule for next season start
            const startMD = toMD(sched.active_season_start_date);
            if (startMD) {
              const nextSeasonStart = nextOccurrenceOfMonthDay(startMD.m, startMD.d, today);
              const saved = await upsertUserPlantSchedule({
                userPlantId,
                eventType,
                nextRunAt: nextSeasonStart.toISOString(),
                eventData: { reason: 'next_season', activeNow: false, intervalDays: null },
              });
              // eslint-disable-next-line no-console
              console.log(`${NS}(${eventType}:${userPlantId}) no interval in inactive season; scheduled for next season start: ${nextSeasonStart.toISOString()}`);
              return saved;
            }
          }
          // eslint-disable-next-line no-console
          console.log(`${NS}(${eventType}:${userPlantId}) no interval configured; skipping`);
          return null;
        }

        // 2) Get last event of this type
        const last = eventType === 'water' ? await fetchLatestEffectiveWateringEvent(userPlantId) : await fetchLatestTimelineByType(userPlantId, eventType);
        let nextAt = today;
        let reason: 'initial' | 'due' | 'projected' = 'initial';

        if (last?.event_time) {
          const lastAt = new Date(last.event_time);
          const lastMidnightLocal = new Date(lastAt);
          lastMidnightLocal.setHours(0, 0, 0, 0);
          const todayMidnightLocal = new Date(today);
          todayMidnightLocal.setHours(0, 0, 0, 0);

          const daysSince = Math.floor(
            (todayMidnightLocal.getTime() - lastMidnightLocal.getTime()) / (1000 * 60 * 60 * 24)
          );

          if (daysSince >= intervalDays) {
            // overdue → schedule today
            reason = 'due';
            nextAt = today;
          } else {
            // not yet due → project next date = last + interval
            reason = 'projected';
            nextAt = addDaysLocal(lastMidnightLocal, intervalDays);

            // never schedule in the past
            if (nextAt < today) nextAt = today;
          }
        }

        // 3) Check for pest events and adjust schedule to avoid conflicts
        const latestPestEvent = await fetchLatestPestEvent(userPlantId);
        const nextPestTreatment = calculateNextPestTreatmentDate(latestPestEvent, today);

        if (nextPestTreatment) {
          // If the calculated next run date conflicts with pest treatment (within 1 day), adjust it
          const pestDateMidnight = new Date(nextPestTreatment);
          pestDateMidnight.setHours(0, 0, 0, 0);
          const nextAtMidnight = new Date(nextAt);
          nextAtMidnight.setHours(0, 0, 0, 0);
          
          const daysDiff = Math.abs(
            (nextAtMidnight.getTime() - pestDateMidnight.getTime()) / (1000 * 60 * 60 * 24)
          );

          // If water/fertilize is scheduled within 1 day of pest treatment, move it to the day after pest treatment
          if (daysDiff <= 1 && nextAtMidnight <= pestDateMidnight) {
            nextAt = addDaysLocal(pestDateMidnight, 1);
            // eslint-disable-next-line no-console
            console.log(`${NS}(${eventType}:${userPlantId}) adjusted schedule to avoid pest treatment conflict: ${nextAt.toISOString()}`);
          }
        }

        // 4) Upsert schedule row
        const saved = await upsertUserPlantSchedule({
          userPlantId,
          eventType,
          nextRunAt: nextAt.toISOString(),
          eventData: { reason, activeNow, intervalDays },
        });

        // 5) Coordinate with the other event type (fertilize/water)
        // If we just updated water, coordinate fertilize
        // If we just updated fertilize, coordinate with water
        // Always coordinate after updating either schedule
        try {
          await coordinateFertilizeWithWater(userPlantId);
          // eslint-disable-next-line no-console
          console.log(`${NS}(${eventType}:${userPlantId}) coordination completed`);
        } catch (err: any) {
          // eslint-disable-next-line no-console
          console.warn(`${NS}(${eventType}:${userPlantId}) coordination error`, err);
          // Don't throw - coordination failure shouldn't break the update
          // But log it so we can see what's happening
        }

        return saved;
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn(`${NS}(${eventType}:${userPlantId}) error`, e);
        setError(e?.message ?? `Failed to update ${eventType} schedule`);
        throw e;
      } finally {
        setLoading(false);
      }
    }, []);

    return { updateOne, loading, error };
  };
}

export const useUpdateWaterSchedule = makeUseUpdateSchedule('water', pickWaterInterval);
export const useUpdateFertilizeSchedule = makeUseUpdateSchedule('fertilize', pickFertInterval);
