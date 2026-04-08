import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View, Pressable, ScrollView, ActivityIndicator } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { 
  fetchPlantSchedulingFieldsByUserPlant,
  fetchLatestEffectiveWateringEvent,
  fetchLatestPestEvent,
  calculateNextPestTreatmentDate,
  upsertUserPlantSchedule,
  atStartOfTodayLocal,
  addDaysLocal,
  isTodayInActive,
  nextOccurrenceOfMonthDay,
  toMD,
} from '@/services/supabaseSchedules';

export default function FertilizeModal({
  open,
  onClose,
  userPlantIds,
  onSaved,
  defaultIsWatering = false,
}: {
  open: boolean;
  onClose: () => void;
  userPlantIds: string[];
  onSaved?: () => void;
  defaultIsWatering?: boolean;
}) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [productName, setProductName] = useState('MiracleGro Liquafeed');
  const [productForm, setProductForm] = useState('liquid');
  const [npkOpen, setNpkOpen] = useState(false);
  const [npk, setNpk] = useState('');
  const [method, setMethod] = useState('Soil drench');
  const [concentrationOpen, setConcentrationOpen] = useState(false);
  const [concentration, setConcentration] = useState('');
  const [isWatering, setIsWatering] = useState(false);
  const [dryWeightLb, setDryWeightLb] = useState('');
  const [wetWeightLb, setWetWeightLb] = useState('');
  const [prefillLoading, setPrefillLoading] = useState(false);
  const plantIds = userPlantIds ?? [];
  const canPrefill = plantIds.length === 1;
  
  const npkOptions = ['12-4-8', '12-9-6', '1-1-1'] as const;
  const concentrationOptions = ['1/4', '1/2'] as const;

  const handlePrefill = useCallback(async () => {
    if (!canPrefill || !user?.id) return;
    const plantId = plantIds[0];
    try {
      setPrefillLoading(true);
      const { data, error } = await supabase
        .from('user_plant_timeline_events')
        .select('event_data, created_at')
        .eq('user_plant_id', plantId)
        .eq('event_type', 'fertilize')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data?.event_data) return;

      const event = data.event_data as any;
      const product = event?.product ?? {};
      setProductName(product?.name ?? '');
      setProductForm(product?.form ?? '');
      setNpk(product?.npk ?? '');
      setMethod(event?.method ?? '');
      setConcentration(event?.concentration ?? '');
      setIsWatering(!!event?.is_watering);
      setDryWeightLb(event?.dry_weight_lb ? String(event.dry_weight_lb) : '');
      setWetWeightLb(event?.wet_weight_lb ? String(event.wet_weight_lb) : '');
    } catch (err) {
      console.warn('Fertilize prefill failed', err);
    } finally {
      setPrefillLoading(false);
    }
  }, [canPrefill, plantIds, user?.id]);

  useEffect(() => {
    if (!open) {
      setProductName('MiracleGro Liquafeed');
      setProductForm('liquid');
      setNpk('');
      setMethod('Soil drench');
      setConcentration('');
      setIsWatering(false);
      setDryWeightLb('');
      setWetWeightLb('');
      setNpkOpen(false);
      setConcentrationOpen(false);
    } else {
      // Set default isWatering when modal opens
      setIsWatering(defaultIsWatering);
    }
  }, [open, defaultIsWatering]);

  if (!open) return null;
  if (!plantIds.length) return null;

  const plantCountLabel =
    plantIds.length > 1 ? ` (${plantIds.length} plants)` : '';

  const toWeightValue = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  };

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
      {/* Click-away closes dropdowns only */}
      {(npkOpen || concentrationOpen) ? (
        <TouchableOpacity 
          onPress={() => { setNpkOpen(false); setConcentrationOpen(false); }} 
          style={StyleSheet.absoluteFillObject} 
        />
      ) : null}
      <View style={{ width: '90%', maxWidth: 520, maxHeight: 500, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.card, position: 'relative', zIndex: 2 }}>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <ThemedText type="title">Log fertilizing{plantCountLabel}</ThemedText>
          {canPrefill && (
            <Pressable
              style={[styles.prefillButton, { borderColor: theme.colors.border }]}
              onPress={handlePrefill}
              disabled={prefillLoading}
            >
              {prefillLoading ? (
                <ActivityIndicator size="small" color={theme.colors.text as any} />
              ) : (
                <ThemedText style={styles.prefillButtonText}>Prefill Event</ThemedText>
              )}
            </Pressable>
          )}
          <View style={{ height: 8 }} />
          
          {/* Product Section */}
          <ThemedText style={{ fontWeight: '700' }}>Product Name</ThemedText>
          <TextInput
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
            value={productName}
            onChangeText={setProductName}
            placeholder="e.g., Miracle-Gro All Purpose"
            placeholderTextColor={theme.colors.mutedText}
          />
          
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>Form</ThemedText>
          <TextInput
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
            value={productForm}
            onChangeText={setProductForm}
            placeholder="e.g., liquid, granular, powder"
            placeholderTextColor={theme.colors.mutedText}
          />
          
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>NPK Ratio</ThemedText>
          <View style={{ position: 'relative', marginTop: 6 }}>
            <TouchableOpacity
              onPress={() => { setNpkOpen((o) => !o); setConcentrationOpen(false); }}
              activeOpacity={0.8}
              style={{
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.input,
                borderRadius: 10,
                paddingLeft: 12,
                paddingRight: 40,
                paddingVertical: 10,
              }}
            >
              <ThemedText style={{ color: npk ? theme.colors.text : theme.colors.mutedText }}>
                {npk || 'Select NPK ratio'}
              </ThemedText>
              <View style={{ position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                <IconSymbol name={npkOpen ? 'chevron.up' : 'chevron.down'} size={20} color={theme.colors.mutedText} />
              </View>
            </TouchableOpacity>
            {npkOpen && (
              <View
                style={{
                  position: 'absolute',
                  top: 42,
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  borderRadius: 10,
                  overflow: 'hidden',
                  backgroundColor: theme.colors.card,
                  shadowColor: '#000',
                  shadowOpacity: 0.12,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 4,
                }}
              >
                {npkOptions.map((option) => (
                  <TouchableOpacity
                    key={option}
                    onPress={() => { setNpk(option); setNpkOpen(false); }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    <ThemedText>{option}</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>Method</ThemedText>
          <TextInput
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
            value={method}
            onChangeText={setMethod}
            placeholder="e.g., soil drench, foliar spray, top dress"
            placeholderTextColor={theme.colors.mutedText}
          />
          
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>Concentration</ThemedText>
          <View style={{ position: 'relative', marginTop: 6 }}>
            <TouchableOpacity
              onPress={() => { setConcentrationOpen((o) => !o); setNpkOpen(false); }}
              activeOpacity={0.8}
              style={{
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.input,
                borderRadius: 10,
                paddingLeft: 12,
                paddingRight: 40,
                paddingVertical: 10,
              }}
            >
              <ThemedText style={{ color: concentration ? theme.colors.text : theme.colors.mutedText }}>
                {concentration || 'Select concentration'}
              </ThemedText>
              <View style={{ position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                <IconSymbol name={concentrationOpen ? 'chevron.up' : 'chevron.down'} size={20} color={theme.colors.mutedText} />
              </View>
            </TouchableOpacity>
            {concentrationOpen && (
              <View
                style={{
                  position: 'absolute',
                  top: 42,
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  borderRadius: 10,
                  overflow: 'hidden',
                  backgroundColor: theme.colors.card,
                  shadowColor: '#000',
                  shadowOpacity: 0.12,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 4,
                }}
              >
                {concentrationOptions.map((option) => (
                  <TouchableOpacity
                    key={option}
                    onPress={() => { setConcentration(option); setConcentrationOpen(false); }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    <ThemedText>{option}</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          
          <View style={{ height: 14 }} />
          
          {/* Is Watering Checkbox */}
          <Pressable
            onPress={() => setIsWatering(!isWatering)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
          >
            <View style={[
              styles.checkbox,
              { borderColor: theme.colors.border, backgroundColor: isWatering ? '#10B981' : 'transparent' }
            ]}>
              {isWatering && (
                <IconSymbol name="checkmark.circle" size={16} color="#fff" />
              )}
            </View>
            <ThemedText style={{ fontWeight: '600' }}>Counts as watering</ThemedText>
          </Pressable>
          
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>Dry weight (lb, optional)</ThemedText>
          <TextInput
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
            value={dryWeightLb}
            onChangeText={setDryWeightLb}
            placeholder="e.g., 8.5"
            placeholderTextColor={theme.colors.mutedText}
            keyboardType="decimal-pad"
          />
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>Wet weight (lb, optional)</ThemedText>
          <TextInput
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
            value={wetWeightLb}
            onChangeText={setWetWeightLb}
            placeholder="e.g., 9.2"
            placeholderTextColor={theme.colors.mutedText}
            keyboardType="decimal-pad"
          />
          <View style={{ height: 14 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
            <TouchableOpacity onPress={onClose} style={[styles.envBtn, { borderColor: theme.colors.border }]}>
              <ThemedText style={{ fontWeight: '700', color: theme.colors.text }}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                if (!user?.id) { onClose(); return; }
                if (!productName.trim() || !plantIds.length) { return; }
                try {
                  const now = new Date().toISOString();
                  const dryWeight = toWeightValue(dryWeightLb);
                  const wetWeight = toWeightValue(wetWeightLb);
                  const rows = plantIds.map((id) => ({
                    owner_id: user.id,
                    user_plant_id: id,
                    event_type: 'fertilize',
                    event_time: now,
                    event_data: { 
                      product: {
                        name: productName.trim(),
                        form: productForm.trim() || null,
                        npk: npk.trim() || null,
                      },
                      method: method.trim() || null,
                      concentration: concentration.trim() || null,
                      is_watering: isWatering,
                      dry_weight_lb: dryWeight,
                      wet_weight_lb: wetWeight,
                    },
                    note: null,
                  }));
                  await supabase.from('user_plant_timeline_events').insert(rows);
                  
                  // If isWatering=true, immediately update water schedules for normal plants
                  if (isWatering) {
                    const today = atStartOfTodayLocal();
                    const updatePromises = plantIds.map(async (plantId) => {
                      try {
                        // Skip reservoir plants (they don't have water schedules)
                        const sched = await fetchPlantSchedulingFieldsByUserPlant(plantId);
                        if (!sched || sched.system_type === 'reservoir') return;
                        
                        // Get the latest effective watering event (now includes this fertilize event)
                        const last = await fetchLatestEffectiveWateringEvent(plantId);
                        if (!last) return;
                        
                        // Determine active season
                        const activeNow = sched.light_type === 'grow_light' 
                          ? true 
                          : isTodayInActive(
                              today,
                              sched.active_season_start_date,
                              sched.active_season_end_date,
                              sched.schedule_same_year_round ?? null
                            );
                        
                        // Get water interval
                        let intervalDays: number | null;
                        if (sched.water_delay !== null && sched.water_delay !== undefined) {
                          intervalDays = sched.water_delay;
                        } else {
                          intervalDays = activeNow ? sched.water_interval_days_active ?? null : sched.water_interval_days_inactive ?? null;
                        }
                        
                        // If no interval configured during inactive season, schedule for next season start
                        if (!intervalDays || intervalDays <= 0) {
                          if (!activeNow && sched.active_season_start_date) {
                            const startMD = toMD(sched.active_season_start_date);
                            if (startMD) {
                              const nextSeasonStart = nextOccurrenceOfMonthDay(startMD.m, startMD.d, today);
                              await upsertUserPlantSchedule({
                                userPlantId: plantId,
                                ownerId: user.id,
                                eventType: 'water',
                                nextRunAt: nextSeasonStart.toISOString(),
                                eventData: { reason: 'next_season', activeNow: false, intervalDays: null },
                              });
                            }
                          }
                          return;
                        }
                        
                        // Calculate next water date
                        const lastAt = new Date(last.event_time);
                        const lastMidnightLocal = new Date(lastAt);
                        lastMidnightLocal.setHours(0, 0, 0, 0);
                        const todayMidnightLocal = new Date(today);
                        todayMidnightLocal.setHours(0, 0, 0, 0);
                        
                        const daysSince = Math.floor(
                          (todayMidnightLocal.getTime() - lastMidnightLocal.getTime()) / (1000 * 60 * 60 * 24)
                        );
                        
                        let nextAt = today;
                        let reason: 'initial' | 'due' | 'projected' = 'initial';
                        
                        if (last?.event_time) {
                          if (daysSince >= intervalDays) {
                            reason = 'due';
                            nextAt = today;
                          } else {
                            reason = 'projected';
                            nextAt = addDaysLocal(lastMidnightLocal, intervalDays);
                            if (nextAt < today) nextAt = today;
                          }
                        }
                        
                        // Check for pest events and adjust schedule to avoid conflicts
                        const latestPestEvent = await fetchLatestPestEvent(plantId);
                        const nextPestTreatment = calculateNextPestTreatmentDate(latestPestEvent, today);
                        
                        if (nextPestTreatment) {
                          const pestDateMidnight = new Date(nextPestTreatment);
                          pestDateMidnight.setHours(0, 0, 0, 0);
                          const nextAtMidnight = new Date(nextAt);
                          nextAtMidnight.setHours(0, 0, 0, 0);
                          
                          const daysDiff = Math.abs(
                            (nextAtMidnight.getTime() - pestDateMidnight.getTime()) / (1000 * 60 * 60 * 24)
                          );
                          
                          if (daysDiff <= 1 && nextAtMidnight <= pestDateMidnight) {
                            nextAt = addDaysLocal(pestDateMidnight, 1);
                          }
                        }
                        
                        // Upsert water schedule
                        await upsertUserPlantSchedule({
                          userPlantId: plantId,
                          ownerId: user.id,
                          eventType: 'water',
                          nextRunAt: nextAt.toISOString(),
                          eventData: { reason, activeNow, intervalDays },
                        });
                      } catch (err) {
                        console.warn('Failed to update water schedule after fertilize', err);
                      }
                    });
                    
                    // Wait for all water schedule updates to complete
                    await Promise.all(updatePromises);
                  }
                  
                  onClose();
                  onSaved?.();
                } catch {}
              }}
              style={[styles.envBtn, { borderColor: theme.colors.border }]}
            >
              <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>Save</ThemedText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  envBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefillButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  prefillButtonText: {
    fontWeight: '600',
  },
});
