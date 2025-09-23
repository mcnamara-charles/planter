import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import SkeletonTile from '@/components/SkeletonTile';
import SoilMixViz from '@/components/SoilMixViz';
import PlantTimeline from '@/components/PlantTimeline';
import WaterModal from '@/components/WaterModal';
import { useGeneratePlantFacts } from '@/hooks/useGeneratePlantFacts';

import TopBar from '@/components/TopBar';
import MenuSheet from '@/components/MenuSheet';
import Section from '@/components/Section';
import AboutBox from '@/components/AboutBox';
import CompactStatus from '@/components/CompactStatus';
import EnvironmentSection from '@/components/EnvironmentSection';
import LocationModal from '@/components/LocationModal';
import SoilModal from '@/components/SoilModal';
import PotDetailsModal from '@/components/PotDetailsModal';
import GridPanel from '@/components/GridPanel';
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
  const [ui, setUi] = useState({ menuOpen: false, heroLoaded: false, refreshing: false, timelineKey: 0, genLoading: false });
  const [status, setStatus] = useState({ loading: true, error: null as string | null });
  const [plant, setPlant] = useState({
    headerUrl: '',
    displayName: '',
    scientific: '',
    description: '',
    availability: '' as Availability,
    rarity: '' as Rarity,
    isFavorite: false,
    location: '',
    plantsTableId: null as string | null,
    pot: { type: '', heightIn: null as number | null, diameterIn: null as number | null, drainage: '' } as PotShape,
    soilMix: null as Record<string, number> | null,
  });

  // Modals/drafts
  const [modals, setModals] = useState({ water: false, location: false, soil: false, pot: false as boolean, potMode: 'add' as 'add' | 'repot' });
  const [drafts, setDrafts] = useState({ location: '', soilRows: [] as SoilRowDraft[], potNote: '' });
  const [potDraft, setPotDraft] = useState({ potType: '', drainageSystem: '', potHeightIn: '', potDiameterIn: '' });

  const [openSection, setOpenSection] = useState<
    'care' | 'timeline' | 'environment' | 'propagation' | 'photos' | null
  >(null);

  const toggle = (key: NonNullable<typeof openSection>) =>
    setOpenSection((curr) => (curr === key ? null : key));

  // Debounce ref for favorite
  const favTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { loading: genLoadingHook, run: generateFacts } = useGeneratePlantFacts();
  const genLoading = ui.genLoading || genLoadingHook;

  const rarityLabel = useMemo(() => labelRarity(plant.rarity), [plant.rarity]);
  const availabilityLabel = useMemo(() => labelAvailability(plant.availability), [plant.availability]);

  // ===== Data fetch =====
  const fetchDetails = useCallback(async (isPull = false) => {
    try {
      if (!isPull) setStatus((s) => ({ ...s, loading: true, error: null }));
      const { data: up, error: upErr } = await supabase
        .from('user_plants')
        .select('id, nickname, plants_table_id, default_plant_photo_id, favorite, location, pot_type, pot_height_in, pot_diameter_in, drainage_system, soil_mix')
        .eq('id', id)
        .maybeSingle();
      if (upErr) throw upErr;
      if (!up) throw new Error('Plant not found');

      // signed hero url
      let hero = '';
      if (up.default_plant_photo_id) {
        const { data: pr } = await supabase.from('user_plant_photos').select('bucket, object_path').eq('id', up.default_plant_photo_id).maybeSingle();
        if (pr?.object_path) {
          const { data: signed } = await supabase.storage.from(pr.bucket || 'plant-photos').createSignedUrl(pr.object_path, 3600, {
            transform: { width: 1200, quality: 85, resize: 'contain' },
          });
          hero = signed?.signedUrl ?? '';
        }
      }

      // names/details
      let displayName = up.nickname || '';
      let scientific = '';
      let description = '';
      let availability: Availability = '';
      let rarity: Rarity = '';

      if (up.plants_table_id) {
        const { data: plantRow } = await supabase
          .from('plants')
          .select('plant_name, plant_scientific_name, description, availability, rarity')
          .eq('id', up.plants_table_id)
          .maybeSingle();
        displayName = displayName || plantRow?.plant_name || 'Unnamed Plant';
        scientific = plantRow?.plant_scientific_name || 'Unknown Scientific Name';
        description = plantRow?.description || '';
        availability = (plantRow?.availability as any) || '';
        rarity = (plantRow?.rarity as any) || '';
      }

      setPlant({
        headerUrl: hero,
        displayName,
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
      });
      setUi((u) => ({ ...u, heroLoaded: false }));
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
        onBack={() => (nav as any).goBack()}
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
                    (nav as any).goBack();
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
              <ThemedText type="title">{plant.displayName}</ThemedText>
              {!!plant.scientific && <ThemedText style={{ opacity: 0.7, fontStyle: 'italic' }}>{plant.scientific}</ThemedText>}
              <CompactStatus rarity={rarityLabel} availability={availabilityLabel} />


              <GenerateFactsButton
                label={genLoading ? 'Generating…' : 'Generate Facts'}
                disabled={genLoading || !plant.plantsTableId}
                onPress={async () => {
                  if (!plant.plantsTableId) return;
                  try {
                    const res = await generateFacts({
                      plantsTableId: plant.plantsTableId,
                      commonName: plant.displayName,
                      scientificName: plant.scientific,
                    });
                    if (res) {
                      setPlant((p) => ({
                        ...p,
                        description: res.description,
                        availability: res.availability_status as Availability,
                        rarity: res.rarity_level as Rarity,
                      }));
                    } else {
                      Alert.alert('Generation failed', 'Please try again.');
                    }
                    await fetchDetails(true);
                    Alert.alert('Updated', 'Description, rarity, and availability saved.');
                  } catch (e: any) {
                    Alert.alert('Generation failed', e?.message ?? 'Please try again.');
                  }
                }}
              />
            </ThemedView>

            <AboutBox title="About Plant" body={plant.description} />

            <View style={{ marginTop: 12 }}>
              <Section title="Care & Schedule" open={openSection === 'care'} onToggle={() => toggle('care')}>
                <View style={{ gap: 12 }}>
                  <ThemedText style={{ fontWeight: '800' }}>Care Actions</ThemedText>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 8 }}>
                    <ButtonPill
                      label="Water"
                      variant="outline"
                      color="primary"
                      onPress={() => setModals((m) => ({ ...m, water: true }))}
                    />
                    <ButtonPill label="Fertilize" variant="outline" color="primary" />
                    <ButtonPill label="Prune"     variant="outline" color="primary" />
                    <ButtonPill label="Observe"   variant="outline" color="primary" />
                  </View>
                </View>
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
                      <SoilMixViz mix={Object.entries(plant.soilMix).map(([label, parts]) => ({ label, parts: Number(parts), icon: 'leaf' }))} />
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

              <Section title="Propagation" open={openSection === 'propagation'} onToggle={() => toggle('propagation')} />
              <Section title="Photos" open={openSection === 'photos'} onToggle={() => toggle('photos')} />
            </View>
          </>
        )}
      </ParallaxScrollView>

      {/* Modals */}
      <WaterModal open={modals.water} onClose={() => setModals((m) => ({ ...m, water: false }))} userPlantId={id} onSaved={() => {}} />

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
});
