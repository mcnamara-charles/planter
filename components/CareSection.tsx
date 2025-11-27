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
  schedule_same_year_round?: boolean | null;
  active_season_start_date?: string | null;
  active_season_end_date?: string | null;
  water_interval_days_active?: number | null;
  water_interval_days_inactive?: number | null;
  fert_interval_days_active?: number | null;
  fert_interval_days_inactive?: number | null;
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
        .select('care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning, schedule_same_year_round, active_season_start_date, active_season_end_date, water_interval_days_active, water_interval_days_inactive, fert_interval_days_active, fert_interval_days_inactive')
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

  // Format date as "Month Day" (e.g., "March 15")
  const formatSeasonDate = (dateString: string | null | undefined): string => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    } catch {
      return '';
    }
  };

  // Check if current date is within the active season
  const isInActiveSeason = (startDate: string | null | undefined, endDate: string | null | undefined): boolean => {
    if (!startDate || !endDate) return false;
    
    try {
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentDay = now.getDate();
      
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      const startMonth = start.getMonth();
      const startDay = start.getDate();
      const endMonth = end.getMonth();
      const endDay = end.getDate();
      
      // Create comparable values (month * 100 + day)
      const currentValue = currentMonth * 100 + currentDay;
      const startValue = startMonth * 100 + startDay;
      const endValue = endMonth * 100 + endDay;
      
      // Check if season wraps around year end (e.g., Nov - Feb)
      if (startValue > endValue) {
        return currentValue >= startValue || currentValue <= endValue;
      } else {
        return currentValue >= startValue && currentValue <= endValue;
      }
    } catch {
      return false;
    }
  };

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

  const WaterIntervalDisplay = () => {
    const hasActiveInterval = typeof vm.water_interval_days_active === 'number' && vm.water_interval_days_active > 0;
    const hasInactiveInterval = typeof vm.water_interval_days_inactive === 'number' && vm.water_interval_days_inactive > 0;
    const isYearRound = vm.schedule_same_year_round === true;
    const isCurrentlyActive = vm.active_season_start_date && vm.active_season_end_date 
      ? isInActiveSeason(vm.active_season_start_date, vm.active_season_end_date)
      : false;

    if (!hasActiveInterval) return null;

    return (
      <View style={styles.waterIntervalContainer}>
        {isYearRound ? (
          <View style={styles.waterIntervalRow}>
            <View style={[styles.waterIntervalBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <ThemedText style={styles.waterIntervalLabel}>Water every</ThemedText>
              <ThemedText style={[styles.waterIntervalValue, { color: '#10B981' }]}>
                {vm.water_interval_days_active} {vm.water_interval_days_active === 1 ? 'day' : 'days'}
              </ThemedText>
            </View>
          </View>
        ) : (
          <View style={styles.waterIntervalRow}>
            <View style={[styles.waterIntervalBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <View style={styles.waterIntervalLabelRow}>
                <ThemedText style={styles.waterIntervalLabel}>Active season</ThemedText>
                {isCurrentlyActive && <View style={[styles.seasonIndicator, { backgroundColor: '#10B981' }]} />}
              </View>
              <ThemedText style={[styles.waterIntervalValue, { color: '#10B981' }]}>
                Every {vm.water_interval_days_active} {vm.water_interval_days_active === 1 ? 'day' : 'days'}
              </ThemedText>
            </View>
            {hasInactiveInterval && (
              <View style={[styles.waterIntervalBadge, { backgroundColor: 'rgba(156, 163, 175, 0.15)' }]}>
                <View style={styles.waterIntervalLabelRow}>
                  <ThemedText style={styles.waterIntervalLabel}>Inactive season</ThemedText>
                  {!isCurrentlyActive && <View style={[styles.seasonIndicator, { backgroundColor: '#9CA3AF' }]} />}
                </View>
                <ThemedText style={[styles.waterIntervalValue, { color: '#6B7280' }]}>
                  Every {vm.water_interval_days_inactive} {vm.water_interval_days_inactive === 1 ? 'day' : 'days'}
                </ThemedText>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const FertilizerIntervalDisplay = () => {
    const hasActiveInterval = typeof vm.fert_interval_days_active === 'number' && vm.fert_interval_days_active > 0;
    const hasInactiveInterval = typeof vm.fert_interval_days_inactive === 'number' && vm.fert_interval_days_inactive > 0;
    const isYearRound = vm.schedule_same_year_round === true;
    const isCurrentlyActive = vm.active_season_start_date && vm.active_season_end_date 
      ? isInActiveSeason(vm.active_season_start_date, vm.active_season_end_date)
      : false;

    if (!hasActiveInterval) return null;

    return (
      <View style={styles.waterIntervalContainer}>
        {isYearRound ? (
          <View style={styles.waterIntervalRow}>
            <View style={[styles.waterIntervalBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <ThemedText style={styles.waterIntervalLabel}>Fertilize every</ThemedText>
              <ThemedText style={[styles.waterIntervalValue, { color: '#10B981' }]}>
                {vm.fert_interval_days_active} {vm.fert_interval_days_active === 1 ? 'day' : 'days'}
              </ThemedText>
            </View>
          </View>
        ) : (
          <View style={styles.waterIntervalRow}>
            <View style={[styles.waterIntervalBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <View style={styles.waterIntervalLabelRow}>
                <ThemedText style={styles.waterIntervalLabel}>Active season</ThemedText>
                {isCurrentlyActive && <View style={[styles.seasonIndicator, { backgroundColor: '#10B981' }]} />}
              </View>
              <ThemedText style={[styles.waterIntervalValue, { color: '#10B981' }]}>
                Every {vm.fert_interval_days_active} {vm.fert_interval_days_active === 1 ? 'day' : 'days'}
              </ThemedText>
            </View>
            {hasInactiveInterval && (
              <View style={[styles.waterIntervalBadge, { backgroundColor: 'rgba(156, 163, 175, 0.15)' }]}>
                <View style={styles.waterIntervalLabelRow}>
                  <ThemedText style={styles.waterIntervalLabel}>Inactive season</ThemedText>
                  {!isCurrentlyActive && <View style={[styles.seasonIndicator, { backgroundColor: '#9CA3AF' }]} />}
                </View>
                <ThemedText style={[styles.waterIntervalValue, { color: '#6B7280' }]}>
                  Every {vm.fert_interval_days_inactive} {vm.fert_interval_days_inactive === 1 ? 'day' : 'days'}
                </ThemedText>
              </View>
            )}
          </View>
        )}
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

      {/* Grower Type Display */}
      {typeof vm.schedule_same_year_round === 'boolean' && (
        <View style={styles.growerTypeContainer}>
          <ThemedText style={styles.growerTypeText}>
            {vm.schedule_same_year_round ? (
              '🌿 Year-Round Grower'
            ) : (
              <>
                🌸 Seasonal Grower •{' '}
                {vm.active_season_start_date && vm.active_season_end_date ? (
                  isInActiveSeason(vm.active_season_start_date, vm.active_season_end_date) ? (
                    <ThemedText style={[styles.growerTypeText, { color: '#10B981' }]}>Active</ThemedText>
                  ) : (
                    <ThemedText style={[styles.growerTypeText, { color: '#9CA3AF' }]}>Inactive</ThemedText>
                  )
                ) : (
                  'Unknown'
                )}
              </>
            )}
          </ThemedText>
          <ThemedText style={styles.growerDetailText}>
            {vm.schedule_same_year_round ? (
              `${commonName || displayName} shows growth year round`
            ) : vm.active_season_start_date && vm.active_season_end_date ? (
              <>
                {commonName || displayName} mostly grows from{' '}
                <ThemedText style={[styles.growerDetailText, { color: '#10B981', fontWeight: '700' }]}>
                  {formatSeasonDate(vm.active_season_start_date)}
                </ThemedText>
                <ThemedText style={[styles.growerDetailText, { color: '#10B981', fontWeight: '700' }]}>
                  {' '}–{' '}
                </ThemedText>
                <ThemedText style={[styles.growerDetailText, { color: '#10B981', fontWeight: '700' }]}>
                  {formatSeasonDate(vm.active_season_end_date)}
                </ThemedText>
              </>
            ) : (
              `${commonName || displayName} has a seasonal growth pattern`
            )}
          </ThemedText>
        </View>
      )}

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
          <View style={styles.row}>
            <ThemedText style={styles.rowTitle}>Water</ThemedText>
            <WaterIntervalDisplay />
            {vm.care_water?.trim() ? (
              vm.care_water.split(/\n\s*\n+/).map((p, i) => (
                <ThemedText key={i} style={{ opacity: 0.8, marginTop: i === 0 ? 8 : 8 }}>
                  {p}
                </ThemedText>
              ))
            ) : (
              <ThemedText style={{ opacity: 0.8, marginTop: 8 }}>Data not present</ThemedText>
            )}
          </View>
          <Row title="Temperature & Humidity" body={vm.care_temp_humidity} />
          <View style={styles.row}>
            <ThemedText style={styles.rowTitle}>Fertilizer</ThemedText>
            <FertilizerIntervalDisplay />
            {vm.care_fertilizer?.trim() ? (
              vm.care_fertilizer.split(/\n\s*\n+/).map((p, i) => (
                <ThemedText key={i} style={{ opacity: 0.8, marginTop: i === 0 ? 8 : 8 }}>
                  {p}
                </ThemedText>
              ))
            ) : (
              <ThemedText style={{ opacity: 0.8, marginTop: 8 }}>Data not present</ThemedText>
            )}
          </View>
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
  growerTypeContainer: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  growerTypeText: {
    fontWeight: '700',
    fontSize: 18,
    textAlign: 'center',
  },
  growerDetailText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    opacity: 0.85,
  },
  waterIntervalContainer: {
    marginTop: 8,
    marginBottom: 4,
  },
  waterIntervalRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  waterIntervalBadge: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    flex: 1,
    minWidth: 140,
    alignItems: 'center',
  },
  waterIntervalLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  waterIntervalLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.7,
    textAlign: 'center',
  },
  waterIntervalValue: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  seasonIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
