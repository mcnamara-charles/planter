import React, { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import { upsertUserPlantSchedule } from '@/services/supabaseSchedules';

type PestIdModalProps = {
  open: boolean;
  userPlantIds: string[];
  onClose: () => void;
  onSaved?: () => void;
};

export default function PestIdModal({ open, userPlantIds, onClose, onSaved }: PestIdModalProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [pestOpen, setPestOpen] = useState(false);
  const [severityOpen, setSeverityOpen] = useState(false);
  const [pestType, setPestType] = useState('');
  const [severity, setSeverity] = useState('');
  const [treatTotal, setTreatTotal] = useState('5');
  const [treatDone, setTreatDone] = useState('0');
  const [lastTreatmentDate, setLastTreatmentDate] = useState('');
  const [lastTreatmentPickerOpen, setLastTreatmentPickerOpen] = useState(false);

  const pestOptions = ['Mealybugs', 'Scale', 'Aphids', 'Whiteflies', 'Thrips', 'Spider mites', 'Fungal'];
  const severityOptions = ['Light', 'Moderate', 'Severe'];

  useEffect(() => {
    if (!open) {
      setPestOpen(false);
      setSeverityOpen(false);
      setPestType('');
      setSeverity('');
      setTreatTotal('5');
      setTreatDone('0');
      setLastTreatmentDate('');
      setLastTreatmentPickerOpen(false);
    }
  }, [open]);

  if (!open) return null;
  if (!user?.id || userPlantIds.length === 0) return null;

  const totalNum = Math.max(0, parseInt(treatTotal || '5', 10) || 5);
  const doneNum = Math.max(0, parseInt(treatDone || '0', 10) || 0);
  const needsLastTreatment = doneNum > 0;
  const formattedLastTreatment = lastTreatmentDate
    ? new Date(lastTreatmentDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const computeNextRunIso = () => {
    const now = new Date();
    let nextRun = now;
    if (needsLastTreatment && lastTreatmentDate) {
      const last = new Date(lastTreatmentDate);
      if (!isNaN(last.getTime())) {
        const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
        const ageMs = now.getTime() - last.getTime();
        if (ageMs <= fiveDaysMs && ageMs >= 0) {
          nextRun = new Date(last.getTime() + fiveDaysMs);
        }
      }
    }
    return nextRun.toISOString();
  };

  const handleSave = async () => {
    if (!pestType || !severity) return;
    try {
      // Check for existing active pest_id events
      const { data: existingEvents, error: checkError } = await supabase
        .from('user_plant_timeline_events')
        .select('user_plant_id, event_data')
        .in('user_plant_id', userPlantIds)
        .eq('event_type', 'pest_id')
        .order('event_time', { ascending: false });

      if (checkError) throw checkError;

      // Get plant IDs that already have an active pest_id event
      const plantsWithActivePest = new Set<string>();
      if (existingEvents) {
        for (const event of existingEvents) {
          const eventData = event.event_data as any;
          if (eventData?.status === 'active') {
            plantsWithActivePest.add(event.user_plant_id);
          }
        }
      }

      // Filter out plants that already have an active pest_id event
      const plantsToProcess = userPlantIds.filter((id) => !plantsWithActivePest.has(id));

      if (plantsToProcess.length === 0) {
        Alert.alert('Info', 'All selected plants already have an active pest ID event.');
        return;
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const nextRunAtIso = computeNextRunIso();

      const timelineRows = plantsToProcess.map((id) => ({
        owner_id: user.id,
        user_plant_id: id,
        event_type: 'pest_id',
        event_time: nowIso,
        event_data: {
          pest_type: pestType,
          severity,
          status: 'active',
          treatments_total: totalNum,
          treatments_completed: doneNum,
          last_treatment_date: needsLastTreatment && lastTreatmentDate ? lastTreatmentDate : null,
        },
        note: null,
      }));

      await supabase.from('user_plant_timeline_events').insert(timelineRows);

      await Promise.all(
        plantsToProcess.map((id) =>
          upsertUserPlantSchedule({
            ownerId: user.id,
            userPlantId: id,
            eventType: 'pest_treat' as any,
            nextRunAt: nextRunAtIso,
            eventData: {
              reason: 'scheduled',
              intervalDays: 5,
              completions: doneNum,
              totalTreats: totalNum,
            },
          })
        )
      );

      if (plantsWithActivePest.size > 0) {
        Alert.alert(
          'Partial Success',
          `Pest ID added to ${plantsToProcess.length} plant(s). ${plantsWithActivePest.size} plant(s) were skipped because they already have an active pest ID event.`
        );
      }

      onClose();
      onSaved?.();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save pest event');
    }
  };

  return (
    <View style={styles.backdrop}>
      {pestOpen || severityOpen || lastTreatmentPickerOpen ? (
        <TouchableOpacity
          onPress={() => {
            setPestOpen(false);
            setSeverityOpen(false);
            setLastTreatmentPickerOpen(false);
          }}
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
        <ThemedText type='title'>Pest ID</ThemedText>
        <View style={{ height: 12 }} />

        <ThemedText style={{ fontWeight: '700' }}>Pest Type</ThemedText>
        <View style={{ position: 'relative', marginTop: 6 }}>
          <TouchableOpacity
            onPress={() => {
              setPestOpen((o) => !o);
              setSeverityOpen(false);
            }}
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
            <ThemedText style={{ color: pestType ? theme.colors.text : theme.colors.mutedText }}>
              {pestType || 'Select pest'}
            </ThemedText>
            <View style={{ position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
              <IconSymbol name={pestOpen ? 'chevron.up' : 'chevron.down'} size={20} color={theme.colors.mutedText} />
            </View>
          </TouchableOpacity>
          {pestOpen && (
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
              {pestOptions.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => {
                    setPestType(opt);
                    setPestOpen(false);
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

        <ThemedText style={{ fontWeight: '700' }}>Pest Severity</ThemedText>
        <View style={{ position: 'relative', marginTop: 6 }}>
          <TouchableOpacity
            onPress={() => {
              setSeverityOpen((o) => !o);
              setPestOpen(false);
            }}
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
            <ThemedText style={{ color: severity ? theme.colors.text : theme.colors.mutedText }}>
              {severity || 'Select severity'}
            </ThemedText>
            <View style={{ position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
              <IconSymbol name={severityOpen ? 'chevron.up' : 'chevron.down'} size={20} color={theme.colors.mutedText} />
            </View>
          </TouchableOpacity>
          {severityOpen && (
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
              {severityOptions.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => {
                    setSeverity(opt);
                    setSeverityOpen(false);
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

        <ThemedText style={{ fontWeight: '700' }}>Treatments to complete</ThemedText>
        <TextInput
          style={{
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.input,
            color: theme.colors.text,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginTop: 6,
          }}
          keyboardType='numeric'
          value={treatTotal}
          onChangeText={setTreatTotal}
          placeholder='Defaults to 5'
          placeholderTextColor={theme.colors.mutedText}
        />

        <View style={{ height: 12 }} />

        <ThemedText style={{ fontWeight: '700' }}>Treatments completed</ThemedText>
        <TextInput
          style={{
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.input,
            color: theme.colors.text,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginTop: 6,
          }}
          keyboardType='numeric'
          value={treatDone}
          onChangeText={setTreatDone}
          placeholder='Defaults to 0'
          placeholderTextColor={theme.colors.mutedText}
        />

        {needsLastTreatment && (
          <>
            <View style={{ height: 12 }} />
            <ThemedText style={{ fontWeight: '700' }}>Last treatment (date)</ThemedText>
            <TouchableOpacity
              onPress={() => setLastTreatmentPickerOpen(true)}
              activeOpacity={0.8}
              style={{
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.input,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 12,
                marginTop: 6,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <ThemedText style={{ color: formattedLastTreatment ? theme.colors.text : theme.colors.mutedText }}>
                {formattedLastTreatment || 'Select date'}
              </ThemedText>
              <IconSymbol name='calendar' size={18} color={theme.colors.mutedText} />
            </TouchableOpacity>
            {lastTreatmentPickerOpen && (
              <DateTimePicker
                value={lastTreatmentDate ? new Date(lastTreatmentDate) : new Date()}
                mode='date'
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_, date) => {
                  setLastTreatmentPickerOpen(false);
                  if (date) {
                    const iso = date.toISOString().slice(0, 10);
                    setLastTreatmentDate(iso);
                  }
                }}
              />
            )}
          </>
        )}

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

