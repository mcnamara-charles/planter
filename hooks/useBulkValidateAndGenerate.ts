// hooks/generatePlantData/useBulkValidateAndGenerate.ts
import { useCallback, useMemo, useRef, useState } from 'react';
import { useGeneratePlantData } from '@/hooks/generatePlantData';
import { usePlantDataValidation } from '@/hooks/usePlantDataValidation';

export type BulkItemStatus = 'up_to_date' | 'generated' | 'skipped' | 'failed';
export type BulkItemResult = {
  id: string;
  status: BulkItemStatus;
  error?: string | null;
  // You can stash anything else you want here (e.g., timestamps, counts, etc.)
};

export type BulkProgress = {
  total: number;
  done: number;
  running: number;
  queued: number;
  percent: number; // 0..100
};

export type UseBulkOptions = {
  concurrency?: number;               // default 10
  onProgress?: (progress: BulkProgress) => void;
  // If you want to pass hints, you can do so here; they’re optional and resolved per-plant anyway.
  getCommonName?: (id: string) => string | undefined | null;
  getScientificName?: (id: string) => string | undefined | null;
};

export function useBulkValidateAndGenerate() {
  const { run: generatePlantData } = useGeneratePlantData();
  const { validatePlantData } = usePlantDataValidation();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BulkProgress>({ total: 0, done: 0, running: 0, queued: 0, percent: 0 });
  const [results, setResults] = useState<Record<string, BulkItemResult>>({});
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    cancelRef.current = false;
    setRunning(false);
    setProgress({ total: 0, done: 0, running: 0, queued: 0, percent: 0 });
    setResults({});
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const run = useCallback(
    async (plantIds: string[], opts: UseBulkOptions = {}) => {
      const concurrency = Math.max(1, Math.min(64, opts.concurrency ?? 10));
      reset();
      setRunning(true);

      const total = plantIds.length;
      let done = 0;
      let runningCount = 0;
      let queued = total;

      const updateProgress = () => {
        const percent = total === 0 ? 100 : Math.round((done / total) * 100);
        const p = { total, done, running: runningCount, queued, percent };
        setProgress(p);
        opts.onProgress?.(p);
      };

      // Initialize progress
      updateProgress();

      // Simple promise pool
      const queue = [...plantIds];
      const workers: Promise<void>[] = [];

      const workOne = async (id: string) => {
        if (cancelRef.current) return;

        try {
          // 1) Validate
          const validation = await validatePlantData(id);

          if (cancelRef.current) return;

          if (!validation.needsGeneration) {
            setResults(prev => ({ ...prev, [id]: { id, status: 'up_to_date' } }));
          } else {
            // 2) Generate (use minimal args; the hook reads DB and figures out what to do)
            try {
              await generatePlantData({ plantsTableId: id });
              setResults(prev => ({ ...prev, [id]: { id, status: 'generated' } }));
            } catch (err: any) {
              setResults(prev => ({ ...prev, [id]: { id, status: 'failed', error: err?.message ?? 'Generation failed' } }));
            }
          }
        } catch (err: any) {
          setResults(prev => ({ ...prev, [id]: { id, status: 'failed', error: err?.message ?? 'Validation failed' } }));
        } finally {
          done += 1;
          runningCount -= 1;
          queued = Math.max(0, queued - 1);
          updateProgress();
        }
      };

      const launchNext = () => {
        if (cancelRef.current) return;
        const id = queue.shift();
        if (!id) return;

        runningCount += 1;
        updateProgress();

        const p = workOne(id).finally(() => {
          if (cancelRef.current) return;
          // Launch next when this finishes (to keep pool filled)
          if (queue.length > 0) {
            launchNext();
          }
        });
        workers.push(p);
      };

      // Prime the pool
      const initial = Math.min(concurrency, queue.length);
      for (let i = 0; i < initial; i++) launchNext();

      // Wait for all
      await Promise.all(workers);

      setRunning(false);
      updateProgress();

      return {
        results,
        progress: { total, done, running: 0, queued: 0, percent: 100 },
        cancelled: cancelRef.current,
      };
    },
    [generatePlantData, validatePlantData, reset]
  );

  const summary = useMemo(() => {
    const vals = Object.values(results);
    const counts = vals.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<BulkItemStatus, number>
    );
    return counts;
  }, [results]);

  return {
    running,
    progress,
    results,   // map: id -> { status, error? }
    summary,   // counts by status
    run,       // (ids, options?) => Promise<{ results, progress, cancelled }>
    cancel,    // signal to stop taking new work (in-flight items will finish)
    reset,     // clear progress/results
  };
}
