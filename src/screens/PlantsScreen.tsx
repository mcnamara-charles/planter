import { Image } from 'expo-image';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
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
import MoveModal from '@/components/MoveModal';
import UpdateLightModal from '@/components/UpdateLightModal';
import UpdateTypeModal from '@/components/UpdateTypeModal';
import { usePlantImageCache } from '@/context/PlantImageCacheContext';
import PestIdModal from '@/components/PestIdModal';
import PestTreatModal from '@/components/PestTreatModal';

// Module-level variable to persist plant ID across component remounts
let lastSelectedPlantId: string | null = null;

type JoinedPhotoRow = { id: string; bucket: string; object_path: string };

// The row shape we expect from the joined query
type UserPlantJoined = {
  id: string;
  plants_table_id: string | null;
  nickname: string | null;
  acquired_at: string | null;
  acquired_from: string | null;
  location_id: string | null;
  default_plant_photo_id: string | null;
  updated_at: string | null;
  plants: {
    id: string;
    plant_name: string | null;
    plant_scientific_name: string | null;
    genus: string | null;
  } | null;
  location: {
    id: string;
    name: string;
  } | null;
  // Supabase returns arrays for joined relations unless it can guarantee 1:1
  photo: JoinedPhotoRow[] | null;
};

export default function PlantsScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const nav = useNavigation();
  const { getCachedImage } = usePlantImageCache();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // ⬅️ for pull-to-refresh
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<'none' | 'location' | 'genus'>('location');
  const [selectedPlantIds, setSelectedPlantIds] = useState<string[]>([]);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [lightModalOpen, setLightModalOpen] = useState(false);
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [pestIdModalOpen, setPestIdModalOpen] = useState(false);
  const [pestTreatModalOpen, setPestTreatModalOpen] = useState(false);
  const [clearSelectionTrigger, setClearSelectionTrigger] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const lastSelectedPlantIdRef = useRef<string | null>(null);
  const [viewportBounds, setViewportBounds] = useState({ top: 0, bottom: 0 });
  
  // Sync module-level variable with ref on mount
  useEffect(() => {
    if (lastSelectedPlantId) {
      lastSelectedPlantIdRef.current = lastSelectedPlantId;
    }
  }, []);
  


  const fetchPlants = useCallback(async (isRefresh = false) => {
    if (!user?.id) {
      return;
    }
    // Show skeletons only if first load; pull-to-refresh uses its own spinner
    const firstLoad = !isRefresh && plantsLengthRef.current === 0;
    if (firstLoad) setLoading(true);
    if (isRefresh) setRefreshing(true);
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
          location_id,
          default_plant_photo_id,
          lineage,
          light_type,
          system_type,
          water_delay,
          updated_at,
          plants:plants_table_id (
            id,
            plant_name,
            plant_scientific_name,
            genus,
            schedule_same_year_round
          ),
          location:location_id (
            id,
            name
          ),
          photo:user_plant_photos!user_plants_default_plant_photo_id_fkey (
            id,
            bucket,
            object_path
          )
        `)
        .eq('owner_id', user.id)
        .is('deceased_at', null); // Exclude deceased plants

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

      // Fetch active pest_id events for all plants
      const plantIds = rows.map((r) => String(r.id));
      const { data: pestEvents } = await supabase
        .from('user_plant_timeline_events')
        .select('user_plant_id, event_data')
        .in('user_plant_id', plantIds)
        .eq('event_type', 'pest_id')
        .order('event_time', { ascending: false });

      // Create a set of plant IDs with active pest events
      const plantsWithActivePest = new Set<string>();
      if (pestEvents) {
        for (const event of pestEvents) {
          const eventData = event.event_data as any;
          if (eventData?.status === 'active' && !plantsWithActivePest.has(event.user_plant_id)) {
            plantsWithActivePest.add(event.user_plant_id);
          }
        }
      }

      // Map to UI model with cached images
      const mappedPromises = rows.map(async (row) => {
        const ref = row.plants ?? ({} as UserPlantJoined['plants']);
        const displayName = row.nickname || ref?.plant_name || 'Unnamed Plant';
        const sci = ref?.plant_scientific_name || '';

        // Generate URI function for cache
        const generateImageUri = async (): Promise<string> => {
          const pr = row.photo?.[0];
          if (pr?.object_path) {
            return signedMap.get(`${pr.bucket || 'plant-photos'}|${pr.object_path}`) || '';
          } else if (row.default_plant_photo_id && typeof row.default_plant_photo_id === 'string') {
            if (uuidRe.test(row.default_plant_photo_id)) {
              // Use the fetched row
              const fetched = fetchedPhotoRows[row.default_plant_photo_id];
              if (fetched?.object_path) {
                return signedMap.get(`${fetched.bucket}|${fetched.object_path}`) || '';
              }
            } else {
              // Legacy path
              return signedMap.get(`plant-photos|${row.default_plant_photo_id}`) || '';
            }
          }
          return '';
        };

        // Use cache to get image URI
        const imageUri = await getCachedImage(
          String(row.id),
          row.updated_at || null,
          generateImageUri
        );

        return {
          id: String(row.id),
          name: displayName,
          scientificName: sci,
          imageUri,
          location: row.location?.name,
          genus: ref?.genus || undefined,
          lineage: (row as any).lineage || undefined,
          lightType: (row as any).light_type || undefined,
          systemType: (row as any).system_type || undefined,
          scheduleSameYearRound: (ref as any)?.schedule_same_year_round ?? undefined,
          waterDelay: (row as any).water_delay ?? undefined,
          hasActivePest: plantsWithActivePest.has(String(row.id)),
        };
      });

      const mapped = await Promise.all(mappedPromises);

      setPlants(mapped);
    } catch (e: any) {
      console.error('[PlantsScreen] fetchPlants ERROR', e);
      setError(e?.message ?? 'Failed to load plants');
    } finally {
      setLoading(false);
      setRefreshing(false); // ensure we end pull-to-refresh if active
    }
  }, [user?.id, search, getCachedImage]); // Added getCachedImage dependency
  
  // Use ref to access current plants.length without adding to dependencies
  const plantsLengthRef = useRef(0);
  useEffect(() => {
    plantsLengthRef.current = plants.length;
  }, [plants.length]);
  
  useEffect(() => {
    if (user?.id) {
      fetchPlants(false);
    }
  }, [user?.id, fetchPlants]);

  // Debounce search updates
  useEffect(() => {
    if (!user?.id) return;
    const t = setTimeout(() => {
      fetchPlants(false);
    }, 250);
    return () => {
      clearTimeout(t);
    };
  }, [search, fetchPlants, user?.id]);

  // Store plants in ref to avoid dependency issues
  const plantsRef = useRef<Plant[]>([]);
  useEffect(() => {
    plantsRef.current = plants;
  }, [plants]);

  // Scroll to plant when plants load and we have a selected plant ID
  useEffect(() => {
    if (lastSelectedPlantIdRef.current && plants.length > 0 && !loading && !refreshing) {
      const plantId = lastSelectedPlantIdRef.current;
      const plant = plants.find(p => p.id === plantId);
      
      if (plant && scrollViewRef.current) {
        // Calculate position accounting for grouping
        // This matches how PlantGallery renders: groups with headers, then items
        const getGroupKey = (p: Plant): string => {
          switch (groupBy) {
            case 'location':
              return p.location || 'No Location';
            case 'genus':
              return p.genus || 'Unknown Genus';
            default:
              return '';
          }
        };

        // Build grouped structure (same as PlantGallery)
        const groups: Record<string, Plant[]> = {};
        for (const p of plants) {
          const key = getGroupKey(p);
          if (!groups[key]) {
            groups[key] = [];
          }
          groups[key].push(p);
        }

        // Sort groups (same logic as PlantGallery)
        const fallbackKeys = ['No Location', 'Unknown Genus'];
        const sortedKeys = Object.keys(groups)
          .filter(k => !fallbackKeys.includes(k))
          .sort()
          .concat(fallbackKeys.filter(k => groups[k]));

        // Calculate scroll position
        // For small grid: cards are ~30% width, aspectRatio 1 image + text = ~140-150px total height
        // Account for row spacing and margins
        let scrollY = 80; // Title height (title container + padding)
        let found = false;
        
        // Estimate item height based on grid size
        // Small grid: ~140px per card (image ~100px + text ~40px), but cards are in rows of 3
        // So we need to account for row height, not individual card height
        const itemsPerRow = 3; // Small grid has 3 columns
        const rowHeight = 160; // Approximate height per row (card + spacing)
        
        for (const groupKey of sortedKeys) {
          const groupPlants = groups[groupKey];
          if (groupKey) {
            scrollY += 38; // Group header height
          }
          
          // Process plants in rows
          for (let i = 0; i < groupPlants.length; i += itemsPerRow) {
            const rowPlants = groupPlants.slice(i, i + itemsPerRow);
            const plantInRow = rowPlants.find(p => p.id === plantId);
            
            if (plantInRow) {
              found = true;
              break;
            }
            
            // Add row height for each complete row
            scrollY += rowHeight;
          }
          
          if (found) break;
        }

        // Wait for layout to complete, then scroll
        const scrollTimeout = setTimeout(() => {
          if (scrollViewRef.current) {
            // Adjust scroll position to position the plant near the top of visible area
            // Reduced padding to scroll further down
            const adjustedScrollY = Math.max(0, scrollY - 120); // Reduced padding from 200 to 120
            scrollViewRef.current.scrollTo({ y: adjustedScrollY, animated: true });
          }
          lastSelectedPlantIdRef.current = null; // Clear after scrolling
          lastSelectedPlantId = null; // Clear module-level variable
        }, 1200); // Increased delay to ensure layout is complete
        return () => {
          clearTimeout(scrollTimeout);
        };
      } else if (!plant) {
        lastSelectedPlantIdRef.current = null;
      }
    }
  }, [plants, loading, refreshing, groupBy]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        fetchPlants(false);
      }

      return () => {
        // Clear selection when screen loses focus
        setSelectedPlantIds([]);
        setClearSelectionTrigger(prev => prev + 1);
        // DON'T clear lastSelectedPlantIdRef here - we need it for scrolling when we return
      };
    }, [fetchPlants, user?.id])
  );

  // Pull-to-refresh handler
  const onRefresh = useCallback(() => {
    fetchPlants(true); // Pass isRefresh flag
  }, [fetchPlants]);
  const selectionMode = selectedPlantIds.length > 0;
  const selectionCount = selectedPlantIds.length;

  const clearSelection = useCallback(() => {
    setSelectedPlantIds([]);
    setClearSelectionTrigger(prev => prev + 1); // Trigger PlantGallery to clear selection
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {/* Selection Toolbar - sticky at top */}
      {selectionMode && (
        <View
          style={[
            styles.selectionToolbar,
            { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
          ]}
        >
          <View>
            <ThemedText style={styles.selectionToolbarText}>
              {selectionCount} selected
            </ThemedText>
            <Pressable onPress={clearSelection} hitSlop={12}>
              <ThemedText style={styles.selectionToolbarClear}>Clear</ThemedText>
            </Pressable>
          </View>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            style={styles.selectionToolbarActionsScroll}
            contentContainerStyle={styles.selectionToolbarActions}
          >
            <Pressable
              style={styles.selectionToolbarButton}
              onPress={() => {
                if (selectedPlantIds.length > 0) {
                  setTypeModalOpen(true);
                }
              }}
              disabled={selectedPlantIds.length === 0}
            >
              <IconSymbol name="tag" size={20} color={theme.colors.text} />
              <ThemedText style={styles.selectionToolbarButtonLabel}>Type</ThemedText>
            </Pressable>
            <Pressable
              style={styles.selectionToolbarButton}
              onPress={() => {
                if (selectedPlantIds.length > 0) {
                  setLightModalOpen(true);
                }
              }}
              disabled={selectedPlantIds.length === 0}
            >
              <IconSymbol name="sun.max" size={20} color={theme.colors.text} />
              <ThemedText style={styles.selectionToolbarButtonLabel}>Light</ThemedText>
            </Pressable>
            <Pressable
              style={styles.selectionToolbarButton}
              onPress={() => {
                if (selectedPlantIds.length > 0) {
                  setMoveModalOpen(true);
                }
              }}
              disabled={selectedPlantIds.length === 0}
            >
              <IconSymbol name="arrow.right" size={20} color={theme.colors.text} />
              <ThemedText style={styles.selectionToolbarButtonLabel}>Move</ThemedText>
            </Pressable>
            <Pressable
              style={styles.selectionToolbarButton}
              onPress={() => setMoreMenuOpen(true)}
              disabled={selectedPlantIds.length === 0}
            >
              <IconSymbol name="ellipsis" size={20} color={theme.colors.text} />
              <ThemedText style={styles.selectionToolbarButtonLabel}>More</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      )}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onScroll={(event) => {
          const { contentOffset, layoutMeasurement } = event.nativeEvent;
          const top = contentOffset.y;
          const bottom = top + layoutMeasurement.height;
          setViewportBounds({ top, bottom });
        }}
        scrollEventThrottle={100}
      >
        {/* Title */}
        <View style={styles.titleContainer}>
          <ThemedText style={styles.title}>
            My Plants{' '}
            <ThemedText style={styles.plantCount}>({plants.length})</ThemedText>
          </ThemedText>
        </View>
        
        <PlantGallery
          plants={plants}
          loading={loading}
          error={error}
          refreshing={refreshing}     // used by parent scroll view already
          onRefresh={onRefresh}        // ditto (kept for API symmetry)

          // show/hide controls
          enableSearch={true}
          enableViewToggle={true}

          // default layout: 'gridsmall' | 'gridmed' | 'list'
          defaultLayout="gridsmall"

          // search wired to your server-side filtering
          searchValue={search}
          onSearchChange={setSearch}

          // group by functionality
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          defaultGroupBy="location"

          // navigate on item press
          onItemPress={(p) => {
            lastSelectedPlantIdRef.current = p.id;
            lastSelectedPlantId = p.id; // Store in module-level variable
            (nav as any).navigate('PlantDetail', { id: p.id });
          }}
          
          // selection
          onSelectionChange={setSelectedPlantIds}
          clearSelectionTrigger={clearSelectionTrigger}
          
          // viewport for image rendering
          viewportBounds={viewportBounds}
        />
      </ScrollView>

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

      <MoveModal
        open={moveModalOpen}
        userPlantIds={selectedPlantIds}
        onClose={() => setMoveModalOpen(false)}
        onSaved={() => {
          setMoveModalOpen(false);
          setSelectedPlantIds([]);
          setClearSelectionTrigger(prev => prev + 1); // Trigger PlantGallery to clear selection
          fetchPlants(false);
        }}
      />
      <UpdateLightModal
        open={lightModalOpen}
        userPlantIds={selectedPlantIds}
        onClose={() => setLightModalOpen(false)}
        onSaved={() => {
          setLightModalOpen(false);
          setSelectedPlantIds([]);
          setClearSelectionTrigger(prev => prev + 1); // Trigger PlantGallery to clear selection
          fetchPlants(false);
        }}
      />
      <UpdateTypeModal
        open={typeModalOpen}
        userPlantIds={selectedPlantIds}
        onClose={() => setTypeModalOpen(false)}
        onSaved={() => {
          setTypeModalOpen(false);
          setSelectedPlantIds([]);
          setClearSelectionTrigger(prev => prev + 1); // Trigger PlantGallery to clear selection
          fetchPlants(false);
        }}
      />
      {moreMenuOpen && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMoreMenuOpen(false)} />
          <View style={[styles.moreMenu, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <TouchableOpacity
              style={styles.moreMenuItem}
              onPress={() => {
                setMoreMenuOpen(false);
                setPestIdModalOpen(true);
              }}
            >
              <IconSymbol name="pest" size={18} color={theme.colors.text} />
              <ThemedText style={{ marginLeft: 8, fontWeight: '700' }}>Pest ID</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreMenuItem}
              onPress={() => {
                setMoreMenuOpen(false);
                setPestTreatModalOpen(true);
              }}
            >
              <IconSymbol name="pest" size={18} color={theme.colors.text} />
              <ThemedText style={{ marginLeft: 8, fontWeight: '700' }}>Treat Plant</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <PestIdModal
        open={pestIdModalOpen}
        onClose={() => setPestIdModalOpen(false)}
        userPlantIds={selectedPlantIds}
        onSaved={() => {
          setPestIdModalOpen(false);
          setSelectedPlantIds([]);
          setClearSelectionTrigger((v) => v + 1);
        }}
      />
      <PestTreatModal
        open={pestTreatModalOpen}
        onClose={() => setPestTreatModalOpen(false)}
        userPlantIds={selectedPlantIds}
        onSaved={() => {
          setPestTreatModalOpen(false);
          setSelectedPlantIds([]);
          setClearSelectionTrigger((v) => v + 1);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingLeft: 26, // Reduced by 5px from 31
    paddingRight: 26, // 16 (existing) + 10 (additional) = 26px total right padding
  },
  plantCount: {
    fontSize: 18, // Smaller than title (which is 32)
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#3B82F6', // Blue color
  },
  titleContainer: {
    paddingLeft: 0, // Reduced from 26
    paddingRight: 26,
    paddingTop: 20,
    paddingBottom: 24, // Increased from 16
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
  selectionToolbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 1000,
    elevation: 10,
  },
  selectionToolbarText: {
    fontSize: 14,
    fontWeight: '700',
  },
  selectionToolbarClear: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3B82F6',
    marginTop: 4,
  },
  selectionToolbarActionsScroll: {
    flex: 1,
  },
  selectionToolbarActions: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 8,
  },
  selectionToolbarButton: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 0,
    width: 70,
  },
  selectionToolbarButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.8,
    textAlign: 'center',
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
  moreMenu: {
    position: 'absolute',
    top: 90,
    right: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 6,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  moreMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
  },
  overlayCloseBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
