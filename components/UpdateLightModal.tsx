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

type LightType = 'grow_light' | 'sunlight' | null;

type UpdateLightModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  userPlantIds: string[];
};

export default function UpdateLightModal({
  open,
  onClose,
  onSaved,
  userPlantIds,
}: UpdateLightModalProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { updateOne: updateWaterSchedule } = useUpdateWaterSchedule();
  const { updateOne: updateFertilizeSchedule } = useUpdateFertilizeSchedule();
  const [selectedLightType, setSelectedLightType] = useState<LightType>(null);
  const [saving, setSaving] = useState(false);

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      setSelectedLightType(null);
    }
  }, [open]);

  const handleSave = useCallback(async () => {
    if (selectedLightType === null || !user?.id || userPlantIds.length === 0) return;

    try {
      setSaving(true);

      // Update all selected plants
      const { error: updErr } = await supabase
        .from('user_plants')
        .update({ light_type: selectedLightType })
        .in('id', userPlantIds);

      if (updErr) throw updErr;

      // Rebuild schedules for all affected plants (light type affects scheduling)
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
      console.error('Error updating light type:', error);
      // TODO: Show error alert
    } finally {
      setSaving(false);
    }
  }, [selectedLightType, user?.id, userPlantIds, onSaved, onClose]);

  if (!open) return null;

  const plantCountLabel = userPlantIds.length > 1 ? ` (${userPlantIds.length} plants)` : '';

  return (
    <ModalShell
      open={open}
      title={`Update Light Source${plantCountLabel}`}
      footer={
        <>
          <ButtonPill label="Cancel" onPress={onClose} disabled={saving} />
          <ButtonPill
            label={saving ? 'Updating...' : 'Update'}
            onPress={handleSave}
            variant="solid"
            color="primary"
            disabled={selectedLightType === null || saving}
          />
        </>
      }
    >
      <View style={styles.content}>
        <ThemedText style={styles.label}>Primary Light Source{plantCountLabel}</ThemedText>
        <View style={styles.plantTypeContainer}>
          <TouchableOpacity
            style={[
              styles.plantTypeOption,
              { 
                backgroundColor: selectedLightType === 'grow_light' ? theme.colors.primary : theme.colors.input,
                borderColor: selectedLightType === 'grow_light' ? theme.colors.primary : theme.colors.border,
              }
            ]}
            onPress={() => setSelectedLightType('grow_light')}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedLightType === 'grow_light' }}
          >
            <View style={styles.plantTypeContent}>
              <View style={[
                styles.plantTypeIconContainer,
                { backgroundColor: selectedLightType === 'grow_light' ? 'rgba(255,255,255,0.2)' : theme.colors.card }
              ]}>
                <IconSymbol 
                  name="light.grow" 
                  size={28} 
                  color={selectedLightType === 'grow_light' ? '#fff' : theme.colors.text} 
                />
              </View>
              <View style={styles.plantTypeTextContainer}>
                <ThemedText style={[
                  styles.plantTypeTitle,
                  { color: selectedLightType === 'grow_light' ? '#fff' : theme.colors.text }
                ]}>
                  Grow Light
                </ThemedText>
                <ThemedText style={[
                  styles.plantTypeDescription,
                  { color: selectedLightType === 'grow_light' ? 'rgba(255,255,255,0.9)' : theme.colors.mutedText }
                ]}>
                  This plant receives its primary light from an artificial grow light source.
                </ThemedText>
              </View>
              <View style={[
                styles.radioButton,
                { 
                  borderColor: selectedLightType === 'grow_light' ? '#fff' : theme.colors.border,
                  backgroundColor: selectedLightType === 'grow_light' ? '#fff' : 'transparent'
                }
              ]}>
                {selectedLightType === 'grow_light' && (
                  <View style={[styles.radioButtonInner, { backgroundColor: theme.colors.primary }]} />
                )}
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.plantTypeOption,
              { 
                backgroundColor: selectedLightType === 'sunlight' ? theme.colors.primary : theme.colors.input,
                borderColor: selectedLightType === 'sunlight' ? theme.colors.primary : theme.colors.border,
              }
            ]}
            onPress={() => setSelectedLightType('sunlight')}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedLightType === 'sunlight' }}
          >
            <View style={styles.plantTypeContent}>
              <View style={[
                styles.plantTypeIconContainer,
                { backgroundColor: selectedLightType === 'sunlight' ? 'rgba(255,255,255,0.2)' : theme.colors.card }
              ]}>
                <IconSymbol 
                  name="light.sun" 
                  size={28} 
                  color={selectedLightType === 'sunlight' ? '#fff' : theme.colors.text} 
                />
              </View>
              <View style={styles.plantTypeTextContainer}>
                <ThemedText style={[
                  styles.plantTypeTitle,
                  { color: selectedLightType === 'sunlight' ? '#fff' : theme.colors.text }
                ]}>
                  Sunlight
                </ThemedText>
                <ThemedText style={[
                  styles.plantTypeDescription,
                  { color: selectedLightType === 'sunlight' ? 'rgba(255,255,255,0.9)' : theme.colors.mutedText }
                ]}>
                  This plant receives its primary light from natural sunlight (windows, outdoor, etc.).
                </ThemedText>
              </View>
              <View style={[
                styles.radioButton,
                { 
                  borderColor: selectedLightType === 'sunlight' ? '#fff' : theme.colors.border,
                  backgroundColor: selectedLightType === 'sunlight' ? '#fff' : 'transparent'
                }
              ]}>
                {selectedLightType === 'sunlight' && (
                  <View style={[styles.radioButtonInner, { backgroundColor: theme.colors.primary }]} />
                )}
              </View>
            </View>
          </TouchableOpacity>
        </View>
        {saving && (
          <View style={styles.savingContainer}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <ThemedText style={styles.savingText}>Updating light source...</ThemedText>
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

