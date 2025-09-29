// components/CareSection.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';
import { ButtonPill } from '@/components/Buttons';

type CareRows = {
  care_light?: string | null;
  care_water?: string | null;
  care_temp_humidity?: string | null;
  care_fertilizer?: string | null;
  care_pruning?: string | null;
};

type OptimisticCare = {
  care_light?: string | null;
  care_water?: string | null;
  care_temp_humidity?: string | null;
  care_fertilizer?: string | null;
  care_pruning?: string | null;
} | null;

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
  optimisticCare,
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
  optimisticCare?: OptimisticCare;
}) {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [care, setCare] = useState<CareRows | null>(null);


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

  // ---- Optimistic merge from parent (e.g., after generation) ----
  useEffect(() => {
    if (!optimisticCare) return;
    setCare((prev) => ({ ...(prev ?? {}), ...optimisticCare }));
  }, [optimisticCare]);


  // merged view model (falls back to placeholders in Row)
  const vm = useMemo<CareRows>(() => ({ ...(care ?? {}) }), [care]);

  const Row = ({ title, body }: { title: string; body?: string | null }) => {
    const text = body?.trim() ? body!.trim() : 'Data not present';
    const paras = text.split(/\n\s*\n+/);
    return (
      <View style={styles.row}>
        <ThemedText style={styles.rowTitle}>{title}</ThemedText>
        {paras.map((p, i) => (
          <ThemedText key={i} style={{ opacity: 0.8, marginTop: i === 0 ? 0 : 8 }}>
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
          <Row title="Light" body={vm.care_light} />
          <Row title="Water" body={vm.care_water} />
          <Row title="Temperature & Humidity" body={vm.care_temp_humidity} />
          <Row title="Fertilizer" body={vm.care_fertilizer} />
          <Row title="Pruning" body={vm.care_pruning} />
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
