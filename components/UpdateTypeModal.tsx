import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import { useUpdateWaterSchedule, useUpdateFertilizeSchedule } from '@/hooks/scheduling/useUpdateWaterSchedule';
import ModalShell from './ModalShell';
import { ButtonPill } from './Buttons';
import { ThemedText } from './themed-text';
import { IconSymbol } from './ui/icon-symbol';

type PlantType = 'normal' | 'reservoir' | null;

type UpdateTypeModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  userPlantIds: string[];
};

export default function UpdateTypeModal({
  open,
  onClose,
  onSaved,
  userPlantIds,
}: UpdateTypeModalProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { updateOne: updateWaterSchedule } = useUpdateWaterSchedule();
  const { updateOne: updateFertilizeSchedule } = useUpdateFertilizeSchedule();
  const [selectedPlantType, setSelectedPlantType] = useState<PlantType>(null);
  const [saving, setSaving] = useState(false);

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      setSelectedPlantType(null);
    }
  }, [open]);

  const handleSave = useCallback(async () => {
    if (selectedPlantType === null || !user?.id || userPlantIds.length === 0) return;

    try {
      setSaving(true);

      // Update all selected plants
      const { error: updErr } = await supabase
        .from('user_plants')
        .update({ system_type: selectedPlantType })
        .in('id', userPlantIds);

      if (updErr) throw updErr;

      // Rebuild schedules for all affected plants (system type affects scheduling)
      // Rebuild schedules in background (don't wait)
      Promise.all(
        userPlantIds.map(id => 
          Promise.all([
            updateWaterSchedule(id).catch(() => {}),
            updateFertilizeSchedule(id).catch(() => {}),
          ])
        )
      ).catch(() => {});

      onSaved?.();
      onClose();
    } catch (error: any) {
      console.error('Error updating plant type:', error);
      // TODO: Show error alert
    } finally {
      setSaving(false);
    }
  }, [selectedPlantType, user?.id, userPlantIds, onSaved, onClose]);

  if (!open) return null;

  const plantCountLabel = userPlantIds.length > 1 ? ` (${userPlantIds.length} plants)` : '';

  return (
    <ModalShell
      open={open}
      title={`Update Plant Type${plantCountLabel}`}
      footer={
        <>
          <ButtonPill label="Cancel" onPress={onClose} disabled={saving} />
          <ButtonPill
            label={saving ? 'Updating...' : 'Update'}
            onPress={handleSave}
            variant="solid"
            color="primary"
            disabled={selectedPlantType === null || saving}
          />
        </>
      }
    >
      <View style={styles.content}>
        <ThemedText style={styles.label}>Plant Type{plantCountLabel}</ThemedText>
        <View style={styles.plantTypeContainer}>
          <TouchableOpacity
            style={[
              styles.plantTypeOption,
              { 
                backgroundColor: selectedPlantType === 'normal' ? theme.colors.primary : theme.colors.input,
                borderColor: selectedPlantType === 'normal' ? theme.colors.primary : theme.colors.border,
              }
            ]}
            onPress={() => setSelectedPlantType('normal')}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedPlantType === 'normal' }}
          >
            <View style={styles.plantTypeContent}>
              <View style={[
                styles.plantTypeIconContainer,
                { backgroundColor: selectedPlantType === 'normal' ? 'rgba(255,255,255,0.2)' : theme.colors.card }
              ]}>
                      <IconSymbol 
                        name="plant.normal" 
                        size={28} 
                        color={selectedPlantType === 'normal' ? '#fff' : theme.colors.text} 
                      />
              </View>
              <View style={styles.plantTypeTextContainer}>
                <ThemedText style={[
                  styles.plantTypeTitle,
                  { color: selectedPlantType === 'normal' ? '#fff' : theme.colors.text }
                ]}>
                  Normal
                </ThemedText>
                <ThemedText style={[
                  styles.plantTypeDescription,
                  { color: selectedPlantType === 'normal' ? 'rgba(255,255,255,0.9)' : theme.colors.mutedText }
                ]}>
                  Standard potted plant that requires manual watering and fertilizing.
                </ThemedText>
              </View>
              <View style={[
                styles.radioButton,
                { 
                  borderColor: selectedPlantType === 'normal' ? '#fff' : theme.colors.border,
                  backgroundColor: selectedPlantType === 'normal' ? '#fff' : 'transparent'
                }
              ]}>
                {selectedPlantType === 'normal' && (
                  <View style={[styles.radioButtonInner, { backgroundColor: theme.colors.primary }]} />
                )}
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.plantTypeOption,
              { 
                backgroundColor: selectedPlantType === 'reservoir' ? theme.colors.primary : theme.colors.input,
                borderColor: selectedPlantType === 'reservoir' ? theme.colors.primary : theme.colors.border,
              }
            ]}
            onPress={() => setSelectedPlantType('reservoir')}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedPlantType === 'reservoir' }}
          >
            <View style={styles.plantTypeContent}>
              <View style={[
                styles.plantTypeIconContainer,
                { backgroundColor: selectedPlantType === 'reservoir' ? 'rgba(255,255,255,0.2)' : theme.colors.card }
              ]}>
                      <IconSymbol 
                        name="plant.reservoir" 
                        size={28} 
                        color={selectedPlantType === 'reservoir' ? '#fff' : theme.colors.text} 
                      />
              </View>
              <View style={styles.plantTypeTextContainer}>
                <ThemedText style={[
                  styles.plantTypeTitle,
                  { color: selectedPlantType === 'reservoir' ? '#fff' : theme.colors.text }
                ]}>
                  Reservoir
                </ThemedText>
                <ThemedText style={[
                  styles.plantTypeDescription,
                  { color: selectedPlantType === 'reservoir' ? 'rgba(255,255,255,0.9)' : theme.colors.mutedText }
                ]}>
                  Self-watering system where fertilizing and watering are combined. Fertilizing is set to every 7 days.
                </ThemedText>
              </View>
              <View style={[
                styles.radioButton,
                { 
                  borderColor: selectedPlantType === 'reservoir' ? '#fff' : theme.colors.border,
                  backgroundColor: selectedPlantType === 'reservoir' ? '#fff' : 'transparent'
                }
              ]}>
                {selectedPlantType === 'reservoir' && (
                  <View style={[styles.radioButtonInner, { backgroundColor: theme.colors.primary }]} />
                )}
              </View>
            </View>
          </TouchableOpacity>
        </View>
        {saving && (
          <View style={styles.savingContainer}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <ThemedText style={styles.savingText}>Updating plant type...</ThemedText>
          </View>
        )}
      </View>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  plantTypeContainer: {
    gap: 12,
  },
  plantTypeOption: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  plantTypeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  plantTypeIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plantTypeTextContainer: {
    flex: 1,
    gap: 4,
  },
  plantTypeTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  plantTypeDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  radioButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  savingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  savingText: {
    fontSize: 14,
    opacity: 0.7,
  },
});

