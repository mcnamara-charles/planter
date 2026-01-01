import React, { useCallback, useEffect, useState, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View, Pressable, ScrollView, ActivityIndicator, Animated, Modal } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { IconSymbol } from '@/components/ui/icon-symbol';

type EventType = 'flush' | 'first_water' | 'second_water' | 'fertilizer';
type FillType = 'top_up' | 'fill';

export default function CareModal({
  open,
  onClose,
  userPlantIds,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userPlantIds: string[];
  onSaved?: () => void;
}) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [selectedEvents, setSelectedEvents] = useState<Set<EventType>>(new Set(['fertilizer']));
  const [fillType, setFillType] = useState<FillType>('fill');
  const [saving, setSaving] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const plantIds = userPlantIds ?? [];

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const fillPanelOpacity = useRef(new Animated.Value(0)).current;
  const fillPanelTranslateY = useRef(new Animated.Value(-10)).current;

  useEffect(() => {
    if (open) {
      // Animate modal in
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);
      fillPanelOpacity.setValue(0);
      fillPanelTranslateY.setValue(-10);
    }
  }, [open]);

  // Animate fill panel when it appears
  useEffect(() => {
    if (hasWaterOrFertilizer) {
      Animated.parallel([
        Animated.timing(fillPanelOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(fillPanelTranslateY, {
          toValue: 0,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fillPanelOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(fillPanelTranslateY, {
          toValue: -10,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [hasWaterOrFertilizer]);

  useEffect(() => {
    if (!open) {
      setSelectedEvents(new Set(['fertilizer']));
      setFillType('fill');
      setSaving(false);
      setShowInfo(false);
    }
  }, [open]);

  const toggleEvent = useCallback((event: EventType) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      
      // If clicking the same event, toggle it (unless it's the only one selected)
      if (next.has(event) && next.size > 1) {
        next.delete(event);
        return next;
      }
      
      // If clicking flush, just toggle it
      if (event === 'flush') {
        if (next.has('flush')) {
          next.delete('flush');
        } else {
          next.add('flush');
        }
        return next;
      }
      
      // For non-flush events, can only select one at a time
      // Remove all non-flush events
      next.delete('first_water');
      next.delete('second_water');
      next.delete('fertilizer');
      
      // Add the clicked event
      next.add(event);
      
      return next;
    });
  }, []);

  const hasWaterOrFertilizer = selectedEvents.has('first_water') || 
                                selectedEvents.has('second_water') || 
                                selectedEvents.has('fertilizer');

  const handleSave = useCallback(async () => {
    if (!user?.id || !plantIds.length) return;
    if (selectedEvents.size === 0) return;

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const sevenDaysLater = new Date();
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
      sevenDaysLater.setHours(0, 0, 0, 0);

      // Process each plant
      for (const plantId of plantIds) {
        const events: any[] = [];
        const scheduleUpdates: any[] = [];

        // Get current schedules to find fertilize events to remove
        const { data: schedules } = await supabase
          .from('user_plant_schedules')
          .select('id, event_type, next_run_at')
          .eq('user_plant_id', plantId)
          .in('event_type', ['water', 'fertilize']);

        const fertSchedule = schedules?.find(s => s.event_type === 'fertilize');
        const waterSchedule = schedules?.find(s => s.event_type === 'water');

        // Handle flush event
        if (selectedEvents.has('flush')) {
          events.push({
            owner_id: user.id,
            user_plant_id: plantId,
            event_type: 'flush',
            event_time: now,
            event_data: {
              type: 'flush',
            },
            note: null,
          });
        }

        // Handle 1st Water Refill
        if (selectedEvents.has('first_water')) {
          events.push({
            owner_id: user.id,
            user_plant_id: plantId,
            event_type: 'water',
            event_time: now,
            event_data: {
              method: 'reservoir_refill',
              refill_type: 'first_water',
              fill_type: fillType,
            },
            note: null,
          });

          // Schedule water event 7 days later
          scheduleUpdates.push({
            owner_id: user.id,
            user_plant_id: plantId,
            event_type: 'water',
            next_run_at: sevenDaysLater.toISOString(),
            event_data: {
              reason: 'reservoir_first_water',
              intervalDays: 7,
            },
          });

          // Remove current/next fertilize event (don't mark complete)
          if (fertSchedule) {
            await supabase
              .from('user_plant_schedules')
              .delete()
              .eq('id', fertSchedule.id);
          }
        }

        // Handle 2nd Water Refill
        if (selectedEvents.has('second_water')) {
          events.push({
            owner_id: user.id,
            user_plant_id: plantId,
            event_type: 'water',
            event_time: now,
            event_data: {
              method: 'reservoir_refill',
              refill_type: 'second_water',
              fill_type: fillType,
            },
            note: null,
          });

          // Mark water event (like 1st water)
          scheduleUpdates.push({
            owner_id: user.id,
            user_plant_id: plantId,
            event_type: 'water',
            next_run_at: sevenDaysLater.toISOString(),
            event_data: {
              reason: 'reservoir_second_water',
              intervalDays: 7,
            },
          });

          // Schedule fertilize event 7 days out
          scheduleUpdates.push({
            owner_id: user.id,
            user_plant_id: plantId,
            event_type: 'fertilize',
            next_run_at: sevenDaysLater.toISOString(),
            event_data: {
              reason: 'reservoir_second_water',
              intervalDays: 7,
              isReservoir: true,
            },
          });

          // Remove current fertilize event
          if (fertSchedule) {
            await supabase
              .from('user_plant_schedules')
              .delete()
              .eq('id', fertSchedule.id);
          }
        }

        // Handle Fertilizer Refill
        if (selectedEvents.has('fertilizer')) {
          events.push({
            owner_id: user.id,
            user_plant_id: plantId,
            event_type: 'fertilize',
            event_time: now,
            event_data: {
              method: 'reservoir_refill',
              refill_type: 'fertilizer',
              fill_type: fillType,
            },
            note: null,
          });

          // Mark fertilize complete and schedule 7 days out
          scheduleUpdates.push({
            owner_id: user.id,
            user_plant_id: plantId,
            event_type: 'fertilize',
            next_run_at: sevenDaysLater.toISOString(),
            event_data: {
              reason: 'reservoir_fertilizer',
              intervalDays: 7,
              isReservoir: true,
            },
          });
        }

        // Insert timeline events
        if (events.length > 0) {
          await supabase.from('user_plant_timeline_events').insert(events);
        }

        // Upsert schedules
        for (const schedule of scheduleUpdates) {
          await supabase
            .from('user_plant_schedules')
            .upsert(schedule, {
              onConflict: 'owner_id,user_plant_id,event_type',
              ignoreDuplicates: false,
            });
        }
      }

      onClose();
      onSaved?.();
    } catch (err) {
      console.error('Failed to save care event:', err);
    } finally {
      setSaving(false);
    }
  }, [user?.id, plantIds, selectedEvents, fillType, onClose, onSaved]);

  if (!open) return null;
  if (!plantIds.length) return null;

  const plantCountLabel =
    plantIds.length > 1 ? ` (${plantIds.length} plants)` : '';

  const eventButtons: { key: EventType; label: string; icon: string; description: string }[] = [
    { key: 'flush', label: 'Flush', icon: 'drop.fill', description: 'Regular maintenance' },
    { key: 'first_water', label: '1st Water Refill', icon: 'drop.triangle', description: 'Salt burn recovery' },
    { key: 'second_water', label: '2nd Water Refill', icon: 'drop.triangle.fill', description: 'Salt burn recovery' },
    { key: 'fertilizer', label: 'Fertilizer Refill', icon: 'leaf.fill', description: 'Regular feeding' },
  ];

  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View 
        style={[
          styles.backdrop,
          {
            opacity: fadeAnim,
          }
        ]}
      >
        <Pressable 
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <Animated.View
          style={[
            styles.modalContainer,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              transform: [{ scale: scaleAnim }],
            }
          ]}
        >
          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <ThemedText type="title" style={styles.title}>
                Care{plantCountLabel}
              </ThemedText>
              <Pressable
                onPress={onClose}
                style={styles.closeButton}
                hitSlop={8}
              >
                <IconSymbol name="xmark.circle.fill" size={24} color={theme.colors.mutedText} />
              </Pressable>
            </View>

            {/* Info Section */}
            {(selectedEvents.has('first_water') || selectedEvents.has('second_water')) && (
              <Animated.View
                style={[
                  styles.infoCard,
                  {
                    backgroundColor: theme.colors.input,
                    borderColor: theme.colors.border,
                    opacity: fillPanelOpacity,
                    transform: [{ translateY: fillPanelTranslateY }],
                  }
                ]}
              >
                <View style={styles.infoHeader}>
                  <IconSymbol name="info.circle.fill" size={20} color={theme.colors.primary} />
                  <ThemedText style={[styles.infoTitle, { color: theme.colors.primary }]}>
                    Salt Burn Recovery Procedure
                  </ThemedText>
                </View>
                <ThemedText style={[styles.infoText, { color: theme.colors.text }]}>
                  Use 1st and 2nd Water Refills when your plant shows obvious damage from salt burn. The proper procedure is:{'\n\n'}
                  1. Regular flushing{'\n'}
                  2. Two times with just water (1st & 2nd Water Refills){'\n'}
                  3. Back to fertilizer with regular flushing
                </ThemedText>
              </Animated.View>
            )}

            <View style={styles.spacer} />
          
            {/* Event Panel */}
            <View style={styles.section}>
              <ThemedText style={[styles.sectionTitle, { color: theme.colors.text }]}>
                Event
              </ThemedText>
              <View style={[styles.buttonGrid, { backgroundColor: theme.colors.input, borderColor: theme.colors.border }]}>
                {eventButtons.map(({ key, label, icon, description }) => {
                  const isSelected = selectedEvents.has(key);
                  return (
                    <Pressable
                      key={key}
                      onPress={() => toggleEvent(key)}
                      style={({ pressed }) => [
                        styles.gridButton,
                        {
                          backgroundColor: isSelected 
                            ? theme.colors.primary 
                            : 'transparent',
                          borderColor: isSelected 
                            ? theme.colors.primary 
                            : theme.colors.border,
                          opacity: pressed ? 0.7 : 1,
                          transform: [{ scale: pressed ? 0.98 : 1 }],
                        },
                        // Top row buttons
                        (key === 'flush' || key === 'first_water') && styles.topButton,
                        // Bottom row buttons
                        (key === 'second_water' || key === 'fertilizer') && styles.bottomButton,
                        // Left column buttons
                        (key === 'flush' || key === 'second_water') && styles.leftButton,
                        // Right column buttons
                        (key === 'first_water' || key === 'fertilizer') && styles.rightButton,
                      ]}
                    >
                      <IconSymbol 
                        name={icon} 
                        size={28} 
                        color={isSelected ? '#fff' : theme.colors.text} 
                      />
                      <View style={styles.buttonTextContainer}>
                        <ThemedText
                          style={[
                            styles.gridButtonText,
                            { color: isSelected ? '#fff' : theme.colors.text },
                          ]}
                        >
                          {label}
                        </ThemedText>
                        <ThemedText
                          style={[
                            styles.gridButtonDescription,
                            { color: isSelected ? 'rgba(255,255,255,0.8)' : theme.colors.mutedText },
                          ]}
                        >
                          {description}
                        </ThemedText>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Fill/Top Up Panel - conditional */}
            <Animated.View
              style={[
                {
                  opacity: fillPanelOpacity,
                  transform: [{ translateY: fillPanelTranslateY }],
                }
              ]}
            >
              {hasWaterOrFertilizer && (
                <View style={styles.section}>
                  <ThemedText style={[styles.sectionTitle, { color: theme.colors.text }]}>
                    Fill Type
                  </ThemedText>
                  <View style={[styles.fillTypeContainer, { borderColor: theme.colors.border }]}>
                    <Pressable
                      onPress={() => setFillType('top_up')}
                      style={({ pressed }) => [
                        styles.fillTypeButton,
                        {
                          backgroundColor: fillType === 'top_up' 
                            ? theme.colors.primary 
                            : theme.colors.input,
                          borderColor: fillType === 'top_up'
                            ? theme.colors.primary
                            : theme.colors.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                        styles.leftFillButton,
                      ]}
                    >
                      <IconSymbol 
                        name="arrow.up.circle.fill" 
                        size={20} 
                        color={fillType === 'top_up' ? '#fff' : theme.colors.text} 
                      />
                      <ThemedText
                        style={[
                          styles.fillTypeButtonText,
                          { color: fillType === 'top_up' ? '#fff' : theme.colors.text },
                        ]}
                      >
                        Top Up
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => setFillType('fill')}
                      style={({ pressed }) => [
                        styles.fillTypeButton,
                        {
                          backgroundColor: fillType === 'fill' 
                            ? theme.colors.primary 
                            : theme.colors.input,
                          borderColor: fillType === 'fill'
                            ? theme.colors.primary
                            : theme.colors.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                        styles.rightFillButton,
                      ]}
                    >
                      <IconSymbol 
                        name="drop.fill" 
                        size={20} 
                        color={fillType === 'fill' ? '#fff' : theme.colors.text} 
                      />
                      <ThemedText
                        style={[
                          styles.fillTypeButtonText,
                          { color: fillType === 'fill' ? '#fff' : theme.colors.text },
                        ]}
                      >
                        Fill
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              )}
            </Animated.View>

            <View style={styles.spacer} />
            
            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              <Pressable 
                onPress={onClose} 
                style={({ pressed }) => [
                  styles.cancelButton,
                  {
                    backgroundColor: theme.colors.input,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.7 : 1,
                  }
                ]}
                disabled={saving}
              >
                <ThemedText style={[styles.buttonText, { color: theme.colors.text }]}>
                  Cancel
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={handleSave}
                style={({ pressed }) => [
                  styles.saveButton,
                  {
                    backgroundColor: selectedEvents.size === 0 || saving
                      ? theme.colors.border
                      : theme.colors.primary,
                    opacity: (selectedEvents.size === 0 || saving || pressed) ? 0.7 : 1,
                  }
                ]}
                disabled={saving || selectedEvents.size === 0}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <ThemedText style={[styles.buttonText, { color: '#fff' }]}>
                    Save
                  </ThemedText>
                )}
              </Pressable>
            </View>
        </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
  },
  scrollContent: {
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  closeButton: {
    padding: 4,
  },
  spacer: {
    height: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  infoCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  infoText: {
    fontSize: 13,
    lineHeight: 20,
    opacity: 0.9,
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
    gap: 0,
  },
  gridButton: {
    flex: 1,
    minWidth: '48%',
    aspectRatio: 1,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
  },
  topButton: {
    borderBottomWidth: 2,
  },
  bottomButton: {
    borderTopWidth: 0,
  },
  leftButton: {
    borderRightWidth: 2,
  },
  rightButton: {
    borderLeftWidth: 0,
  },
  buttonTextContainer: {
    alignItems: 'center',
    gap: 4,
  },
  gridButtonText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  gridButtonDescription: {
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '500',
  },
  fillTypeContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 2,
    overflow: 'hidden',
    gap: 0,
  },
  fillTypeButton: {
    flex: 1,
    borderWidth: 2,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  leftFillButton: {
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderRightWidth: 0,
  },
  rightFillButton: {
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderLeftWidth: 0,
  },
  fillTypeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});

