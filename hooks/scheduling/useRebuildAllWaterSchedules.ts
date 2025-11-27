// hooks/schedules/useRebuildAllWaterSchedules.ts
import { useCallback, useState } from 'react';
import {
  fetchUserPlantIdsNeedingRebuild,
  fetchOverdueUserPlantIdsByType, // NEW
} from '@/services/supabaseSchedules';
import { useUpdateWaterSchedule, useUpdateFertilizeSchedule } from './useUpdateWaterSchedule';

function unique<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export function useRebuildAllWaterSchedules() {
  const { updateOne: updateWater } = useUpdateWaterSchedule();
  const { updateOne: updateFertilize } = useUpdateFertilizeSchedule();

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Array<{ userPlantId: string; message: string }>>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [total, setTotal] = useState(0);

  const rebuild = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setDoneCount(0);

    // Compute both sets: timeline-driven rebuild + overdue-by-date
    const [
      waterNeedRebuild,
      fertNeedRebuild,
      waterOverdue,
      fertOverdue,
    ] = await Promise.all([
      fetchUserPlantIdsNeedingRebuild('water'),
      fetchUserPlantIdsNeedingRebuild('fertilize'),
      fetchOverdueUserPlantIdsByType('water'),
      fetchOverdueUserPlantIdsByType('fertilize'),
    ]);

    const waterTargets = unique([...waterNeedRebuild, ...waterOverdue]);
    const fertTargets  = unique([...fertNeedRebuild,  ...fertOverdue]);

    // We'll count operations (water + fert)
    const totalOps = waterTargets.length + fertTargets.length;
    setTotal(totalOps);

    // Debug
    // eslint-disable-next-line no-console
    console.log('[useRebuildAllWaterSchedules] water targets (need|overdue):', waterNeedRebuild.length, waterOverdue.length, '->', waterTargets.length);
    // eslint-disable-next-line no-console
    console.log('[useRebuildAllWaterSchedules] fert  targets (need|overdue):', fertNeedRebuild.length,  fertOverdue.length,  '->', fertTargets.length);

    if (totalOps === 0) {
      setLoading(false);
      return;
    }

    // Run water updates
    for (const userPlantId of waterTargets) {
      try {
        await updateWater(userPlantId);
      } catch (e: any) {
        setErrors(prev => [...prev, { userPlantId, message: e?.message ?? 'error' }]);
      } finally {
        setDoneCount(prev => prev + 1);
      }
    }

    // Run fertilizer updates
    for (const userPlantId of fertTargets) {
      try {
        await updateFertilize(userPlantId);
      } catch (e: any) {
        setErrors(prev => [...prev, { userPlantId, message: e?.message ?? 'error' }]);
      } finally {
        setDoneCount(prev => prev + 1);
      }
    }

    setLoading(false);
  }, [updateWater, updateFertilize]);

  return { rebuild, loading, errors, doneCount, total };
}
