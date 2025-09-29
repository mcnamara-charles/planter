// hooks/generatePlantData/stages.ts
import { useCallback, useState } from 'react';
import type { ProgressEvent, ProgressStatus, StageKey } from './types';

export const STAGE_LABELS: Record<StageKey,string> = {
  db_read:'Reading plant record', facts_generation:'Generating plant facts', facts_db_write:'Saving plant facts',
  stage1_parallel:'Stage 1: Parallel generation', stage2_light:'Stage 2: Light requirements', stage3_water:'Stage 3: Water schedule',
  profile:'Building species profile', care_light:'Generating lighting requirements',
  care_water:'Generating watering schedule', care_temp_humidity:'Generating temp & humidity',
  care_fertilizer:'Generating fertilizer plan', care_pruning:'Generating pruning guidance',
  care_soil_description:'Generating soil & mix', care_propagation:'Generating propagation',
  care_db_write:'Saving care details', done:'Finished',
};

export function useStages() {
  const [events, setEvents] = useState<ProgressEvent[]>([]);

  const stage = useCallback(async <T>(key: StageKey, label: string, fn: () => Promise<T>, onProgress?: (e:ProgressEvent[])=>void): Promise<T> => {
    const startedAt = Date.now();
    setEvents(prev => {
      const updated = [...prev.filter(e => e.key !== key), { key, label, status: 'running' as ProgressStatus, startedAt, percent: 0 }];
      onProgress?.(updated);
      return updated;
    });

    try {
      const result = await fn();
      const endedAt = Date.now();
      setEvents(prev => {
        const updated = [...prev.filter(e => e.key !== key), { key, label, status: 'success' as ProgressStatus, startedAt, endedAt, percent: 100 }];
        onProgress?.(updated);
        return updated;
      });
      return result;
    } catch (err) {
      const endedAt = Date.now();
      setEvents(prev => {
        const updated = [...prev.filter(e => e.key !== key), { key, label, status: 'error' as ProgressStatus, startedAt, endedAt, percent: 0 }];
        onProgress?.(updated);
        return updated;
      });
      throw err;
    }
  }, []);

  return { events, stage };
}
