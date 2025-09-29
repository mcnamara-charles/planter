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
import PlantGallery from '@/components/PlantGallery';
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

// Custom list item component for sick plants with warning labels
function SickPlantListItem({ 
  plant, 
  onPress 
}: { 
  plant: Plant & { problem?: string }; 
  onPress: () => void; 
}) {
  const { theme } = useTheme();
  
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.sickPlantItem, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}
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
        <View style={styles.warningContainer}>
          <IconSymbol name="exclamationmark.triangle" size={14} color="#ef4444" />
          <ThemedText style={styles.warningText} numberOfLines={1}>
            {plant.problem || 'Health issue detected'}
          </ThemedText>
        </View>
      </View>
      
      {/* Chevron */}
      <IconSymbol name="chevron.right" size={16} color={theme.colors.mutedText} />
    </TouchableOpacity>
  );
}

export default function SickPlantsScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const nav = useNavigation();
  const [sickPlants, setSickPlants] = useState<(Plant & { problem?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch plants that are currently sick
  const fetchSickPlants = useCallback(async () => {
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
        setSickPlants([]);
        return;
      }
      
      const userPlantIds = userPlants.map(p => p.id);
      
      // Get the most recent observe event for each plant
      const { data: recentObserveEvents, error: eventsError } = await supabase
        .from('user_plant_timeline_events')
        .select('user_plant_id, event_data')
        .eq('event_type', 'observe')
        .in('user_plant_id', userPlantIds)
        .order('event_time', { ascending: false });
      
      if (eventsError) throw eventsError;
      
      // Group by plant_id and get the most recent for each
      const mostRecentByPlant = new Map();
      recentObserveEvents?.forEach(event => {
        if (!mostRecentByPlant.has(event.user_plant_id)) {
          mostRecentByPlant.set(event.user_plant_id, event);
        }
      });
      
      // Filter to only sick plants and collect problem data
      const sickPlantIds: string[] = [];
      const plantProblems: Record<string, string> = {};
      mostRecentByPlant.forEach(event => {
        const healthData = event.event_data?.health;
        if (healthData && healthData.is_healthy === false) {
          sickPlantIds.push(event.user_plant_id);
          // Collect the problem description
          const problem = healthData.damage_desc || 'Health issue detected';
          plantProblems[event.user_plant_id] = problem;
        }
      });
      
      if (sickPlantIds.length === 0) {
        setSickPlants([]);
        return;
      }
      
      // Get plant details for sick plants only
      const sickUserPlants = userPlants.filter(p => sickPlantIds.includes(p.id));
      
      const sickPlantTableIds = Array.from(new Set(sickUserPlants
        .map((p: any) => p.plants_table_id)
        .filter((v: any) => v !== null && v !== undefined)));

      const rawPhotoVals = sickUserPlants
        .map((p: any) => p.default_plant_photo_id)
        .filter((v: any) => v !== null && v !== undefined);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const sickPhotoIds = Array.from(new Set(rawPhotoVals.filter((v: any) => typeof v === 'string' && uuidRegex.test(v))));
      const sickPhotoPaths = Array.from(new Set(rawPhotoVals.filter((v: any) => typeof v === 'string' && !uuidRegex.test(v))));

      let plantsById: Record<string, any> = {};
      if (sickPlantTableIds.length > 0) {
        const { data: plantRows, error: pErr } = await supabase
          .from('plants')
          .select('id, plant_name, plant_scientific_name')
          .in('id', sickPlantTableIds);
        if (pErr) throw pErr;
        plantsById = Object.fromEntries(
          (plantRows ?? []).map((p: any) => [String(p.id), p])
        );
      }

      let photoById: Record<string, string> = {};
      if (sickPhotoIds.length > 0) {
        const { data: photoRows, error: phErr } = await supabase
          .from('user_plant_photos')
          .select('id, bucket, object_path')
          .in('id', sickPhotoIds);
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
      if (sickPhotoPaths.length > 0) {
        for (const pth of sickPhotoPaths) {
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

      const mapped: (Plant & { problem?: string })[] = sickUserPlants.map((row: any) => {
        const ref = plantsById[String(row.plants_table_id)] ?? {};
        const displayName = row.nickname || ref.plant_name || 'Unnamed Plant';
        const sci = ref.plant_scientific_name || '';
        let photo = '';
        if (row.default_plant_photo_id) {
          const key = String(row.default_plant_photo_id);
          photo = photoById[key] ?? photoByPath[key] ?? '';
        }
        return {
          id: String(row.id),
          name: displayName,
          scientificName: sci,
          imageUri: photo,
          problem: plantProblems[String(row.id)] || 'Health issue detected',
        };
      });

      setSickPlants(mapped);
      
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load sick plants');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchSickPlants();
  }, [fetchSickPlants]);

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
          <ThemedText type="title" style={styles.title}>Sick Plants</ThemedText>
        </View>
        
        {loading ? (
          <View style={styles.loadingContainer}>
            <ThemedText>Loading sick plants...</ThemedText>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : sickPlants.length === 0 ? (
          <View style={styles.emptyContainer}>
            <IconSymbol name="exclamationmark.triangle" size={48} color={theme.colors.mutedText} />
            <ThemedText style={styles.emptyText}>No sick plants found</ThemedText>
            <ThemedText style={styles.emptySubtext}>All your plants are healthy!</ThemedText>
          </View>
        ) : (
          <View style={styles.plantsList}>
            {sickPlants.map((plant) => (
              <SickPlantListItem
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
  sickPlantItem: {
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
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  warningText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '500',
    flex: 1,
  },
});
