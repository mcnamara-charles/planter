import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View, TouchableOpacity, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import SkeletonTile from '@/components/SkeletonTile';
import PotDetailsFields, { type PotDetailsValues } from '@/components/PotDetailsFields';
import SoilMixViz, { type SoilPart } from '@/components/SoilMixViz';
import PotBlueprintViz from '@/components/PotBlueprintViz';
import PlantTimeline from '@/components/PlantTimeline';

type RouteParams = { id: string };

export default function PlantDetailScreen() {
	const { theme } = useTheme();
  const route = useRoute();
  const nav = useNavigation();
  const { id } = (route.params as any) as RouteParams;

  const [headerUrl, setHeaderUrl] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [scientific, setScientific] = useState<string>('');
  const [plantLocation, setPlantLocation] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
  const [isFavorite, setIsFavorite] = useState<boolean>(false);
  const favTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [aboutExpanded, setAboutExpanded] = useState<boolean>(false);
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [timelineKey, setTimelineKey] = useState(0);
  const [potType, setPotType] = useState<string>('');
  const [potHeightIn, setPotHeightIn] = useState<number | null>(null);
  const [potDiameterIn, setPotDiameterIn] = useState<number | null>(null);
  const [drainageSystem, setDrainageSystem] = useState<string>('');
  const [soilMix, setSoilMix] = useState<Record<string, number> | null>(null);
  const [potModalOpen, setPotModalOpen] = useState(false);
  const [potDraft, setPotDraft] = useState<PotDetailsValues>({ potType: '', drainageSystem: '', potHeightIn: '', potDiameterIn: '' });
  const [potModalMode, setPotModalMode] = useState<'add' | 'repot'>('add');
  const [potDraftNote, setPotDraftNote] = useState('');
  const { user } = useAuth();

  const fetchDetails = useCallback(async (isPull: boolean = false) => {
    try {
      if (!isPull) setLoading(true);
      setError(null);
      // Fetch one user plant with related fields
      const { data: up, error: upErr } = await supabase
        .from('user_plants')
        .select('id, nickname, plants_table_id, default_plant_photo_id, favorite, location, pot_type, pot_height_in, pot_diameter_in, drainage_system, soil_mix')
        .eq('id', id)
        .maybeSingle();
      if (upErr) throw upErr;
      if (!up) throw new Error('Plant not found');

      // resolve image from default_plant_photo_id (signed URL)
      let hero = '';
      if (up.default_plant_photo_id) {
        const { data: pr, error: prErr } = await supabase
          .from('user_plant_photos')
          .select('bucket, object_path')
          .eq('id', up.default_plant_photo_id)
          .maybeSingle();
        if (!prErr && pr?.object_path) {
          const { data: signed } = await supabase.storage
            .from(pr.bucket || 'plant-photos')
            .createSignedUrl(pr.object_path, 60 * 60, {
              transform: { width: 1200, quality: 85, resize: 'contain' },
            });
          hero = signed?.signedUrl ?? '';
        }
      }

      // resolve names from plants table
      let commonName = up.nickname || '';
      let sciName = '';
      if (up.plants_table_id) {
        const { data: plantRow } = await supabase
          .from('plants')
          .select('plant_name, plant_scientific_name')
          .eq('id', up.plants_table_id)
          .maybeSingle();
        commonName = commonName || plantRow?.plant_name || 'Unnamed Plant';
        sciName = plantRow?.plant_scientific_name || '';
      }

      setHeaderUrl(hero);
      setDisplayName(commonName);
      setScientific(sciName);
      setIsFavorite(!!up.favorite);
      setPlantLocation(up.location ?? '');
      setPotType(up.pot_type ?? '');
      setPotHeightIn(typeof up.pot_height_in === 'number' ? up.pot_height_in : up.pot_height_in ? Number(up.pot_height_in) : null);
      setPotDiameterIn(typeof up.pot_diameter_in === 'number' ? up.pot_diameter_in : up.pot_diameter_in ? Number(up.pot_diameter_in) : null);
      setDrainageSystem(up.drainage_system ?? '');
      setSoilMix((up as any).soil_mix ?? null);
      setHeroLoaded(false);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load plant');
    } finally {
      setLoading(false);
      setRefreshing(false);
      if (isPull) setTimelineKey((k) => k + 1); // force timeline remount to refetch
    }
  }, [id]);

  useEffect(() => {
    fetchDetails(false);
  }, [id, fetchDetails]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDetails(true);
  }, [fetchDetails]);

  const isRemoteHeader = !!headerUrl;
  const showHeaderSkeleton = isRemoteHeader && !heroLoaded;

  return (
    <View style={{ flex: 1 }}>
      {/* Non-overlapping top bar */}
			<View style={[styles.topBar, { backgroundColor: theme.colors.card, borderBottomColor: theme.colors.border }]}>
        <View style={styles.leftGroup}>
					<TouchableOpacity
						style={styles.backButton}
						accessibilityRole="button"
						accessibilityLabel="Go back"
						onPress={() => (nav as any).goBack()}>
						<IconSymbol name="arrow.left" color={theme.colors.text} size={20} />
					</TouchableOpacity>
					<ThemedText style={styles.topTitle} numberOfLines={1}>
						{displayName || 'Plant'}
					</ThemedText>
				</View>
        <View style={styles.rightGroup}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={isFavorite ? 'Unfavorite' : 'Favorite'}
            onPress={() => {
              // optimistic toggle with debounce commit
              const next = !isFavorite;
              setIsFavorite(next);
              if (favTimerRef.current) clearTimeout(favTimerRef.current);
              favTimerRef.current = setTimeout(async () => {
                try {
                  await supabase
                    .from('user_plants')
                    .update({ favorite: next })
                    .eq('id', id);
                } catch {}
              }, 500);
            }}
            style={styles.iconBtn}
          >
            <IconSymbol name={isFavorite ? 'heart.fill' : 'heart'} color={isFavorite ? '#e63946' : theme.colors.text} size={22} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="More options"
            onPress={() => setMenuOpen((m) => !m)}
            style={styles.iconBtn}                // <-- give it the same button style
          >
            <IconSymbol name="ellipsis.vertical" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
			</View>
      {menuOpen && (
        <View style={[styles.menuSheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}> 
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              (nav as any).navigate('AddPlant', { userPlantId: id });
            }}
          >
            <ThemedText>Edit details</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              Alert.alert('Delete plant', 'Are you sure you want to delete this plant?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: async () => {
                  try {
                    const { error: delErr } = await supabase.from('user_plants').delete().eq('id', id);
                    if (delErr) throw delErr;
                    (nav as any).goBack();
                  } catch (e: any) {
                    Alert.alert('Delete failed', e?.message ?? 'Unknown error');
                  }
                }}
              ]);
            }}
          >
            <ThemedText style={{ color: '#d11a2a', fontWeight: '600' }}>Delete</ThemedText>
          </TouchableOpacity>
        </View>
      )}

      <ParallaxScrollView
        headerBackgroundColor={{ light: '#E5F4EF', dark: '#12231F' }}
        refreshing={refreshing}
        onRefresh={onRefresh}
        headerImage={
          headerUrl ? (
          <Image
            key={headerUrl}
            source={{uri: headerUrl}}
            contentFit="cover"
            transition={200}
            style={styles.headerImage}
            onLoadStart={() => setHeroLoaded(false)}
            onLoadEnd={() => setHeroLoaded(true)}
            onError={() => setHeroLoaded(true)}
          />
          ) : (
            // No remote? Use the local fallback as usual.
            <></>
          )
        }
        headerOverlay={
          heroLoaded ? null : (
            <SkeletonTile style={styles.headerSkeleton} rounded={0} />
          )
        }
      >
      {loading ? (
        <View style={styles.loadingRow}><ActivityIndicator /></View>
      ) : error ? (
        <ThemedText>{error}</ThemedText>
      ) : (
        <>
					<ThemedView>
            <ThemedText type="title">{displayName}</ThemedText>
            {!!scientific && <ThemedText style={{ opacity: 0.7, fontStyle: 'italic' }}>{scientific}</ThemedText>}
          </ThemedView>
					{/* About Plant box */}
					<View style={[
						styles.aboutBox,
						{ borderColor: theme.colors.border, backgroundColor: theme.colors.card }
					]}>
						<ThemedText style={styles.aboutTitle}>About Plant</ThemedText>
						<ThemedText
							style={styles.aboutBody}
							numberOfLines={aboutExpanded ? undefined : 4}
						>
							Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor. Cras elementum ultrices diam. Maecenas ligula massa, varius a, semper congue, euismod non, mi. Proin porttitor, orci nec nonummy molestie, enim est eleifend mi, non fermentum diam nisl sit amet erat.
						</ThemedText>
						<TouchableOpacity onPress={() => setAboutExpanded((v) => !v)} accessibilityRole="button" style={styles.aboutToggle}>
							<ThemedText style={[styles.aboutToggleText, { color: theme.colors.primary }]}>
								{aboutExpanded ? 'See less' : 'See more'}
							</ThemedText>
						</TouchableOpacity>
					</View>
					{/* Collapsible sections */}
					<View style={styles.sectionsWrap}>
						<Section title="Care & Schedule" />
            <Section title="Timeline">
              <PlantTimeline key={timelineKey} userPlantId={id} withinScrollView/>
            </Section>
            <Section title="Environment">
              <EnvironmentSection
                plantName={displayName || 'This plant'}
                plantLocation={plantLocation}
                potType={potType}
                potHeightIn={potHeightIn}
                potDiameterIn={potDiameterIn}
                drainageSystem={drainageSystem}
                soilMix={soilMix}
                onAddPotDetails={() => { setPotModalMode('add'); setPotDraft({ potType: potType || '', drainageSystem: drainageSystem || '', potHeightIn: potHeightIn ? String(potHeightIn) : '', potDiameterIn: potDiameterIn ? String(potDiameterIn) : '' }); setPotDraftNote(''); setPotModalOpen(true); }}
                onRepot={() => { setPotModalMode('repot'); setPotDraft({ potType: potType || '', drainageSystem: drainageSystem || '', potHeightIn: potHeightIn ? String(potHeightIn) : '', potDiameterIn: potDiameterIn ? String(potDiameterIn) : '' }); setPotDraftNote(''); setPotModalOpen(true); }}
              />
            </Section>
						<Section title="Propagation" />
						<Section title="Photos" />
					</View>
        </>
      )}
      </ParallaxScrollView>
      <PotDetailsModal
        open={potModalOpen}
        onClose={() => setPotModalOpen(false)}
        draft={potDraft}
        setDraft={setPotDraft}
        mode={potModalMode}
        note={potDraftNote}
        setNote={setPotDraftNote}
        onSave={async (vals) => {
          try {
            const prev = {
              pot_type: potType || null,
              drainage_system: drainageSystem || null,
              pot_height_in: potHeightIn ?? null,
              pot_diameter_in: potDiameterIn ?? null,
            };
            const { error: updErr } = await supabase.from('user_plants').update({
              pot_type: vals.potType || null,
              drainage_system: vals.drainageSystem || null,
              pot_height_in: vals.potHeightIn ? Number(vals.potHeightIn) : null,
              pot_diameter_in: vals.potDiameterIn ? Number(vals.potDiameterIn) : null,
            }).eq('id', id);
            if (updErr) throw updErr;
            setPotModalOpen(false);
            setLoading(true);
            const { data: up } = await supabase
              .from('user_plants')
              .select('pot_type, pot_height_in, pot_diameter_in, drainage_system')
              .eq('id', id)
              .maybeSingle();
            setPotType(up?.pot_type ?? '');
            setPotHeightIn(up?.pot_height_in ?? null);
            setPotDiameterIn(up?.pot_diameter_in ?? null);
            setDrainageSystem(up?.drainage_system ?? '');

            const wasEmpty = !prev.pot_type && !prev.drainage_system && !prev.pot_height_in && !prev.pot_diameter_in;
            const isRepot = potModalMode === 'repot' || !wasEmpty;
            if (isRepot && user?.id) {
              await supabase.from('user_plant_timeline_events').insert({
                owner_id: user.id,
                user_plant_id: id,
                event_type: 'repot',
                event_data: {
                  previous_pot_type: prev.pot_type,
                  previous_drainage_system: prev.drainage_system,
                  previous_diameter: prev.pot_diameter_in,
                  previous_height: prev.pot_height_in,
                  new_pot_type: up?.pot_type ?? null,
                  new_drainage_system: up?.drainage_system ?? null,
                  new_diameter: up?.pot_diameter_in ?? null,
                  new_height: up?.pot_height_in ?? null,
                },
                note: potDraftNote || null,
              });
            }
          } finally {
            setLoading(false);
          }
        }}
      />
    </View>
  );
}

function Pill({ label }: { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={{
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
    }}>
      <ThemedText style={{ fontWeight: '600', fontSize: 12 }}>{label}</ThemedText>
    </View>
  );
}

function SeparatorPlus() {
  const { theme } = useTheme();
  return (
    <View style={{ paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
      <ThemedText style={{ color: theme.colors.mutedText, fontWeight: '700' }}>+</ThemedText>
    </View>
  );
}

/* old EnvironmentSection removed */

function Section({ title, children }: { title: string; children?: React.ReactNode }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState<boolean>(false);
  return (
    <View style={[styles.sectionContainer, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`Toggle section ${title}`}
      >
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        <ThemedText style={[styles.sectionIndicator, { color: theme.colors.text }]}>{open ? '−' : '+'}</ThemedText>
      </TouchableOpacity>
      {open && (
        <View style={[styles.sectionBody, { backgroundColor: theme.colors.background }]}> 
          {children ?? <ThemedText style={{ opacity: 0.8 }}>Coming soon…</ThemedText>}
        </View>
      )}
    </View>
  );
}

function EnvironmentSection({ plantName, plantLocation, potType, potHeightIn, potDiameterIn, drainageSystem, soilMix, onAddPotDetails, onRepot }: { plantName: string; plantLocation?: string; potType?: string | null; potHeightIn?: number | null; potDiameterIn?: number | null; drainageSystem?: string | null; soilMix?: Record<string, number> | null; onAddPotDetails?: () => void; onRepot?: () => void }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 8 }}>
        <ThemedText style={{ fontWeight: '800' }}>Location</ThemedText>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <ThemedText style={{ opacity: 0.85 }}>{plantLocation || 'Not set'}</ThemedText>
          <TouchableOpacity style={[styles.envBtn, { borderColor: theme.colors.border }]}>
            <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>Move</ThemedText>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <ThemedText style={{ fontWeight: '800' }}>Potting</ThemedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: 8 }}>
          {!!potType && <Pill label={potType} />}
          {!!drainageSystem && <Pill label={`Drainage: ${drainageSystem}`} />}
        </View>
        {!!(potHeightIn || potDiameterIn) && (
          <View style={{ marginTop: 8 }}>
            <PotBlueprintViz heightIn={potHeightIn || 0} diameterIn={potDiameterIn || 0} potType={potType ?? null} drainageSystem={drainageSystem ?? null} />
          </View>
        )}
        {potType || potHeightIn || potDiameterIn || drainageSystem ? (
          <View style={{ marginTop: 8, alignItems: 'flex-start' }}>
          <TouchableOpacity style={[styles.envBtn, { borderColor: theme.colors.border }]} onPress={onRepot}> 
              <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>Repot</ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.soiPanel, { backgroundColor: theme.colors.card }]}> 
            {/* Grid background */}
            <View pointerEvents='none' style={StyleSheet.absoluteFill}>
              <View style={styles.soiGridColWrap}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <View key={`pv-v-${i}`} style={[styles.soiGridCol]} />
                ))}
              </View>
              <View style={styles.soiGridRowWrap}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View key={`pv-h-${i}`} style={[styles.soiGridRow]} />
                ))}
              </View>
              {/* Edge fade overlay */}
              <LinearGradient
                colors={[theme.colors.background as string, 'transparent']}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 16 }}
              />
              <LinearGradient
                colors={['transparent', theme.colors.background as string]}
                style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 16 }}
              />
              <LinearGradient
                colors={[theme.colors.background as string, 'transparent']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 16 }}
              />
              <LinearGradient
                colors={['transparent', theme.colors.background as string]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 16 }}
              />
            </View>

            <View style={{ alignItems: 'center' }}>
              <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]} onPress={onAddPotDetails}>
                <ThemedText style={styles.primaryLabel}>Add Pot Details</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <ThemedText style={{ fontWeight: '800' }}>Soil mix</ThemedText>
        <View style={[styles.soiPanel, { backgroundColor: theme.colors.card }]}> 
          {/* Grid background */}
          <View pointerEvents='none' style={StyleSheet.absoluteFill}>
            <View style={styles.soiGridColWrap}>
              {Array.from({ length: 7 }).map((_, i) => (
                <View key={`v-${i}`} style={[styles.soiGridCol]} />
              ))}
            </View>
            <View style={styles.soiGridRowWrap}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View key={`h-${i}`} style={[styles.soiGridRow]} />
              ))}
            </View>
            {/* Edge fade overlay */}
            <LinearGradient
              colors={[theme.colors.background as string, 'transparent']}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 16 }}
            />
            <LinearGradient
              colors={['transparent', theme.colors.background as string]}
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 16 }}
            />
            <LinearGradient
              colors={[theme.colors.background as string, 'transparent']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 16 }}
            />
            <LinearGradient
              colors={['transparent', theme.colors.background as string]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 16 }}
            />
          </View>

          {!!soilMix && Object.keys(soilMix).length > 0 ? (
            <SoilMixViz
              mix={Object.entries(soilMix).map(([label, parts]) => ({ label, parts: Number(parts), icon: 'leaf' }))}
            />
          ) : (
            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.colors.primary, marginTop: 12 }]}>
              <ThemedText style={styles.primaryLabel}>Set Soil Mix</ThemedText>
            </TouchableOpacity>
          )}
        </View>
        {!!soilMix && Object.keys(soilMix).length > 0 ? (
          <View style={{ marginTop: 8, alignItems: 'flex-start' }}>
            <TouchableOpacity style={[styles.envBtn, { borderColor: theme.colors.border }]}> 
              <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>Change soil mix</ThemedText>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function PotDetailsModal({
  open,
  onClose,
  onSave,
  draft,
  setDraft,
  mode,
  note,
  setNote,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (values: PotDetailsValues) => void;
  draft: PotDetailsValues;
  setDraft: (v: PotDetailsValues) => void;
  mode: 'add' | 'repot';
  note: string;
  setNote: (t: string) => void;
}) {
  const { theme } = useTheme();
  if (!open) return null;
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: '90%', maxWidth: 520, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.card, padding: 16 }}>
        <ThemedText type="title">{mode === 'repot' ? 'Repot' : 'Add pot details'}</ThemedText>
        <View style={{ height: 8 }} />
        <PotDetailsFields {...draft} onChange={setDraft} />
        {mode === 'repot' && (
          <>
            <View style={{ height: 10 }} />
            <ThemedText style={{ fontWeight: '700' }}>Note</ThemedText>
            <TextInput
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 }}
              placeholder="Optional note"
              placeholderTextColor={theme.colors.mutedText}
              value={note}
              onChangeText={setNote}
            />
          </>
        )}
        <View style={{ height: 14 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
          <TouchableOpacity onPress={onClose} style={[styles.envBtn, { borderColor: theme.colors.border }]}>
            <ThemedText style={{ fontWeight: '700', color: theme.colors.text }}>Cancel</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onSave(draft)} style={[styles.envBtn, { borderColor: theme.colors.border }]}>
            <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>Save</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerImage: { width: '100%', height: '100%' },
  headerSkeleton: { width: '100%', height: '100%' },
  loadingRow: { paddingVertical: 24, alignItems: 'center' },
  topBar: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heroTitle: {
    marginBottom: -2,      // pull subtitle up slightly
  },
  heroSubtitle: {
    opacity: 0.7,
    fontStyle: 'italic',
    marginTop: 0,
    fontSize: 13,          // smaller
    lineHeight: 15,        // tighter
    // @ts-ignore Android: trims extra padding
    includeFontPadding: false,
  },
	leftGroup: {
		flexDirection: 'row',
		alignItems: 'center',
		flexShrink: 1,
	},
	backButton: {
    width: 40, height: 40,                 // uniform hitbox
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,                         // a little tighter than 8 helps alignment feel
  },
  topTitle: {
    fontWeight: '600',
    fontSize: 18,
    // This helps baseline alignment across platforms/fonts:
    // @ts-ignore
    includeFontPadding: false,
    // lineHeight close to fontSize avoids extra vertical whitespace on Android
    lineHeight: 20,
  },
  topMenu: {
    fontSize: 22,
    paddingHorizontal: 4,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,                                 // reduce the spacing slightly
  },
  iconBtn: {
    width: 40, height: 40,                 // uniform hitbox
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuSheet: {
    position: 'absolute',
    right: 12,
    top: 56,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    zIndex: 20,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
	sectionsWrap: {
		marginTop: 12,
		gap: 0,
	},
	aboutBox: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 12,
		padding: 12,
		marginTop: 12,
	},
	aboutTitle: {
		fontSize: 16,
		fontWeight: '700',
		marginBottom: 6,
	},
	aboutBody: {
		fontSize: 14,
		lineHeight: 20,
		opacity: 0.9,
	},
	aboutToggle: {
		marginTop: 8,
		alignSelf: 'flex-start',
		paddingVertical: 4,
		paddingHorizontal: 2,
	},
	aboutToggleText: {
		fontWeight: '700',
	},
	sectionContainer: {
		marginHorizontal: -32, // full-bleed to match page edges (content has 32 padding)
		borderTopWidth: StyleSheet.hairlineWidth,
	},
	sectionHeader: {
		paddingHorizontal: 32,
		paddingVertical: 16,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	sectionTitle: {
		fontSize: 20,
		fontWeight: '800',
	},
	sectionIndicator: {
		fontSize: 24,
		opacity: 0.85,
	},
	sectionBody: {
		paddingHorizontal: 32,
		paddingVertical: 14,
	},
  envBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryButton: { marginTop: 8, marginBottom: 12, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', alignSelf: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '600' },
  soiPanel: { marginTop: 8, padding: 16, borderRadius: 12, overflow: 'hidden' },
  soiGridColWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around' },
  soiGridCol: { width: 1, backgroundColor: 'rgba(127,127,127,0.18)' },
  soiGridRowWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'space-around' },
  soiGridRow: { height: 1, backgroundColor: 'rgba(127,127,127,0.18)' },
  envBtnSmall: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  envBtnSmallLabel: {
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 14,
  },
});


