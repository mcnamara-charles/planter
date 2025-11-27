// hooks/schedules/useUpdateWaterSchedule.ts
import { useCallback, useState } from 'react';
import {
  fetchLatestTimelineByType,
  fetchPlantSchedulingFieldsByUserPlant,
  upsertUserPlantSchedule,
  ScheduleEventType,
} from '@/services/supabaseSchedules';

const NS = '[useUpdatePlantSchedule]';

function toMD(dateStr: string | null) {
  if (!dateStr) return null;
  // Use month/day from the stored date (year-agnostic)
  const d = new Date(dateStr);
  return { m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function isTodayInActive(
  todayUTC: Date,
  startStr: string | null,
  endStr: string | null,
  sameAllYear?: boolean | null
) {
  if (sameAllYear) return true;
  if (!startStr || !endStr) return true; // if not configured, treat as active

  const s = toMD(startStr)!;
  const e = toMD(endStr)!;
  const m = todayUTC.getUTCMonth() + 1;
  const d = todayUTC.getUTCDate();

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

function addDaysUTC(date: Date, days: number) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function atStartOfTodayUTC(now = new Date()) {
  // 08:00 UTC = “morning” to avoid triggering at midnight; tweak if needed
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0));
}

type IntervalPick = (args: {
  activeNow: boolean;
  water_interval_days_active: number | null;
  water_interval_days_inactive: number | null;
  fert_interval_days_active: number | null;
  fert_interval_days_inactive: number | null;
}) => number | null;

const pickWaterInterval: IntervalPick = ({
  activeNow,
  water_interval_days_active,
  water_interval_days_inactive,
}) => (activeNow ? water_interval_days_active ?? null : water_interval_days_inactive ?? null);

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

        const today = atStartOfTodayUTC();
        const activeNow = isTodayInActive(
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
        });

        // If nothing configured, skip safely
        if (!intervalDays || intervalDays <= 0) {
          // eslint-disable-next-line no-console
          console.log(`${NS}(${eventType}:${userPlantId}) no interval configured; skipping`);
          return null;
        }

        // 2) Get last event of this type
        const last = await fetchLatestTimelineByType(userPlantId, eventType);
        let nextAt = today;
        let reason: 'initial' | 'due' | 'projected' = 'initial';

        if (last?.event_time) {
          const lastAt = new Date(last.event_time);
          const lastMidnightUTC = new Date(
            Date.UTC(lastAt.getUTCFullYear(), lastAt.getUTCMonth(), lastAt.getUTCDate())
          );
          const todayMidnightUTC = new Date(
            Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
          );

          const daysSince = Math.floor(
            (todayMidnightUTC.getTime() - lastMidnightUTC.getTime()) / (1000 * 60 * 60 * 24)
          );

          if (daysSince >= intervalDays) {
            // overdue → schedule today
            reason = 'due';
            nextAt = today;
          } else {
            // not yet due → project next date = last + interval
            reason = 'projected';
            nextAt = addDaysUTC(lastMidnightUTC, intervalDays);

            // never schedule in the past
            if (nextAt < today) nextAt = today;
          }
        }

        // 3) Upsert schedule row
        const saved = await upsertUserPlantSchedule({
          userPlantId,
          eventType,
          nextRunAt: nextAt.toISOString(),
          eventData: { reason, activeNow, intervalDays },
        });

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
