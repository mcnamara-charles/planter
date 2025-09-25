// components/CareSection.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';
import GenerateFactsButton from '@/components/GenerateFactsButton';
import { ButtonPill } from '@/components/Buttons';
import { useGenerateCare } from '@/hooks/useGenerateCare';

type CareRows = {
  care_light?: string | null;
  care_water?: string | null;
  care_temp_humidity?: string | null;
  care_fertilizer?: string | null;
  care_pruning?: string | null;
};

export default function CareSection({
  isOpen,
  plantsTableId,
  commonName,
  displayName,
  scientificName,
  showOverlay,
  hideOverlay,
  onRefetch, // optional: parent can pass fetchDetails(true)
  onWater,
  onFertilize,
  onPrune,
  onObserve,
  showActionButtons = true, // control action buttons
  onCareProgress,
}: {
  isOpen: boolean;
  plantsTableId: string | null;
  commonName: string;
  displayName: string;
  scientificName: string;
  showOverlay: (msg: string) => void;
  hideOverlay: () => void;
  onRefetch?: () => Promise<void>;
  onWater?: () => void;
  onFertilize?: () => void;
  onPrune?: () => void;
  onObserve?: () => void;
  showActionButtons?: boolean;
  onCareProgress?: (evt: {
    key:
      | 'db_read'
      | 'profile'
      | 'light_water'
      | 'care_temp_humidity'
      | 'care_fertilizer'
      | 'care_pruning'
      | 'soil_description'
      | 'propagation'
      | 'db_write'
      | 'done';
    label: string;
    status: 'pending' | 'running' | 'success' | 'error';
    error?: string;
  }) => void;
}) {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [care, setCare] = useState<CareRows | null>(null);

  const { run: generateCare } = useGenerateCare();

  // ---- After-commit emitters (avoid parent updates during render) ----
  type ProgressEvt = NonNullable<Parameters<NonNullable<typeof onCareProgress>>[0]>;
  const progressQueueRef = useRef<ProgressEvt[]>([]);
  const postCommitTasksRef = useRef<Array<() => void>>([]);
  const [commitTick, setCommitTick] = useState(0); // bump to flush after commit

  const emitProgress = useCallback((evt: ProgressEvt) => {
    progressQueueRef.current.push(evt);
    setCommitTick((t) => t + 1);
  }, []);

  const afterCommit = useCallback((fn: () => void) => {
    postCommitTasksRef.current.push(fn);
    setCommitTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // Flush progress first (drives overlay/status), then any other tasks (like onRefetch)
    if (onCareProgress && progressQueueRef.current.length) {
      const batch = progressQueueRef.current.splice(0);
      for (const evt of batch) onCareProgress(evt);
    }
    if (postCommitTasksRef.current.length) {
      const tasks = postCommitTasksRef.current.splice(0);
      for (const fn of tasks) fn();
    }
  }, [commitTick, onCareProgress]);

  const fetchCare = useCallback(async () => {
    if (!plantsTableId) return;
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('plants')
        .select('care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning')
        .eq('id', plantsTableId)
        .maybeSingle<CareRows>();
      if (error) throw error;
      setCare(data ?? {});
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load care info');
      setCare(null);
    } finally {
      setLoading(false);
    }
  }, [plantsTableId]);

  useEffect(() => {
    if (isOpen && plantsTableId) fetchCare();
  }, [isOpen, plantsTableId, fetchCare]);

  const onGenerate = useCallback(async () => {
    if (!plantsTableId) return;
    try {
      setGenBusy(true);

      // Send a "starting" ping to parent, flushed right after commit
      emitProgress({
        key: 'db_read',
        label: 'Reading plant record',
        status: 'running',
      });

      const res = await generateCare({
        plantsTableId,
        commonName: commonName || displayName,
        scientificName,
        units: 'us', // inches + °F
        // Forward every stage; flush after commit
        onProgress: (evt) => emitProgress(evt),
      });

      if (res) {
        setCare({
          care_light: res.care_light,
          care_water: res.care_water,
          care_temp_humidity: res.care_temp_humidity,
          care_fertilizer: res.care_fertilizer,
          care_pruning: res.care_pruning,
        });
      }

      // Ask parent to refetch after commit (avoids parent setState during child render)
      if (onRefetch) afterCommit(() => { void onRefetch(); });

      // Parent will close the overlay on 'done' via progress
    } catch (e: any) {
      // Bubble error to parent via progress; it will Alert + close overlay
      emitProgress({
        key: 'done',
        label: 'Failed',
        status: 'error',
        error: e?.message ?? 'Unknown error',
      });
    } finally {
      setGenBusy(false);
    }
  }, [plantsTableId, commonName, displayName, scientificName, generateCare, onRefetch, emitProgress, afterCommit]);

  const Row = ({ title, body }: { title: string; body?: string | null }) => {
    const text = body?.trim() ? body!.trim() : 'Data not present';
    const paras = text.split(/\n\s*\n+/);
    return (
      <View style={styles.row}>
        <ThemedText style={styles.rowTitle}>{title}</ThemedText>
        {paras.map((p, i) => (
          <ThemedText key={i} style={{ color: theme.colors.mutedText, marginTop: i === 0 ? 0 : 8 }}>
            {p}
          </ThemedText>
        ))}
      </View>
    );
  };

  return (
    <View style={{ gap: 16 }}>
      {/* Actions row */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 3 }}>
        <GenerateFactsButton
          label={genBusy ? 'Generating…' : 'Generate Care Instructions'}
          disabled={genBusy || !plantsTableId}
          onPress={onGenerate}
        />

        {/* Action pills - only show if showActionButtons is true */}
        {showActionButtons && (
          <>
            <ButtonPill
              label="Water"
              variant="solid"
              color="primary"
              onPress={() => onWater?.()}
              style={{ backgroundColor: '#10B981', borderColor: '#10B981' }}
            />
            <ButtonPill
              label="Fertilize"
              variant="solid"
              color="primary"
              onPress={() => onFertilize?.()}
              style={{ backgroundColor: '#10B981', borderColor: '#10B981' }}
            />
            <ButtonPill
              label="Prune"
              variant="solid"
              color="primary"
              onPress={() => onPrune?.()}
              style={{ backgroundColor: '#10B981', borderColor: '#10B981' }}
            />
            <ButtonPill label="Observe" variant="solid" color="primary" onPress={() => onObserve?.()} />
          </>
        )}
      </View>

      {/* Loading skeletons */}
      {loading ? (
        <View style={{ paddingVertical: 4 }}>
          <SkeletonBlock />
          <SkeletonBlock />
          <SkeletonBlock />
          <SkeletonBlock />
          <SkeletonBlock />
        </View>
      ) : error ? (
        <ThemedText style={{ color: '#d11a2a' }}>{error}</ThemedText>
      ) : (
        <>
          <Row title="Light" body={care?.care_light} />
          <Row title="Water" body={care?.care_water} />
          <Row title="Temperature & Humidity" body={care?.care_temp_humidity} />
          <Row title="Fertilizer" body={care?.care_fertilizer} />
          <Row title="Pruning" body={care?.care_pruning} />
        </>
      )}
    </View>
  );
}

function SkeletonBlock() {
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 10 }}>
      <View style={{ height: 14, borderRadius: 7, opacity: 0.18, backgroundColor: '#888', width: 140 }} />
      <View style={{ height: 64, borderRadius: 12, opacity: 0.12, backgroundColor: '#888', marginTop: 10 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 8,
  },
  rowTitle: {
    fontWeight: '800',
    fontSize: 30,
    lineHeight: 36,
    marginBottom: 6,
  },
});
