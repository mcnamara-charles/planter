import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';

type PestTreatModalProps = {
  open: boolean;
  userPlantIds: string[];
  onClose: () => void;
  onSaved?: () => void;
};

export default function PestTreatModal({ open, userPlantIds, onClose, onSaved }: PestTreatModalProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [treatmentOpen, setTreatmentOpen] = useState(false);
  const [treatmentType, setTreatmentType] = useState('Neem Oil');
  const [includesRinse, setIncludesRinse] = useState(false);

  const treatmentOptions = ['Sulfur Pesticide', 'Neem Oil', 'Spinosad'];

  useEffect(() => {
    if (!open) {
      setTreatmentOpen(false);
      setTreatmentType('Neem Oil');
      setIncludesRinse(false);
    }
  }, [open]);

  if (!open) return null;
  if (!user?.id || userPlantIds.length === 0) return null;

  const handleSave = async () => {
    try {
      const now = new Date();
      const nowIso = now.toISOString();

      // Get the most recent pest_id event for each plant
      const { data: pestIdEvents, error: fetchError } = await supabase
        .from('user_plant_timeline_events')
        .select('id, user_plant_id, event_data')
        .in('user_plant_id', userPlantIds)
        .eq('event_type', 'pest_id')
        .order('event_time', { ascending: false });

      if (fetchError) throw fetchError;

      if (!pestIdEvents || pestIdEvents.length === 0) {
        Alert.alert('Error', 'No active pest ID events found for the selected plants.');
        return;
      }

      // Group by user_plant_id to get the most recent event for each plant
      const mostRecentEvents = new Map<string, { id: string; event_data: any }>();
      for (const event of pestIdEvents) {
        const eventData = event.event_data as any;
        if (eventData?.status === 'active' && !mostRecentEvents.has(event.user_plant_id)) {
          mostRecentEvents.set(event.user_plant_id, { id: event.id, event_data: eventData });
        }
      }

      if (mostRecentEvents.size === 0) {
        Alert.alert('Error', 'No active pest ID events found for the selected plants.');
        return;
      }

      // Create treatment events and update pest_id events
      const treatmentRows: any[] = [];
      const updatePromises: Promise<any>[] = [];

      for (const [userPlantId, pestEvent] of mostRecentEvents.entries()) {
        const eventData = pestEvent.event_data;
        const currentCompleted = eventData.treatments_completed || 0;
        const totalTreatments = eventData.treatments_total || 0;
        const newCompleted = currentCompleted + 1;

        // Create treatment event
        treatmentRows.push({
          owner_id: user.id,
          user_plant_id: userPlantId,
          event_type: 'pest_treat',
          event_time: nowIso,
          event_data: {
            treatment_type: treatmentType,
            includes_rinse: includesRinse,
          },
          note: null,
        });

        // Update the pest_id event
        const updatedEventData = {
          ...eventData,
          treatments_completed: newCompleted,
          status: newCompleted >= totalTreatments ? 'completed' : 'active',
        };

        updatePromises.push(
          supabase
            .from('user_plant_timeline_events')
            .update({ event_data: updatedEventData })
            .eq('id', pestEvent.id)
        );
      }

      // Insert treatment events
      if (treatmentRows.length > 0) {
        const { error: insertError } = await supabase.from('user_plant_timeline_events').insert(treatmentRows);
        if (insertError) throw insertError;
      }

      // Update pest_id events
      await Promise.all(updatePromises);

      onClose();
      onSaved?.();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save pest treatment');
    }
  };

  return (
    <View style={styles.backdrop}>
      {treatmentOpen ? (
        <TouchableOpacity
          onPress={() => setTreatmentOpen(false)}
          style={StyleSheet.absoluteFillObject}
        />
      ) : null}
      <View
        style={[
          styles.card,
          {
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.card,
          },
        ]}
      >
        <ThemedText type='title'>Treat Plant</ThemedText>
        <View style={{ height: 12 }} />

        <ThemedText style={{ fontWeight: '700' }}>Treated with</ThemedText>
        <View style={{ position: 'relative', marginTop: 6 }}>
          <TouchableOpacity
            onPress={() => setTreatmentOpen((o) => !o)}
            activeOpacity={0.8}
            style={{
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.input,
              borderRadius: 10,
              paddingLeft: 12,
              paddingRight: 40,
              paddingVertical: 12,
            }}
          >
            <ThemedText style={{ color: treatmentType ? theme.colors.text : theme.colors.mutedText }}>
              {treatmentType || 'Select treatment'}
            </ThemedText>
            <View style={{ position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
              <IconSymbol name={treatmentOpen ? 'chevron.up' : 'chevron.down'} size={20} color={theme.colors.mutedText} />
            </View>
          </TouchableOpacity>
          {treatmentOpen && (
            <View
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                backgroundColor: theme.colors.card,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                borderRadius: 10,
                marginTop: 6,
                zIndex: 3,
              }}
            >
              {treatmentOptions.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => {
                    setTreatmentType(opt);
                    setTreatmentOpen(false);
                  }}
                  style={{ paddingVertical: 10, paddingHorizontal: 12 }}
                >
                  <ThemedText style={{ color: theme.colors.text }}>{opt}</ThemedText>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 14 }} />

        <TouchableOpacity
          onPress={() => setIncludesRinse(!includesRinse)}
          activeOpacity={0.8}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 8,
          }}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderWidth: 2,
              borderColor: includesRinse ? theme.colors.primary : theme.colors.border,
              backgroundColor: includesRinse ? theme.colors.primary : 'transparent',
              borderRadius: 4,
              marginRight: 12,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {includesRinse && (
              <IconSymbol name='checkmark' size={16} color={theme.colors.background} />
            )}
          </View>
          <ThemedText style={{ fontWeight: '600' }}>Includes rinse</ThemedText>
        </TouchableOpacity>

        <View style={{ height: 18 }} />

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
          <TouchableOpacity onPress={onClose} style={[styles.overlayCloseBtn, { borderColor: theme.colors.border }]}>
            <ThemedText style={{ fontWeight: '700', color: theme.colors.text }}>Cancel</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSave} style={[styles.overlayCloseBtn, { borderColor: theme.colors.border }]}>
            <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>Save</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '90%',
    maxWidth: 520,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    position: 'relative',
    zIndex: 2,
  },
  overlayCloseBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});

