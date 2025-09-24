import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View, BackHandler, Platform } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import SkeletonTile from '@/components/SkeletonTile';
import PlantTimeline from '@/components/PlantTimeline';
import WaterModal from '@/components/WaterModal';
import ConfirmNameModal from '@/components/ConfirmNameModal';
import { useGeneratePlantFacts } from '@/hooks/useGeneratePlantFacts';
import { useGenerateCare } from '@/hooks/useGenerateCare';

import TopBar from '@/components/TopBar';
import MenuSheet from '@/components/MenuSheet';
import Section from '@/components/Section';
import AboutBox from '@/components/AboutBox';
import CompactStatus from '@/components/CompactStatus';
import EnvironmentSection from '@/components/EnvironmentSection';
import CareSection from '@/components/CareSection';
import SoilMixViz from '@/components/SoilMixViz';
import LocationModal from '@/components/LocationModal';
import SoilModal from '@/components/SoilModal';
import PotDetailsModal from '@/components/PotDetailsModal';
import { ButtonPill } from '@/components/Buttons';
import GenerateFactsButton from '@/components/GenerateFactsButton';

import { labelAvailability, labelRarity } from '@/utils/labels';
import type { Availability, Rarity, RouteParams, SoilRowDraft, PotShape } from '@/utils/types';

export default function PlantDetailScreen() {
  const { theme } = useTheme();
  const route = useRoute();
  const nav = useNavigation();
  const { id } = (route.params as any) as RouteParams;
  const { user } = useAuth();

  // ===== State (grouped) =====
  const [ui, setUi] = useState({
    menuOpen: false,
    heroLoaded: false,
    refreshing: false,
    timelineKey: 0,
    genLoading: false,
  });
  const [overlay, setOverlay] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });

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
    plantsTableId: null as string | null,
    pot: { type: '', heightIn: null as number | null, diameterIn: null as number | null, drainage: '' } as PotShape,
    soilMix: null as Record<string, number> | null,
    soilDescription: null as string | null,
    propagationMethods: [] as { method: string; difficulty?: string | null; description?: string | null }[],
  });

  // Modals/drafts
  const [modals, setModals] = useState({
    water: false,
    location: false,
    soil: false,
    pot: false as boolean,
    potMode: 'add' as 'add' | 'repot',
    confirmName: { open: false, suggested: null as string | null },
  });
  const [drafts, setDrafts] = useState({ location: '', soilRows: [] as SoilRowDraft[], potNote: '' });
  const [potDraft, setPotDraft] = useState({ potType: '', drainageSystem: '', potHeightIn: '', potDiameterIn: '' });

  const [openSection, setOpenSection] = useState<'care' | 'timeline' | 'environment' | 'propagation' | 'photos' | null>(null);
  const toggle = (key: NonNullable<typeof openSection>) => setOpenSection((curr) => (curr === key ? null : key));

  // Debounce ref for favorite
  const favTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { loading: genFactsLoading, run: generateFacts } = useGeneratePlantFacts();
  const { loading: genCareLoading,  run: generateCare  } = useGenerateCare();
  const genLoading = ui.genLoading || genFactsLoading || genCareLoading;

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
        if (modals.location) { setModals((m) => ({ ...m, location: false })); return true; }
        if (modals.soil) { setModals((m) => ({ ...m, soil: false })); return true; }
        if (modals.pot) { setModals((m) => ({ ...m, pot: false })); return true; }
        if ((modals as any).confirmName?.open) { setModals((m: any) => ({ ...m, confirmName: { open: false, suggested: null } })); return true; }
        // Always navigate to My Plants page
        (nav as any).navigate('plants');
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
          'id, nickname, plants_table_id, default_plant_photo_id, favorite, location, pot_type, pot_height_in, pot_diameter_in, drainage_system, soil_mix'
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
            .createSignedUrl(pr.object_path, 3600, { transform: { width: 1200, quality: 85, resize: 'contain' } });
          hero = signed?.signedUrl ?? '';
        }
      }

      // names/details
      let nickname = up.nickname || '';
      let commonName = '';
      let scientific = '';
      let description = '';
      let availability: Availability = '';
      let rarity: Rarity = '';

      let plantRow: any = null;
      if (up.plants_table_id) {
        const { data } = await supabase
          .from('plants')
          .select('plant_name, plant_scientific_name, description, availability, rarity, propagation_methods_json, soil_description')
          .eq('id', up.plants_table_id)
          .maybeSingle();
        plantRow = data;

        commonName = plantRow?.plant_name || '';
        scientific = plantRow?.plant_scientific_name || 'Unknown Scientific Name';
        description = plantRow?.description || '';
        availability = (plantRow?.availability as any) || '';
        rarity = (plantRow?.rarity as any) || '';
      }

      setPlant({
        headerUrl: hero,
        displayName: nickname || 'My Plant',
        commonName: commonName || '',
        scientific,
        description,
        availability,
        rarity,
        isFavorite: !!up.favorite,
        location: up.location ?? '',
        plantsTableId: up.plants_table_id ?? null,
        pot: {
          type: up.pot_type ?? '',
          heightIn: typeof up.pot_height_in === 'number' ? up.pot_height_in : up.pot_height_in ? Number(up.pot_height_in) : null,
          diameterIn: typeof up.pot_diameter_in === 'number' ? up.pot_diameter_in : up.pot_diameter_in ? Number(up.pot_diameter_in) : null,
          drainage: up.drainage_system ?? '',
        },
        soilMix: (up as any).soil_mix ?? null,
        soilDescription: (plantRow as any)?.soil_description ?? null,
        propagationMethods: ((plantRow as any)?.propagation_methods_json ?? []) as any[],
      });
    } catch (e: any) {
      setStatus({ loading: false, error: e?.message ?? 'Failed to load plant' });
    } finally {
      setStatus((s) => ({ ...s, loading: false }));
      setUi((u) => ({ ...u, refreshing: false }));
      if (isPull) setUi((u) => ({ ...u, timelineKey: u.timelineKey + 1 }));
    }
  }, [id]);

  useEffect(() => {
    fetchDetails(false);
    return () => { if (favTimerRef.current) clearTimeout(favTimerRef.current); };
  }, [fetchDetails]);

  const onRefresh = useCallback(() => {
    setUi((u) => ({ ...u, refreshing: true }));
    fetchDetails(true);
  }, [fetchDetails]);

  const isRemoteHeader = !!plant.headerUrl;
  const showHeaderSkeleton = isRemoteHeader && !ui.heroLoaded;

  // ===== Helpers =====
  const showOverlay = (message: string) => setOverlay({ visible: true, message });
  const hideOverlay = () => setOverlay({ visible: false, message: '' });

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

  const saveLocation = useCallback(async () => {
    const prev = plant.location || '';
    const next = drafts.location.trim();
    if (next === prev) { setModals((m) => ({ ...m, location: false })); return; }
    try {
      const { error: updErr } = await supabase.from('user_plants').update({ location: next || null }).eq('id', id);
      if (updErr) throw updErr;
      setPlant((p) => ({ ...p, location: next }));
      setModals((m) => ({ ...m, location: false }));
      if (user?.id && prev) {
        await supabase.from('user_plant_timeline_events').insert({
          owner_id: user.id, user_plant_id: id, event_type: 'move', event_data: { from: prev || null, to: next || null }, note: null,
        });
      }
    } catch {}
  }, [drafts.location, plant.location, id, user?.id]);

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

  // ===== Render =====
  return (
    <View style={{ flex: 1 }}>
      <TopBar
        title={plant.displayName || 'Plant'}
        isFavorite={plant.isFavorite}
        onBack={() => (nav as any).navigate('MainTabs')}
        onToggleFavorite={toggleFavorite}
        onToggleMenu={() => setUi((u) => ({ ...u, menuOpen: !u.menuOpen }))}
      />

      {ui.menuOpen && (
        <MenuSheet
          onEdit={() => {
            setUi((u) => ({ ...u, menuOpen: false }));
            (nav as any).navigate('AddPlant', { userPlantId: id });
          }}
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
                    (nav as any).navigate('MainTabs');
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
        {status.loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
          </View>
        ) : status.error ? (
          <ThemedText>{status.error}</ThemedText>
        ) : (
          <>
            <ThemedView>
              {/* Common name under header (nickname remains in TopBar) */}
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

                    await fetchDetails(true);

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
              <Section title="Care & Schedule" open={openSection === 'care'} onToggle={() => toggle('care')}>
                <CareSection
                  isOpen={openSection === 'care'}
                  plantsTableId={plant.plantsTableId}
                  commonName={plant.commonName}
                  displayName={plant.displayName}
                  scientificName={plant.scientific}
                  showOverlay={(msg) => setOverlay({ visible: true, message: msg })}
                  hideOverlay={() => setOverlay({ visible: false, message: '' })}
                  onRefetch={() => fetchDetails(true)}
                  onWater={() => setModals((m) => ({ ...m, water: true }))}   // <— opens WaterModal
                  onFertilize={() => {}}
                  onPrune={() => {}}
                  onObserve={() => (nav as any).navigate('Observe', { id })}
                />
              </Section>

              <Section title="Timeline" open={openSection === 'timeline'} onToggle={() => toggle('timeline')}>
                <PlantTimeline key={ui.timelineKey} userPlantId={id} withinScrollView />
              </Section>

              <Section title="Environment" open={openSection === 'environment'} onToggle={() => toggle('environment')}>
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
                    setDrafts((d) => ({ ...d, location: plant.location || '' }));
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

              <Section title="Propagation" open={openSection === 'propagation'} onToggle={() => toggle('propagation')}>
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
                          {!!pm.description && (
                            <ThemedText style={{ color: theme.colors.mutedText }}>{pm.description}</ThemedText>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </Section>
              <Section title="Photos" open={openSection === 'photos'} onToggle={() => toggle('photos')} />
            </View>
          </>
        )}
      </ParallaxScrollView>

      {/* Full-page progress overlay */}
      <Modal visible={overlay.visible} transparent animationType="fade">
        <View style={styles.overlayBackdrop}>
          <View style={[styles.overlayCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }] }>
            <ActivityIndicator color={theme.colors.text as any} />
            <ThemedText style={{ marginTop: 12 }}>{overlay.message || 'Working…'}</ThemedText>
          </View>
          <Pressable style={styles.overlayBlocker} />
        </View>
      </Modal>

      {/* Modals */}
      <WaterModal open={modals.water} onClose={() => setModals((m) => ({ ...m, water: false }))} userPlantId={id} onSaved={() => setUi((u) => ({ ...u, timelineKey: u.timelineKey + 1 }))} />
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
            await fetchDetails(true);
          } catch (e: any) {
            Alert.alert('Update failed', e?.message ?? 'Could not update common name.');
          } finally {
            setOverlay({ visible: false, message: '' });
            setModals((m: any) => ({ ...m, confirmName: { open: false, suggested: null } }));
          }
        }}
      />
      <LocationModal
        open={modals.location}
        value={drafts.location}
        onChange={(t) => setDrafts((d) => ({ ...d, location: t }))}
        onCancel={() => setModals((m) => ({ ...m, location: false }))}
        onSave={saveLocation}
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
});
