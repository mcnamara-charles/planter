import { useEffect, useRef, useState, useMemo } from 'react';
import { Alert, StyleSheet, TextInput, TouchableOpacity, View, ScrollView, ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SpeciesAutocomplete } from '@/components/SpeciesAutocomplete';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { PropagatedByAutocomplete } from '@/components/PropagatedByAutocomplete';
import DatePicker from '@/components/DatePicker';

export default function AddPlantScreen() {
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const rawRouteId = (route.params as any)?.userPlantId;
  const editingId = rawRouteId == null ? null : String(rawRouteId).trim() || null;
  const isEdit = !!editingId;
  const params = (route.params as any) || {};
  const { user } = useAuth();

  // Handle identification parameters
  const identificationData = useMemo(() => {
    return params.plantId ? {
      plantId: params.plantId,
      identificationPhoto: params.identificationPhoto,
      scientificName: params.scientificName,
      commonName: params.commonName,
    } : null;
  }, [params.plantId, params.identificationPhoto, params.scientificName, params.commonName]);

  // Plant type selection state
  const [plantType, setPlantType] = useState<'normal' | 'reservoir' | null>('normal');

  // Light source selection state
  const [lightType, setLightType] = useState<'grow_light' | 'sunlight' | null>('sunlight');

  // Species selection state
  const [speciesId, setSpeciesId] = useState<string | null>(null);
  const [speciesCommon, setSpeciesCommon] = useState<string>('');        // <-- COMMON name
  const [speciesScientific, setSpeciesScientific] = useState<string>(''); // <-- SCIENTIFIC name

  const [nickname, setNickname] = useState('');
  const [propagatedFrom, setPropagatedFrom] = useState('');
  const [acquiredAt, setAcquiredAt] = useState('');
  const [acquiredFrom, setAcquiredFrom] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationName, setLocationName] = useState('');
  const [propagatedFromId, setPropagatedFromId] = useState<string | null>(null);
  const [propagatedFromName, setPropagatedFromName] = useState('');
  const [potType, setPotType] = useState('');
  const [potHeightIn, setPotHeightIn] = useState('');
  const [potDiameterIn, setPotDiameterIn] = useState('');
  const [drainageSystem, setDrainageSystem] = useState('');
  type SoilRow = { id: string; name: string; parts: string };
  const [soilRows, setSoilRows] = useState<SoilRow[]>([]);
  const [photo, setPhoto] = useState<{ uri: string; width?: number; height?: number; fileName?: string; type?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [speciesResetKey, setSpeciesResetKey] = useState(0);
  const initialPayloadRef = useRef<any | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [androidOffset, setAndroidOffset] = useState(0);
  const [identificationDataProcessed, setIdentificationDataProcessed] = useState(false);
  const [advancedSetupOpen, setAdvancedSetupOpen] = useState(false);

  const KEYBOARD_OFFSET = Platform.OS === 'ios' ? 88 : androidOffset;

  function buildSoilMixObject(rows: Array<{ name: string; parts: string }>) {
    const obj: Record<string, number> = {};
    for (const r of rows) {
      const name = r.name.trim();
      const partsNum = Number(r.parts);
      if (!name) continue;
      if (!isFinite(partsNum) || partsNum <= 0) continue;
      obj[name] = partsNum;
    }
    return Object.keys(obj).length > 0 ? obj : null;
  }

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'We need access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      exif: false,
    } as any);
    if (!result.canceled) {
      const asset = result.assets[0];
      setPhoto({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        fileName: (asset as any).fileName as string | undefined,
        type: (asset as any).type as string | undefined,
      });
    }
  }

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', () => setAndroidOffset(45));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setAndroidOffset(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Handle identification data from plant identification screen
  useEffect(() => {
    if (identificationData && !isEdit && !identificationDataProcessed) {
      // Set the species ID and names
      setSpeciesId(identificationData.plantId);
      setSpeciesCommon(identificationData.commonName || '');
      setSpeciesScientific(identificationData.scientificName || '');
      
      // Set the identification photo
      if (identificationData.identificationPhoto) {
        setPhoto({
          uri: identificationData.identificationPhoto,
          fileName: 'identification_photo.jpg',
          type: 'image/jpeg',
        });
      }
      
      // Mark as processed to prevent re-running
      setIdentificationDataProcessed(true);
    }
  }, [identificationData, isEdit, identificationDataProcessed]);

  // Prefill when editing
  useEffect(() => {
    (async () => {
      try {
        if (isEdit && params?.userPlantId) {
          const { data: up } = await supabase
            .from('user_plants')
            .select(`
              plants_table_id, nickname, custom_species_name, propagated_from_user_plant_id, acquired_at, acquired_from, location_id, pot_type, pot_height_in, pot_diameter_in, drainage_system, soil_mix, system_type, light_type, default_plant_photo_id, 
              location:location_id (id, name),
              propagated_from:propagated_from_user_plant_id (id, nickname, custom_species_name, plants:plants_table_id (plant_name, plant_scientific_name))
            `)
            .eq('id', params.userPlantId)
            .maybeSingle();

          if (up) {
            setNickname(up.nickname ?? '');
            setAcquiredFrom(up.acquired_from ?? '');
            setLocationId(up.location_id);
            setLocationName((up.location as any)?.name ?? '');
            setPropagatedFrom(up.propagated_from_user_plant_id ?? '');
            setPropagatedFromId(up.propagated_from_user_plant_id);
            // Set plant type from system_type (normal or reservoir, default to 'normal' if not set)
            const systemType = (up as any).system_type;
            if (systemType === 'normal' || systemType === 'reservoir') {
              setPlantType(systemType);
            } else {
              setPlantType('normal'); // Default to normal
            }
            // Set light type from light_type (grow_light or sunlight, default to 'sunlight' if not set)
            const lightTypeValue = (up as any).light_type;
            if (lightTypeValue === 'grow_light' || lightTypeValue === 'sunlight') {
              setLightType(lightTypeValue);
            } else {
              setLightType('sunlight'); // Default to sunlight
            }
            
            // Set propagated plant name if available
            if (up.propagated_from_user_plant_id && (up as any).propagated_from) {
              const propagatedPlant = (up as any).propagated_from;
              const displayName = propagatedPlant.nickname || 
                                propagatedPlant.plants?.plant_name || 
                                propagatedPlant.custom_species_name || 
                                '';
              setPropagatedFromName(displayName);
            }
            setPotType(up.pot_type ?? '');
            setPotHeightIn(up.pot_height_in ? String(up.pot_height_in) : '');
            setPotDiameterIn(up.pot_diameter_in ? String(up.pot_diameter_in) : '');
            setDrainageSystem(up.drainage_system ?? '');
            // Prefill photo if present
            if (up.default_plant_photo_id) {
              try {
                const val = String(up.default_plant_photo_id);
                const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                if (uuidRe.test(val)) {
                  const { data: pr } = await supabase
                    .from('user_plant_photos')
                    .select('bucket, object_path')
                    .eq('id', val)
                    .maybeSingle();
                  if (pr?.object_path) {
                    const { data: signed } = await supabase.storage
                      .from(pr.bucket || 'plant-photos')
                      .createSignedUrl(pr.object_path, 60 * 60);
                    if (signed?.signedUrl) setPhoto({ uri: signed.signedUrl });
                  }
                } else {
                  // Legacy path; try signing directly from default bucket
                  const { data: signed } = await supabase.storage
                    .from('plant-photos')
                    .createSignedUrl(val, 60 * 60);
                  if (signed?.signedUrl) setPhoto({ uri: signed.signedUrl });
                }
              } catch {}
            }
            // Prefill soil mix rows from JSON object
            const mixObj = (up as any).soil_mix as Record<string, number> | null;
            if (mixObj && typeof mixObj === 'object') {
              const entries = Object.entries(mixObj);
              setSoilRows(
                entries.map(([name, parts]) => ({
                  id: Math.random().toString(36).slice(2),
                  name,
                  parts: String(parts ?? ''),
                }))
              );
            } else {
              setSoilRows([]);
            }
            let acquiredOn: string | null = null;
            if (up.acquired_at) {
              const iso = String(up.acquired_at);
              const m = iso.match(/^\d{4}-\d{2}-\d{2}/);
              acquiredOn = m ? m[0] : iso;
              setAcquiredAt(acquiredOn);
            }

            if (up.plants_table_id) {
              const { data: plantRow } = await supabase
                .from('plants')
                .select('id, plant_name, plant_scientific_name')
                .eq('id', up.plants_table_id)
                .maybeSingle();
              if (plantRow) {
                setSpeciesId(String(plantRow.id));
                setSpeciesCommon(plantRow.plant_name || '');
                setSpeciesScientific(plantRow.plant_scientific_name || '');
              }
            } else if (up.custom_species_name) {
              // Custom species (no DB id)
              setSpeciesId(null);
              setSpeciesCommon(up.custom_species_name || '');
              setSpeciesScientific('');
            }
            // Build initial payload snapshot for change detection
            const initialPlantsId = up.plants_table_id ? String(up.plants_table_id) : null;
            const initialCustomName = initialPlantsId ? null : (up.custom_species_name ?? null);
            const normSoil: Record<string, number> | null = (up as any).soil_mix && typeof (up as any).soil_mix === 'object'
              ? Object.fromEntries(Object.entries((up as any).soil_mix).map(([k, v]) => [String(k), Number(v as any)]))
              : null;
            initialPayloadRef.current = {
              plants_table_id: initialPlantsId,
              custom_species_name: initialCustomName,
              nickname: up.nickname || null,
              propagated_from_user_plant_id: up.propagated_from_user_plant_id ?? null,
              acquired_at: acquiredOn,
              acquired_from: up.acquired_from || null,
              location_id: up.location_id || null,
              pot_type: up.pot_type || null,
              pot_height_in: up.pot_height_in ? Number(up.pot_height_in) : null,
              pot_diameter_in: up.pot_diameter_in ? Number(up.pot_diameter_in) : null,
              drainage_system: up.drainage_system || null,
              soil_mix: normSoil,
              system_type: (up as any).system_type || null,
              light_type: (up as any).light_type || null,
            };
          }
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Helper: create a timeline event ("added" or "edited") ----
  async function createTimelineEvent(opts: {
    userPlantId: string;
    type: 'added' | 'edited';
    timeISO?: string;
  }) {
    try {
      await supabase
        .from('user_plant_timeline_events')
        .insert({
          owner_id: user!.id,
          user_plant_id: opts.userPlantId,
          event_time: opts.timeISO ?? new Date().toISOString(),
          event_type: opts.type,
          event_data: {},
          note: null,
        });
    } catch {
      // Non-fatal: don't block the UX if logging fails
    }
  }

  async function createAddedOnce(userPlantId: string, timeISO?: string) {
    try {
      const { data: existing, error: selErr } = await supabase
        .from('user_plant_timeline_events')
        .select('id')
        .eq('user_plant_id', userPlantId)
        .eq('event_type', 'added')
        .limit(1);
      if (selErr) throw selErr;
      if (existing && existing.length) return; // already have one
  
      await createTimelineEvent({ userPlantId, type: 'added', timeISO });
    } catch {
      // best-effort; don't block UX
    }
  }

  const onSave = async () => {
    if (saving) return;
    if (!user?.id) {
      Alert.alert('Not signed in', 'Please sign in first.');
      return;
    }

    // Date validation (DatePicker returns YYYY-MM-DD format)
    let acquiredDate: string | null = null;
    if (acquiredAt.trim().length > 0) {
      const m = acquiredAt.trim().match(/^\d{4}-\d{2}-\d{2}$/);
      if (!m) {
        Alert.alert('Invalid date', 'Please select a valid date.');
        return;
      }
      acquiredDate = acquiredAt.trim();
    }

    // Decide species mapping (kept for insert path)
    const usePlantsId = !!speciesId;
    const plantsTableIdInsert = usePlantsId ? speciesId : null;
    const customSpeciesNameInsert = usePlantsId ? null : (speciesCommon.trim() || null); // <-- use COMMON for custom

    // Handle location - create new location if needed
    let finalLocationId = locationId;
    if (locationName.trim() && !locationId) {
      // User entered a custom location name, create it
      try {
        const { data: newLocation, error: createErr } = await supabase
          .from('locations')
          .insert({ name: locationName.trim(), owner_id: user.id })
          .select('id')
          .single();
        
        if (createErr) throw createErr;
        finalLocationId = newLocation.id;
      } catch (e) {
        // If creation fails, continue without location
        finalLocationId = null;
      }
    }

    // Build potential payload now to check changes before we flip saving=true
    const usePlantsIdPre = !!speciesId;
    const plants_table_id = usePlantsIdPre ? speciesId : null;
    const custom_species_name = usePlantsIdPre ? null : (speciesCommon.trim() || null);
    const nextPayloadForCompare = {
      plants_table_id,
      custom_species_name,
      nickname: nickname || null,
      propagated_from_user_plant_id: propagatedFromId || null,
      acquired_at: acquiredDate,
      acquired_from: acquiredFrom || null,
      location_id: locationId,
      pot_type: potType || null,
      pot_height_in: potHeightIn ? Number(potHeightIn) : null,
      pot_diameter_in: potDiameterIn ? Number(potDiameterIn) : null,
      drainage_system: drainageSystem || null,
      soil_mix: buildSoilMixObject(soilRows),
      system_type: plantType || null,
      light_type: lightType || null,
    } as const;

    if (isEdit && initialPayloadRef.current) {
      const changed = JSON.stringify(initialPayloadRef.current) !== JSON.stringify(nextPayloadForCompare);
      if (!changed) {
        // No changes: do nothing (stay on page)
        return;
      }
    }

    try {
      setSaving(true);
      let currentPlantId: string | undefined = editingId ?? undefined;

      if (isEdit && currentPlantId) {
        // Compute intended update payload and compare with initial snapshot
        const nextPayload = nextPayloadForCompare;

        const prev = initialPayloadRef.current;
        const changed = JSON.stringify(prev) !== JSON.stringify(nextPayload);

        if (!changed) {
          // Nothing changed; skip update and timeline event (should not reach due to pre-check)
          return;
        }

        const { error: updErr } = await supabase
          .from('user_plants')
          .update(nextPayload as any)
          .eq('id', currentPlantId);
        if (updErr) throw updErr;

        await createTimelineEvent({ userPlantId: currentPlantId, type: 'edited' });
      } else {
        // INSERT
        const insertPayload: any = {
          owner_id: user.id,
          plants_table_id: plantsTableIdInsert,
          custom_species_name: customSpeciesNameInsert,
          nickname: nickname || null,
          propagated_from_user_plant_id: propagatedFromId || null,
          acquired_at: acquiredDate,
          acquired_from: acquiredFrom || null,
          location_id: finalLocationId,
          pot_type: potType || null,
          pot_height_in: potHeightIn ? Number(potHeightIn) : null,
          pot_diameter_in: potDiameterIn ? Number(potDiameterIn) : null,
          drainage_system: drainageSystem || null,
          soil_mix: buildSoilMixObject(soilRows),
          system_type: plantType || null,
          light_type: lightType || null,
        };
  
        const { data: inserted, error } = await supabase
          .from('user_plants')
          .insert(insertPayload)
          .select('id, created_at')
          .single();
        if (error) throw error;
  
        currentPlantId = inserted?.id as string;
  
        // Create "added" exactly once (see guard below)
        await createAddedOnce(currentPlantId, inserted?.created_at ?? undefined);
      }

      // Optional photo handling
      if (photo?.uri && currentPlantId) {
        const now = new Date();
        const yyyy = String(now.getFullYear());
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const rand = (global as any).crypto?.randomUUID
          ? (global as any).crypto.randomUUID()
          : Math.random().toString(36).slice(2);
        const extMatch = /\.(\w+)$/.exec(photo.fileName ?? photo.uri);
        const ext = (extMatch?.[1] || 'jpg').toLowerCase();
        const objectPath = `${user.id}/${currentPlantId}/originals/${yyyy}/${mm}/${Date.now()}-${rand}.${ext}`;
        const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

        const resp = await fetch(photo.uri);
        const arrayBuffer = await resp.arrayBuffer();

        const { error: uploadErr } = await supabase.storage
          .from('plant-photos')
          .upload(objectPath, arrayBuffer, { contentType, upsert: false });
        if (uploadErr) throw uploadErr;

        const { data: photoRow, error: photoErr } = await supabase
          .from('user_plant_photos')
          .insert({
            owner_id: user.id,
            user_plant_id: currentPlantId,
            bucket: 'plant-photos',
            object_path: objectPath,
            content_type: contentType,
            bytes: arrayBuffer.byteLength ?? null,
            width_px: photo.width ?? null,
            height_px: photo.height ?? null,
          })
          .select('id')
          .single();
        if (photoErr) throw photoErr;

        const { error: setDefaultErr } = await supabase
          .from('user_plants')
          .update({ default_plant_photo_id: photoRow.id })
          .eq('id', currentPlantId);
        if (setDefaultErr) throw setDefaultErr;
      }

      if (isEdit) {
        // For edits, go back to the previous screen
        (nav as any).goBack();
      } else {
        // For new plants, navigate to the plant detail screen
        (nav as any).navigate('PlantDetail', { id: currentPlantId });
      }
    } catch (e: any) {
      Alert.alert('Failed to save', e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  // Track hasChanges for edit mode to control Save button state
  useEffect(() => {
    if (!isEdit || !initialPayloadRef.current) {
      setHasChanges(true); // allow saving in add mode or before prefill load
      return;
    }
    const currUsePlantsId = !!speciesId;
    const curr_plants_table_id = currUsePlantsId ? speciesId : null;
    const curr_custom_species_name = currUsePlantsId ? null : (speciesCommon.trim() || null);
    const currentPayload = {
      plants_table_id: curr_plants_table_id,
      custom_species_name: curr_custom_species_name,
      nickname: nickname || null,
      propagated_from_user_plant_id: propagatedFromId || null,
      acquired_at: acquiredAt.trim().length > 0 ? acquiredAt.trim() : null,
      acquired_from: acquiredFrom || null,
      location_id: locationId,
      pot_type: potType || null,
      pot_height_in: potHeightIn ? Number(potHeightIn) : null,
      pot_diameter_in: potDiameterIn ? Number(potDiameterIn) : null,
      drainage_system: drainageSystem || null,
      soil_mix: buildSoilMixObject(soilRows),
      system_type: plantType || null,
      light_type: lightType || null,
    } as const;
    setHasChanges(JSON.stringify(initialPayloadRef.current) !== JSON.stringify(currentPayload));
  }, [isEdit, speciesId, speciesCommon, nickname, propagatedFromId, acquiredAt, acquiredFrom, locationId, potType, potDiameterIn, potHeightIn, drainageSystem, soilRows, plantType, lightType]);

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={{ flex: 1 }}
      keyboardVerticalOffset={KEYBOARD_OFFSET}
    >
      <ThemedView style={[styles.container, { backgroundColor: theme.colors.background }]}>
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
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => (nav as any).goBack()} accessibilityRole="button" accessibilityLabel="Go back">
              <IconSymbol name="arrow.left" color={theme.colors.text} size={28} />
            </TouchableOpacity>
            <ThemedText type="title">{params?.userPlantId ? 'Edit Plant' : 'Add Plant'}</ThemedText>
            <View style={{ width: 28 }} />
          </View>

          <View style={styles.formContainer}>
            {/* Plant Type Selector */}
            <View style={styles.fieldGroup}>
              <ThemedText style={styles.label}>Plant Type</ThemedText>
              <View style={styles.plantTypeContainer}>
                <TouchableOpacity
                  style={[
                    styles.plantTypeOption,
                    { 
                      backgroundColor: plantType === 'normal' ? theme.colors.primary : theme.colors.input,
                      borderColor: plantType === 'normal' ? theme.colors.primary : theme.colors.border,
                    }
                  ]}
                  onPress={() => setPlantType('normal')}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: plantType === 'normal' }}
                >
                  <View style={styles.plantTypeContent}>
                    <View style={[
                      styles.plantTypeIconContainer,
                      { backgroundColor: plantType === 'normal' ? 'rgba(255,255,255,0.2)' : theme.colors.card }
                    ]}>
                      <IconSymbol 
                        name="plant.normal" 
                        size={28} 
                        color={plantType === 'normal' ? '#fff' : theme.colors.text} 
                      />
                    </View>
                    <View style={styles.plantTypeTextContainer}>
                      <ThemedText style={[
                        styles.plantTypeTitle,
                        { color: plantType === 'normal' ? '#fff' : theme.colors.text }
                      ]}>
                        Normal Plant
                      </ThemedText>
                      <ThemedText style={[
                        styles.plantTypeDescription,
                        { color: plantType === 'normal' ? 'rgba(255,255,255,0.9)' : theme.colors.mutedText }
                      ]}>
                        This plant sits in soil (or other substrate) and is watered and fertilized on a schedule when the substrate is ready for new nutrients.
                      </ThemedText>
                    </View>
                    <View style={[
                      styles.radioButton,
                      { 
                        borderColor: plantType === 'normal' ? '#fff' : theme.colors.border,
                        backgroundColor: plantType === 'normal' ? '#fff' : 'transparent'
                      }
                    ]}>
                      {plantType === 'normal' && (
                        <View style={[styles.radioButtonInner, { backgroundColor: theme.colors.primary }]} />
                      )}
                    </View>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.plantTypeOption,
                    { 
                      backgroundColor: plantType === 'reservoir' ? theme.colors.primary : theme.colors.input,
                      borderColor: plantType === 'reservoir' ? theme.colors.primary : theme.colors.border,
                    }
                  ]}
                  onPress={() => setPlantType('reservoir')}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: plantType === 'reservoir' }}
                >
                  <View style={styles.plantTypeContent}>
                    <View style={[
                      styles.plantTypeIconContainer,
                      { backgroundColor: plantType === 'reservoir' ? 'rgba(255,255,255,0.2)' : theme.colors.card }
                    ]}>
                      <IconSymbol 
                        name="plant.reservoir" 
                        size={28} 
                        color={plantType === 'reservoir' ? '#fff' : theme.colors.text} 
                      />
                    </View>
                    <View style={styles.plantTypeTextContainer}>
                      <ThemedText style={[
                        styles.plantTypeTitle,
                        { color: plantType === 'reservoir' ? '#fff' : theme.colors.text }
                      ]}>
                        Reservoir Plant
                      </ThemedText>
                      <ThemedText style={[
                        styles.plantTypeDescription,
                        { color: plantType === 'reservoir' ? 'rgba(255,255,255,0.9)' : theme.colors.mutedText }
                      ]}>
                        This plant sits in a medium that gets its water and nutrients from a reservoir. Water and nutrients are added to the reservoir as it runs out.
                      </ThemedText>
                    </View>
                    <View style={[
                      styles.radioButton,
                      { 
                        borderColor: plantType === 'reservoir' ? '#fff' : theme.colors.border,
                        backgroundColor: plantType === 'reservoir' ? '#fff' : 'transparent'
                      }
                    ]}>
                      {plantType === 'reservoir' && (
                        <View style={[styles.radioButtonInner, { backgroundColor: theme.colors.primary }]} />
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <ThemedText style={styles.label}>Species</ThemedText>
              <SpeciesAutocomplete
                key={speciesResetKey}
                selectedItem={
                  speciesId
                    ? { id: speciesId, common: speciesCommon, scientific: speciesScientific || undefined }
                    : null
                }
                displayText={!speciesId ? speciesCommon : undefined} // show custom text only when not bound to DB id
                onPick={(item) => {
                  // Picked a real species from DB
                  setSpeciesId(item.id);
                  setSpeciesCommon(item.common || item.scientific || '');
                  setSpeciesScientific(item.scientific || '');
                  setSpeciesResetKey((k) => k + 1); // <- force remount to clear input
                  Keyboard.dismiss();
                }}
                onCustomChange={(text) => {
                  // Typing a custom species (no DB id)
                  setSpeciesId(null);
                  setSpeciesCommon(text);
                  setSpeciesScientific('');
                }}
              />
            </View>

            <View style={styles.fieldGroup}>
              <ThemedText style={styles.label}>Nickname</ThemedText>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
                value={nickname}
                onChangeText={setNickname}
                placeholder="Enter nickname (optional)"
                placeholderTextColor={theme.colors.mutedText}
              />
            </View>

            <View style={styles.fieldGroup}>
              <ThemedText style={styles.label}>Location</ThemedText>
              <LocationAutocomplete
                selectedItem={locationId ? { id: locationId, name: locationName } : null}
                displayText={!locationId ? locationName : undefined}
                onPick={(item) => {
                  setLocationId(item.id);
                  setLocationName(item.name);
                }}
                onCustomChange={(text) => {
                  // Handle custom text input - could create new location or clear selection
                  setLocationName(text);
                  if (!text.trim()) {
                    setLocationId(null);
                  }
                }}
                placeholder="Search or enter location name"
              />
            </View>

            {/* Light Source Selector */}
            <View style={styles.fieldGroup}>
              <ThemedText style={styles.label}>Primary Light Source</ThemedText>
              <View style={styles.plantTypeContainer}>
                <TouchableOpacity
                  style={[
                    styles.plantTypeOption,
                    { 
                      backgroundColor: lightType === 'grow_light' ? theme.colors.primary : theme.colors.input,
                      borderColor: lightType === 'grow_light' ? theme.colors.primary : theme.colors.border,
                    }
                  ]}
                  onPress={() => setLightType('grow_light')}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: lightType === 'grow_light' }}
                >
                  <View style={styles.plantTypeContent}>
                    <View style={[
                      styles.plantTypeIconContainer,
                      { backgroundColor: lightType === 'grow_light' ? 'rgba(255,255,255,0.2)' : theme.colors.card }
                    ]}>
                      <IconSymbol 
                        name="light.grow" 
                        size={28} 
                        color={lightType === 'grow_light' ? '#fff' : theme.colors.text} 
                      />
                    </View>
                    <View style={styles.plantTypeTextContainer}>
                      <ThemedText style={[
                        styles.plantTypeTitle,
                        { color: lightType === 'grow_light' ? '#fff' : theme.colors.text }
                      ]}>
                        Grow Light
                      </ThemedText>
                      <ThemedText style={[
                        styles.plantTypeDescription,
                        { color: lightType === 'grow_light' ? 'rgba(255,255,255,0.9)' : theme.colors.mutedText }
                      ]}>
                        This plant receives its primary light from an artificial grow light source.
                      </ThemedText>
                    </View>
                    <View style={[
                      styles.radioButton,
                      { 
                        borderColor: lightType === 'grow_light' ? '#fff' : theme.colors.border,
                        backgroundColor: lightType === 'grow_light' ? '#fff' : 'transparent'
                      }
                    ]}>
                      {lightType === 'grow_light' && (
                        <View style={[styles.radioButtonInner, { backgroundColor: theme.colors.primary }]} />
                      )}
                    </View>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.plantTypeOption,
                    { 
                      backgroundColor: lightType === 'sunlight' ? theme.colors.primary : theme.colors.input,
                      borderColor: lightType === 'sunlight' ? theme.colors.primary : theme.colors.border,
                    }
                  ]}
                  onPress={() => setLightType('sunlight')}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: lightType === 'sunlight' }}
                >
                  <View style={styles.plantTypeContent}>
                    <View style={[
                      styles.plantTypeIconContainer,
                      { backgroundColor: lightType === 'sunlight' ? 'rgba(255,255,255,0.2)' : theme.colors.card }
                    ]}>
                      <IconSymbol 
                        name="light.sun" 
                        size={28} 
                        color={lightType === 'sunlight' ? '#fff' : theme.colors.text} 
                      />
                    </View>
                    <View style={styles.plantTypeTextContainer}>
                      <ThemedText style={[
                        styles.plantTypeTitle,
                        { color: lightType === 'sunlight' ? '#fff' : theme.colors.text }
                      ]}>
                        Sunlight
                      </ThemedText>
                      <ThemedText style={[
                        styles.plantTypeDescription,
                        { color: lightType === 'sunlight' ? 'rgba(255,255,255,0.9)' : theme.colors.mutedText }
                      ]}>
                        This plant receives its primary light from natural sunlight (windows, outdoor, etc.).
                      </ThemedText>
                    </View>
                    <View style={[
                      styles.radioButton,
                      { 
                        borderColor: lightType === 'sunlight' ? '#fff' : theme.colors.border,
                        backgroundColor: lightType === 'sunlight' ? '#fff' : 'transparent'
                      }
                    ]}>
                      {lightType === 'sunlight' && (
                        <View style={[styles.radioButtonInner, { backgroundColor: theme.colors.primary }]} />
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Photo */}
            <View style={styles.fieldGroup}>
              <ThemedText style={styles.label}>Main Photo</ThemedText>
              {photo?.uri ? (
                <View style={styles.photoCard}>
                  <Image source={{ uri: photo.uri }} style={styles.photoCardImage} contentFit="cover" />
                  <View style={styles.photoOverlay}>
                    <TouchableOpacity style={[styles.overlayBtn, { backgroundColor: 'rgba(0,0,0,0.55)' }]} onPress={pickPhoto} accessibilityLabel="Change photo">
                      <IconSymbol name="pencil" size={16} color="#fff" />
                      <ThemedText style={styles.overlayLabel}>Change</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.overlayBtn, { backgroundColor: 'rgba(209,26,42,0.85)' }]} onPress={() => setPhoto(null)} accessibilityLabel="Remove photo">
                      <IconSymbol name="trash.fill" size={16} color="#fff" />
                      <ThemedText style={styles.overlayLabel}>Remove</ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.addPhotoCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.input }]}
                  onPress={pickPhoto}
                  accessibilityRole="button"
                  accessibilityLabel="Add photo"
                >
                  <View style={styles.addPhotoInner}>
                    <View style={[styles.addPhotoIconWrap, { backgroundColor: theme.colors.card }]}>
                      <IconSymbol name="camera.fill" size={24} color={theme.colors.text} />
                    </View>
                    <ThemedText style={styles.addPhotoTitle}>Add a photo</ThemedText>
                    <ThemedText style={styles.addPhotoSubtitle}>Tap to choose from your library</ThemedText>
                  </View>
                </TouchableOpacity>
              )}
            </View>

            {/* Advanced Setup Collapsible */}
            <View style={styles.fieldGroup}>
              <TouchableOpacity
                style={styles.advancedHeader}
                onPress={() => setAdvancedSetupOpen(!advancedSetupOpen)}
                activeOpacity={0.7}
              >
                <View style={styles.advancedHeaderContent}>
                  <IconSymbol
                    name={advancedSetupOpen ? 'chevron.down' : 'chevron.right'}
                    size={20}
                    color={theme.colors.text}
                  />
                  <ThemedText style={[styles.advancedHeaderText, { color: theme.colors.text }]}>
                    Advanced setup
                  </ThemedText>
                </View>
              </TouchableOpacity>
              {advancedSetupOpen && (
                <View style={styles.advancedContent}>
                  <View style={styles.fieldGroup}>
                    <ThemedText style={styles.label}>Acquired on</ThemedText>
                    <DatePicker
                      value={acquiredAt}
                      onChange={setAcquiredAt}
                      placeholder="Select date"
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <ThemedText style={styles.label}>Acquired from (place)</ThemedText>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
                      value={acquiredFrom}
                      onChangeText={setAcquiredFrom}
                      placeholder="Local nursery"
                      placeholderTextColor={theme.colors.mutedText}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <ThemedText style={styles.label}>Propagated from</ThemedText>
                    <PropagatedByAutocomplete
                      selectedItem={propagatedFromId ? { id: propagatedFromId, nickname: propagatedFromName, common: '', scientific: '' } : null}
                      displayText={!propagatedFromId ? propagatedFromName : undefined}
                      onPick={(item: any) => {
                        setPropagatedFromId(item.id);
                        setPropagatedFromName(item.nickname || item.common);
                      }}
                      onCustomChange={(text: string) => {
                        setPropagatedFromName(text);
                        if (!text.trim()) {
                          setPropagatedFromId(null);
                        }
                      }}
                      placeholder="Search your plants"
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <ThemedText style={styles.label}>Pot type</ThemedText>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
                      value={potType}
                      onChangeText={setPotType}
                      placeholder="Terracotta, Nursery pot, etc."
                      placeholderTextColor={theme.colors.mutedText}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <ThemedText style={styles.label}>Pot diameter (inches)</ThemedText>
                    <TextInput
                      keyboardType="numeric"
                      style={[styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
                      value={potDiameterIn}
                      onChangeText={setPotDiameterIn}
                      placeholder="Number"
                      placeholderTextColor={theme.colors.mutedText}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <ThemedText style={styles.label}>Pot height (inches)</ThemedText>
                    <TextInput
                      keyboardType="numeric"
                      style={[styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
                      value={potHeightIn}
                      onChangeText={setPotHeightIn}
                      placeholder="Number"
                      placeholderTextColor={theme.colors.mutedText}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <ThemedText style={styles.label}>Drainage system</ThemedText>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
                      value={drainageSystem}
                      onChangeText={setDrainageSystem}
                      placeholder="Saucer, cachepot, etc."
                      placeholderTextColor={theme.colors.mutedText}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <ThemedText style={styles.label}>Soil mix</ThemedText>
                    {soilRows.map((row, idx) => (
                      <View key={row.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <TextInput
                          style={[styles.input, { flex: 1, backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
                          value={row.name}
                          onChangeText={(t) => setSoilRows((r) => r.map((x, i) => i === idx ? { ...x, name: t } : x))}
                          placeholder="Component"
                          placeholderTextColor={theme.colors.mutedText}
                        />
                        <TextInput
                          keyboardType="numeric"
                          style={[styles.input, { width: 88, backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text, textAlign: 'center' }]}
                          value={row.parts}
                          onChangeText={(t) => setSoilRows((r) => r.map((x, i) => i === idx ? { ...x, parts: t } : x))}
                          placeholder="parts"
                          placeholderTextColor={theme.colors.mutedText}
                        />
                        <TouchableOpacity onPress={() => setSoilRows((r) => r.filter((_, i) => i !== idx))} accessibilityLabel="Remove component">
                          <IconSymbol name="xmark.circle.fill" size={20} color={theme.colors.mutedText} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                      <TouchableOpacity
                        onPress={() => setSoilRows((r) => [...r, { id: Math.random().toString(36).slice(2), name: '', parts: '' }])}
                        accessibilityLabel="Add component"
                        style={styles.textButton}
                      >
                        <ThemedText style={[styles.textButtonLabel, { color: theme.colors.primary }]}>+ Add</ThemedText>
                      </TouchableOpacity>
                      {soilRows.length > 0 && (
                        <TouchableOpacity onPress={() => setSoilRows([])} accessibilityLabel="Clear soil mix" style={[styles.smallButton, { backgroundColor: theme.colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border }]}>
                          <ThemedText style={{ fontWeight: '700' }}>Clear</ThemedText>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              )}
            </View>
            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.colors.primary, opacity: saving ? 0.6 : (isEdit ? (hasChanges ? 1 : 0.45) : 1) }]} onPress={onSave} disabled={saving}>
              <ThemedText style={styles.primaryLabel}>Save</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkButton} onPress={() => (nav as any).goBack()}>
              <ThemedText style={[styles.linkLabel, { color: theme.colors.mutedText }]}>Cancel</ThemedText>
            </TouchableOpacity>
          </View>
        </ParallaxScrollView>
        {saving && (
          <View style={styles.savingOverlay} pointerEvents="auto">
            <View style={[styles.savingCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
              <ActivityIndicator size="large" />
              <ThemedText style={styles.savingText}>Saving…</ThemedText>
            </View>
          </View>
        )}
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerImage: { width: '100%', height: '100%' },
  headerRow: { marginTop: 8, marginHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  formContainer: { marginTop: 8, marginHorizontal: 2, gap: 8 },
  scrollContent: { paddingBottom: 32 },
  fieldGroup: { marginTop: 10, gap: 6 },
  label: { fontSize: 14, opacity: 0.8 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photoPreview: { width: 72, height: 72, borderRadius: 8 },
  smallButton: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center' },
  smallButtonLabel: { color: '#fff', fontWeight: '600' },
  textButton: { paddingVertical: 8, paddingHorizontal: 4 },
  textButtonLabel: { fontWeight: '700' },
  addPhotoCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden', aspectRatio: 1, width: '100%' },
  addPhotoInner: { flex: 1, paddingVertical: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', gap: 8 },
  addPhotoIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  addPhotoTitle: { fontWeight: '600' },
  addPhotoSubtitle: { opacity: 0.7, fontSize: 12 },
  photoCard: { borderRadius: 12, overflow: 'hidden', position: 'relative', aspectRatio: 1, width: '100%' },
  photoCardImage: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  photoOverlay: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', gap: 8 },
  overlayBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999 },
  overlayLabel: { color: '#fff', fontWeight: '600' },
  searchInputContainer: { position: 'relative' },
  searchInput: { paddingLeft: 36, paddingRight: 36 },
  searchIcon: { position: 'absolute', left: 10, top: 0, bottom: 0, textAlignVertical: 'center', textAlign: 'center', lineHeight: 44 },
  searchSpinner: { position: 'absolute', right: 10, top: 8 },
  suggestionsBox: { marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, maxHeight: 220, overflow: 'hidden' },
  suggestionRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.08)' },
  suggestionPrimary: { fontWeight: '600' },
  suggestionSecondary: { opacity: 0.7 },
  primaryButton: { marginTop: 16, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '600' },
  linkButton: { marginTop: 10, alignItems: 'center', paddingVertical: 8 },
  linkLabel: { fontWeight: '600' },
  savingOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  savingCard: { paddingHorizontal: 20, paddingVertical: 18, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', gap: 10 },
  savingText: { fontWeight: '600' },
  plantTypeContainer: { gap: 12 },
  plantTypeOption: { 
    borderWidth: StyleSheet.hairlineWidth, 
    borderRadius: 12, 
    padding: 16,
    transition: 'all 0.2s',
  },
  plantTypeContent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  plantTypeIconContainer: { 
    width: 56, 
    height: 56, 
    borderRadius: 12, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  plantTypeTextContainer: { flex: 1, gap: 4 },
  plantTypeTitle: { fontSize: 16, fontWeight: '600' },
  plantTypeDescription: { fontSize: 13, lineHeight: 18 },
  radioButton: { 
    width: 22, 
    height: 22, 
    borderRadius: 11, 
    borderWidth: 2, 
    alignItems: 'center', 
    justifyContent: 'center',
    marginTop: 2,
  },
  radioButtonInner: { 
    width: 12, 
    height: 12, 
    borderRadius: 6,
  },
  advancedHeader: {
    paddingVertical: 12,
  },
  advancedHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  advancedHeaderText: {
    fontSize: 16,
    fontWeight: '600',
  },
  advancedContent: {
    marginTop: 8,
    paddingLeft: 28,
  },
});
