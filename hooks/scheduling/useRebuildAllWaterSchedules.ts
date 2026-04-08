// hooks/schedules/useRebuildAllWaterSchedules.ts
import { useCallback, useState } from 'react';
import {
  fetchUserPlantIdsNeedingRebuild,
  fetchOverdueUserPlantIdsByType,
  coordinateFertilizeWithWaterInMemory,
  fetchUserPlantIdsNeedingPestScheduleUpdate,
  fetchAllUserPlantIds,
  upsertSchedulesBatchAll,
  calculateScheduleForPlant,
  calculatePestTreatScheduleForPlant,
  fetchPlantSchedulingFieldsByUserPlant,
  fetchLatestEffectiveWateringEvent,
  fetchLatestTimelineByType,
  fetchLatestPestEvent,
  ScheduleEventType,
  fetchLatestEventsPerPlantRPC,
  CalculatedSchedule,
} from '@/services/supabaseSchedules';
import { supabase } from '@/services/supabaseClient';

/**
 * TESTING FLAG: Set to true to force rebuild all schedules for all plants, even if they don't need it.
 * This bypasses the normal checks and rebuilds everything for testing purposes.
 */
const FORCE_REBUILD_ALL = false; // Set to true to rebuild ALL plants for testing

function unique<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

/**
 * Process items in parallel batches with a concurrency limit
 * Updates progress callback immediately when each item completes for real-time UI updates
 */
async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>,
  onItemComplete?: (item: T, result: R | null, error: Error | null) => void
): Promise<Array<{ item: T; result: R | null; error: Error | null }>> {
  const results: Array<{ item: T; result: R | null; error: Error | null }> = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    // Process batch in parallel, but call callbacks immediately as each completes
    const batchPromises = batch.map(async (item) => {
      try {
        const result = await processor(item);
        // Call callback immediately when this item completes
        onItemComplete?.(item, result, null);
        return { item, result, error: null };
      } catch (error: any) {
        const err = error instanceof Error ? error : new Error(String(error));
        // Call callback immediately when this item fails
        onItemComplete?.(item, null, err);
        return { item, result: null, error: err };
      }
    });
    
    // Wait for all items in batch to complete
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return results;
}

export function useRebuildAllWaterSchedules() {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Array<{ userPlantId: string; message: string }>>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [uniquePlantsCount, setUniquePlantsCount] = useState(0);
  const [completedPlantsCount, setCompletedPlantsCount] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<string>('');

  const rebuild = useCallback(async (skipOverdue: boolean = false) => {
    setLoading(true);
    setErrors([]);
    setDoneCount(0);
    setCompletedPlantsCount(0);
    setCurrentPhase('Preparing...');

    // Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      setLoading(false);
      setErrors([{ userPlantId: '', message: 'Not authenticated' }]);
      return;
    }
    const ownerId = user.id;

    let waterTargets: string[];
    let fertTargets: string[];
    let pestTargets: string[];

    if (FORCE_REBUILD_ALL) {
      // TESTING MODE: Fetch all user plants and rebuild everything
      // eslint-disable-next-line no-console
      console.log('[useRebuildAllWaterSchedules] FORCE_REBUILD_ALL is enabled - rebuilding all schedules');
      const allPlantIds = await fetchAllUserPlantIds(ownerId);
      waterTargets = allPlantIds;
      fertTargets = allPlantIds;
      pestTargets = allPlantIds;
      // eslint-disable-next-line no-console
      console.log(`[useRebuildAllWaterSchedules] Force rebuild: ${allPlantIds.length} total plants`);
    } else {
      // Normal mode: Compute timeline-driven rebuilds, optionally include overdue-by-date
      const [
        waterNeedRebuild,
        fertNeedRebuild,
        pestNeedUpdate,
      ] = await Promise.all([
        fetchUserPlantIdsNeedingRebuild('water', ownerId),
        fetchUserPlantIdsNeedingRebuild('fertilize', ownerId),
        fetchUserPlantIdsNeedingPestScheduleUpdate(ownerId),
      ]);

      if (skipOverdue) {
        // Only rebuild plants with timeline changes (used during refresh)
        waterTargets = waterNeedRebuild;
        fertTargets = fertNeedRebuild;
        pestTargets = pestNeedUpdate;
      } else {
        // Include overdue items (used during initial rebuild or scheduled rebuilds)
        const [
          waterOverdue,
          fertOverdue,
          pestOverdue,
        ] = await Promise.all([
          fetchOverdueUserPlantIdsByType('water'),
          fetchOverdueUserPlantIdsByType('fertilize'),
          fetchOverdueUserPlantIdsByType('pest_treat'),
        ]);

        waterTargets = unique([...waterNeedRebuild, ...waterOverdue]);
        fertTargets = unique([...fertNeedRebuild, ...fertOverdue]);
        pestTargets = unique([...pestNeedUpdate, ...pestOverdue]);
      }
    }

    // Debug - Count unique plants
    const uniquePlants = new Set([...waterTargets, ...fertTargets, ...pestTargets]);
    setUniquePlantsCount(uniquePlants.size);
    
    if (FORCE_REBUILD_ALL) {
      // eslint-disable-next-line no-console
      console.log('[useRebuildAllWaterSchedules] FORCE mode:');
      // eslint-disable-next-line no-console
      console.log(`  - Unique plants: ${uniquePlants.size}`);
      // eslint-disable-next-line no-console
      console.log(`  - Water operations: ${waterTargets.length}`);
      // eslint-disable-next-line no-console
      console.log(`  - Fertilize operations: ${fertTargets.length}`);
      // eslint-disable-next-line no-console
      console.log(`  - Pest operations: ${pestTargets.length}`);
      // eslint-disable-next-line no-console
      console.log(`  - Total operations: ${waterTargets.length + fertTargets.length + pestTargets.length}`);
    } else if (skipOverdue) {
      // eslint-disable-next-line no-console
      console.log('[useRebuildAllWaterSchedules] Refresh mode (skipping overdue items):');
      // eslint-disable-next-line no-console
      console.log(`  - Unique plants: ${uniquePlants.size}`);
      // eslint-disable-next-line no-console
      console.log(`  - Water timeline changes: ${waterTargets.length}`);
      // eslint-disable-next-line no-console
      console.log(`  - Fertilize timeline changes: ${fertTargets.length}`);
      // eslint-disable-next-line no-console
      console.log(`  - Pest timeline changes: ${pestTargets.length}`);
    } else {
      // eslint-disable-next-line no-console
      console.log('[useRebuildAllWaterSchedules] Normal mode (includes overdue):');
      // eslint-disable-next-line no-console
      console.log(`  - Unique plants: ${uniquePlants.size}`);
      // eslint-disable-next-line no-console
      console.log(`  - Water operations: ${waterTargets.length}`);
      // eslint-disable-next-line no-console
      console.log(`  - Fertilize operations: ${fertTargets.length}`);
      // eslint-disable-next-line no-console
      console.log(`  - Pest operations: ${pestTargets.length}`);
      // eslint-disable-next-line no-console
      console.log(`  - Total operations: ${waterTargets.length + fertTargets.length + pestTargets.length}`);
    }

    // Set total to number of operations across all phases
    // Phase 1: Batch fetch (1 operation)
    // Phase 2: Individual schedule calculations (one per schedule type needed per plant) + coordination (in-memory, no extra count)
    // Phase 3: Batch upsert (1 operation)
    // Phase 4: REMOVED - coordination now happens in Phase 2 in-memory
    const totalCalculationOps = waterTargets.length + fertTargets.length + pestTargets.length;
    const totalOps = 1 + // Phase 1: Batch fetch
                     totalCalculationOps + // Phase 2: Calculations (coordination is included in calculations, no extra ops)
                     1; // Phase 3: Batch upsert
    setTotal(totalOps);

    if (totalOps === 0) {
      // eslint-disable-next-line no-console
      console.log('[useRebuildAllWaterSchedules] No plants to process');
      setLoading(false);
      return;
    }

    // Process plants in batches of 10 - calculate all schedules first, then batch upsert
    const PLANTS_PER_BATCH = 10;
    
    // Group plants by which operations they need
    const plantsToProcess = Array.from(uniquePlants).map(plantId => ({
      plantId,
      needsWater: waterTargets.includes(plantId),
      needsFertilize: fertTargets.includes(plantId),
      needsPest: pestTargets.includes(plantId),
    }));

    // eslint-disable-next-line no-console
    console.log(`[useRebuildAllWaterSchedules] Processing ${plantsToProcess.length} plants in batches of ${PLANTS_PER_BATCH}`);
    
    // Step 0: Use ownerId we already have from earlier in the function
    const currentUserId = ownerId;

    // Step 0: Batch fetch all data we need upfront (ONE database roundtrip instead of 5 per plant!)
    setCurrentPhase(`Fetching data for ${uniquePlants.size} plants...`);
    // eslint-disable-next-line no-console
    console.log(`[useRebuildAllWaterSchedules] Phase 1/3: Batch fetching data for ${uniquePlants.size} plants`);
    setDoneCount(0); // Start at 0 for batch fetch phase
    
    const allPlantIds = Array.from(uniquePlants);
    
    // Batch fetch: scheduling fields + owner_id + system_type for all plants
    const { data: plantsData, error: plantsError } = await supabase
      .from('user_plants')
      .select(`
        id,
        owner_id,
        system_type,
        light_type,
        water_delay,
        plants_table_id,
        plants:plants_table_id (
          id,
          schedule:plants_schedule (
            schedule_same_year_round,
            active_season_start_date,
            active_season_end_date,
            water_interval_days_active,
            water_interval_days_inactive,
            fert_interval_days_active,
            fert_interval_days_inactive
          )
        )
      `)
      .in('id', allPlantIds)
      .is('sold_at', null) // Exclude sold plants
      .is('deceased_at', null); // Exclude deceased plants

    if (plantsError) throw plantsError;
    
    // Build maps for quick lookup
    const schedulingFieldsMap = new Map<string, any>();
    const ownerIdMap = new Map<string, string>();
    
    (plantsData || []).forEach((plant: any) => {
      if (plant.plants) {
        const schedule = Array.isArray(plant.plants.schedule) ? plant.plants.schedule[0] : plant.plants.schedule;
        schedulingFieldsMap.set(plant.id, {
          plantId: plant.plants.id,
          schedule_same_year_round: schedule?.schedule_same_year_round ?? null,
          active_season_start_date: schedule?.active_season_start_date ?? null,
          active_season_end_date: schedule?.active_season_end_date ?? null,
          water_interval_days_active: schedule?.water_interval_days_active ?? null,
          water_interval_days_inactive: schedule?.water_interval_days_inactive ?? null,
          fert_interval_days_active: schedule?.fert_interval_days_active ?? null,
          fert_interval_days_inactive: schedule?.fert_interval_days_inactive ?? null,
          light_type: plant.light_type,
          system_type: plant.system_type,
          water_delay: plant.water_delay,
        });
      }
      // Use owner_id from plant if available, otherwise fall back to current user ID
      const ownerId = plant.owner_id || currentUserId;
      ownerIdMap.set(plant.id, ownerId);
    });

    // Batch fetch: latest water/fertilize events for all plants that need water (efficiently!)
    // Reservoir plants use fertilize as "water", so we need to query separately
    const waterPlantIds = allPlantIds.filter(id => waterTargets.includes(id));
    const waterEventsMap = new Map<string, { id: string; event_time: string } | null>();
    if (waterPlantIds.length > 0) {
      // Separate plants by type so we can query the right event type for each
      const reservoirPlants = waterPlantIds.filter(id => {
        const sched = schedulingFieldsMap.get(id);
        return sched?.system_type === 'reservoir';
      });
      const normalPlants = waterPlantIds.filter(id => {
        const sched = schedulingFieldsMap.get(id);
        return sched?.system_type !== 'reservoir';
      });
      
      // Query fertilize events for reservoir plants (they use fertilize as "water")
      if (reservoirPlants.length > 0) {
        const fertEvents = await fetchLatestEventsPerPlantRPC(reservoirPlants, ['fertilize']);
        fertEvents.forEach((event, plantId) => {
          waterEventsMap.set(plantId, event ? { id: event.id, event_time: event.event_time } : null);
        });
      }
      
      // Query water events for normal plants
      if (normalPlants.length > 0) {
        const waterEvents = await fetchLatestEventsPerPlantRPC(normalPlants, ['water']);
        waterEvents.forEach((event, plantId) => {
          waterEventsMap.set(plantId, event ? { id: event.id, event_time: event.event_time } : null);
        });
      }
    }

    // Batch fetch: latest fertilize events for all plants that need fertilize (efficiently!)
    const fertPlantIds = allPlantIds.filter(id => fertTargets.includes(id));
    const fertEventsMap = new Map<string, { id: string; event_time: string } | null>();
    if (fertPlantIds.length > 0) {
      const fertEvents = await fetchLatestEventsPerPlantRPC(fertPlantIds, ['fertilize']);
      fertEvents.forEach((event, plantId) => {
        fertEventsMap.set(plantId, event ? { id: event.id, event_time: event.event_time } : null);
      });
    }

    // Batch fetch: latest pest events for all plants that need pest (efficiently!)
    const pestPlantIds = allPlantIds.filter(id => pestTargets.includes(id));
    const pestEventsMap = new Map<string, { id: string; event_time: string; event_type: string; event_data: any } | null>();
    if (pestPlantIds.length > 0) {
      const pestEvents = await fetchLatestEventsPerPlantRPC(pestPlantIds, ['pest_id', 'pest_treat']);
      pestEvents.forEach((event, plantId) => {
        if (event) {
          pestEventsMap.set(plantId, {
            id: event.id,
            event_time: event.event_time,
            event_type: event.event_type,
            event_data: event.event_data,
          });
        } else {
          pestEventsMap.set(plantId, null);
        }
      });
    }

    // eslint-disable-next-line no-console
    console.log(`[useRebuildAllWaterSchedules] Phase 1/3 complete: ${schedulingFieldsMap.size} plants, ${waterEventsMap.size} water events, ${fertEventsMap.size} fert events, ${pestEventsMap.size} pest events`);
    setDoneCount(1); // Mark batch fetch phase complete

    // Step 1: Calculate all schedules for all plants (using batch-fetched data)
    setCurrentPhase(`Calculating schedules for ${plantsToProcess.length} plants...`);
    // eslint-disable-next-line no-console
    console.log(`[useRebuildAllWaterSchedules] Phase 2/3: Calculating and coordinating schedules for ${plantsToProcess.length} plants`);
    const allSchedulesToUpsert: Array<{
      userPlantId: string;
      eventType: ScheduleEventType;
      nextRunAt: string;
      eventData?: Record<string, any>;
      ownerId: string; // Required
    }> = [];
    
    const plantsNeedingPestDeletion = new Set<string>();
    let calculatedOpsCount = 0; // Track individual calculation operations
    const baseProgressOffset = 1; // After batch fetch phase (which counts as 1)
    
    // Process plants in batches to calculate schedules (now using cached data!)
    for (let i = 0; i < plantsToProcess.length; i += PLANTS_PER_BATCH) {
      const batch = plantsToProcess.slice(i, i + PLANTS_PER_BATCH);
      
      // Calculate all schedules for this batch in parallel (using cached data, no DB reads!)
      const batchCalculations = await Promise.all(
        batch.map(async ({ plantId, needsWater, needsFertilize, needsPest }) => {
          try {
            // Get cached data instead of fetching
            const sched = schedulingFieldsMap.get(plantId);
            
            // Skip plants without scheduling fields (e.g., custom species without plant data, or plants without generated care data)
            if (!sched) {
              // eslint-disable-next-line no-console
              console.log(`[useRebuildAllWaterSchedules] Skipping plant ${plantId} - no scheduling fields available`);
              calculatedOpsCount++;
              setDoneCount(baseProgressOffset + calculatedOpsCount);
              return { plantId, schedulesCount: 0 };
            }

            const lastWater = needsWater ? (waterEventsMap.get(plantId) || null) : null;
            const lastFert = needsFertilize ? (fertEventsMap.get(plantId) || null) : null;
            const latestPest = needsPest ? (pestEventsMap.get(plantId) || null) : null;

            // Calculate water schedule
            let waterSchedule: CalculatedSchedule = null;
            if (needsWater) {
              waterSchedule = await calculateScheduleForPlant(plantId, 'water', sched, lastWater, latestPest);
              if (waterSchedule) {
                calculatedOpsCount++;
                setDoneCount(baseProgressOffset + calculatedOpsCount);
              }
            }

            // Calculate fertilize schedule
            let fertSchedule: CalculatedSchedule = null;
            if (needsFertilize) {
              fertSchedule = await calculateScheduleForPlant(plantId, 'fertilize', sched, lastFert, latestPest);
              if (fertSchedule) {
                calculatedOpsCount++;
                setDoneCount(baseProgressOffset + calculatedOpsCount);
              }
            }

            // Apply coordination rules IN MEMORY (no DB calls!)
            // Only coordinate if both schedules exist and plant is not reservoir
            if (waterSchedule && fertSchedule && sched.system_type !== 'reservoir') {
              const coordination = coordinateFertilizeWithWaterInMemory(
                waterSchedule,
                fertSchedule,
                sched.system_type === 'reservoir'
              );
              
              if (coordination) {
                // Adjust fertilize schedule based on coordination rules
                fertSchedule.nextRunAt = coordination.adjustedNextRunAt;
                fertSchedule.eventData = {
                  ...fertSchedule.eventData,
                  ...coordination.adjustedEventData,
                };
              }
            }

            const plantSchedules: Array<{
              eventType: ScheduleEventType;
              nextRunAt: string;
              eventData?: Record<string, any>;
            }> = [];

            // Add water schedule
            if (waterSchedule) {
              plantSchedules.push(waterSchedule);
            }

            // Add fertilize schedule (already coordinated if needed)
            if (fertSchedule) {
              plantSchedules.push(fertSchedule);
            }

            // Calculate pest schedule
            if (needsPest) {
              const pestSchedule = await calculatePestTreatScheduleForPlant(plantId, latestPest);
              if (pestSchedule) {
                plantSchedules.push(pestSchedule);
                calculatedOpsCount++;
                setDoneCount(baseProgressOffset + calculatedOpsCount);
              } else {
                // No active pest - mark for deletion
                plantsNeedingPestDeletion.add(plantId);
              }
            }

            // Add all schedules for this plant to the batch (include owner_id!)
            const ownerId = ownerIdMap.get(plantId) || currentUserId;
            if (!ownerId) {
              // This should never happen since we have currentUserId fallback, but just in case
              throw new Error(`No owner_id available for plant ${plantId}`);
            }

            plantSchedules.forEach(schedule => {
              allSchedulesToUpsert.push({
                userPlantId: plantId,
                ownerId,
                ...schedule,
              });
            });

            return { plantId, schedulesCount: plantSchedules.length };
          } catch (err: any) {
            console.error(`[useRebuildAllWaterSchedules] Error calculating schedules for ${plantId}:`, err);
            setErrors(prev => [...prev, { userPlantId: plantId, message: err?.message ?? 'error' }]);
            return { plantId, schedulesCount: 0 };
          }
        })
      );
      
      // Update progress - count completed plants
      const completedInBatch = batchCalculations.filter(r => r.schedulesCount > 0).length;
      setCompletedPlantsCount(prev => prev + completedInBatch);
    }

    // eslint-disable-next-line no-console
    console.log(`[useRebuildAllWaterSchedules] Phase 2/3 complete: ${calculatedOpsCount} schedules calculated and coordinated`);

    // Step 2: Delete pest schedules that are no longer needed (batch delete)
    if (plantsNeedingPestDeletion.size > 0) {
      // eslint-disable-next-line no-console
      console.log(`[useRebuildAllWaterSchedules] Deleting ${plantsNeedingPestDeletion.size} pest schedules`);
      const { error: deleteError } = await supabase
        .from('user_plant_schedules')
        .delete()
        .in('user_plant_id', Array.from(plantsNeedingPestDeletion))
        .eq('event_type', 'pest_treat');
      
      if (deleteError) {
        console.error(`[useRebuildAllWaterSchedules] Pest schedule deletion error:`, deleteError);
      }
    }

    // Step 3: Batch upsert ALL schedules at once (single database operation!)
    // All schedules are already coordinated in Phase 2, so this is the final step
    setCurrentPhase(`Saving ${allSchedulesToUpsert.length} schedules...`);
    // eslint-disable-next-line no-console
    console.log(`[useRebuildAllWaterSchedules] Phase 3/3: Batch upserting ${allSchedulesToUpsert.length} schedules`);
    const upsertProgressOffset = baseProgressOffset + calculatedOpsCount;
    if (allSchedulesToUpsert.length > 0) {
      try {
        await upsertSchedulesBatchAll(allSchedulesToUpsert);
        setDoneCount(upsertProgressOffset + 1); // Mark upsert phase complete
        // eslint-disable-next-line no-console
        console.log(`[useRebuildAllWaterSchedules] Phase 3/3 complete: Successfully batch upserted ${allSchedulesToUpsert.length} schedules (already coordinated)`);
      } catch (err: any) {
        setDoneCount(upsertProgressOffset + 1); // Still mark as done even on error
        console.error(`[useRebuildAllWaterSchedules] Batch upsert error:`, err);
        setErrors(prev => [...prev, { userPlantId: 'batch', message: err?.message ?? 'Batch upsert failed' }]);
      }
    } else {
      setDoneCount(upsertProgressOffset + 1); // No schedules to upsert, mark phase complete
    }
    
    // eslint-disable-next-line no-console
    console.log(`[useRebuildAllWaterSchedules] Rebuild complete: ${calculatedOpsCount} schedules calculated and coordinated, ${allSchedulesToUpsert.length} upserted across ${plantsToProcess.length} plants`);
    setCurrentPhase('Complete!');
    setLoading(false);
  }, []);

  return { rebuild, loading, errors, doneCount, total, uniquePlantsCount, completedPlantsCount, currentPhase };
}
