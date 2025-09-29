import { Image } from 'expo-image';
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, TouchableOpacity, RefreshControl, TextInput } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import FavoritePlantCard from '@/components/favorite-plant-card';
import { supabase } from '@/services/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { type Plant } from '@/types/plant';
import { useTheme } from '@/context/themeContext';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import SkeletonTile from '@/components/SkeletonTile'; // ⬅️ NEW
import { IconSymbol } from '@/components/ui/icon-symbol';
import PlantGallery from '@/components/PlantGallery';

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

export default function PlantsScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const nav = useNavigation();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // ⬅️ for pull-to-refresh
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [gridSize, setGridSize] = useState<'small' | 'medium'>('medium');
  const [sizeDropdownOpen, setSizeDropdownOpen] = useState(false);

  const getCardContainerStyle = () => {
    switch (gridSize) {
      case 'small':
        return { width: '30%' as const }; // 3 columns
      case 'medium':
        return { width: '47%' as const }; // 2 columns
      default:
        return { width: '47%' as const };
    }
  };

  const fetchPlants = useCallback(async () => {
    if (!user?.id) return;
    // Show skeletons only if first load; pull-to-refresh uses its own spinner
    const firstLoad = plants.length === 0 && !refreshing;
    if (firstLoad) setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('user_plants')
        .select(`
          id,
          plants_table_id,
          nickname,
          acquired_at,
          acquired_from,
          location,
          default_plant_photo_id,
          plants:plants_table_id (
            id,
            plant_name,
            plant_scientific_name
          ),
          photo:user_plant_photos!user_plants_default_plant_photo_id_fkey (
            id,
            bucket,
            object_path
          )
        `)
        .eq('owner_id', user.id);

      const q = search.trim();
      if (q.length > 0) {
        const term = `%${q}%`;
        // Root filter for nickname
        query = query.or(`nickname.ilike.${term}`);
        // Nested filters for plants table (common/scientific)
        // @ts-ignore supabase-js foreignTable option
        query = query.or(`plant_name.ilike.${term},plant_scientific_name.ilike.${term}`, { foreignTable: 'plants' });
      }

      const { data, error } = await query;

      if (error) throw error;
      const rows = (data ?? []) as unknown as UserPlantJoined[];

      // Sort alphabetically by species scientific name (plants.plant_scientific_name)
      rows.sort((a, b) => {
        const an = (a.plants?.plant_scientific_name || '').toLowerCase();
        const bn = (b.plants?.plant_scientific_name || '').toLowerCase();
        if (an < bn) return -1;
        if (an > bn) return 1;
        return 0;
      });

      // Collect signing work
      type PhotoToSign = { bucket: string; path: string };
      const toSign: PhotoToSign[] = [];
      const legacyPaths: string[] = [];

      // capture “missing” photo IDs (UUIDs) when the join didn’t return a row
      const missingPhotoIds: string[] = [];
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      for (const row of rows) {
        const pr = row.photo?.[0];
        if (pr?.object_path) {
          toSign.push({ bucket: pr.bucket || 'plant-photos', path: pr.object_path });
        } else if (row.default_plant_photo_id && typeof row.default_plant_photo_id === 'string') {
          if (uuidRe.test(row.default_plant_photo_id)) {
            missingPhotoIds.push(row.default_plant_photo_id);
          } else {
            legacyPaths.push(row.default_plant_photo_id);
          }
        }
      }

      // fetch any missing user_plant_photos by ID (when join didn’t hit)
      let fetchedPhotoRows: Record<string, { bucket: string; object_path: string }> = {};
      if (missingPhotoIds.length > 0) {
        const { data: photoRows, error: phErr } = await supabase
          .from('user_plant_photos')
          .select('id, bucket, object_path')
          .in('id', Array.from(new Set(missingPhotoIds)));
        if (phErr) throw phErr;
        for (const r of photoRows ?? []) {
          fetchedPhotoRows[String(r.id)] = {
            bucket: r.bucket || 'plant-photos',
            object_path: r.object_path,
          };
        }
        // Add those to the signing list
        for (const id of missingPhotoIds) {
          const row = fetchedPhotoRows[id];
          if (row?.object_path) {
            toSign.push({ bucket: row.bucket, path: row.object_path });
          }
        }
      }

      // Sign everything we gathered
      const signedMap = new Map<string, string>(); // `${bucket}|${path}` -> signedUrl

      // Group by bucket for batch signing
      const byBucket = toSign.reduce<Record<string, string[]>>((acc, p) => {
        (acc[p.bucket] ||= []).push(p.path);
        return acc;
      }, {});

      await Promise.all(
        Object.entries(byBucket).map(async ([bucket, paths]) => {
          const { data: signed, error } = await supabase.storage
            .from(bucket)
            .createSignedUrls(paths, 60 * 60);
          if (!error && signed) {
            signed.forEach((s, i) => {
              if (s?.signedUrl) signedMap.set(`${bucket}|${paths[i]}`, s.signedUrl);
            });
          }
        })
      );

      if (legacyPaths.length > 0) {
        const { data: signed, error } = await supabase.storage
          .from('plant-photos')
          .createSignedUrls(legacyPaths, 60 * 60);
        if (!error && signed) {
          signed.forEach((s, i) => {
            if (s?.signedUrl) signedMap.set(`plant-photos|${legacyPaths[i]}`, s.signedUrl);
          });
        }
      }

      // Map to UI model
      const mapped: Plant[] = rows.map((row) => {
        const ref = row.plants ?? ({} as UserPlantJoined['plants']);
        const displayName = row.nickname || ref?.plant_name || 'Unnamed Plant';
        const sci = ref?.plant_scientific_name || '';

        let imageUri = '';
        const pr = row.photo?.[0];
        if (pr?.object_path) {
          imageUri = signedMap.get(`${pr.bucket || 'plant-photos'}|${pr.object_path}`) || '';
        } else if (row.default_plant_photo_id && typeof row.default_plant_photo_id === 'string') {
          if (uuidRe.test(row.default_plant_photo_id)) {
            // Use the fetched row
            const fetched = fetchedPhotoRows[row.default_plant_photo_id];
            if (fetched?.object_path) {
              imageUri =
                signedMap.get(`${fetched.bucket}|${fetched.object_path}`) || '';
            }
          } else {
            // Legacy path
            imageUri = signedMap.get(`plant-photos|${row.default_plant_photo_id}`) || '';
          }
        }

        return {
          id: String(row.id),
          name: displayName,
          scientificName: sci,
          imageUri,
        };
      });

      setPlants(mapped);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load plants');
    } finally {
      setLoading(false);
      setRefreshing(false); // ensure we end pull-to-refresh if active
    }
  }, [user?.id, refreshing, plants.length, search]);

  useEffect(() => {
    fetchPlants();
  }, [user?.id, fetchPlants]);

  // Debounce search updates
  useEffect(() => {
    const t = setTimeout(() => {
      fetchPlants();
    }, 250);
    return () => clearTimeout(t);
  }, [search, fetchPlants]);

  useFocusEffect(
    useCallback(() => {
      fetchPlants();
      return () => {};
    }, [user?.id, fetchPlants])
  );

  // Pull-to-refresh handler
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // fetchPlants will setRefreshing(false) in finally
    fetchPlants();
  }, [fetchPlants]);

  return (
    <View style={{ flex: 1 }}>
      <ParallaxScrollView
        headerBackgroundColor={{ light: '#E5F4EF', dark: '#12231F' }}
        headerImage={
          <Image
            source={require('../../assets/images/plants-header.jpg')}
            contentFit="cover"
            transition={200}
            style={styles.headerImage}
          />
        }
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <PlantGallery
          title="Plants"
          plants={plants}
          loading={loading}
          error={error}
          refreshing={refreshing}     // used by parent scroll view already
          onRefresh={onRefresh}        // ditto (kept for API symmetry)

          // show/hide controls
          enableSearch={true}
          enableViewToggle={true}

          // default layout: 'gridsmall' | 'gridmed' | 'list'
          defaultLayout="gridmed"

          // search wired to your server-side filtering
          searchValue={search}
          onSearchChange={setSearch}

          // navigate on item press
          onItemPress={(p) => (nav as any).navigate('PlantDetail', { id: p.id })}
        />
      </ParallaxScrollView>

      <TouchableOpacity
        onPress={() => (nav as any).navigate('AddPlant')}
        accessibilityRole="button"
        accessibilityLabel="Add a new plant"
        style={[
          styles.fab,
          {
            backgroundColor: theme.colors.primary,
            borderColor: theme.colors.card,
          },
        ]}
      >
        <View style={styles.fabInner}>
          <ThemedText style={styles.fabPlus}>+</ThemedText>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewToggle: {
    flexDirection: 'row',
    gap: 4,
  },
  toggleButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    minWidth: 36,
    height: 36,
    justifyContent: 'center',
  },
  sizeLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  sizeDropdown: {
    position: 'absolute',
    top: 60,
    right: 16,
    zIndex: 100,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 120,
    overflow: 'hidden',
  },
  sizeDropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sizeDropdownText: {
    fontSize: 14,
    fontWeight: '500',
  },
  grid: {
    paddingTop: 4,
    paddingBottom: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  list: {
    paddingTop: 4,
    paddingBottom: 16,
    gap: 8,
  },
  searchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cardContainer: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  listItemContainer: {
    width: '100%',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.1)',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  listItemImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  listItemContent: {
    flex: 1,
    marginLeft: 12,
  },
  listItemName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  listItemScientific: {
    fontSize: 14,
    opacity: 0.7,
    fontStyle: 'italic',
  },
  listItemSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  headerImage: {
    width: '100%',
    height: '100%',
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  fabInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPlus: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '700',
  },
});
