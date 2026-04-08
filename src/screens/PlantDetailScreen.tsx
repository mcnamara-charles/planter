import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, TouchableOpacity, View, BackHandler, Platform, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import SkeletonTile from '@/components/SkeletonTile';
import TimelineChart from '@/components/TimelineChart';
import TimelineCalendar from '@/components/TimelineCalendar';
import WaterModal from '@/components/WaterModal';
import FertilizeModal from '@/components/FertilizeModal';
import PruneModal from '@/components/PruneModal';
import ConfirmNameModal from '@/components/ConfirmNameModal';
import { useGeneratePlantData } from '@/hooks/generatePlantData';
import { usePlantDataValidation } from '@/hooks/usePlantDataValidation';

import TopBar from '@/components/TopBar';
import MenuSheet from '@/components/MenuSheet';
import Section from '@/components/Section';
import AboutBox from '@/components/AboutBox';
import CompactStatus from '@/components/CompactStatus';
import EnvironmentSection from '@/components/EnvironmentSection';
import CareSection from '@/components/CareSection';
import SoilMixViz from '@/components/SoilMixViz';
import MoveModal from '@/components/MoveModal';
import SoilModal from '@/components/SoilModal';
import PotDetailsModal from '@/components/PotDetailsModal';
import TaxonomyModal from '@/components/TaxonomyModal';
import { ButtonPill } from '@/components/Buttons';
import PlantDataGenerationModal from '@/components/PlantDataGenerationModal';
import PestIdModal from '@/components/PestIdModal';
import PestTreatModal from '@/components/PestTreatModal';
import ImageLightbox from '@/components/ImageLightbox';
import FavoritePlantCard from '@/components/favorite-plant-card';
import { usePlantImageCache } from '@/context/PlantImageCacheContext';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { labelAvailability, labelRarity } from '@/utils/labels';
import type { Availability, Rarity, RouteParams, SoilRowDraft, PotShape } from '@/utils/types';

type PlantDetailScreenProps = {
  plantId?: string;
  onClose?: () => void;
};

export default function PlantDetailScreen(props?: PlantDetailScreenProps) {
  const { theme } = useTheme();
  // Hooks must be called unconditionally (React requirement)
  const route = useRoute();
  const nav = useNavigation();
  // Support both props (for overlay) and route params (for navigation)
  // If props.plantId is provided, use it; otherwise fall back to route params
  const { id } = props?.plantId ? { id: props.plantId } : ((route.params as any) as RouteParams);
  const onClose = props?.onClose;
  const { user } = useAuth();
  const { height: windowHeight } = useWindowDimensions();

  // ===== State (grouped) =====
  const [ui, setUi] = useState({
    menuOpen: false,
    heroLoaded: false,
    refreshing: false,
    timelineKey: 0,
    genLoading: false,
    uploadingPhoto: false,
  });
  
  const [overlay, setOverlay] = useState<{ visible: boolean; message: string; percent?: number; sublabel?: string }>({
    visible: false,
    message: '',
    percent: undefined,
    sublabel: undefined,
  });

  const [optimisticCare, setOptimisticCare] = useState<{
    care_light?: string | null;
    care_water?: string | null;
    care_temp_humidity?: string | null;
    care_fertilizer?: string | null;
    care_pruning?: string | null;
    soil_description?: string | null;
    propagation_methods?: { method: string; difficulty?: string | null; description?: string | null; min_days?: number; max_days?: number }[];
  } | null>(null);

  const [status, setStatus] = useState({ loading: true, error: null as string | null });

  const [plant, setPlant] = useState({
    headerUrl: '',
    // nickname (user-provided) stays in TopBar title
    displayName: '',
    // show *this* below the header (from plants.plant_name)
    commonName: '',
    scientific: '',
    description: '',
    availability: '' as Availability,
    rarity: '' as Rarity,
    isFavorite: false,
    location: '',
    locationId: null as string | null,
    plantsTableId: null as string | null,
    speciesTaxonId: null as string | null,
    lineage: null as string | null,
    lightType: null as 'grow_light' | 'sunlight' | null,
    systemType: null as 'normal' | 'reservoir' | null,
    pot: { type: '', heightIn: null as number | null, diameterIn: null as number | null, drainage: '' } as PotShape,
    soilMix: null as Record<string, number> | null,
    soilDescription: null as string | null,
    propagationMethods: [] as { method: string; difficulty?: string | null; description?: string | null; min_days?: number; max_days?: number }[],
    deceasedAt: null as string | null,
    soldAt: null as string | null,
  });

  // Plant photos state
  const [plantPhotos, setPlantPhotos] = useState<{ id: string; thumbUrl: string; fullUrl: string; isDefault: boolean; createdAt: string | null; bucket: string; objectPath: string }[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState<'Healthy' | 'Sick' | 'Damaged'>('Healthy');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxInitialIndex, setLightboxInitialIndex] = useState(0);
  
  // Propagation relationships
  const [parentPlant, setParentPlant] = useState<{ id: string; name: string; scientificName: string; imageUri: string; lineage?: string | null; lightType?: 'grow_light' | 'sunlight' | null; systemType?: 'normal' | 'reservoir' | null; scheduleSameYearRound?: boolean | null; waterDelay?: number | null; hasActivePest?: boolean } | null>(null);
  const [childrenPlants, setChildrenPlants] = useState<{ id: string; name: string; scientificName: string; imageUri: string; lineage?: string | null; lightType?: 'grow_light' | 'sunlight' | null; systemType?: 'normal' | 'reservoir' | null; scheduleSameYearRound?: boolean | null; waterDelay?: number | null; hasActivePest?: boolean }[]>([]);
  const { getCachedImage } = usePlantImageCache();

  // Modals/drafts
  const [modals, setModals] = useState({
    water: false,
    fertilize: false,
    prune: false,
    pest: false,
    pestTreat: false,
    location: false,
    taxonomy: false,
    soil: false,
    pot: false as boolean,
    potMode: 'add' as 'add' | 'repot',
    confirmName: { open: false, suggested: null as string | null },
  });
  const [drafts, setDrafts] = useState({ soilRows: [] as SoilRowDraft[], potNote: '' });
  const [potDraft, setPotDraft] = useState({ potType: '', drainageSystem: '', potHeightIn: '', potDiameterIn: '' });

  const [openSection, setOpenSection] = useState<'care' | 'timeline' | 'environment' | 'propagation' | 'photos' | null>('care');
  const toggle = (key: NonNullable<typeof openSection>) => setOpenSection((curr) => (curr === key ? null : key));

  // Timeline controls state
  const [timelineEventType, setTimelineEventType] = useState<'Water' | 'Fertilize'>('Water');
  const [timelineEventTypeOpen, setTimelineEventTypeOpen] = useState(false);

  // Debounce ref for favorite
  const favTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { loading: genLoading, data: genData, error: genError, progressEvents, run: generatePlantData } = useGeneratePlantData();
  const { validationResult, validatePlantData, hideModal, resetValidation } = usePlantDataValidation();
  
  // Track if user declined the update modal
  const [userDeclinedUpdate, setUserDeclinedUpdate] = useState(false);
  const [autoGenRan, setAutoGenRan] = useState(false);
  const [genModalVisible, setGenModalVisible] = useState(false);

  // ---- Progress wiring (same shape CareSection emits) ----
  type StageKey =
    | 'db_read'
    | 'profile'
    | 'light_water'
    | 'care_temp_humidity'
    | 'care_fertilizer'
    | 'care_pruning'
    | 'soil_description'
    | 'propagation'
    | 'db_write'
    | 'done';
  type ProgressEvent = {
    key: StageKey;
    label: string;
    status: 'pending' | 'running' | 'success' | 'error';
    error?: string;
  };
  const STAGE_ORDER: StageKey[] = [
    'db_read',
    'profile',
    'light_water',
    'care_temp_humidity',
    'care_fertilizer',
    'care_pruning',
    'soil_description',
    'propagation',
    'db_write',
    'done',
  ];
  const calcPercent = (k: StageKey) => {
    const i = Math.max(0, STAGE_ORDER.indexOf(k));
    const total = STAGE_ORDER.length - 1; // treat "done" as 100%
    return Math.round((i / total) * 100);
  };
  const STAGE_LABELS: Record<StageKey, string> = {
    db_read: 'Reading plant record',
    profile: 'Building species profile',
    light_water: 'Rendering light & water',
    care_temp_humidity: 'Generating temp & humidity',
    care_fertilizer: 'Generating fertilizer plan',
    care_pruning: 'Generating pruning guidance',
    soil_description: 'Generating soil & mix',
    propagation: 'Generating propagation',
    db_write: 'Saving updates',
    done: 'Finished',
  };

  const rarityLabel = useMemo(() => labelRarity(plant.rarity), [plant.rarity]);
  const availabilityLabel = useMemo(() => labelAvailability(plant.availability), [plant.availability]);

  // Sort propagation methods by difficulty for display
  const sortedPropagation = useMemo(() => {
    const order: Record<string, number> = {
      easy: 0,
      moderate: 1,
      challenging: 2,
      very_challenging: 3,
    };
    return [...(plant.propagationMethods || [])].sort((a, b) => {
      const da = order[(a.difficulty || '').toLowerCase()] ?? 99;
      const db = order[(b.difficulty || '').toLowerCase()] ?? 99;
      if (da !== db) return da - db;
      return (a.method || '').localeCompare(b.method || '');
    });
  }, [plant.propagationMethods]);

  // ===== Android hardware back handling =====
  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const onBack = () => {
        if (overlay.visible) { setOverlay({ visible: false, message: '' }); return true; }
        if (modals.water) { setModals((m) => ({ ...m, water: false })); return true; }
        if (modals.fertilize) { setModals((m) => ({ ...m, fertilize: false })); return true; }
        if (modals.prune) { setModals((m) => ({ ...m, prune: false })); return true; }
        if (modals.pestTreat) { setModals((m) => ({ ...m, pestTreat: false })); return true; }
        if (modals.location) { setModals((m) => ({ ...m, location: false })); return true; }
        if (modals.soil) { setModals((m) => ({ ...m, soil: false })); return true; }
        if (modals.pot) { setModals((m) => ({ ...m, pot: false })); return true; }
        if ((modals as any).confirmName?.open) { setModals((m: any) => ({ ...m, confirmName: { open: false, suggested: null } })); return true; }
        // Always navigate to My Plants page
        if (onClose) {
          onClose();
          return true;
        }
        (nav as any).navigate('MainTabs', { screen: 'MyPlants' });
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [overlay.visible, modals.water, modals.location, modals.soil, modals.pot, (modals as any).confirmName?.open])
  );

  // ===== Data fetch =====
  const fetchDetails = useCallback(async (isPull = false) => {
    try {
      if (!isPull) setStatus((s) => ({ ...s, loading: true, error: null }));
      const { data: up, error: upErr } = await supabase
        .from('user_plants')
        .select(
          'id, nickname, plants_table_id, default_plant_photo_id, favorite, location_id, pot_type, pot_height_in, pot_diameter_in, drainage_system, soil_mix, lineage, light_type, system_type, propagated_from_user_plant_id, deceased_at, sold_at, location:location_id (id, name)'
        )
        .eq('id', id)
        .maybeSingle();
      if (upErr) throw upErr;
      if (!up) throw new Error('Plant not found');

      // signed hero url
      let hero = '';
      if (up.default_plant_photo_id) {
        const { data: pr } = await supabase
          .from('user_plant_photos')
          .select('bucket, object_path')
          .eq('id', up.default_plant_photo_id)
          .maybeSingle();
        if (pr?.object_path) {
          const { data: signed } = await supabase
            .storage
            .from(pr.bucket || 'plant-photos')
            .createSignedUrl(pr.object_path, 3600, { transform: { width: 900, quality: 80, resize: 'contain' } });
          hero = signed?.signedUrl ?? '';
        }
      }

      // names/details
      let nickname = up.nickname || '';
      let commonName = '';
      let scientific = '';
      let description = '';
      let availability: Availability = '' as Availability;
      let rarity: Rarity = '' as Rarity;

      let plantRow: any = null;
      let speciesTaxonId: string | null = null;
      if (up.plants_table_id) {
        // Fetch from all microtables
        const [coreResult, careResult, marketResult] = await Promise.all([
          supabase
            .from('plants_core')
            .select('plant_name, plant_scientific_name, description, species_taxon_id')
            .eq('id', up.plants_table_id)
            .maybeSingle(),
          supabase
            .from('plants_care')
            .select('propagation_methods_json, soil_description')
            .eq('plant_id', up.plants_table_id)
            .maybeSingle(),
          supabase
            .from('plants_market_meta')
            .select('availability, rarity')
            .eq('plant_id', up.plants_table_id)
            .maybeSingle(),
        ]);
        
        plantRow = {
          ...coreResult.data,
          ...careResult.data,
          ...marketResult.data,
        };

        commonName = plantRow?.plant_name || '';
        scientific = plantRow?.plant_scientific_name || 'Unknown Scientific Name';
        description = plantRow?.description || '';
        availability = (plantRow?.availability as any) || '';
        rarity = (plantRow?.rarity as any) || '';
        speciesTaxonId = plantRow?.species_taxon_id || null;
      }

      // Check for active pest events to determine health status
      const { data: pestEvents } = await supabase
        .from('user_plant_timeline_events')
        .select('event_data')
        .eq('user_plant_id', id)
        .eq('event_type', 'pest_id')
        .order('event_time', { ascending: false })
        .limit(1);

      const hasActivePest = pestEvents && pestEvents.length > 0 && (pestEvents[0].event_data as any)?.status === 'active';
      setHealthStatus(hasActivePest ? 'Sick' : 'Healthy');

      // IMPORTANT: merge DB with existing (optimistic) state so optimistic wins
      setPlant((prev) => ({
        ...prev,
        headerUrl: hero || prev.headerUrl,
        displayName: nickname || prev.displayName || 'My Plant',
        commonName: commonName || prev.commonName || '',
        scientific: scientific || prev.scientific,
        speciesTaxonId: speciesTaxonId !== null ? speciesTaxonId : prev.speciesTaxonId,
        description: description || prev.description,
        availability: (availability as Availability) || prev.availability,
        rarity: (rarity as Rarity) || prev.rarity,
        isFavorite: !!up.favorite,
        location: (up.location as any)?.name ?? prev.location,
        locationId: (up.location as any)?.id ?? prev.locationId,
        plantsTableId: up.plants_table_id ?? prev.plantsTableId,
        lineage: (up as any).lineage ?? prev.lineage,
        lightType: (up as any).light_type ?? prev.lightType,
        systemType: (up as any).system_type ?? prev.systemType,
        pot: {
          type: up.pot_type ?? prev.pot.type,
          heightIn:
            typeof up.pot_height_in === 'number'
              ? up.pot_height_in
              : up.pot_height_in
              ? Number(up.pot_height_in)
              : prev.pot.heightIn,
          diameterIn:
            typeof up.pot_diameter_in === 'number'
              ? up.pot_diameter_in
              : up.pot_diameter_in
              ? Number(up.pot_diameter_in)
              : prev.pot.diameterIn,
          drainage: up.drainage_system ?? prev.pot.drainage,
        },
        soilMix: (up as any).soil_mix ?? prev.soilMix,
        // prefer optimistic environment/propagation; DB will naturally win on later refresh once it has new content
        soilDescription: (plantRow as any)?.soil_description ?? prev.soilDescription,
        propagationMethods:
          ((plantRow as any)?.propagation_methods_json ?? [])?.length
            ? (plantRow as any).propagation_methods_json
            : prev.propagationMethods,
        deceasedAt: (up as any).deceased_at ?? null,
        soldAt: (up as any).sold_at ?? null,
      }));

      // Fetch parent plant if this plant was propagated from another
      const propagatedFromId = (up as any).propagated_from_user_plant_id;
      if (propagatedFromId) {
        try {
          const { data: parentUp } = await supabase
            .from('user_plants')
            .select(`
              id,
              nickname,
              default_plant_photo_id,
              lineage,
              light_type,
              system_type,
              plants:plants_table_id (
                id,
                plant_name,
                plant_scientific_name,
                schedule:plants_schedule (
                  schedule_same_year_round
                )
              )
            `)
            .eq('id', propagatedFromId)
            .maybeSingle();

          if (parentUp) {
            // Get parent plant photo
            let parentImageUri = '';
            if (parentUp.default_plant_photo_id) {
              const { data: parentPhoto } = await supabase
                .from('user_plant_photos')
                .select('bucket, object_path')
                .eq('id', parentUp.default_plant_photo_id)
                .maybeSingle();
              
              if (parentPhoto?.object_path) {
                const { data: signed } = await supabase.storage
                  .from(parentPhoto.bucket || 'plant-photos')
                  .createSignedUrl(parentPhoto.object_path, 3600);
                parentImageUri = signed?.signedUrl || '';
              }
            }

            const parentPlantData = parentUp.plants as any;
            const parentSchedule = Array.isArray(parentPlantData?.schedule) ? parentPlantData.schedule[0] : parentPlantData?.schedule;
            const parentName = parentUp.nickname || parentPlantData?.plant_name || 'Unnamed Plant';
            const parentScientific = parentPlantData?.plant_scientific_name || '';

            // Check for active pest
            const { data: parentPestEvents } = await supabase
              .from('timeline_events')
              .select('event_data')
              .eq('user_plant_id', propagatedFromId)
              .eq('event_type', 'pest_id')
              .order('event_time', { ascending: false })
              .limit(1);
            
            const parentHasActivePest = parentPestEvents && parentPestEvents.length > 0 && (parentPestEvents[0].event_data as any)?.status === 'active';

            setParentPlant({
              id: parentUp.id,
              name: parentName,
              scientificName: parentScientific,
              imageUri: parentImageUri,
              lineage: (parentUp as any).lineage || null,
              lightType: (parentUp as any).light_type || null,
              systemType: (parentUp as any).system_type || null,
              scheduleSameYearRound: parentSchedule?.schedule_same_year_round ?? undefined,
              waterDelay: null,
              hasActivePest: parentHasActivePest || false,
            });
          } else {
            setParentPlant(null);
          }
        } catch (err) {
          console.error('[PlantDetailScreen] Error fetching parent plant:', err);
          setParentPlant(null);
        }
      } else {
        setParentPlant(null);
      }

      // Fetch children plants (plants propagated from this plant)
      try {
        const { data: childrenRows } = await supabase
          .from('user_plants')
          .select(`
            id,
            nickname,
            default_plant_photo_id,
            lineage,
            light_type,
            system_type,
            water_delay,
            plants:plants_table_id (
              id,
              plant_name,
              plant_scientific_name,
              schedule:plants_schedule (
                schedule_same_year_round
              )
            )
          `)
          .eq('owner_id', user?.id)
          .eq('propagated_from_user_plant_id', id)
          .is('sold_at', null)
          .is('deceased_at', null);

        if (childrenRows && childrenRows.length > 0) {
          // Get all photo IDs for batch signing
          const photoIds = childrenRows
            .map(r => r.default_plant_photo_id)
            .filter((id): id is string => Boolean(id));
          
          const photoMap = new Map<string, string>();
          if (photoIds.length > 0) {
            const { data: photoRows } = await supabase
              .from('user_plant_photos')
              .select('id, bucket, object_path')
              .in('id', photoIds);
            
            if (photoRows) {
              // Batch sign photos
              const toSign = photoRows.map(p => ({ bucket: p.bucket || 'plant-photos', path: p.object_path }));
              const byBucket = toSign.reduce<Record<string, string[]>>((acc, p) => {
                (acc[p.bucket] ||= []).push(p.path);
                return acc;
              }, {});

              await Promise.all(
                Object.entries(byBucket).map(async ([bucket, paths]) => {
                  const { data: signed } = await supabase.storage
                    .from(bucket)
                    .createSignedUrls(paths, 3600);
                  if (signed) {
                    signed.forEach((s, i) => {
                      if (s?.signedUrl) photoMap.set(`${bucket}|${paths[i]}`, s.signedUrl);
                    });
                  }
                })
              );
            }
          }

          // Get active pest status for all children
          const childrenIds = childrenRows.map(r => r.id);
          const { data: pestEvents } = await supabase
            .from('timeline_events')
            .select('user_plant_id, event_data')
            .in('user_plant_id', childrenIds)
            .eq('event_type', 'pest_id')
            .order('event_time', { ascending: false });

          const plantsWithActivePest = new Set<string>();
          if (pestEvents) {
            // Group by plant and get latest event for each
            const latestByPlant = new Map<string, any>();
            for (const event of pestEvents) {
              if (!latestByPlant.has(event.user_plant_id)) {
                latestByPlant.set(event.user_plant_id, event);
              }
            }
            for (const [plantId, event] of latestByPlant) {
              if ((event.event_data as any)?.status === 'active') {
                plantsWithActivePest.add(plantId);
              }
            }
          }

          const children = await Promise.all(
            childrenRows.map(async (row) => {
              let imageUri = '';
              if (row.default_plant_photo_id) {
                const { data: photoRow } = await supabase
                  .from('user_plant_photos')
                  .select('bucket, object_path')
                  .eq('id', row.default_plant_photo_id)
                  .maybeSingle();
                
                if (photoRow?.object_path) {
                  const key = `${photoRow.bucket || 'plant-photos'}|${photoRow.object_path}`;
                  imageUri = photoMap.get(key) || '';
                  if (!imageUri) {
                    // Fallback to individual signing
                    const { data: signed } = await supabase.storage
                      .from(photoRow.bucket || 'plant-photos')
                      .createSignedUrl(photoRow.object_path, 3600);
                    imageUri = signed?.signedUrl || '';
                  }
                }
              }

              const plantData = row.plants as any;
              const schedule = Array.isArray(plantData?.schedule) ? plantData.schedule[0] : plantData?.schedule;
              const displayName = row.nickname || plantData?.plant_name || 'Unnamed Plant';
              const scientific = plantData?.plant_scientific_name || '';

              return {
                id: row.id,
                name: displayName,
                scientificName: scientific,
                imageUri,
                lineage: (row as any).lineage || null,
                lightType: (row as any).light_type || null,
                systemType: (row as any).system_type || null,
                scheduleSameYearRound: schedule?.schedule_same_year_round ?? undefined,
                waterDelay: (row as any).water_delay ?? null,
                hasActivePest: plantsWithActivePest.has(row.id),
              };
            })
          );

          // Sort children by lineage alphanumerically
          // Handle null/undefined lineages by putting them at the end
          const sortedChildren = children.sort((a, b) => {
            const lineageA = a.lineage || '';
            const lineageB = b.lineage || '';
            
            // If both are empty, maintain order
            if (!lineageA && !lineageB) return 0;
            // Empty lineages go to the end
            if (!lineageA) return 1;
            if (!lineageB) return -1;
            
            // Alphanumeric comparison
            // This will sort: A, A1, A2, A3, A4, A5, B, etc.
            return lineageA.localeCompare(lineageB, undefined, { numeric: true, sensitivity: 'base' });
          });
          
          setChildrenPlants(sortedChildren);
        } else {
          setChildrenPlants([]);
        }
      } catch (err) {
        console.error('[PlantDetailScreen] Error fetching children plants:', err);
        setChildrenPlants([]);
      }
    } catch (e: any) {
      setStatus({ loading: false, error: e?.message ?? 'Failed to load plant' });
    } finally {
      setStatus((s) => ({ ...s, loading: false }));
      setUi((u) => ({ ...u, refreshing: false }));
      if (isPull) setUi((u) => ({ ...u, timelineKey: u.timelineKey + 1 }));
    }
  }, [id, user?.id]);

  useEffect(() => {
    fetchDetails(false);
    return () => { if (favTimerRef.current) clearTimeout(favTimerRef.current); };
  }, [fetchDetails]);

  // Validate plant data when plant is loaded
  useEffect(() => {
    if (plant.plantsTableId && !status.loading) {
      validatePlantData(plant.plantsTableId);
    }
  }, [plant.plantsTableId, status.loading, validatePlantData]);

  // Reset auto-generation state when plant changes
  useEffect(() => {
    setAutoGenRan(false);
    setUserDeclinedUpdate(false);
    setGenModalVisible(false);
    resetValidation();
  }, [id, resetValidation]);

  // Auto-run generation when needed (no user click)
  useEffect(() => {
    const shouldRun = !!plant.plantsTableId && validationResult.needsGeneration && !genLoading && !autoGenRan;
    if (!shouldRun) return;
    (async () => {

      setGenModalVisible(true);

      try {
        const res = await generatePlantData({
          plantsTableId: plant.plantsTableId!,
          commonName: plant.commonName || plant.displayName,
          scientificName: plant.scientific,
        });

        if (!res) throw new Error(genError || 'Generation returned no result');

        if (res) {
          setPlant(prev => ({
            ...prev,
            description: res.description || prev.description,
            availability: (res.availability_status as any) || prev.availability,
            rarity: (res.rarity_level as any) || prev.rarity,
          }));
          // Update optimistic care
          setOptimisticCare(prev => ({
            ...prev,
            care_light: res.care_light || (prev?.care_light ?? null),
            care_water: res.care_water || (prev?.care_water ?? null),
            care_temp_humidity: res.care_temp_humidity || (prev?.care_temp_humidity ?? null),
            care_fertilizer: res.care_fertilizer || (prev?.care_fertilizer ?? null),
            care_pruning: res.care_pruning || (prev?.care_pruning ?? null),
            soil_description: res.soil_description || (prev?.soil_description ?? null),
            propagation_methods: res.propagation_techniques || (prev?.propagation_methods ?? []),
          }));
          // Background refresh
          setTimeout(() => { void fetchDetails(true); }, 500);
          if (res.suggested_common_name && plant.plantsTableId) {
            setModals((m) => ({ ...m, confirmName: { open: true, suggested: res.suggested_common_name! } }));
          }
        }
        setUserDeclinedUpdate(false);
        setAutoGenRan(true);
        hideModal();
      } catch (e: any) {
        console.warn('Auto-generation failed', e?.message ?? e);
        hideModal();
      } finally {
        setGenModalVisible(false);
      }
    })();
  }, [validationResult.needsGeneration, plant.plantsTableId, genLoading, autoGenRan, plant.commonName, plant.displayName, plant.scientific, generatePlantData, hideModal, fetchDetails, genError]);

  const onRefresh = useCallback(() => {
    setUi((u) => ({ ...u, refreshing: true }));
    fetchDetails(true);
  }, [fetchDetails]);

  const isRemoteHeader = !!plant.headerUrl;
  const showHeaderSkeleton = isRemoteHeader && !ui.heroLoaded;

  // Calculate header height to align bottom of info row with bottom of viewport
  // Approximate heights: TopBar (~60), text section (~180 with padding), info row (~100 with padding)
  // We want: headerHeight + TopBar + textSection + infoRow = windowHeight
  // So: headerHeight = windowHeight - TopBar - textSection - infoRow
  const estimatedTopBarHeight = 60;
  const estimatedTextSectionHeight = 180; // Includes padding (30 top + 30 bottom + ~120 content)
  const estimatedInfoRowHeight = 190; // Includes padding (24 top + 24 bottom + ~52 content)
  const calculatedHeaderHeight = Math.max(400, windowHeight - estimatedTopBarHeight - estimatedTextSectionHeight - estimatedInfoRowHeight);

  // ===== Helpers =====
  const showOverlay = (message: string) => setOverlay({ visible: true, message });
  const hideOverlay = () => setOverlay({ visible: false, message: '', percent: undefined, sublabel: undefined });


  const maybeApplySuggestedCommonName = useCallback(async (suggested?: string | null) => {
    if (!suggested || !suggested.trim() || !plant.plantsTableId) return;
    setModals((m) => ({ ...m, confirmName: { open: true, suggested } }));
  }, [plant.plantsTableId]);

  // ===== Actions =====
  const toggleFavorite = useCallback(() => {
    const next = !plant.isFavorite;
    setPlant((p) => ({ ...p, isFavorite: next }));
    if (favTimerRef.current) clearTimeout(favTimerRef.current);
    favTimerRef.current = setTimeout(async () => {
      try { await supabase.from('user_plants').update({ favorite: next }).eq('id', id); } catch {}
    }, 500);
  }, [plant.isFavorite, id]);

  const handleMoveSaved = useCallback(() => {
    setUi((u) => ({ ...u, timelineKey: u.timelineKey + 1 }));
    fetchDetails(true);
  }, [fetchDetails]);

  const saveSoil = useCallback(async () => {
    const obj: Record<string, number> = {};
    for (const r of drafts.soilRows) {
      const name = r.name.trim();
      const partsNum = Number(r.parts);
      if (!name) continue;
      if (!isFinite(partsNum) || partsNum <= 0) continue;
      obj[name] = partsNum;
    }
    const nextMix = Object.keys(obj).length > 0 ? obj : null;
    const prevMix = plant.soilMix;
    try {
      const { error: updErr } = await supabase.from('user_plants').update({ soil_mix: nextMix }).eq('id', id);
      if (updErr) throw updErr;
      setPlant((p) => ({ ...p, soilMix: nextMix }));
      setModals((m) => ({ ...m, soil: false }));
      if (user?.id && prevMix && JSON.stringify(prevMix) !== JSON.stringify(nextMix)) {
        await supabase.from('user_plant_timeline_events').insert({
          owner_id: user.id, user_plant_id: id, event_type: 'soil_changed', event_data: { previous: prevMix, next: nextMix }, note: null,
        });
      }
    } catch {}
  }, [drafts.soilRows, plant.soilMix, id, user?.id]);

  const savePot = useCallback(async () => {
    const prev = plant.pot;
    try {
      const { error: updErr } = await supabase
        .from('user_plants')
        .update({
          pot_type: potDraft.potType || null,
          drainage_system: potDraft.drainageSystem || null,
          pot_height_in: potDraft.potHeightIn ? Number(potDraft.potHeightIn) : null,
          pot_diameter_in: potDraft.potDiameterIn ? Number(potDraft.potDiameterIn) : null,
        })
        .eq('id', id);
      if (updErr) throw updErr;

      const { data: up } = await supabase
        .from('user_plants')
        .select('pot_type, pot_height_in, pot_diameter_in, drainage_system')
        .eq('id', id)
        .maybeSingle();

      setPlant((p) => ({
        ...p,
        pot: { type: up?.pot_type ?? '', heightIn: up?.pot_height_in ?? null, diameterIn: up?.pot_diameter_in ?? null, drainage: up?.drainage_system ?? '' },
      }));
      const wasEmpty = !prev.type && !prev.drainage && !prev.heightIn && !prev.diameterIn;
      const isRepot = modals.potMode === 'repot' || !wasEmpty;
      if (isRepot && user?.id) {
        await supabase.from('user_plant_timeline_events').insert({
          owner_id: user.id,
          user_plant_id: id,
          event_type: 'repot',
          event_data: {
            previous_pot_type: prev.type || null,
            previous_drainage_system: prev.drainage || null,
            previous_diameter: prev.diameterIn ?? null,
            previous_height: prev.heightIn ?? null,
            new_pot_type: up?.pot_type ?? null,
            new_drainage_system: up?.drainage_system ?? null,
            new_diameter: up?.pot_diameter_in ?? null,
            new_height: up?.pot_height_in ?? null,
          },
          note: drafts.potNote || null,
        });
      }
    } finally {
      setModals((m) => ({ ...m, pot: false }));
    }
  }, [plant.pot, potDraft, id, modals.potMode, drafts.potNote, user?.id]);

  // Fetch all photos for the plant (excluding timeline photos)
  const fetchPlantPhotos = useCallback(async () => {
    if (!id) return;
    
    try {
      setPhotosLoading(true);
      
      // Get current default_plant_photo_id to mark it
      const { data: plantData, error: plantError } = await supabase
        .from('user_plants')
        .select('default_plant_photo_id')
        .eq('id', id)
        .maybeSingle();
      
      if (plantError) throw plantError;
      
      const currentDefaultPhotoId = plantData?.default_plant_photo_id || null;
      
      // Fetch all photos for this plant
      // First, get timeline events for this plant to find which photos are linked to observations
      const { data: timelineEvents } = await supabase
        .from('user_plant_timeline_events')
        .select('id')
        .eq('user_plant_id', id);
      
      const timelineEventIds = timelineEvents?.map(e => e.id) || [];
      
      // Get photos linked to timeline events (these are observation photos, not main photos)
      let timelinePhotoIds = new Set<string>();
      if (timelineEventIds.length > 0) {
        const { data: timelinePhotoLinks } = await supabase
          .from('user_plant_timeline_event_photos')
          .select('user_plant_photo_id')
          .in('timeline_event_id', timelineEventIds);
        
        timelinePhotoIds = new Set(timelinePhotoLinks?.map(link => link.user_plant_photo_id) || []);
      }
      
      // Fetch all photos for this plant
      const { data: photos, error: photosError } = await supabase
        .from('user_plant_photos')
        .select('id, bucket, object_path, created_at')
        .eq('user_plant_id', id)
        .order('created_at', { ascending: false });
      
      if (photosError) throw photosError;
      
      // Filter out timeline photos - only keep photos that were main photos (not linked to timeline events)
      const mainPhotos = photos?.filter(photo => !timelinePhotoIds.has(photo.id)) || [];
      
      if (!mainPhotos || mainPhotos.length === 0) {
        setPlantPhotos([]);
        return;
      }
      
      // Fetch signed URLs for all photos
      const photosWithUrls = await Promise.all(
        mainPhotos.map(async (photo) => {
          const bucket = photo.bucket || 'plant-photos';
          
          // Get thumbnail signed URL
          const { data: thumbSigned } = await supabase.storage
            .from(bucket)
            .createSignedUrl(photo.object_path, 60 * 60, {
              transform: { width: 300, height: 300, quality: 85, resize: 'cover' },
            });
          
          // Get full-size signed URL
          const { data: fullSigned } = await supabase.storage
            .from(bucket)
            .createSignedUrl(photo.object_path, 60 * 60);
          
          return {
            id: photo.id,
            thumbUrl: thumbSigned?.signedUrl || fullSigned?.signedUrl || '',
            fullUrl: fullSigned?.signedUrl || thumbSigned?.signedUrl || '',
            isDefault: photo.id === currentDefaultPhotoId,
            createdAt: photo.created_at,
            bucket: photo.bucket || 'plant-photos',
            objectPath: photo.object_path,
          };
        })
      );
      
      setPlantPhotos(photosWithUrls);
    } catch (err: any) {
      console.error('[PlantDetailScreen] Error fetching plant photos:', err);
      setPlantPhotos([]);
    } finally {
      setPhotosLoading(false);
    }
  }, [id]);

  // Set a photo as the main photo
  const handleSetMainPhoto = useCallback(async (photoId: string) => {
    try {
      setPhotosLoading(true);
      
      // Update default_plant_photo_id in user_plants
      const { error: updateErr } = await supabase
        .from('user_plants')
        .update({ default_plant_photo_id: photoId })
        .eq('id', id);
      
      if (updateErr) throw updateErr;
      
      // Refresh plant data to update header image
      await fetchDetails(true);
      
      // Refresh photos list to update the star badges
      await fetchPlantPhotos();
      
      Alert.alert('Success', 'Main photo updated successfully.');
    } catch (err: any) {
      console.error('[PlantDetailScreen] Error setting main photo:', err);
      Alert.alert('Error', err?.message ?? 'Failed to set main photo');
    } finally {
      setPhotosLoading(false);
    }
  }, [id, fetchDetails, fetchPlantPhotos]);

  // Delete a photo
  const handleDeletePhoto = useCallback(async (photoId: string, isDefault: boolean, bucket: string, objectPath: string) => {
    Alert.alert(
      'Delete Photo',
      isDefault 
        ? 'This is the main photo. Deleting it will remove it from the plant. Continue?'
        : 'Are you sure you want to delete this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setPhotosLoading(true);
              
              // Delete the file from Supabase Storage
              const { error: storageErr } = await supabase.storage
                .from(bucket)
                .remove([objectPath]);
              
              if (storageErr) {
                console.error('[PlantDetailScreen] Error deleting photo from storage:', storageErr);
                // Continue with database deletion even if storage deletion fails
              }
              
              // Delete the photo record from database
              const { error: deleteErr } = await supabase
                .from('user_plant_photos')
                .delete()
                .eq('id', photoId);
              
              if (deleteErr) throw deleteErr;
              
              // If this was the main photo, clear default_plant_photo_id
              if (isDefault) {
                const { error: updateErr } = await supabase
                  .from('user_plants')
                  .update({ default_plant_photo_id: null })
                  .eq('id', id);
                
                if (updateErr) {
                  console.error('[PlantDetailScreen] Error clearing default photo:', updateErr);
                  // Continue even if this fails
                }
                
                // Refresh plant data to update header image
                await fetchDetails(true);
              }
              
              // Refresh photos list
              await fetchPlantPhotos();
              
              Alert.alert('Success', 'Photo deleted successfully.');
            } catch (err: any) {
              console.error('[PlantDetailScreen] Error deleting photo:', err);
              Alert.alert('Error', err?.message ?? 'Failed to delete photo');
            } finally {
              setPhotosLoading(false);
            }
          },
        },
      ]
    );
  }, [id, fetchDetails, fetchPlantPhotos]);

  // Handle photo long press - show action sheet
  const handlePhotoLongPressWithRefs = useCallback((photo: { id: string; thumbUrl: string; fullUrl: string; isDefault: boolean; createdAt: string | null; bucket: string; objectPath: string }) => {
    if (photo.isDefault) {
      // If already main photo, only show delete option
      handleDeletePhoto(photo.id, photo.isDefault, photo.bucket, photo.objectPath);
    } else {
      // If not main photo, show both options
      Alert.alert(
        'Photo Options',
        'Choose an action for this photo',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Make Main Photo',
            onPress: async () => {
              await handleSetMainPhoto(photo.id);
            },
          },
          {
            text: 'Delete Photo',
            style: 'destructive',
            onPress: () => {
              handleDeletePhoto(photo.id, photo.isDefault, photo.bucket, photo.objectPath);
            },
          },
        ]
      );
    }
  }, [handleSetMainPhoto, handleDeletePhoto]);

  // Fetch photos when photos section is opened
  useEffect(() => {
    if (openSection === 'photos') {
      fetchPlantPhotos();
    }
  }, [openSection, fetchPlantPhotos]);

  const handleChangePhoto = useCallback(async () => {
    if (!user?.id || ui.uploadingPhoto) return;

    try {
      // Request permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'We need access to your photo library to change the plant photo.');
        return;
      }

      // Open image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        allowsEditing: false,
      } as any);

      if (result.canceled || !result.assets?.[0]) return;

      setUi((u) => ({ ...u, uploadingPhoto: true }));

      const asset = result.assets[0];
      
      // Fetch the image as array buffer
      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();
      
      // Generate unique path for the photo (matching pattern from ObserveScreen)
      const now = new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const rand = (global as any).crypto?.randomUUID
        ? (global as any).crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      const extMatch = /\.(\w+)$/.exec(asset.uri);
      const ext = (extMatch?.[1] || 'jpg').toLowerCase();
      // Use path pattern: {user_id}/{plant_id}/originals/{year}/{month}/{timestamp}-{random}.{ext}
      // This matches the pattern used in AddPlantScreen and should work with existing storage policies
      const objectPath = `${user.id}/${id}/originals/${yyyy}/${mm}/${Date.now()}-${rand}.${ext}`;
      const contentType = asset.mimeType || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');

      // Upload to Supabase storage
      const { error: uploadErr } = await supabase.storage
        .from('plant-photos')
        .upload(objectPath, arrayBuffer, { contentType, upsert: false });
      
      if (uploadErr) throw uploadErr;

      // Create record in user_plant_photos
      const insertPayload = {
        owner_id: user.id,
        user_plant_id: id,
        bucket: 'plant-photos',
        object_path: objectPath,
        content_type: contentType,
        bytes: arrayBuffer.byteLength ?? null,
        width_px: asset.width ?? null,
        height_px: asset.height ?? null,
      };
      
      console.log('[PlantDetailScreen] Inserting photo record:', insertPayload);
      
      const { data: photoRow, error: photoErr } = await supabase
        .from('user_plant_photos')
        .insert(insertPayload)
        .select('id')
        .single();
      
      if (photoErr) {
        console.error('[PlantDetailScreen] Photo insert error:', photoErr);
        console.error('[PlantDetailScreen] Error details:', JSON.stringify(photoErr, null, 2));
        throw photoErr;
      }
      if (!photoRow?.id) throw new Error('Failed to create photo record');

      // Update default_plant_photo_id in user_plants
      console.log('[PlantDetailScreen] Updating default_plant_photo_id:', { id, photoId: photoRow.id });
      const { error: updateErr } = await supabase
        .from('user_plants')
        .update({ default_plant_photo_id: photoRow.id })
        .eq('id', id);
      
      if (updateErr) {
        console.error('[PlantDetailScreen] User plants update error:', updateErr);
        console.error('[PlantDetailScreen] Error details:', JSON.stringify(updateErr, null, 2));
        throw updateErr;
      }

      // Refresh plant data to show new photo
      await fetchDetails(true);
      
      // Refresh photos list if photos section is open
      if (openSection === 'photos') {
        await fetchPlantPhotos();
      }
      
      Alert.alert('Success', 'Plant photo updated successfully.');
    } catch (e: any) {
      console.error('[PlantDetailScreen] Error changing photo:', e);
      Alert.alert('Error', e?.message ?? 'Failed to update plant photo');
    } finally {
      setUi((u) => ({ ...u, uploadingPhoto: false }));
    }
  }, [user?.id, id, ui.uploadingPhoto, fetchDetails, openSection, fetchPlantPhotos]);

  // ===== Render =====
  return (
    <View style={{ flex: 1 }}>
      <TopBar
        title={plant.displayName || 'Plant'}
        isFavorite={plant.isFavorite}
        onBack={() => {
          if (onClose) {
            onClose();
          } else {
            (nav as any).navigate('MainTabs', { screen: 'MyPlants' });
          }
        }}
        onToggleFavorite={toggleFavorite}
        onToggleMenu={() => setUi((u) => ({ ...u, menuOpen: !u.menuOpen }))}
        showUpdateButton={userDeclinedUpdate && validationResult.needsGeneration}
        lineage={plant.lineage}
        lightType={plant.lightType}
        systemType={plant.systemType}
        backgroundColor="#6B8E23"
        isInfected={healthStatus === 'Sick'}
        onUpdate={() => {
          setUserDeclinedUpdate(false);
          // Re-trigger validation to show the modal
          if (plant.plantsTableId) {
            validatePlantData(plant.plantsTableId);
          }
        }}
      />

      {ui.menuOpen && (
        <MenuSheet
          onEdit={() => {
            setUi((u) => ({ ...u, menuOpen: false }));
            (nav as any).navigate('AddPlant', { userPlantId: id });
          }}
          onMarkSold={async () => {
            setUi((u) => ({ ...u, menuOpen: false }));
            const isSold = !!plant.soldAt;
            
            if (isSold) {
              // Mark as not sold (remove sold_at)
              Alert.alert('Not sold', 'Mark this plant as not sold?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Not sold',
                  style: 'default',
                  onPress: async () => {
                    try {
                      // Update sold_at to null
                      const { error: updateErr } = await supabase
                        .from('user_plants')
                        .update({ sold_at: null })
                        .eq('id', id);
                      if (updateErr) throw updateErr;

                      // Update local state
                      setPlant((prev) => ({ ...prev, soldAt: null }));

                      Alert.alert('Success', 'Plant marked as not sold.');
                      // Refresh to update UI
                      fetchDetails(false);
                    } catch (e: any) {
                      Alert.alert('Error', e?.message ?? 'Failed to mark plant as not sold');
                    }
                  },
                },
              ]);
            } else {
              // Mark as sold
              Alert.alert('Mark Sold', 'Mark this plant as sold?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Mark Sold',
                  style: 'default',
                  onPress: async () => {
                    try {
                      const now = new Date();
                      // Update sold_at column
                      const { error: updateErr } = await supabase
                        .from('user_plants')
                        .update({ sold_at: now.toISOString() })
                        .eq('id', id);
                      if (updateErr) throw updateErr;

                      // Update local state
                      setPlant((prev) => ({ ...prev, soldAt: now.toISOString() }));

                      Alert.alert('Success', 'Plant marked as sold.');
                      // Navigate back to My Plants
                      if (onClose) {
                        onClose();
                      } else {
                        (nav as any).navigate('MainTabs', { screen: 'MyPlants' });
                      }
                    } catch (e: any) {
                      Alert.alert('Error', e?.message ?? 'Failed to mark plant as sold');
                    }
                  },
                },
              ]);
            }
          }}
          onSetDeceased={async () => {
            setUi((u) => ({ ...u, menuOpen: false }));
            const isDeceased = !!plant.deceasedAt;
            
            if (isDeceased) {
              // Mark as living (remove deceased_at)
              Alert.alert('Mark Living', 'Mark this plant as living?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Mark Living',
                  style: 'default',
                  onPress: async () => {
                    try {
                      // Update deceased_at to null
                      const { error: updateErr } = await supabase
                        .from('user_plants')
                        .update({ deceased_at: null })
                        .eq('id', id);
                      if (updateErr) throw updateErr;

                      // Update local state
                      setPlant((prev) => ({ ...prev, deceasedAt: null }));

                      Alert.alert('Success', 'Plant marked as living.');
                      // Refresh to update UI
                      fetchDetails(false);
                    } catch (e: any) {
                      Alert.alert('Error', e?.message ?? 'Failed to mark plant as living');
                    }
                  },
                },
              ]);
            } else {
              // Mark as deceased
              Alert.alert('Set Deceased', 'Mark this plant as deceased? This will remove all future schedule events.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Set Deceased',
                  style: 'default',
                  onPress: async () => {
                    try {
                      const now = new Date();
                      // Update deceased_at column
                      const { error: updateErr } = await supabase
                        .from('user_plants')
                        .update({ deceased_at: now.toISOString() })
                        .eq('id', id);
                      if (updateErr) throw updateErr;

                      // Delete all future schedule events
                      const { error: deleteSchedulesErr } = await supabase
                        .from('user_plant_schedules')
                        .delete()
                        .eq('user_plant_id', id)
                        .gte('next_run_at', now.toISOString());
                      if (deleteSchedulesErr) throw deleteSchedulesErr;

                      // Update local state
                      setPlant((prev) => ({ ...prev, deceasedAt: now.toISOString() }));

                      Alert.alert('Success', 'Plant marked as deceased and future schedules removed.');
                      // Navigate back to My Plants
                      if (onClose) {
                        onClose();
                      } else {
                        (nav as any).navigate('MainTabs', { screen: 'MyPlants' });
                      }
                    } catch (e: any) {
                      Alert.alert('Error', e?.message ?? 'Failed to set plant as deceased');
                    }
                  },
                },
              ]);
            }
          }}
          isDeceased={!!plant.deceasedAt}
          isSold={!!plant.soldAt}
          onDelete={() => {
            setUi((u) => ({ ...u, menuOpen: false }));
            Alert.alert('Delete plant', 'Are you sure you want to delete this plant?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    const { error: delErr } = await supabase.from('user_plants').delete().eq('id', id);
                    if (delErr) throw delErr;
                    if (nav) {
                      (nav as any).navigate('MainTabs');
                    } else if (onClose) {
                      onClose();
                    }
                  } catch (e: any) {
                    Alert.alert('Delete failed', e?.message ?? 'Unknown error');
                  }
                },
              },
            ]);
          }}
        />
      )}

      <ParallaxScrollView
        headerBackgroundColor={{ light: '#E5F4EF', dark: '#12231F' }}
        refreshing={ui.refreshing}
        onRefresh={onRefresh}
        enableLightbox={!!plant.headerUrl}
        lightboxImages={plant.headerUrl ? [{ uri: plant.headerUrl, id: 'plant-header' }] : []}
        headerHeight={calculatedHeaderHeight}
        headerImage={
          plant.headerUrl ? (
            <Image
              key={plant.headerUrl}
              source={{ uri: plant.headerUrl }}
              contentFit="cover"
              priority="high"
              style={styles.headerImage}
              onLoadStart={() => setUi((u) => ({ ...u, heroLoaded: false }))}
              onLoadEnd={() => setUi((u) => ({ ...u, heroLoaded: true }))}
              onError={() => setUi((u) => ({ ...u, heroLoaded: true }))}
            />
          ) : (
            <></>
          )
        }
        headerOverlay={showHeaderSkeleton ? <SkeletonTile style={styles.headerSkeleton} rounded={0} /> : null}
        headerActions={
          <View style={styles.headerActionsContainer}>
            <TouchableOpacity
              onPress={handleChangePhoto}
              disabled={ui.uploadingPhoto}
              style={[styles.changePhotoButton, { backgroundColor: 'rgba(0, 0, 0, 0.6)', borderColor: theme.colors.border }]}
              activeOpacity={0.8}
            >
              {ui.uploadingPhoto ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <IconSymbol name="camera.fill" size={18} color="#ffffff" />
                  <ThemedText style={styles.changePhotoButtonText}>Change Photo</ThemedText>
                </>
              )}
            </TouchableOpacity>
          </View>
        }
      >
        {status.loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
          </View>
        ) : status.error ? (
          <ThemedText>{status.error}</ThemedText>
        ) : (
          <>
            <View style={styles.outermostContainer}>
              <View style={styles.borderRadiusWrapper}>
                <View style={styles.textOutermostContainer}>
                  <View style={styles.verticalDotsBorder}>
                    <View style={[styles.dot, styles.dotDash, { backgroundColor: '#6B8E23' }]} />
                    <View style={[styles.dot, { backgroundColor: '#9DB668' }]} />
                    <View style={[styles.dot, { backgroundColor: '#9DB668' }]} />
                    <View style={[styles.dot, { backgroundColor: '#9DB668' }]} />
                  </View>
                  <ThemedView style={styles.textContainer}>
                    {/* Nickname under header */}
                    <ThemedText type="title">{plant.displayName}</ThemedText>
                  {!!plant.scientific && (
                    <Pressable
                      onPress={() => {
                        if (plant.speciesTaxonId) {
                          setModals((m) => ({ ...m, taxonomy: true }));
                        }
                      }}
                      style={{ paddingRight: 20, width: '100%' }}
                    >
                      <ThemedText 
                        style={{ 
                          opacity: 0.7, 
                          fontStyle: 'italic',
                          flexShrink: 1
                        }}
                      >
                        {plant.scientific}
                      </ThemedText>
                    </Pressable>
                  )}
                    <CompactStatus rarity={availabilityLabel ? rarityLabel : ''} availability={availabilityLabel} />
                  </ThemedView>
                </View>
              </View>
            </View>

            <View style={styles.infoRowContainer}>
              <View style={styles.infoColumn}>
                <IconSymbol name="ruler" size={24} color="#ffffff" />
                <ThemedText style={styles.infoTitle}>Height</ThemedText>
                <ThemedText style={styles.infoSubtitle}>40cm - 50cm</ThemedText>
              </View>
              <View style={styles.infoColumn}>
                <IconSymbol name="leaf" size={24} color="#ffffff" />
                <ThemedText style={styles.infoTitle}>Spread</ThemedText>
                <ThemedText style={styles.infoSubtitle}>50cm - 60cm</ThemedText>
              </View>
              <View style={styles.infoColumn}>
                <IconSymbol name="heart.fill" size={24} color="#ffffff" />
                <ThemedText style={styles.infoTitle}>Health</ThemedText>
                <ThemedText style={styles.infoSubtitle}>{healthStatus}</ThemedText>
              </View>
            </View>

            <View style={styles.aboutSectionContainer}>
              <AboutBox title="About Plant" body={plant.description} backgroundColor="#7FA947" borderColor="transparent" containerStyle={{ marginTop: 0 }} />
            </View>

            <View style={styles.contentPaddingContainer}>
              <View style={{ marginTop: 0 }}>
              <Section title="Care & Schedule" open={openSection === 'care'} onToggle={() => toggle('care')} headerBackgroundColor="#7FA947">
                <CareSection
                  isOpen={openSection === 'care'}
                  plantsTableId={plant.plantsTableId}
                  userPlantId={id}
                  commonName={plant.commonName}
                  displayName={plant.displayName}
                  scientificName={plant.scientific}
                  showOverlay={(msg) => setOverlay({ visible: true, message: msg })}
                  hideOverlay={() => setOverlay({ visible: false, message: '', percent: undefined, sublabel: undefined })}
                  onRefetch={() => fetchDetails(true)}
                  onWater={() => setModals((m) => ({ ...m, water: true }))}   // <— opens WaterModal
                  onFertilize={() => setModals((m) => ({ ...m, fertilize: true }))}
                  onPrune={() => setModals((m) => ({ ...m, prune: true }))}
                  onObserve={() => (nav as any).navigate('Observe', { id })}
                  onIdentifyPest={() => setModals((m) => ({ ...m, pest: true }))}
                  onTreatPest={() => setModals((m) => ({ ...m, pestTreat: true }))}
                  optimisticCare={optimisticCare}
                />
              </Section>

              <Section 
                title="Timeline" 
                open={openSection === 'timeline'} 
                onToggle={() => toggle('timeline')}
                headerBackgroundColor="#7FA947"
              >
                {/* Event Type Dropdown - on its own line */}
                <View style={{ marginBottom: 12 }}>
                  <View style={{ position: 'relative', alignSelf: 'flex-end' }}>
                    {timelineEventTypeOpen && (
                      <TouchableOpacity 
                        onPress={() => setTimelineEventTypeOpen(false)} 
                        style={StyleSheet.absoluteFillObject} 
                      />
                    )}
                    <TouchableOpacity
                      onPress={() => setTimelineEventTypeOpen((o) => !o)}
                      activeOpacity={0.8}
                      style={{
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.input,
                        borderRadius: 8,
                        paddingLeft: 10,
                        paddingRight: 30,
                        paddingVertical: 6,
                        minWidth: 100,
                      }}
                    >
                      <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>
                        {timelineEventType}
                      </ThemedText>
                      <View style={{ position: 'absolute', right: 6, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                        <IconSymbol name={timelineEventTypeOpen ? 'chevron.up' : 'chevron.down'} size={16} color={theme.colors.mutedText} />
                      </View>
                    </TouchableOpacity>
                    {timelineEventTypeOpen && (
                      <View
                        style={{
                          position: 'absolute',
                          top: 32,
                          right: 0,
                          zIndex: 100,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: theme.colors.border,
                          borderRadius: 8,
                          overflow: 'hidden',
                          backgroundColor: theme.colors.card,
                          shadowColor: '#000',
                          shadowOpacity: 0.12,
                          shadowRadius: 8,
                          shadowOffset: { width: 0, height: 4 },
                          elevation: 4,
                          minWidth: 100,
                        }}
                      >
                        {(['Water', 'Fertilize'] as const).map((type) => (
                          <TouchableOpacity
                            key={type}
                            onPress={() => { setTimelineEventType(type); setTimelineEventTypeOpen(false); }}
                            style={{ paddingHorizontal: 12, paddingVertical: 10, backgroundColor: timelineEventType === type ? theme.colors.input : 'transparent' }}
                          >
                            <ThemedText style={{ fontWeight: '600', fontSize: 13 }}>{type}</ThemedText>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </View>

                {/* Chart */}
                <TimelineChart eventType={timelineEventType} userPlantId={id} />

                {/* Calendar Component */}
                <TimelineCalendar eventType={timelineEventType} userPlantId={id} />
              </Section>

              <Section title="Environment" open={openSection === 'environment'} onToggle={() => toggle('environment')} headerBackgroundColor="#7FA947">
                <EnvironmentSection
                  plantLocation={plant.location}
                  potType={plant.pot.type}
                  potHeightIn={plant.pot.heightIn}
                  potDiameterIn={plant.pot.diameterIn}
                  drainageSystem={plant.pot.drainage}
                  soilMix={plant.soilMix}
                  soilDescription={plant.soilDescription}
                  onAddPotDetails={() => {
                    setModals((m) => ({ ...m, pot: true, potMode: 'add' }));
                    setPotDraft(toPotDraft(plant.pot));
                    setDrafts((d) => ({ ...d, potNote: '' }));
                  }}
                  onRepot={() => {
                    setModals((m) => ({ ...m, pot: true, potMode: 'repot' }));
                    setPotDraft(toPotDraft(plant.pot));
                    setDrafts((d) => ({ ...d, potNote: '' }));
                  }}
                  onMove={() => {
                    setModals((m) => ({ ...m, location: true }));
                  }}
                  SoilMixSlot={
                    plant.soilMix && Object.keys(plant.soilMix).length > 0 ? (
                      <SoilMixViz
                        mix={Object.entries(plant.soilMix).map(([label, parts]) => ({ label, parts: Number(parts), icon: 'leaf' }))}
                      />
                    ) : (
                      <View style={{ alignItems: 'center' }}>
                        <ButtonPill
                          label="Set Soil Mix"
                          variant="solid"
                          color="primary"
                          onPress={() => {
                            setDrafts((d) => ({ ...d, soilRows: [] }));
                            setModals((m) => ({ ...m, soil: true }));
                          }}
                        />
                      </View>
                    )
                  }
                />
                {plant.soilMix && Object.keys(plant.soilMix).length > 0 ? (
                  <View style={{ marginTop: 8 }}>
                    <ButtonPill
                      label="Change soil mix"
                      onPress={() => {
                        const rows = Object.entries(plant.soilMix || {}).map(([name, parts]) => ({
                          id: Math.random().toString(36).slice(2),
                          name,
                          parts: String(parts),
                        }));
                        setDrafts((d) => ({ ...d, soilRows: rows }));
                        setModals((m) => ({ ...m, soil: true }));
                      }}
                    />
                  </View>
                ) : null}
              </Section>

              <Section title="Propagation" open={openSection === 'propagation'} onToggle={() => toggle('propagation')} headerBackgroundColor="#7FA947">
                {/* Parent and Children Plants */}
                {(parentPlant || childrenPlants.length > 0) && (
                  <View style={{ gap: 16, marginBottom: 24 }}>
                    {/* Parent Plant */}
                    {parentPlant && (
                      <View style={{ gap: 8 }}>
                        <ThemedText style={{ fontWeight: '700', fontSize: 16 }}>Parentage</ThemedText>
                        <View style={{ width: '48%' }}>
                          <FavoritePlantCard
                            plant={parentPlant}
                            size="medium"
                            onPress={() => {
                              if (onClose) {
                                onClose();
                              }
                              (nav as any).navigate('PlantDetail', { id: parentPlant.id });
                            }}
                            shouldLoadImage={true}
                          />
                        </View>
                      </View>
                    )}
                    
                    {/* Children Plants */}
                    {childrenPlants.length > 0 && (
                      <View style={{ gap: 8 }}>
                        <ThemedText style={{ fontWeight: '700', fontSize: 16 }}>Children</ThemedText>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {childrenPlants.map((child) => (
                            <View key={child.id} style={{ width: '31%' }}>
                              <FavoritePlantCard
                                plant={child}
                                size="small"
                                onPress={() => {
                                  if (onClose) {
                                    onClose();
                                  }
                                  (nav as any).navigate('PlantDetail', { id: child.id });
                                }}
                                shouldLoadImage={true}
                              />
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                )}
                
                {/* Propagation Methods */}
                {sortedPropagation.length === 0 ? (
                  <ThemedText style={{ opacity: 0.75 }}>No propagation methods available.</ThemedText>
                ) : (
                  <View style={{ gap: 16, paddingVertical: 8 }}>
                    {sortedPropagation.map((pm, idx) => {
                      const label = (pm.method || '')
                        .trim()
                        .toLowerCase()
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, (c) => c.toUpperCase());
                      const diff = (pm.difficulty || '').toLowerCase();
                      const maxBars = 4; // easy..very_challenging
                      const level = diff === 'easy' ? 1 : diff === 'moderate' ? 2 : diff === 'challenging' ? 3 : diff === 'very_challenging' ? 4 : 0;
                      const fillColor = level === 1
                        ? '#10B981' // easy: green
                        : level === 2
                          ? '#F59E0B' // moderate: yellow-orange
                          : level === 3
                            ? '#F43F5E' // challenging: redder tone
                            : level === 4
                              ? '#EF4444' // very challenging: deep red
                              : theme.colors.border;
                      return (
                        <View key={`${pm.method}-${idx}`} style={{ gap: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
                              <ThemedText style={{ fontWeight: '800', fontSize: 20 }}>{label}</ThemedText>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <View style={{ flexDirection: 'row', gap: 2 }}>
                                  {Array.from({ length: maxBars }).map((_, i) => (
                                    <View
                                      key={i}
                                      style={{
                                        width: 12,
                                        height: 6,
                                        borderRadius: 3,
                                        backgroundColor: i < level ? fillColor : theme.colors.border,
                                      }}
                                    />
                                  ))}
                                </View>
                                {!!diff && (
                                  <ThemedText style={{ opacity: 0.8, fontWeight: '700' }}>
                                    {diff.replace('_', ' ').replace(/^./, c => c.toUpperCase())}
                                  </ThemedText>
                                )}
                              </View>
                            </View>
                          </View>
                          {typeof pm.min_days === 'number' && typeof pm.max_days === 'number' && (
                            <ThemedText style={{ color: theme.colors.mutedText }}>
                              Takes between {pm.min_days} and {pm.max_days} days
                            </ThemedText>
                          )}
                          {!!pm.description && (
                            <ThemedText style={{ color: theme.colors.mutedText }}>{pm.description}</ThemedText>
                          )}
                          {/* Divide button for division method on user's plants */}
                          {pm.method === 'division' && id && (
                            <TouchableOpacity
                              onPress={async () => {
                                try {
                                  // Calculate next lineage
                                  const currentLineage = plant.lineage || 'A';
                                  
                                  // Query all plants propagated from this plant to find existing lineages
                                  const { data: propagatedPlants } = await supabase
                                    .from('user_plants')
                                    .select('lineage')
                                    .eq('owner_id', user?.id)
                                    .eq('propagated_from_user_plant_id', id)
                                    .not('lineage', 'is', null);
                                  
                                  // Extract existing numeric/alphabetical suffixes
                                  const existingLineages = (propagatedPlants || [])
                                    .map(p => p.lineage)
                                    .filter((l): l is string => Boolean(l));
                                  
                                  // Calculate next lineage
                                  let nextLineage = '';
                                  if (currentLineage.match(/^[A-Z]$/)) {
                                    // Base lineage (A, B, C) -> A1, A2, etc.
                                    const base = currentLineage;
                                    const existingNums = existingLineages
                                      .filter(l => l.startsWith(base) && /^[A-Z]\d+$/.test(l))
                                      .map(l => {
                                        const match = l.match(/^[A-Z](\d+)$/);
                                        return match ? parseInt(match[1], 10) : 0;
                                      })
                                      .filter(n => n > 0)
                                      .sort((a, b) => a - b);
                                    
                                    let nextNum = 1;
                                    for (const num of existingNums) {
                                      if (num === nextNum) {
                                        nextNum++;
                                      } else {
                                        break;
                                      }
                                    }
                                    nextLineage = `${base}${nextNum}`;
                                  } else if (currentLineage.match(/^[A-Z]\d+$/)) {
                                    // Numbered lineage (A1, A2) -> A1a, A1b, etc.
                                    const base = currentLineage;
                                    const existingLetters = existingLineages
                                      .filter(l => l.startsWith(base) && l.length > base.length)
                                      .map(l => l.substring(base.length))
                                      .filter(s => /^[a-z]+$/.test(s))
                                      .map(s => s.charCodeAt(0) - 97) // Convert a-z to 0-25
                                      .sort((a, b) => a - b);
                                    
                                    let nextLetterCode = 0;
                                    for (const code of existingLetters) {
                                      if (code === nextLetterCode) {
                                        nextLetterCode++;
                                      } else {
                                        break;
                                      }
                                    }
                                    nextLineage = `${base}${String.fromCharCode(97 + nextLetterCode)}`; // 97 is 'a'
                                  } else if (currentLineage.match(/^[A-Z]\d+[a-z]+$/)) {
                                    // Lettered lineage (A1a, A1b) -> A1aa, A1ab, etc.
                                    const base = currentLineage;
                                    const existingSuffixes = existingLineages
                                      .filter(l => l.startsWith(base) && l.length > base.length)
                                      .map(l => l.substring(base.length))
                                      .filter(s => /^[a-z]+$/.test(s))
                                      .map(s => s.charCodeAt(0) - 97)
                                      .sort((a, b) => a - b);
                                    
                                    let nextLetterCode = 0;
                                    for (const code of existingSuffixes) {
                                      if (code === nextLetterCode) {
                                        nextLetterCode++;
                                      } else {
                                        break;
                                      }
                                    }
                                    nextLineage = `${base}${String.fromCharCode(97 + nextLetterCode)}`;
                                  } else {
                                    // Fallback: just append '1'
                                    nextLineage = `${currentLineage}1`;
                                  }
                                  
                                  // Navigate to AddPlantScreen with pre-populated data
                                  (nav as any).navigate('AddPlant', {
                                    divideFromPlantId: id,
                                    speciesId: plant.plantsTableId,
                                    speciesCommon: plant.commonName,
                                    speciesScientific: plant.scientific,
                                    propagatedFromId: id,
                                    lineage: nextLineage,
                                  });
                                } catch (error) {
                                  console.error('Error calculating lineage:', error);
                                  Alert.alert('Error', 'Failed to calculate lineage. Please try again.');
                                }
                              }}
                              style={{
                                marginTop: 8,
                                paddingVertical: 10,
                                paddingHorizontal: 16,
                                backgroundColor: theme.colors.primary,
                                borderRadius: 8,
                                alignSelf: 'flex-start',
                              }}
                            >
                              <ThemedText style={{ color: '#fff', fontWeight: '600' }}>Divide</ThemedText>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </Section>
              <Section title="Photos" open={openSection === 'photos'} onToggle={() => toggle('photos')} headerBackgroundColor="#7FA947">
                {photosLoading ? (
                  <View style={{ padding: 24, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  </View>
                ) : plantPhotos.length === 0 ? (
                  <ThemedText style={{ padding: 16, opacity: 0.7, textAlign: 'center' }}>
                    No photos yet. Change the main photo to add photos here.
                  </ThemedText>
                ) : (
                  <View style={styles.photosGrid}>
                    {plantPhotos.map((photo) => (
                      <TouchableOpacity
                        key={photo.id}
                        activeOpacity={0.9}
                        style={[
                          styles.photoThumbnail,
                          { borderColor: theme.colors.border }
                        ]}
                        onPress={() => {
                          // Open lightbox
                          const photoIndex = plantPhotos.findIndex(p => p.id === photo.id);
                          setLightboxInitialIndex(photoIndex >= 0 ? photoIndex : 0);
                          setLightboxOpen(true);
                        }}
                        onLongPress={() => {
                          handlePhotoLongPressWithRefs(photo);
                        }}
                      >
                        <Image
                          source={{ uri: photo.thumbUrl }}
                          style={styles.photoThumbnailImage}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                        />
                        {photo.isDefault && (
                          <Pressable
                            style={styles.photoStarBadge}
                            onPress={(e) => {
                              e.stopPropagation();
                              // Star on main photo - clicking it does nothing since it's already main
                              // But we can add functionality here if needed in the future
                            }}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <IconSymbol 
                              name="star.fill" 
                              size={14} 
                              weight="bold" 
                              color="#ffffff" 
                            />
                          </Pressable>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </Section>
              </View>
            </View>
          </>
        )}
      </ParallaxScrollView>

      {/* Full-page progress overlay */}
      <Modal visible={overlay.visible} transparent animationType="fade">
        <View style={styles.overlayBackdrop}>
          <View style={[styles.overlayCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }] }>
            <ActivityIndicator color={theme.colors.text as any} />
            <ThemedText style={{ marginTop: 12, fontWeight: '700' }}>
              {overlay.message || 'Working…'}
            </ThemedText>
            {overlay.sublabel && (
              <ThemedText style={{ marginTop: 4, fontWeight: '700', color: theme.colors.mutedText }}>
                {overlay.sublabel}
              </ThemedText>
            )}
            {typeof overlay.percent === 'number' && (
              <>
                <View style={styles.progressWrap}>
                  <View style={[styles.progressBar, { width: `${overlay.percent}%`, backgroundColor: theme.colors.text }]} />
                </View>
                <ThemedText style={{ marginTop: 6, opacity: 0.7 }}>
                  {overlay.percent}%
                </ThemedText>
              </>
            )}
          </View>
          <Pressable style={styles.overlayBlocker} />
        </View>
      </Modal>

      {/* Modals */}
      <WaterModal open={modals.water} onClose={() => setModals((m) => ({ ...m, water: false }))} userPlantIds={[id]} onSaved={() => setUi((u) => ({ ...u, timelineKey: u.timelineKey + 1 }))} />
      <FertilizeModal open={modals.fertilize} onClose={() => setModals((m) => ({ ...m, fertilize: false }))} userPlantIds={[id]} onSaved={() => setUi((u) => ({ ...u, timelineKey: u.timelineKey + 1 }))} />
      <PruneModal open={modals.prune} onClose={() => setModals((m) => ({ ...m, prune: false }))} userPlantId={id} onSaved={() => setUi((u) => ({ ...u, timelineKey: u.timelineKey + 1 }))} />
      <PestIdModal
        open={modals.pest}
        onClose={() => setModals((m) => ({ ...m, pest: false }))}
        userPlantIds={[id]}
        onSaved={() => setUi((u) => ({ ...u, timelineKey: u.timelineKey + 1 }))}
      />
      <PestTreatModal
        open={modals.pestTreat}
        onClose={() => setModals((m) => ({ ...m, pestTreat: false }))}
        userPlantIds={[id]}
        onSaved={() => setUi((u) => ({ ...u, timelineKey: u.timelineKey + 1 }))}
      />

      {/* Photo Lightbox */}
      {plantPhotos.length > 0 && (
        <ImageLightbox
          visible={lightboxOpen}
          images={plantPhotos.map(p => ({ uri: p.fullUrl, id: p.id, dateCreated: p.createdAt }))}
          initialIndex={lightboxInitialIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
      <ConfirmNameModal
        open={(modals as any).confirmName?.open}
        suggested={(modals as any).confirmName?.suggested ?? null}
        onCancel={() => setModals((m: any) => ({ ...m, confirmName: { open: false, suggested: null } }))}
        onConfirm={async () => {
          const suggested = (modals as any).confirmName?.suggested as string | null;
          if (!suggested || !plant.plantsTableId) {
            setModals((m: any) => ({ ...m, confirmName: { open: false, suggested: null } }));
            return;
          }
          try {
            setOverlay({ visible: true, message: 'Updating common name…' });
            const { error } = await supabase
              .from('plants_core')
              .update({ plant_name: suggested })
              .eq('id', plant.plantsTableId);
            if (error) throw error;
            await fetchDetails(true);
          } catch (e: any) {
            Alert.alert('Update failed', e?.message ?? 'Could not update common name.');
          } finally {
            setOverlay({ visible: false, message: '' });
            setModals((m: any) => ({ ...m, confirmName: { open: false, suggested: null } }));
          }
        }}
      />
      <TaxonomyModal
        open={modals.taxonomy}
        onClose={() => setModals((m) => ({ ...m, taxonomy: false }))}
        speciesTaxonId={plant.speciesTaxonId}
      />
      <MoveModal
        open={modals.location}
        userPlantId={id}
        currentLocationId={plant.locationId}
        currentLocationName={plant.location}
        onClose={() => setModals((m) => ({ ...m, location: false }))}
        onSaved={handleMoveSaved}
      />
      <SoilModal
        open={modals.soil}
        rows={drafts.soilRows}
        setRows={(rows) => setDrafts((d) => ({ ...d, soilRows: rows }))}
        onCancel={() => setModals((m) => ({ ...m, soil: false }))}
        onSave={saveSoil}
      />
      <PotDetailsModal
        open={modals.pot}
        mode={modals.potMode}
        draft={potDraft}
        setDraft={setPotDraft}
        note={drafts.potNote}
        setNote={(t) => setDrafts((d) => ({ ...d, potNote: t }))}
        onCancel={() => setModals((m) => ({ ...m, pot: false }))}
        onSave={savePot}
      />

      <PlantDataGenerationModal
        visible={genModalVisible}
        onClose={() => { setGenModalVisible(false); hideModal(); }}
        onGenerate={() => {}}
        loading={genLoading}
        progressEvents={progressEvents}
        isFirstTime={validationResult.missingFacts.length > 0 && validationResult.missingCare.length > 0}
      />
    </View>
  );
}

function toPotDraft(pot: PotShape) {
  return {
    potType: pot.type || '',
    drainageSystem: pot.drainage || '',
    potHeightIn: pot.heightIn ? String(pot.heightIn) : '',
    potDiameterIn: pot.diameterIn ? String(pot.diameterIn) : '',
  };
}

const styles = StyleSheet.create({
  headerImage: { width: '100%', height: '100%' },
  headerSkeleton: { width: '100%', height: '100%' },
  loadingRow: { paddingVertical: 24, alignItems: 'center' },
  outermostContainer: {
    backgroundColor: '#6B8E23',
    marginLeft: -16,
    marginRight: -16,
    marginBottom: 0,
  },
  borderRadiusWrapper: {
    marginLeft: 0,
    borderBottomLeftRadius: 100,
    overflow: 'hidden',
    backgroundColor: '#161719',
    marginBottom: 0,
  },
  textOutermostContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: 70,
  },
  textContainer: {
    flex: 1,
    paddingTop: 20,
    paddingBottom: 30,
  },
  contentPaddingContainer: {
    paddingHorizontal: 16,
  },
  aboutSectionContainer: {
    backgroundColor: '#6B8E23',
    marginLeft: -16,
    marginRight: -16,
    marginTop: -16,
    paddingTop: 24,
    paddingBottom: 30,
    paddingHorizontal: 24,
    marginBottom: -16,
  },
  infoRowContainer: {
    flexDirection: 'row',
    backgroundColor: '#6B8E23',
    marginLeft: -16,
    marginRight: -16,
    marginTop: -16,
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 16,
  },
  infoColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  infoTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  infoSubtitle: {
    color: '#ffffff',
    fontSize: 12,
    opacity: 0.9,
  },
  verticalDotsBorder: {
    marginRight: 20,
    paddingTop: 30,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginBottom: 10,
  },
  dotDash: {
    height: 16,
    width: 6,
    borderRadius: 3,
    marginBottom: 14,
  },
  headerActionsContainer: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    alignItems: 'flex-end',
  },
  changePhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  changePhotoButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    minWidth: 220,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  overlayBlocker: { position: 'absolute', inset: 0 },
  progressWrap: {
    width: 220,
    height: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginTop: 12,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 8,
  },
  overlayCloseBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  photoThumbnail: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  photoThumbnailImage: {
    width: '100%',
    height: '100%',
  },
  photoStarBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoDefaultBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
});
