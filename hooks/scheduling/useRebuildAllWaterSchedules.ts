// hooks/schedules/useRebuildAllWaterSchedules.ts
import { useCallback, useState } from 'react';
import {
  fetchUserPlantIdsNeedingRebuild,
  fetchOverdueUserPlantIdsByType, // NEW
  coordinateFertilizeWithWater,
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

    // Debug
    // eslint-disable-next-line no-console
    console.log('[useRebuildAllWaterSchedules] water targets (need|overdue):', waterNeedRebuild.length, waterOverdue.length, '->', waterTargets.length);
    // eslint-disable-next-line no-console
    console.log('[useRebuildAllWaterSchedules] fert  targets (need|overdue):', fertNeedRebuild.length,  fertOverdue.length,  '->', fertTargets.length);

    // Set total to number of operations we'll attempt (some may be skipped)
    const totalOps = waterTargets.length + fertTargets.length;
    setTotal(totalOps);

    if (totalOps === 0) {
      setLoading(false);
      return;
    }

    // Track actual completed operations (excluding skipped ones)
    let completedCount = 0;

    // Track which plants had both schedules updated (for coordination)
    const plantsWithBothSchedules = new Set<string>();

    // Run water updates
    for (const userPlantId of waterTargets) {
      try {
        const result = await updateWater(userPlantId);
        // Only count if operation actually ran (not skipped)
        if (result !== null) {
          completedCount++;
          setDoneCount(completedCount);
          // Track if this plant also has a fertilize schedule that will be updated
          if (fertTargets.includes(userPlantId)) {
            plantsWithBothSchedules.add(userPlantId);
          }
        }
        // If skipped (result === null), don't increment doneCount
      } catch (e: any) {
        setErrors(prev => [...prev, { userPlantId, message: e?.message ?? 'error' }]);
        // Count errors as completed operations
        completedCount++;
        setDoneCount(completedCount);
      }
    }

    // Run fertilizer updates
    for (const userPlantId of fertTargets) {
      try {
        const result = await updateFertilize(userPlantId);
        // Only count if operation actually ran (not skipped)
        if (result !== null) {
          completedCount++;
          setDoneCount(completedCount);
          // Track if this plant also had a water schedule updated
          if (waterTargets.includes(userPlantId)) {
            plantsWithBothSchedules.add(userPlantId);
          }
        }
        // If skipped (result === null), don't increment doneCount
      } catch (e: any) {
        setErrors(prev => [...prev, { userPlantId, message: e?.message ?? 'error' }]);
        // Count errors as completed operations
        completedCount++;
        setDoneCount(completedCount);
      }
    }

    // After all updates, coordinate schedules for plants that had both updated
    // This ensures coordination happens with the final state of both schedules
    for (const userPlantId of plantsWithBothSchedules) {
      try {
        await coordinateFertilizeWithWater(userPlantId);
      } catch (e: any) {
        // Log but don't fail the rebuild
        console.warn(`[useRebuildAllWaterSchedules] coordination error for ${userPlantId}:`, e);
      }
    }

    setLoading(false);
  }, [updateWater, updateFertilize]);

  return { rebuild, loading, errors, doneCount, total };
}
