// components/CareSection.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';
import GenerateFactsButton from '@/components/GenerateFactsButton';
import { ButtonPill } from '@/components/Buttons'; // <-- add this
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
}: {
  isOpen: boolean;
  plantsTableId: string | null;
  commonName: string;
  displayName: string;
  scientificName: string;
  showOverlay: (msg: string) => void;
  hideOverlay: () => void;
  onRefetch?: () => Promise<void>;
  onWater?: () => void;      // <-- new
  onFertilize?: () => void;  // <-- new
  onPrune?: () => void;      // <-- new
  onObserve?: () => void;    // <-- new
}) {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [care, setCare] = useState<CareRows | null>(null);

  const { run: generateCare } = useGenerateCare();

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
      showOverlay('Generating care instructions…');

      const res = await generateCare({
        plantsTableId,
        commonName: commonName || displayName,
        scientificName,
      });

      showOverlay('Saving updates…');

      if (res) {
        setCare({
          care_light: res.care_light,
          care_water: res.care_water,
          care_temp_humidity: res.care_temp_humidity,
          care_fertilizer: res.care_fertilizer,
          care_pruning: res.care_pruning,
        });
      }

      if (onRefetch) await onRefetch();

      showOverlay('Done');
      setTimeout(() => hideOverlay(), 500);
    } catch (e: any) {
      hideOverlay();
      Alert.alert('Generation failed', e?.message ?? 'Please try again.');
    } finally {
      setGenBusy(false);
    }
  }, [plantsTableId, commonName, displayName, scientificName, generateCare, onRefetch, showOverlay, hideOverlay]);

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

        {/* Re-added action pills, same styling as before */}
        <ButtonPill label="Water"     variant="solid" color="primary" onPress={() => onWater?.()} />
        <ButtonPill label="Fertilize" variant="solid" color="primary" onPress={() => onFertilize?.()} />
        <ButtonPill label="Prune"     variant="solid" color="primary" onPress={() => onPrune?.()} />
        <ButtonPill label="Observe"   variant="solid" color="primary" onPress={() => onObserve?.()} />
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
          <Row title="Light"                  body={care?.care_light} />
          <Row title="Water"                  body={care?.care_water} />
          <Row title="Temperature & Humidity" body={care?.care_temp_humidity} />
          <Row title="Fertilizer"             body={care?.care_fertilizer} />
          <Row title="Pruning"                body={care?.care_pruning} />
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
