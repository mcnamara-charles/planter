import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import ModalShell from './ModalShell';
import { ButtonPill } from './Buttons';
import LocationAutocomplete, { type LocationResult } from './LocationAutocomplete';
import { ThemedText } from './themed-text';

type MoveModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  // Single plant mode
  userPlantId?: string;
  currentLocationId?: string | null;
  currentLocationName?: string | null;
  // Multi-plant mode
  userPlantIds?: string[];
  // Title override
  title?: string;
};

export default function MoveModal({
  open,
  onClose,
  onSaved,
  userPlantId,
  currentLocationId,
  currentLocationName,
  userPlantIds,
  title,
}: MoveModalProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [selectedLocation, setSelectedLocation] = useState<LocationResult | null>(null);
  const [locationName, setLocationName] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const isMultiSelect = !!userPlantIds && userPlantIds.length > 0;
  const plantIds = isMultiSelect ? userPlantIds! : (userPlantId ? [userPlantId] : []);

  // Initialize with current location when modal opens
  useEffect(() => {
    if (open) {
      if (currentLocationId && currentLocationName) {
        setSelectedLocation({ id: currentLocationId, name: currentLocationName });
        setLocationName(currentLocationName);
      } else {
        setSelectedLocation(null);
        setLocationName('');
      }
    }
  }, [open, currentLocationId, currentLocationName]);

  const handleSave = useCallback(async () => {
    if (!selectedLocation || !user?.id || plantIds.length === 0) return;

    try {
      setSaving(true);

      // Update all selected plants
      const { error: updErr } = await supabase
        .from('user_plants')
        .update({ location_id: selectedLocation.id })
        .in('id', plantIds);

      if (updErr) throw updErr;

      // Create timeline events for each plant (only if moving from a previous location)
      if (isMultiSelect) {
        // For multi-select, we need to get the previous locations for each plant
        const { data: plantsData } = await supabase
          .from('user_plants')
          .select('id, location_id, location:location_id (id, name)')
          .in('id', plantIds);

        const timelineEvents = (plantsData || [])
          .filter((p: any) => p.location_id && p.location?.id !== selectedLocation.id)
          .map((p: any) => ({
            owner_id: user.id,
            user_plant_id: p.id,
            event_type: 'move' as const,
            event_data: {
              from: p.location?.name || null,
              to: selectedLocation.name,
            },
            note: null,
          }));

        if (timelineEvents.length > 0) {
          await supabase.from('user_plant_timeline_events').insert(timelineEvents);
        }
      } else if (userPlantId && currentLocationName && currentLocationName !== selectedLocation.name) {
        // Single plant mode - create timeline event if location changed
        await supabase.from('user_plant_timeline_events').insert({
          owner_id: user.id,
          user_plant_id: userPlantId,
          event_type: 'move',
          event_data: {
            from: currentLocationName,
            to: selectedLocation.name,
          },
          note: null,
        });
      } else if (userPlantId && !currentLocationName && selectedLocation.name) {
        // Single plant mode - moving from no location to a location (still create event)
        await supabase.from('user_plant_timeline_events').insert({
          owner_id: user.id,
          user_plant_id: userPlantId,
          event_type: 'move',
          event_data: {
            from: null,
            to: selectedLocation.name,
          },
          note: null,
        });
      }

      onSaved?.();
      onClose();
    } catch (error: any) {
      console.error('Error moving plant(s):', error);
      // TODO: Show error alert
    } finally {
      setSaving(false);
    }
  }, [selectedLocation, user?.id, plantIds, isMultiSelect, userPlantId, currentLocationName, onSaved, onClose]);

  const handleLocationPick = useCallback((item: LocationResult) => {
    setSelectedLocation(item);
    setLocationName(item.name);
  }, []);

  const handleLocationCustomChange = useCallback((text: string) => {
    setLocationName(text);
    if (!text.trim()) {
      setSelectedLocation(null);
    }
  }, []);

  if (!open) return null;

  const modalTitle = title || (isMultiSelect ? `Move ${plantIds.length} plants` : 'Move plant');
  const plantCountLabel = isMultiSelect ? ` (${plantIds.length} plants)` : '';

  return (
    <ModalShell
      open={open}
      title={modalTitle}
      footer={
        <>
          <ButtonPill label="Cancel" onPress={onClose} disabled={saving} />
          <ButtonPill
            label={saving ? 'Moving...' : 'Move'}
            onPress={handleSave}
            variant="solid"
            color="primary"
            disabled={!selectedLocation || saving}
          />
        </>
      }
    >
      <View style={styles.content}>
        <ThemedText style={styles.label}>Location{plantCountLabel}</ThemedText>
        <LocationAutocomplete
          selectedItem={selectedLocation}
          displayText={locationName}
          onPick={handleLocationPick}
          onCustomChange={handleLocationCustomChange}
          placeholder="Search or enter location name"
        />
        {saving && (
          <View style={styles.savingContainer}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <ThemedText style={styles.savingText}>Moving plant{plantIds.length > 1 ? 's' : ''}...</ThemedText>
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

