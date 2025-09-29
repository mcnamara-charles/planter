import { Image } from 'expo-image';
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@/services/supabaseClient';
import { type Plant } from '@/types/plant';
import { IconSymbol } from '@/components/ui/icon-symbol';

type JoinedPhotoRow = { id: string; bucket: string; object_path: string };

// The row shape we expect from the joined query
type UserPlantJoined = {
  id: string;
  plants_table_id: string | null;
  nickname: string | null;
  acquired_at: string | null;
  acquired_from: string | null;
  location: string | null;
  default_plant_photo_id: string | null;
  plants: {
    id: string;
    plant_name: string | null;
    plant_scientific_name: string | null;
  } | null;
  // Supabase returns arrays for joined relations unless it can guarantee 1:1
  photo: JoinedPhotoRow[] | null;
};

type InspectionPlant = Plant & {
  inspectionStatus: 'never' | 'old' | 'recent';
  daysSinceObservation?: number;
};

// Custom list item component for inspection plants with different warning labels
function InspectionPlantListItem({ 
  plant, 
  onPress 
}: { 
  plant: InspectionPlant; 
  onPress: () => void; 
}) {
  const { theme } = useTheme();
  
  const getWarningConfig = () => {
    switch (plant.inspectionStatus) {
      case 'never':
        return {
          color: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          text: 'Never Observed'
        };
      case 'old':
        return {
          color: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          text: `Observed ${plant.daysSinceObservation} days ago`
        };
      case 'recent':
        return {
          color: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          text: `Observed ${plant.daysSinceObservation} days ago`
        };
      default:
        return {
          color: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          text: 'Needs Inspection'
        };
    }
  };

  const warningConfig = getWarningConfig();
  
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.inspectionPlantItem, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}
      activeOpacity={0.7}
    >
      {/* Plant Image */}
      <View style={styles.plantImageContainer}>
        {plant.imageUri ? (
          <Image
            source={{ uri: plant.imageUri }}
            style={styles.plantImage}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.plantImage, { backgroundColor: theme.colors.input }]} />
        )}
      </View>
      
      {/* Plant Info */}
      <View style={styles.plantInfo}>
        <ThemedText style={styles.plantName} numberOfLines={1}>
          {plant.name}
        </ThemedText>
        {plant.scientificName && (
          <ThemedText style={styles.plantScientific} numberOfLines={1}>
            {plant.scientificName}
          </ThemedText>
        )}
        
        {/* Warning Label */}
        <View style={[styles.warningContainer, { backgroundColor: warningConfig.backgroundColor }]}>
          <IconSymbol name="exclamationmark.triangle" size={14} color={warningConfig.color} />
          <ThemedText style={[styles.warningText, { color: warningConfig.color }]} numberOfLines={1}>
            {warningConfig.text}
          </ThemedText>
        </View>
      </View>
      
      {/* Chevron */}
      <IconSymbol name="chevron.right" size={16} color={theme.colors.mutedText} />
    </TouchableOpacity>
  );
}

export default function InspectionScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const nav = useNavigation();
  const [inspectionPlants, setInspectionPlants] = useState<InspectionPlant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch plants that need inspection with their observation status
  const fetchInspectionPlants = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      setLoading(true);
      setError(null);
      
      // Get all user plants
      const { data: userPlants, error: plantsError } = await supabase
        .from('user_plants')
        .select('id, plants_table_id, nickname, default_plant_photo_id')
        .eq('owner_id', user.id);
      
      if (plantsError) throw plantsError;
      
      if (!userPlants || userPlants.length === 0) {
        setInspectionPlants([]);
        return;
      }
      
      const plantIds = userPlants.map(p => p.id);
      
      // Get all observe events for these plants
      const { data: observeEvents, error: eventsError } = await supabase
        .from('user_plant_timeline_events')
        .select('user_plant_id, event_time')
        .eq('event_type', 'observe')
        .in('user_plant_id', plantIds)
        .order('event_time', { ascending: false });
      
      if (eventsError) throw eventsError;
      
      // Group by plant_id and get the most recent event for each
      const mostRecentByPlant = new Map();
      observeEvents?.forEach(event => {
        if (!mostRecentByPlant.has(event.user_plant_id)) {
          mostRecentByPlant.set(event.user_plant_id, event);
        }
      });
      
      // Find plants that need inspection and categorize them
      const plantsNeedingInspectionIds: string[] = [];
      const inspectionStatusMap = new Map<string, { status: 'never' | 'old' | 'recent', days?: number }>();
      
      userPlants.forEach(plant => {
        const mostRecentEvent = mostRecentByPlant.get(plant.id);
        
        if (!mostRecentEvent) {
          // Never observed
          plantsNeedingInspectionIds.push(plant.id);
          inspectionStatusMap.set(plant.id, { status: 'never' });
        } else {
          // Calculate days since observation
          const eventDate = new Date(mostRecentEvent.event_time);
          const today = new Date();
          const daysSince = Math.floor((today.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysSince >= 7) {
            // Needs inspection (7+ days)
            plantsNeedingInspectionIds.push(plant.id);
            inspectionStatusMap.set(plant.id, { 
              status: daysSince >= 14 ? 'old' : 'recent', 
              days: daysSince 
            });
          }
        }
      });
      
      if (plantsNeedingInspectionIds.length === 0) {
        setInspectionPlants([]);
        return;
      }
      
      // Get plant details for plants needing inspection
      const inspectionUserPlants = userPlants.filter(p => plantsNeedingInspectionIds.includes(p.id));
      
      const inspectionPlantIds = Array.from(new Set(inspectionUserPlants
        .map((p: any) => p.plants_table_id)
        .filter((v: any) => v !== null && v !== undefined)));

      const rawPhotoVals = inspectionUserPlants
        .map((p: any) => p.default_plant_photo_id)
        .filter((v: any) => v !== null && v !== undefined);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const inspectionPhotoIds = Array.from(new Set(rawPhotoVals.filter((v: any) => typeof v === 'string' && uuidRegex.test(v))));
      const inspectionPhotoPaths = Array.from(new Set(rawPhotoVals.filter((v: any) => typeof v === 'string' && !uuidRegex.test(v))));

      let plantsById: Record<string, any> = {};
      if (inspectionPlantIds.length > 0) {
        const { data: plantRows, error: pErr } = await supabase
          .from('plants')
          .select('id, plant_name, plant_scientific_name')
          .in('id', inspectionPlantIds);
        if (pErr) throw pErr;
        plantsById = Object.fromEntries(
          (plantRows ?? []).map((p: any) => [String(p.id), p])
        );
      }

      let photoById: Record<string, string> = {};
      if (inspectionPhotoIds.length > 0) {
        const { data: photoRows, error: phErr } = await supabase
          .from('user_plant_photos')
          .select('id, bucket, object_path')
          .in('id', inspectionPhotoIds);
        if (phErr) throw phErr;

        for (const pr of photoRows ?? []) {
          try {
            const { data: signed, error: sErr } = await supabase.storage
              .from(pr.bucket || 'plant-photos')
              .createSignedUrl(pr.object_path, 60 * 60, {
                transform: { width: 512, quality: 80, resize: 'contain' },
              });
            if (!sErr && signed?.signedUrl) {
              photoById[String(pr.id)] = signed.signedUrl;
            }
          } catch {}
        }
      }

      let photoByPath: Record<string, string> = {};
      if (inspectionPhotoPaths.length > 0) {
        for (const pth of inspectionPhotoPaths) {
          try {
            const { data: signed, error: sErr } = await supabase.storage
              .from('plant-photos')
              .createSignedUrl(String(pth), 60 * 60, {
                transform: { width: 512, quality: 80, resize: 'contain' },
              });
            if (!sErr && signed?.signedUrl) {
              photoByPath[String(pth)] = signed.signedUrl;
            }
          } catch {}
        }
      }

      const mapped: InspectionPlant[] = inspectionUserPlants.map((row: any) => {
        const ref = plantsById[String(row.plants_table_id)] ?? {};
        const displayName = row.nickname || ref.plant_name || 'Unnamed Plant';
        const sci = ref.plant_scientific_name || '';
        let photo = '';
        if (row.default_plant_photo_id) {
          const key = String(row.default_plant_photo_id);
          photo = photoById[key] ?? photoByPath[key] ?? '';
        }
        
        const statusInfo = inspectionStatusMap.get(String(row.id))!;
        
        return {
          id: String(row.id),
          name: displayName,
          scientificName: sci,
          imageUri: photo,
          inspectionStatus: statusInfo.status,
          daysSinceObservation: statusInfo.days,
        };
      });

      setInspectionPlants(mapped);
      
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load plants needing inspection');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchInspectionPlants();
  }, [fetchInspectionPlants]);

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#E5F4EF', dark: '#12231F' }}
      headerImage={
        <Image
          source={require('../../assets/images/plants-header.jpg')}
          contentFit="cover"
          transition={200}
          style={styles.headerImage}
        />
      }>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity 
            onPress={() => (nav as any).goBack()}
            style={styles.backButton}
            activeOpacity={0.7}
          >
            <IconSymbol name="arrow.left" size={20} color={theme.colors.text} />
          </TouchableOpacity>
          <ThemedText type="title" style={styles.title}>Needs Inspection</ThemedText>
        </View>
        
        {loading ? (
          <View style={styles.loadingContainer}>
            <ThemedText>Loading plants...</ThemedText>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : inspectionPlants.length === 0 ? (
          <View style={styles.emptyContainer}>
            <IconSymbol name="checkmark.circle" size={48} color="#10b981" />
            <ThemedText style={styles.emptyText}>All plants are up to date!</ThemedText>
            <ThemedText style={styles.emptySubtext}>No plants need inspection</ThemedText>
          </View>
        ) : (
          <View style={styles.plantsList}>
            {inspectionPlants.map((plant) => (
              <InspectionPlantListItem
                key={plant.id}
                plant={plant}
                onPress={() => (nav as any).navigate('PlantDetail', { id: plant.id })}
              />
            ))}
          </View>
        )}
      </View>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    width: '100%',
    height: '100%',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  title: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    opacity: 0.7,
    marginTop: 4,
    textAlign: 'center',
  },
  plantsList: {
    gap: 12,
    paddingBottom: 20,
  },
  inspectionPlantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  plantImageContainer: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
  },
  plantImage: {
    width: '100%',
    height: '100%',
  },
  plantInfo: {
    flex: 1,
    gap: 4,
  },
  plantName: {
    fontSize: 16,
    fontWeight: '600',
  },
  plantScientific: {
    fontSize: 14,
    opacity: 0.7,
    fontStyle: 'italic',
  },
  warningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  warningText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
});

