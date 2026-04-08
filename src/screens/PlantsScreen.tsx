import { Image } from 'expo-image';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
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
import PlantDetailScreen from './PlantDetailScreen';
import MoveModal from '@/components/MoveModal';
import UpdateLightModal from '@/components/UpdateLightModal';
import UpdateTypeModal from '@/components/UpdateTypeModal';
import { usePlantImageCache } from '@/context/PlantImageCacheContext';
import PestIdModal from '@/components/PestIdModal';
import PestTreatModal from '@/components/PestTreatModal';

// Module-level variable to persist plant ID across component remounts
let lastSelectedPlantId: string | null = null;

type JoinedPhotoRow = { id: string; bucket: string; object_path: string };

// The row shape we expect from the joined query (Supabase join)
type UserPlantJoined = {
  id: string;
  plants_table_id: string | null;
  nickname: string | null;
  acquired_at: string | null;
  acquired_from: string | null;
  location_id: string | null;
  default_plant_photo_id: string | null;
  deceased_at: string | null;
  sold_at: string | null;
  updated_at: string | null;
  plants: {
    id: string;
    plant_name: string | null;
    plant_scientific_name: string | null;
    genus: string | null;
    schedule?: {
      schedule_same_year_round: boolean | null;
    } | null;
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
  const { getCachedImage, clearCache, invalidatePlant } = usePlantImageCache();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // ⬅️ for pull-to-refresh
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<'none' | 'location' | 'genus' | 'status'>('location');
  const [selectedPlantIds, setSelectedPlantIds] = useState<string[]>([]);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [lightModalOpen, setLightModalOpen] = useState(false);
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [pestIdModalOpen, setPestIdModalOpen] = useState(false);
  const [pestTreatModalOpen, setPestTreatModalOpen] = useState(false);
  const [clearSelectionTrigger, setClearSelectionTrigger] = useState(0);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [viewedPlantUpdatedAt, setViewedPlantUpdatedAt] = useState<string | null>(null);
  const lastSelectedPlantIdRef = useRef<string | null>(null);
  const fetchPlantsRef = useRef<((isRefresh?: boolean) => Promise<void>) | null>(null);
  const isFetchingRef = useRef(false);
  const hasInitiallyFetchedRef = useRef(false);
  const scrollPositionRef = useRef<{ getScrollOffset: () => number; scrollToOffset: (offset: number) => void } | null>(null);
  const savedScrollOffsetRef = useRef<number>(0);
  
  // Sync module-level variable with ref on mount
  useEffect(() => {
    if (lastSelectedPlantId) {
      lastSelectedPlantIdRef.current = lastSelectedPlantId;
    }
  }, []);
  


  const fetchPlants = useCallback(async (isRefresh = false) => {
    console.log(`[PlantsScreen] fetchPlants called with isRefresh: ${isRefresh}`);
    
    // Guard against duplicate calls
    if (isFetchingRef.current) {
      console.log(`[PlantsScreen] fetchPlants already in progress, skipping`);
      return;
    }
    
    if (!user?.id) {
      return;
    }
    
    isFetchingRef.current = true;
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
          deceased_at,
          sold_at,
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
            schedule:plants_schedule (
              schedule_same_year_round
            ),
            species_taxon_id
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
        .eq('owner_id', user.id);

      // Default behavior: hide deceased/sold plants. When grouping by status, include them so they can be shown separately.
      if (groupBy !== 'status') {
        query = query
          .is('deceased_at', null) // Exclude deceased plants
          .is('sold_at', null); // Exclude sold plants
      }

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

      // Asynchronously populate missing genus values (non-blocking - runs in background)
      // This way the UI loads immediately and genus gets populated in the background
      const plantsNeedingGenus = rows.filter(row => {
        const ref = row.plants;
        return ref && !ref.genus && ref.plant_scientific_name;
      });

      if (plantsNeedingGenus.length > 0) {
        // Run this in the background - don't await it, so UI loads immediately
        (async () => {
          try {
            // Helper to extract first word from scientific name as fallback genus
            const extractGenusFromScientificName = (scientificName: string): string | null => {
              if (!scientificName) return null;
              const trimmed = scientificName.trim();
              const firstWord = trimmed.split(/\s+/)[0];
              return firstWord || null;
            };

            // Get unique species_taxon_ids to reduce queries
            const plantTaxonMap = new Map<string, { plantIds: string[]; scientificName: string }>(); // taxonId -> { plantIds, scientificName }
            const plantsWithoutTaxon: { plantId: string; scientificName: string }[] = [];
            
            for (const row of plantsNeedingGenus) {
              const ref = row.plants as any;
              const speciesTaxonId = ref?.species_taxon_id;
              const plantId = ref?.id;
              const scientificName = ref?.plant_scientific_name || '';
              
              if (plantId && scientificName) {
                if (speciesTaxonId) {
                  if (!plantTaxonMap.has(speciesTaxonId)) {
                    plantTaxonMap.set(speciesTaxonId, { plantIds: [], scientificName });
                  }
                  plantTaxonMap.get(speciesTaxonId)!.plantIds.push(plantId);
                } else {
                  // No taxon ID - will use scientific name fallback
                  plantsWithoutTaxon.push({ plantId, scientificName });
                }
              }
            }

            // Fetch genera for all unique taxon IDs using parallel queries (one per taxon)
            const genusPromises = Array.from(plantTaxonMap.keys()).map(async (taxonId) => {
              try {
                let currentTaxonId: string | null = taxonId;
                let depth = 0;
                const maxDepth = 15;
                
                type TaxonRow = { id: string; name: string; type: string | null; parent_id: string | null };
                while (currentTaxonId && depth < maxDepth) {
                  const response: { data: TaxonRow | null; error: any } = await supabase
                    .from('taxa')
                    .select('id, name, type, parent_id')
                    .eq('id', currentTaxonId)
                    .maybeSingle();
                  
                  if (response.error || !response.data) break;
                  
                  const taxonData = response.data;
                  if (taxonData.type?.toLowerCase() === 'genus') {
                    return { taxonId, genus: taxonData.name };
                  }
                  
                  currentTaxonId = taxonData.parent_id;
                  depth++;
                }
              } catch (err) {
                console.error('[PlantsScreen] Error fetching genus for taxon:', taxonId, err);
              }
              return null;
            });

            const results = await Promise.all(genusPromises);
            
            // Build updates list
            const genusUpdates: { plantId: string; genus: string }[] = [];
            const plantsWithGenusFromTaxonomy = new Set<string>();
            
            // Add genus from taxonomy lookup results
            for (const result of results) {
              if (result?.genus) {
                const plantData = plantTaxonMap.get(result.taxonId);
                if (plantData) {
                  for (const plantId of plantData.plantIds) {
                    genusUpdates.push({ plantId, genus: result.genus });
                    plantsWithGenusFromTaxonomy.add(plantId);
                  }
                }
              }
            }
            
            // For plants where taxonomy lookup failed or no taxon ID, use scientific name fallback
            for (const row of plantsNeedingGenus) {
              const ref = row.plants as any;
              const plantId = ref?.id;
              const scientificName = ref?.plant_scientific_name || '';
              
              // Skip if we already got genus from taxonomy lookup
              if (plantsWithGenusFromTaxonomy.has(plantId)) continue;
              
              // Use scientific name fallback: extract first word
              const genusFromName = extractGenusFromScientificName(scientificName);
              if (genusFromName) {
                genusUpdates.push({ plantId, genus: genusFromName });
              }
            }

            // Batch update plants in groups (Supabase handles batching better this way)
            if (genusUpdates.length > 0) {
              const updateBatchSize = 50;
              for (let i = 0; i < genusUpdates.length; i += updateBatchSize) {
                const batch = genusUpdates.slice(i, i + updateBatchSize);
                const updatePromises = batch.map(({ plantId, genus }) =>
                  supabase
                    .from('plants_core')
                    .update({ genus })
                    .eq('id', plantId)
                );
                
                const updateResults = await Promise.all(updatePromises);
                const errors = updateResults.filter(r => r.error);
                if (errors.length > 0) {
                  console.error('[PlantsScreen] Some genus updates failed:', errors.length);
                  errors.forEach((err, idx) => {
                    const batchIdx = Math.floor(i / updateBatchSize);
                    const updateIdx = i + idx;
                    console.error(`[PlantsScreen] Update error for plant ${updateIdx}:`, {
                      error: err.error,
                      code: err.error?.code,
                      message: err.error?.message,
                      details: err.error?.details,
                      hint: err.error?.hint,
                    });
                  });
                }
              }
              
              console.log(`[PlantsScreen] Updated ${genusUpdates.length} plants with genus values (background)`);
            }
          } catch (err) {
            console.error('[PlantsScreen] Error in background genus update:', err);
          }
        })();
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
        // IMPORTANT: Use the pre-computed signedMap first (from batch signing above)
        // Only fall back to individual queries if the photo isn't in the map
        const generateImageUri = async (): Promise<string> => {
          // First, try to use the pre-computed signedMap (from batch signing)
          const pr = row.photo?.[0];
          if (pr?.object_path) {
            const signedUrl = signedMap.get(`${pr.bucket || 'plant-photos'}|${pr.object_path}`);
            if (signedUrl) return signedUrl;
          }
          
          // Check if we have this photo in fetchedPhotoRows (for UUIDs that didn't join)
          if (row.default_plant_photo_id && typeof row.default_plant_photo_id === 'string') {
            if (uuidRe.test(row.default_plant_photo_id)) {
              const fetched = fetchedPhotoRows[row.default_plant_photo_id];
              if (fetched?.object_path) {
                const signedUrl = signedMap.get(`${fetched.bucket}|${fetched.object_path}`);
                if (signedUrl) return signedUrl;
              }
            } else {
              // Legacy path - check signedMap first
              const signedUrl = signedMap.get(`plant-photos|${row.default_plant_photo_id}`);
              if (signedUrl) return signedUrl;
            }
          }
          
          // Fallback: Only if photo isn't in signedMap, fetch fresh (should be rare)
          // This handles edge cases where the photo changed after we built signedMap
          try {
            const { data: currentPlant } = await supabase
              .from('user_plants')
              .select('default_plant_photo_id')
              .eq('id', row.id)
              .maybeSingle();
            
            if (!currentPlant?.default_plant_photo_id) {
              return '';
            }
            
            const photoId = currentPlant.default_plant_photo_id;
            
            if (uuidRe.test(photoId)) {
              const { data: photoRow } = await supabase
                .from('user_plant_photos')
                .select('bucket, object_path')
                .eq('id', photoId)
                .maybeSingle();
              
              if (photoRow?.object_path) {
                const { data: signed } = await supabase.storage
                  .from(photoRow.bucket || 'plant-photos')
                  .createSignedUrl(photoRow.object_path, 60 * 60);
                return signed?.signedUrl || '';
              }
            } else {
              const { data: signed } = await supabase.storage
                .from('plant-photos')
                .createSignedUrl(photoId, 60 * 60);
              return signed?.signedUrl || '';
            }
          } catch (error) {
            console.error(`[PlantsScreen] Error fetching current photo for plant ${row.id}:`, error);
          }
          
          return '';
        };

        // Get current photo ID for versioned caching
        const currentPhotoId = row.default_plant_photo_id || null;
        
        // Use cache to get image URI (with photo ID for versioning)
        const imageUri = await getCachedImage(
          String(row.id),
          row.updated_at || null,
          currentPhotoId,
          generateImageUri
        );

        return {
          id: String(row.id),
          name: displayName,
          scientificName: sci,
          imageUri,
          location: row.location?.name,
          genus: ref?.genus || undefined,
          speciesTaxonId: (ref as any)?.species_taxon_id || undefined,
          lineage: (row as any).lineage || undefined,
          lightType: (row as any).light_type || undefined,
          systemType: (row as any).system_type || undefined,
          scheduleSameYearRound:
            (ref as any)?.schedule?.schedule_same_year_round ??
            (ref as any)?.schedule?.[0]?.schedule_same_year_round ??
            undefined,
          waterDelay: (row as any).water_delay ?? undefined,
          hasActivePest: plantsWithActivePest.has(String(row.id)),
          deceasedAt: (row as any).deceased_at ?? null,
          soldAt: (row as any).sold_at ?? null,
          updatedAt: row.updated_at || null,
          defaultPhotoId: row.default_plant_photo_id || null,
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
      isFetchingRef.current = false;
    }
  }, [user?.id, search, getCachedImage, groupBy]); // Added getCachedImage dependency
  
  // Store fetchPlants in ref for stable access
  useEffect(() => {
    fetchPlantsRef.current = fetchPlants;
  }, [fetchPlants]);
  
  // Use ref to access current plants.length without adding to dependencies
  const plantsLengthRef = useRef(0);
  useEffect(() => {
    plantsLengthRef.current = plants.length;
  }, [plants.length]);
  
  // Initial load - only fetch once when user is available
  useEffect(() => {
    if (user?.id && !hasInitiallyFetchedRef.current) {
      hasInitiallyFetchedRef.current = true;
      if (fetchPlantsRef.current) {
        fetchPlantsRef.current(false);
      }
    }
  }, [user?.id, fetchPlants]); // Keep fetchPlants to ensure ref is set

  // Debounce search updates
  useEffect(() => {
    if (!user?.id) return;
    // Skip if this is the initial empty search (handled by initial load)
    if (search === '' && hasInitiallyFetchedRef.current === false) {
      return;
    }
    const t = setTimeout(() => {
      if (fetchPlantsRef.current) {
        fetchPlantsRef.current(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
    };
  }, [search, user?.id]); // Removed fetchPlants from dependencies

  // Store plants in ref to avoid dependency issues
  const plantsRef = useRef<Plant[]>([]);
  useEffect(() => {
    plantsRef.current = plants;
  }, [plants]);

  // Scroll to plant when plants load and we have a selected plant ID
  // Note: Scroll-to-plant functionality disabled since we're using VirtualizedLists
  // TODO: Re-implement using FlatList/SectionList scrollToIndex if needed
  useEffect(() => {
    if (lastSelectedPlantIdRef.current && plants.length > 0 && !loading && !refreshing) {
      const plantId = lastSelectedPlantIdRef.current;
      const plant = plants.find(p => p.id === plantId);
      
      if (plant) {
        // VirtualizedLists handle scrolling differently - scrollToIndex would be needed
        // For now, just clear the ref since we can't scroll without proper implementation
        lastSelectedPlantIdRef.current = null;
        lastSelectedPlantId = null;
      } else if (!plant) {
        lastSelectedPlantIdRef.current = null;
      }
    }
  }, [plants, loading, refreshing, groupBy]);

  useFocusEffect(
    useCallback(() => {
      // Only refetch on focus if we've already done initial load
      // This prevents duplicate calls on initial mount
      if (user?.id && hasInitiallyFetchedRef.current) {
        // Use a small delay to avoid immediate refetch on focus
        const timeoutId = setTimeout(() => {
          if (fetchPlantsRef.current && !isFetchingRef.current) {
            fetchPlantsRef.current(false);
          }
        }, 100);
        return () => {
          clearTimeout(timeoutId);
          // Clear selection when screen loses focus
          setSelectedPlantIds([]);
          setClearSelectionTrigger(prev => prev + 1);
          // DON'T clear lastSelectedPlantIdRef here - we need it for scrolling when we return
        };
      }
      
      return () => {
        // Clear selection when screen loses focus
        setSelectedPlantIds([]);
        setClearSelectionTrigger(prev => prev + 1);
        // DON'T clear lastSelectedPlantIdRef here - we need it for scrolling when we return
      };
    }, [user?.id]) // Removed fetchPlants from dependencies
  );

  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    // Fetch fresh plant data
    // The cache will automatically refresh images for plants that have been updated
    // (by comparing updated_at and photoId when getCachedImage is called)
    if (fetchPlantsRef.current) {
      fetchPlantsRef.current(true); // Pass isRefresh flag
    }
  }, []);
  const selectionMode = selectedPlantIds.length > 0;
  const selectionCount = selectedPlantIds.length;

  const clearSelection = useCallback(() => {
    setSelectedPlantIds([]);
    setClearSelectionTrigger(prev => prev + 1); // Trigger PlantGallery to clear selection
  }, []);

  // Reload a single plant
  const reloadSinglePlant = useCallback(async (plantId: string) => {
    try {
      // Fetch the updated plant data using the same query structure as fetchPlants
      const { data: updatedPlant, error } = await supabase
        .from('user_plants')
        .select(`
          id,
          plants_table_id,
          nickname,
          acquired_at,
          acquired_from,
          location_id,
          default_plant_photo_id,
          deceased_at,
          sold_at,
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
            schedule:plants_schedule (
              schedule_same_year_round
            ),
            species_taxon_id
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
        .eq('id', plantId)
        .single();
      
      if (error) throw error;
      if (!updatedPlant) return;
      
      // Check for active pest events
      const { data: pestEvents } = await supabase
        .from('user_plant_timeline_events')
        .select('user_plant_id, event_data')
        .eq('user_plant_id', plantId)
        .eq('event_type', 'pest_id')
        .order('event_time', { ascending: false });
      
      const hasActivePest = pestEvents?.some(event => {
        const eventData = event.event_data as any;
        return eventData?.status === 'active';
      }) || false;
      
      // Transform the plant data (similar to fetchPlants logic)
      const row = updatedPlant as unknown as UserPlantJoined;
      const ref = row.plants ?? ({} as UserPlantJoined['plants']);
      const displayName = row.nickname || ref?.plant_name || 'Unnamed Plant';
      const sci = ref?.plant_scientific_name || '';
      
      // Generate image URI
      const generateImageUri = async (): Promise<string> => {
        const pr = row.photo?.[0];
        if (pr?.object_path) {
          const { data: signed } = await supabase.storage
            .from(pr.bucket || 'plant-photos')
            .createSignedUrl(pr.object_path, 60 * 60);
          return signed?.signedUrl || '';
        } else if (row.default_plant_photo_id && typeof row.default_plant_photo_id === 'string') {
          const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          if (uuidRe.test(row.default_plant_photo_id)) {
            const { data: photoRow } = await supabase
              .from('user_plant_photos')
              .select('bucket, object_path')
              .eq('id', row.default_plant_photo_id)
              .single();
            if (photoRow?.object_path) {
              const { data: signed } = await supabase.storage
                .from(photoRow.bucket || 'plant-photos')
                .createSignedUrl(photoRow.object_path, 60 * 60);
              return signed?.signedUrl || '';
            }
          } else {
            // Legacy path
            const { data: signed } = await supabase.storage
              .from('plant-photos')
              .createSignedUrl(row.default_plant_photo_id, 60 * 60);
            return signed?.signedUrl || '';
          }
        }
        return '';
      };
      
      // Get current photo ID for versioned caching
      const currentPhotoId = row.default_plant_photo_id || null;
      
      const imageUri = await getCachedImage(
        String(row.id),
        row.updated_at || null,
        currentPhotoId,
        generateImageUri
      );
      
      const transformedPlant: Plant = {
        id: String(row.id),
        name: displayName,
        scientificName: sci,
        imageUri,
        location: row.location?.name,
        genus: ref?.genus || undefined,
        speciesTaxonId: (ref as any)?.species_taxon_id || undefined,
        lineage: (row as any).lineage || undefined,
        lightType: (row as any).light_type || undefined,
        systemType: (row as any).system_type || undefined,
        scheduleSameYearRound:
          (ref as any)?.schedule?.schedule_same_year_round ??
          (ref as any)?.schedule?.[0]?.schedule_same_year_round ??
          undefined,
        waterDelay: (row as any).water_delay ?? undefined,
        hasActivePest,
        deceasedAt: (row as any).deceased_at ?? null,
        soldAt: (row as any).sold_at ?? null,
        updatedAt: row.updated_at || null,
        defaultPhotoId: row.default_plant_photo_id || null,
      };
      
      // Update the plant in state
      setPlants(prevPlants => {
        const index = prevPlants.findIndex(p => p.id === plantId);
        if (index >= 0) {
          const updated = [...prevPlants];
          updated[index] = transformedPlant;
          return updated;
        }
        return prevPlants;
      });
    } catch (e) {
      console.error('[PlantsScreen] Error reloading plant:', e);
    }
  }, [getCachedImage]);

  // Handle closing plant detail overlay
  const handleClosePlantDetail = useCallback(async () => {
    // Restore scroll position
    if (scrollPositionRef.current && savedScrollOffsetRef.current > 0) {
      // Use setTimeout to ensure the gallery is rendered before scrolling
      setTimeout(() => {
        if (scrollPositionRef.current) {
          scrollPositionRef.current.scrollToOffset(savedScrollOffsetRef.current);
        }
      }, 100);
    }
    
    // Reload only the viewed plant if it was updated
    const currentSelectedPlantId = selectedPlantId;
    const currentViewedPlantUpdatedAt = viewedPlantUpdatedAt;
    
    if (currentSelectedPlantId && currentViewedPlantUpdatedAt && fetchPlantsRef.current) {
      try {
        // Fetch the current updated_at for the plant
        const { data: currentPlant, error } = await supabase
          .from('user_plants')
          .select('updated_at')
          .eq('id', currentSelectedPlantId)
          .single();
        
        if (!error && currentPlant) {
          const currentUpdatedAt = currentPlant.updated_at;
          // Only reload if the plant was updated
          if (currentUpdatedAt && currentUpdatedAt !== currentViewedPlantUpdatedAt) {
            // Invalidate the image cache for this plant to force refresh
            await invalidatePlant(currentSelectedPlantId);
            // Reload only this specific plant
            await reloadSinglePlant(currentSelectedPlantId);
          }
        }
      } catch (e) {
        console.error('[PlantsScreen] Error checking plant update:', e);
      }
    }
    
    setSelectedPlantId(null);
    setViewedPlantUpdatedAt(null);
  }, [selectedPlantId, viewedPlantUpdatedAt, invalidatePlant, reloadSinglePlant]);

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
      {/* Title - outside of VirtualizedList */}
      <View style={styles.titleContainer}>
        <ThemedText style={styles.title}>
          My Plants{' '}
          <ThemedText style={styles.plantCount}>({plants.length})</ThemedText>
        </ThemedText>
        <TouchableOpacity
          onPress={onRefresh}
          disabled={refreshing}
          style={styles.refreshButton}
          accessibilityRole="button"
          accessibilityLabel="Refresh plants"
        >
          <IconSymbol
            name="arrow.clockwise"
            size={20}
            color={refreshing ? theme.colors.text + '80' : theme.colors.text}
          />
        </TouchableOpacity>
      </View>
        
      <PlantGallery
        plants={plants}
        loading={loading}
        error={error}
        refreshing={refreshing}
        onRefresh={onRefresh}

          // show/hide controls
          enableSearch={true}
          enableViewToggle={true}

          // default layout: 'gridsmall' | 'gridmed' | 'list'
          defaultLayout="gridmed"

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
            // Save scroll position
            if (scrollPositionRef.current) {
              savedScrollOffsetRef.current = scrollPositionRef.current.getScrollOffset();
            }
            // Find the plant to get its updated_at
            const plant = plants.find(pl => pl.id === p.id);
            setViewedPlantUpdatedAt(plant?.updatedAt || null);
            setSelectedPlantId(p.id);
          }}
          scrollPositionRef={scrollPositionRef}
          
          // selection
          onSelectionChange={setSelectedPlantIds}
          clearSelectionTrigger={clearSelectionTrigger}
          
        />

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
          if (fetchPlantsRef.current) {
            fetchPlantsRef.current(false);
          }
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
          if (fetchPlantsRef.current) {
            fetchPlantsRef.current(false);
          }
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
          if (fetchPlantsRef.current) {
            fetchPlantsRef.current(false);
          }
        }}
      />
      <Modal
        visible={moreMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMoreMenuOpen(false)}
      >
        <Pressable 
          style={StyleSheet.absoluteFill} 
          onPress={() => setMoreMenuOpen(false)}
        >
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' }}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View style={[styles.moreModal, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
                <ThemedText style={{ fontSize: 18, fontWeight: '800', marginBottom: 16 }}>More Options</ThemedText>
                <TouchableOpacity
                  style={styles.moreModalItem}
                  onPress={() => {
                    setMoreMenuOpen(false);
                    setPestIdModalOpen(true);
                  }}
                >
                  <IconSymbol name="pest" size={20} color={theme.colors.text} />
                  <ThemedText style={{ marginLeft: 12, fontWeight: '700', fontSize: 16 }}>Pest ID</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.moreModalItem}
                  onPress={() => {
                    setMoreMenuOpen(false);
                    setPestTreatModalOpen(true);
                  }}
                >
                  <IconSymbol name="pest" size={20} color={theme.colors.text} />
                  <ThemedText style={{ marginLeft: 12, fontWeight: '700', fontSize: 16 }}>Treat Plant</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.moreModalItem}
                  onPress={() => {
                    setMoreMenuOpen(false);
                    Alert.alert('Set Deceased', `Mark ${selectedPlantIds.length} plant${selectedPlantIds.length > 1 ? 's' : ''} as deceased? This will remove all future schedule events.`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Set Deceased',
                        style: 'default',
                        onPress: async () => {
                          try {
                            const now = new Date().toISOString();
                            // Update deceased_at column for all selected plants
                            const { error: updateErr } = await supabase
                              .from('user_plants')
                              .update({ deceased_at: now })
                              .in('id', selectedPlantIds);
                            if (updateErr) throw updateErr;

                            // Delete all future schedule events for all selected plants
                            const { error: deleteSchedulesErr } = await supabase
                              .from('user_plant_schedules')
                              .delete()
                              .in('user_plant_id', selectedPlantIds)
                              .gte('next_run_at', now);
                            if (deleteSchedulesErr) throw deleteSchedulesErr;

                            Alert.alert('Success', `Marked ${selectedPlantIds.length} plant${selectedPlantIds.length > 1 ? 's' : ''} as deceased and removed future schedules.`);
                            setSelectedPlantIds([]);
                            setClearSelectionTrigger(prev => prev + 1);
                            if (fetchPlantsRef.current) {
                              fetchPlantsRef.current(false);
                            }
                          } catch (e: any) {
                            Alert.alert('Error', e?.message ?? 'Failed to mark plants as deceased');
                          }
                        },
                      },
                    ]);
                  }}
                >
                  <IconSymbol name="xmark.circle" size={20} color={theme.colors.text} />
                  <ThemedText style={{ marginLeft: 12, fontWeight: '700', fontSize: 16 }}>Set Deceased</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.moreModalItem}
                  onPress={() => {
                    setMoreMenuOpen(false);
                    Alert.alert('Mark Sold', `Mark ${selectedPlantIds.length} plant${selectedPlantIds.length > 1 ? 's' : ''} as sold?`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Mark Sold',
                        style: 'default',
                        onPress: async () => {
                          try {
                            const now = new Date().toISOString();
                            // Update sold_at column for all selected plants
                            const { error: updateErr } = await supabase
                              .from('user_plants')
                              .update({ sold_at: now })
                              .in('id', selectedPlantIds);
                            if (updateErr) throw updateErr;

                            Alert.alert('Success', `Marked ${selectedPlantIds.length} plant${selectedPlantIds.length > 1 ? 's' : ''} as sold.`);
                            setSelectedPlantIds([]);
                            setClearSelectionTrigger(prev => prev + 1);
                            if (fetchPlantsRef.current) {
                              fetchPlantsRef.current(false);
                            }
                          } catch (e: any) {
                            Alert.alert('Error', e?.message ?? 'Failed to mark plants as sold');
                          }
                        },
                      },
                    ]);
                  }}
                >
                  <IconSymbol name="checkmark.circle" size={20} color={theme.colors.text} />
                  <ThemedText style={{ marginLeft: 12, fontWeight: '700', fontSize: 16 }}>Mark Sold</ThemedText>
                </TouchableOpacity>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

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
      
      {/* Plant Detail Overlay */}
      <Modal
        visible={selectedPlantId !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          handleClosePlantDetail();
        }}
      >
        {selectedPlantId && (
          <PlantDetailScreen
            plantId={selectedPlantId}
            onClose={handleClosePlantDetail}
          />
        )}
      </Modal>
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
  refreshButton: {
    padding: 8,
    marginLeft: 12,
  },
  plantCount: {
    fontSize: 18, // Smaller than title (which is 32)
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#3B82F6', // Blue color
  },
  titleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 20,
    paddingBottom: 24,
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
  moreModal: {
    width: '85%',
    maxWidth: 400,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 20,
    gap: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  moreModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 4,
  },
  overlayCloseBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
