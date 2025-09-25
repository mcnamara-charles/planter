import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View, BackHandler, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import SkeletonTile from '@/components/SkeletonTile';
import WaterModal from '@/components/WaterModal';
import ConfirmNameModal from '@/components/ConfirmNameModal';
import { useGeneratePlantFacts } from '@/hooks/useGeneratePlantFacts';
import { useGenerateCare } from '@/hooks/useGenerateCare';

import TopBar from '@/components/TopBar';
import Section from '@/components/Section';
import AboutBox from '@/components/AboutBox';
import CompactStatus from '@/components/CompactStatus';
import CareSection from '@/components/CareSection';
import GenerateFactsButton from '@/components/GenerateFactsButton';
import { IconSymbol } from '@/components/ui/icon-symbol';

import { labelAvailability, labelRarity } from '@/utils/labels';
import type { Availability, Rarity } from '@/utils/types';
import type { IdentifyResult } from '@/hooks/useIdentifier';

const DEBUG_PHOTOS = true;
const dlog = (...args: any[]) => { if (DEBUG_PHOTOS) console.log('[photos]', ...args); };

const UA_HEADERS: Record<string, string> = {
    'User-Agent': 'PlantApp/1.0 (+support@yourapp.example)',
    'Api-User-Agent': 'PlantApp/1.0 (+support@yourapp.example)',
    'Accept': 'application/json',
  };
  
  // Same keys the hook emits:
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

type RouteParams = { 
  candidates: IdentifyResult[];
  currentIndex: number;
  imageUri: string;
};

// --- photo helpers/types ---
type PlantImage = {
  id?: number;
  source_url: string;
  attribution?: string | null;
  license?: string | null;
  is_primary?: boolean | null;
};

// --- helpers (put near your other helpers) ---
const isNicePhotoUrl = (url?: string | null) => {
  if (!url) return false;
  const u = url.toLowerCase();
  if (!/^https?:\/\//.test(u)) return false;
  if (u.endsWith('.tif') || u.endsWith('.tiff')) return false;
  if (u.includes('herbarium') || u.includes('specimen')) return false;
  return true;
};

const isAllowedLicense = (lic?: string | null) => {
  if (!lic) return false;
  const l = lic.toLowerCase();
  return (
    l.includes('creativecommons') ||
    l.includes('cc-by') || l.includes('cc by') ||
    l.includes('cc0')
  );
};

type WebImage = { source_url: string; attribution?: string | null; license?: string | null };

const TARGET_PHOTO_COUNT = 5;

function uniqByUrl(arr: WebImage[]): WebImage[] {
  const seen = new Set<string>();
  const out: WebImage[] = [];
  for (const it of arr) {
    if (!it?.source_url) continue;
    if (seen.has(it.source_url)) continue;
    seen.add(it.source_url);
    out.push(it);
  }
  return out;
}
function stripHtml(x?: string | null) {
  if (!x) return x;
  return x.replace(/<[^>]+>/g, '').trim();
}

async function fetchJsonDebug(url: string, init?: RequestInit) {
    dlog('HTTP:GET', url);
    const res = await fetch(url, { ...init, headers: { ...(init?.headers || {}), ...UA_HEADERS } });
    const txt = await res.text();
    dlog('HTTP:status', res.status, res.ok ? 'OK' : 'FAIL');
    if (!res.ok) {
      dlog('HTTP:body', txt.slice(0, 200));
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    try {
      return JSON.parse(txt);
    } catch (e: any) {
      dlog('HTTP:parse:error', e?.message);
      dlog('HTTP:body', txt.slice(0, 200));
      throw e;
    }
  }

  async function getGbifImages(scientificName: string, usageKey?: number | null, limit: number = 6): Promise<WebImage[]> {
    try {
      dlog('GBIF:start', { scientificName, usageKey, limit });
  
      let key = usageKey ?? null;
      if (!key) {
        const matchUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`;
        dlog('GBIF:match:GET', matchUrl);
        const m = await fetchJsonDebug(matchUrl);
        dlog('GBIF:match:resp', { usageKey: m?.usageKey, status: m?.status });
        if (m?.usageKey) key = m.usageKey as number;
      }
      if (!key) {
        dlog('GBIF:no-usageKey');
        return [];
      }
  
      // We skip the /species/{key}/media endpoint (often specimen) and go straight to occurrences:
      const occLimit = Math.max(60, limit * 10);
      const occUrl =
        `https://api.gbif.org/v1/occurrence/search?` +
        `taxon_key=${key}&mediaType=StillImage&` +
        // prefer “normal” photos
        `basisOfRecord=HUMAN_OBSERVATION,OBSERVATION,MACHINE_OBSERVATION&limit=${occLimit}`;
      dlog('GBIF:occurrence:GET', occUrl);
  
      const occ = await fetchJsonDebug(occUrl);
      const occResults: any[] = Array.isArray(occ?.results) ? occ.results : [];
      dlog('GBIF:occurrence:results', occResults.length);
  
      const imgs: WebImage[] = [];
      for (const r of occResults) {
        // extra guard: exclude preserved specimens if they slip through
        const bor = String(r?.basisOfRecord || '').toUpperCase();
        if (bor.includes('SPECIMEN')) continue;
  
        const media = Array.isArray(r?.media) ? r.media : [];
        for (const m of media) {
          const url: string | null = m?.identifier ?? m?.references ?? m?.url ?? null;
          const license = m?.license ?? r?.license ?? null;
  
          if (!isNicePhotoUrl(url)) continue;
          if (!isAllowedLicense(license)) continue;
  
          imgs.push({
            source_url: url!,
            attribution: (m?.rightsHolder ?? r?.rightsHolder ?? r?.publisher ?? r?.recordedBy ?? null) || null,
            license: license ?? null,
          });
        }
      }
  
      const uniq = uniqByUrl(imgs).slice(0, limit);
      dlog('GBIF:final', uniq.length);
      return uniq;
    } catch (err: any) {
      dlog('GBIF:error', err?.message ?? err);
      return [];
    }
  }
  

// ---- REPLACE your getCommonsImages with this version (adds UA headers) ----
async function getCommonsImages(scientificName: string, limit: number = 6): Promise<WebImage[]> {
    try {
      const api = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
        scientificName
      )}&gsrnamespace=6&prop=imageinfo&iiprop=url|extmetadata&gsrlimit=${Math.max(10, limit)}&format=json&origin=*`;
  
      dlog('Commons:GET', api);
      const json = await fetchJsonDebug(api);
      const pages = json?.query?.pages ? Object.values(json.query.pages as any) : [];
      dlog('Commons:pages', pages.length);
  
       const imgs: WebImage[] = [];
       for (const p of pages) {
         const info = Array.isArray((p as any)?.imageinfo) ? (p as any).imageinfo[0] : null;
        const url = info?.url ?? null;
        const meta = info?.extmetadata ?? {};
        const licenseShort = meta?.LicenseShortName?.value ?? meta?.License?.value ?? null;
        const artist = stripHtml(meta?.Artist?.value ?? null) || stripHtml(meta?.Credit?.value ?? null);
        if (url) imgs.push({ source_url: url, attribution: artist ?? null, license: licenseShort });
      }
  
      const uniq = uniqByUrl(imgs).slice(0, limit);
      dlog('Commons:final', uniq.length);
      return uniq;
    } catch (err: any) {
      dlog('Commons:error', err?.message ?? err);
      return [];
    }
  }

export default function PlantIdentificationResultScreen() {
  const { theme } = useTheme();
  const route = useRoute();
  const nav = useNavigation();
  const { user } = useAuth();
  const { candidates, currentIndex: initialIndex, imageUri } = (route.params as any) as RouteParams;

  // ===== State (grouped) =====
  const [ui, setUi] = useState({
    heroLoaded: false,
    refreshing: false,
    genLoading: false,
  });
  const [overlay, setOverlay] = useState<{
    visible: boolean;
    message: string;
    percent?: number;     // 0–100
    sublabel?: string;    // e.g., current stage label
  }>({ visible: false, message: '' });

  const [status, setStatus] = useState({ loading: true, error: null as string | null });
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const [plant, setPlant] = useState({
    headerUrl: null as string | null,
    displayName: '',
    commonName: '',
    scientific: '',
    description: '',
    availability: '' as Availability,
    rarity: '' as Rarity,
    plantsTableId: null as string | null,
    soilDescription: null as string | null,
    propagationMethods: [] as { method: string; difficulty?: string | null; description?: string | null }[],
    gbifUsageKey: null as number | null,
  });

  // photos
  const [photos, setPhotos] = useState<PlantImage[]>([]);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);

  // Modals/drafts
  const [modals, setModals] = useState({
    water: false,
    confirmName: { open: false, suggested: null as string | null },
  });

  const [openSection, setOpenSection] = useState<'care' | null>('care');
  const toggle = (key: NonNullable<typeof openSection>) => setOpenSection((curr) => (curr === key ? null : key));

  const { loading: genFactsLoading, run: generateFacts } = useGeneratePlantFacts();
  const { loading: genCareLoading, run: generateCare } = useGenerateCare();
  const genLoading = ui.genLoading || genFactsLoading || genCareLoading;

  const currentCandidate = useMemo(() => {
    return candidates[currentIndex] || candidates[0];
  }, [candidates, currentIndex]);

  const rarityLabel = useMemo(() => labelRarity(plant.rarity), [plant.rarity]);
  const availabilityLabel = useMemo(() => labelAvailability(plant.availability), [plant.availability]);

  const showOverlay = (message: string, percent?: number, sublabel?: string) =>
    setOverlay({ visible: true, message, percent, sublabel });
  const hideOverlay = () => setOverlay({ visible: false, message: '', percent: undefined, sublabel: undefined });

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

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < candidates.length - 1;

  // ===== Android hardware back handling =====
  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const onBack = () => {
        if (overlay.visible) { setOverlay({ visible: false, message: '' }); return true; }
        if (modals.water) { setModals((m) => ({ ...m, water: false })); return true; }
        if ((modals as any).confirmName?.open) { setModals((m: any) => ({ ...m, confirmName: { open: false, suggested: null } })); return true; }
        // Navigate back if possible; otherwise allow default behavior
        if ((nav as any).canGoBack && (nav as any).canGoBack()) { (nav as any).goBack(); return true; }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [overlay.visible, modals.water, (modals as any).confirmName?.open])
  );

  

  const ensurePrimaryMainImage = useCallback(async (plantId: string, list: PlantImage[]) => {
    try {
      if (!list?.length) return;
  
      const currentPrimary = list.find(p => p.is_primary);
      const chosen = currentPrimary ?? list[0];
  
      if (chosen?.id && !currentPrimary) {
        const { error } = await supabase
          .from('plant_images')
          .update({ is_primary: true })
          .eq('id', chosen.id);
        if (error) dlog('DB:markPrimary:error', error.message);
        else dlog('DB:markPrimary:ok', chosen.id);
  
        // reflect locally
        setPhotos(prev => prev.map(p => (p.id === chosen.id ? { ...p, is_primary: true } : p)));
      }
  
      const { error: upPlantErr } = await supabase
        .from('plants')
        .update({ plant_main_image: chosen.source_url })
        .eq('id', plantId);
      if (upPlantErr) dlog('DB:updateMainImage:error', upPlantErr.message);
  
      // ensure header image shows the primary
      setPlant(prev => ({ ...prev, headerUrl: chosen.source_url }));
    } catch (e: any) {
      dlog('ensurePrimary:error', e?.message ?? e);
    }
  }, [setPhotos, setPlant]);

  // ===== Data fetch =====
  const fetchPlantDetails = useCallback(async (scientificName: string) => {
    try {
      setStatus((s) => ({ ...s, loading: true, error: null }));
  
      const { data: plantData, error: plantErr } = await supabase
        .from('plants')
        .select(`
          id, plant_name, plant_scientific_name, description, availability, rarity,
          propagation_methods_json, soil_description,
          gbif_usage_key, plant_main_image
        `)
        .ilike('plant_scientific_name', `%${scientificName}%`)
        .limit(1)
        .maybeSingle();
  
      if (plantErr) throw plantErr;
  
      if (plantData) {
        setPlant((p) => ({
          ...p,
          headerUrl: plantData.plant_main_image || null,
          displayName: plantData.plant_name || currentCandidate.commonNames?.[0] || 'Identified Plant',
          commonName: plantData.plant_name || '',
          scientific: plantData.plant_scientific_name || currentCandidate.scientificName,
          description: plantData.description || '',
          availability: (plantData.availability as any) || '',
          rarity: (plantData.rarity as any) || '',
          plantsTableId: plantData.id,
          soilDescription: plantData.soil_description || null,
          propagationMethods: (plantData.propagation_methods_json || []) as any[],
          gbifUsageKey: plantData.gbif_usage_key ?? null,
        } as any));
      } else {
        setPlant((p) => ({
          ...p,
          headerUrl: null,
          displayName: currentCandidate.commonNames?.[0] || 'Identified Plant',
          commonName: currentCandidate.commonNames?.[0] || '',
          scientific: currentCandidate.scientificName,
          description: '',
          availability: '',
          rarity: '',
          plantsTableId: null,
          soilDescription: null,
          propagationMethods: [],
          gbifUsageKey: null,
        } as any));
      }
    } catch (e: any) {
      setStatus({ loading: false, error: e?.message ?? 'Failed to load plant details' });
    } finally {
      setStatus((s) => ({ ...s, loading: false }));
    }
  }, [currentCandidate, imageUri]);

  useEffect(() => {
    if (currentCandidate) {
      // Clear photos and header image immediately when candidate changes
      setPhotos([]);
      setSelectedPhotoUrl(null);
      setPlant(prev => ({ ...prev, headerUrl: null })); // Clear header image
      fetchPlantDetails(currentCandidate.scientificName);
    }
  }, [currentCandidate, fetchPlantDetails]);

  const onRefresh = useCallback(() => {
    setUi((u) => ({ ...u, refreshing: true }));
    if (currentCandidate) {
      fetchPlantDetails(currentCandidate.scientificName);
    }
    setUi((u) => ({ ...u, refreshing: false }));
  }, [currentCandidate, fetchPlantDetails]);

  const isRemoteHeader = !!plant.headerUrl;
  const showHeaderSkeleton = isRemoteHeader && !ui.heroLoaded;

  const maybeApplySuggestedCommonName = useCallback(async (suggested?: string | null) => {
    if (!suggested || !suggested.trim() || !plant.plantsTableId) return;
    setModals((m) => ({ ...m, confirmName: { open: true, suggested } }));
  }, [plant.plantsTableId]);

  const loadPhotos = useCallback(async (plantId: string, scientificName: string, gbifUsageKey?: number | null) => {
    dlog('loadPhotos:start', { plantId, scientificName, gbifUsageKey });
  
    try {
      // 1) existing DB images
      const { data: dbImgs, error } = await supabase
        .from('plant_images')
        .select('id, source_url, attribution, license, is_primary')
        .eq('plant_id', plantId)
        .order('is_primary', { ascending: false })
        .order('id', { ascending: true })
        .limit(TARGET_PHOTO_COUNT);
  
      if (error) {
        dlog('DB:select:error', error.message ?? error);
        throw error;
      }
  
      const existing = dbImgs ?? [];
      dlog('DB:select:count', existing.length);
  
      let result = existing.slice(0, TARGET_PHOTO_COUNT);
      setPhotos(result);

      await ensurePrimaryMainImage(plantId, result);

        const needed = TARGET_PHOTO_COUNT - result.length;
        dlog('needed', needed);
        if (needed <= 0) return;
  
      showOverlay('Fetching photos…');
  
      const commons = await getCommonsImages(scientificName, needed * 4);
      dlog('commons:count', commons.length);

      const stillNeed = Math.max(0, TARGET_PHOTO_COUNT - (result.length + commons.length));
      const gbif = stillNeed > 0 ? await getGbifImages(scientificName, gbifUsageKey, stillNeed * 4) : [];
      dlog('gbif:count', gbif.length);
  
      // 3) insert new ones
      const existingUrls = new Set(result.map(i => i.source_url));
      const toInsert = [...gbif, ...commons]
        .filter(img => img.source_url && !existingUrls.has(img.source_url))
        .slice(0, TARGET_PHOTO_COUNT - result.length)
        .map(img => ({
          plant_id: plantId,
          source_url: img.source_url,
          attribution: img.attribution ?? null,
          license: img.license ?? null,
          is_primary: false,
        }));
  
      dlog('toInsert:count', toInsert.length);
  
      if (toInsert.length) {
        const { error: insErr } = await supabase.from('plant_images').insert(toInsert);
        if (insErr) {
          dlog('DB:insert:error', insErr.message ?? insErr);
          throw insErr;
        }
        dlog('DB:insert:ok');
  
        const { data: finalImgs, error: finErr } = await supabase
          .from('plant_images')
          .select('id, source_url, attribution, license, is_primary')
          .eq('plant_id', plantId)
          .order('is_primary', { ascending: false })
          .order('id', { ascending: true })
          .limit(TARGET_PHOTO_COUNT);
  
        if (finErr) {
          dlog('DB:finalSelect:error', finErr.message ?? finErr);
          throw finErr;
        }
  
        result = (finalImgs ?? []).slice(0, TARGET_PHOTO_COUNT);
        dlog('final:count', result.length);
        setPhotos(result);
        await ensurePrimaryMainImage(plantId, result);
      }
    } catch (e: any) {
      dlog('loadPhotos:error', e?.message ?? e);
      console.warn('loadPhotos failed', e?.message ?? e);
    } finally {
      hideOverlay();
      dlog('loadPhotos:end');
    }
  }, [ensurePrimaryMainImage]);

  useEffect(() => {
    if (plant.plantsTableId && plant.scientific) {
      const t = setTimeout(() => {
        loadPhotos(plant.plantsTableId!, plant.scientific!, plant.gbifUsageKey ?? null);
      }, 50);
      return () => clearTimeout(t);
    }
  }, [plant.plantsTableId, plant.scientific, plant.gbifUsageKey, loadPhotos]);

  // Prefer a primary photo (or first) for header if header missing
  useEffect(() => {
    if (!plant.headerUrl && photos.length) {
      const primary = photos.find(p => p.is_primary) ?? photos[0];
      if (primary?.source_url) {
        setPlant((prev) => ({ ...prev, headerUrl: primary.source_url }));
        setSelectedPhotoUrl(primary.source_url);
      }
    }
  }, [photos, plant.headerUrl]);

  // Initialize selected photo when photos are loaded
  useEffect(() => {
    if (photos.length > 0 && !selectedPhotoUrl) {
      const primary = photos.find(p => p.is_primary) ?? photos[0];
      if (primary?.source_url) {
        setSelectedPhotoUrl(primary.source_url);
      }
    }
  }, [photos, selectedPhotoUrl]);

  // ===== Actions =====
  const selectPhoto = useCallback((photo: PlantImage) => {
    if (photo.source_url) {
      setPlant((prev) => ({ ...prev, headerUrl: photo.source_url }));
      setSelectedPhotoUrl(photo.source_url);
    }
  }, []);

  const navigateToPrevious = useCallback(() => {
    if (hasPrev) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [hasPrev, currentIndex]);

  const navigateToNext = useCallback(() => {
    if (hasNext) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [hasNext, currentIndex]);

  const addToCollection = useCallback(() => {
    if (!plant.plantsTableId) {
      Alert.alert(
        'Cannot Add to Collection',
        'This plant is not in our database yet. Please try again later or add it manually.',
        [{ text: 'OK' }]
      );
      return;
    }

    (nav as any).navigate('AddPlant', {
      plantId: plant.plantsTableId,
      identificationPhoto: imageUri,
      scientificName: currentCandidate.scientificName,
      commonName: currentCandidate.commonNames?.[0] || plant.commonName,
    });
  }, [plant.plantsTableId, imageUri, currentCandidate, plant.commonName, nav]);

  const handleCareProgress = useCallback((evt: ProgressEvent) => {
    const label = STAGE_LABELS[evt.key] ?? evt.label ?? 'Working…';
    const percent = calcPercent(evt.key);

    if (evt.status === 'error') {
      hideOverlay();
      Alert.alert('Generation failed', evt.error || 'Please try again.');
      return;
    }

    showOverlay('Generating care…', percent, label);

    if (evt.key === 'done' && evt.status === 'success') {
      // optional: refresh plant details after save
      fetchPlantDetails(currentCandidate.scientificName);
      setTimeout(hideOverlay, 400);
    }
  }, [currentCandidate.scientificName, fetchPlantDetails]);


  // ===== Render =====
  return (
    <View style={{ flex: 1 }}>
      <TopBar
        title={plant.displayName || 'Plant Identification'}
        isFavorite={false}
        onBack={() => (nav as any).goBack()}
        onToggleFavorite={() => {}}
        onToggleMenu={() => {}}
        hideActions
      />

      {/* Navigation arrows */}
      <View style={styles.navigationArrows}>
        <View style={styles.arrowContainer}>
          <View style={styles.arrowButton} onTouchEnd={navigateToPrevious}>
            <IconSymbol 
              name="chevron.left" 
              size={24} 
              color={hasPrev ? theme.colors.text : theme.colors.mutedText} 
            />
          </View>
          <ThemedText style={[styles.arrowLabel, { color: hasPrev ? theme.colors.text : theme.colors.mutedText }]}>
            Previous
          </ThemedText>
        </View>

        <View style={styles.counterContainer}>
          <ThemedText style={styles.counterText}>
            {currentIndex + 1} of {candidates.length}
          </ThemedText>
          {currentCandidate && (
            <ThemedText style={styles.confidenceText}>
              {(currentCandidate.score * 100).toFixed(1)}% confidence
            </ThemedText>
          )}
        </View>

        <View style={styles.arrowContainer}>
          <View style={styles.arrowButton} onTouchEnd={navigateToNext}>
            <IconSymbol 
              name="chevron.right" 
              size={24} 
              color={hasNext ? theme.colors.text : theme.colors.mutedText} 
            />
          </View>
          <ThemedText style={[styles.arrowLabel, { color: hasNext ? theme.colors.text : theme.colors.mutedText }]}>
            Next
          </ThemedText>
        </View>
      </View>


      <ParallaxScrollView
        headerBackgroundColor={{ light: '#E5F4EF', dark: '#12231F' }}
        refreshing={ui.refreshing}
        onRefresh={onRefresh}
        enableLightbox={photos.length > 0}
        lightboxImages={photos.map(p => ({ uri: p.source_url, id: p.id?.toString() }))}
        headerImage={
          plant.headerUrl ? (
            <Image
              key={plant.headerUrl}
              source={{ uri: plant.headerUrl }}
              contentFit="cover"
              transition={200}
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
      >
        {/* Photo Gallery */}
        {photos.length > 0 && (
          <View style={styles.photoGalleryContainer}>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photoGalleryContent}
            >
              {photos.map((photo, idx) => {
                const isSelected = selectedPhotoUrl === photo.source_url;
                return (
                  <TouchableOpacity
                    key={photo.id ?? photo.source_url ?? idx}
                    style={[
                      styles.photoGalleryItem,
                      isSelected && styles.photoGalleryItemSelected
                    ]}
                    onPress={() => selectPhoto(photo)}
                    activeOpacity={0.8}
                  >
                    <Image 
                      source={{ uri: photo.source_url }} 
                      contentFit="cover" 
                      style={styles.photoGalleryImage}
                    />
                    {photo.is_primary && (
                      <View style={styles.primaryBadge}>
                        <ThemedText style={styles.primaryBadgeText}>★</ThemedText>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
        {status.loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
          </View>
        ) : status.error ? (
          <ThemedText>{status.error}</ThemedText>
        ) : (
          <>
            <ThemedView>
              {/* Common name under header */}
              <ThemedText type="title">{plant.commonName || plant.displayName}</ThemedText>
              {!!plant.scientific && (
                <ThemedText style={{ opacity: 0.7, fontStyle: 'italic' }}>{plant.scientific}</ThemedText>
              )}
              <CompactStatus rarity={availabilityLabel ? rarityLabel : ''} availability={availabilityLabel} />

              <GenerateFactsButton
                label={genLoading ? 'Generating…' : 'Generate Facts'}
                disabled={genLoading || !plant.plantsTableId}
                onPress={async () => {
                  if (!plant.plantsTableId) return;
                  try {
                    setUi((u) => ({ ...u, genLoading: true }));
                    setOverlay({ visible: true, message: 'Generating details…' });

                    const res = await generateFacts({
                      plantsTableId: plant.plantsTableId,
                      commonName: plant.commonName || plant.displayName,
                      scientificName: plant.scientific,
                    });

                    setOverlay({ visible: true, message: 'Saving updates…' });

                    if (res) {
                      setPlant((p) => ({
                        ...p,
                        description: res.description,
                        availability: res.availability_status as Availability,
                        rarity: res.rarity_level as Rarity,
                      }));
                    }

                    await fetchPlantDetails(currentCandidate.scientificName);

                    setOverlay({ visible: true, message: 'Done' });
                    setTimeout(() => setOverlay({ visible: false, message: '' }), 500);

                    // Offer to adopt suggested common name
                    await maybeApplySuggestedCommonName(res?.suggested_common_name);
                  } catch (e: any) {
                    setOverlay({ visible: false, message: '' });
                    Alert.alert('Generation failed', e?.message ?? 'Please try again.');
                  } finally {
                    setUi((u) => ({ ...u, genLoading: false }));
                  }
                }}
              />
            </ThemedView>

            <AboutBox title="About Plant" body={plant.description} />

            <View style={{ marginTop: 12 }}>
              <Section title="Care" open={openSection === 'care'} onToggle={() => toggle('care')}>
              <CareSection
                isOpen={openSection === 'care'}
                plantsTableId={plant.plantsTableId}
                commonName={plant.commonName}
                displayName={plant.displayName}
                scientificName={plant.scientific}
                showOverlay={(msg) => setOverlay({ visible: true, message: msg })}
                hideOverlay={() => setOverlay({ visible: false, message: '' })}
                onRefetch={() => fetchPlantDetails(currentCandidate.scientificName)}
                onWater={() => {}}
                onFertilize={() => {}}
                onPrune={() => {}}
                onObserve={() => {}}
                showActionButtons={false}
                onCareProgress={handleCareProgress}
              />
                {/* Soil Description */}
                {plant.soilDescription && (
                  <View style={{ marginTop: 16 }}>
                    <View style={styles.row}>
                      <ThemedText style={styles.rowTitle}>Soil</ThemedText>
                      <ThemedText style={{ color: theme.colors.mutedText }}>
                        {plant.soilDescription}
                      </ThemedText>
                    </View>
                  </View>
                )}

                {/* Propagation Methods */}
                {sortedPropagation.length > 0 && (
                  <View style={{ marginTop: 16 }}>
                    <View style={styles.row}>
                      <ThemedText style={styles.rowTitle}>Propagation</ThemedText>
                      <View style={{ gap: 16 }}>
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
                            {!!pm.description && (
                              <ThemedText style={{ color: theme.colors.mutedText }}>{pm.description}</ThemedText>
                            )}
                          </View>
                        );
                        })}
                      </View>
                    </View>
                  </View>
                )}
              </Section>
            </View>
          </>
        )}
        
        {/* Bottom padding to prevent content overlap with floating button */}
        <View style={{ height: 50 }} />
      </ParallaxScrollView>

      {/* Full-page progress overlay */}
      <Modal visible={overlay.visible} transparent animationType="fade">
        <View style={styles.overlayBackdrop}>
          <View style={[styles.overlayCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <ActivityIndicator color={theme.colors.text as any} />
            <ThemedText style={{ marginTop: 12, fontWeight: '700' }}>
              {overlay.message || 'Working…'}
            </ThemedText>
            {!!overlay.sublabel && (
              <ThemedText style={{ marginTop: 4, color: theme.colors.mutedText }}>
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
      <WaterModal open={modals.water} onClose={() => setModals((m) => ({ ...m, water: false }))} userPlantId={''} onSaved={() => {}} />
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
              .from('plants')
              .update({ plant_name: suggested })
              .eq('id', plant.plantsTableId);
            if (error) throw error;
            await fetchPlantDetails(currentCandidate.scientificName);
          } catch (e: any) {
            Alert.alert('Update failed', e?.message ?? 'Could not update common name.');
          } finally {
            setOverlay({ visible: false, message: '' });
            setModals((m: any) => ({ ...m, confirmName: { open: false, suggested: null } }));
          }
        }}
      />

      {/* Floating Add to Collection Button */}
      <View style={styles.floatingButtonContainer}>
        <TouchableOpacity
          style={[styles.floatingButton, { backgroundColor: '#10B981' }]}
          onPress={addToCollection}
          activeOpacity={0.8}
        >
          <IconSymbol name="plus" size={20} color="#ffffff" />
          <ThemedText style={styles.floatingButtonText}>Add to Collection</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  headerImage: { width: '100%', height: '100%' },
  headerSkeleton: { width: '100%', height: '100%' },
  loadingRow: { paddingVertical: 24, alignItems: 'center' },

  navigationArrows: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  arrowContainer: {
    alignItems: 'center',
    minWidth: 60,
  },
  arrowButton: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  arrowLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  counterContainer: {
    alignItems: 'center',
    flex: 1,
  },
  counterText: {
    fontSize: 15,
    fontWeight: '700',
  },
  confidenceText: {
    fontSize: 11,
    opacity: 0.7,
    marginTop: 0,
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

  // Care section styling
  row: {
    paddingVertical: 8,
  },
  rowTitle: {
    fontWeight: '800',
    fontSize: 30,
    lineHeight: 36,
    marginBottom: 6,
  },

  // Photo gallery styles
  photoGalleryContainer: {
    paddingVertical: 8,
    paddingHorizontal: 0,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  photoGalleryContent: {
    paddingRight: 8,
  },
  photoGalleryItem: {
    width: 100,
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
    marginRight: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    position: 'relative',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  photoGalleryItemSelected: {
    borderColor: '#FFD700',
  },
  photoGalleryImage: {
    width: '100%',
    height: '100%',
  },
  primaryBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  primaryBadgeText: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 12,
  },

  // Floating button styles
  floatingButtonContainer: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
  },
  floatingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    gap: 8,
  },
  floatingButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
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
});
