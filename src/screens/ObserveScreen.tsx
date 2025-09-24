import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput, View, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, Switch, Keyboard } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import TopBar from '@/components/TopBar';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useAuth } from '@/context/AuthContext';
import { IconSymbol } from '@/components/ui/icon-symbol';

type RouteParams = { id: string };

const Section = React.memo(function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
});

const LabeledInput = React.memo(function LabeledInput({ label, value, onChangeText, keyboardType = 'default', placeholder }: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: any;
  placeholder?: string;
}) {
  const { theme } = useTheme();
  return (
    <View>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text },
        ]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.mutedText}
      />
    </View>
  );
});

export default function AddObserveScreen() {
  const nav = useNavigation() as any;
  const { theme } = useTheme();
  const route = useRoute();
  const { id } = (route.params as any) as RouteParams; // user_plant_id
  const { user } = useAuth();

  const [heightIn, setHeightIn] = useState('');
  const [widthIn, setWidthIn] = useState('');
  const [leafCount, setLeafCount] = useState('');
  const [soilMoisture, setSoilMoisture] = useState('');
  const [depthIn, setDepthIn] = useState('');
  const [isHealthy, setIsHealthy] = useState(true);
  const [damageDesc, setDamageDesc] = useState('');
  const [tempF, setTempF] = useState('');
  const [rhPct, setRhPct] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [assets, setAssets] = useState<Array<{ uri: string; width?: number; height?: number; fileName?: string; mimeType?: string }>>([]);

  // Match AddPlantScreen keyboard behavior exactly
  const [androidOffset, setAndroidOffset] = useState(0);
  const KEYBOARD_OFFSET = Platform.OS === 'ios' ? 88 : androidOffset;
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', () => setAndroidOffset(45));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setAndroidOffset(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const parseNum = (v: string): number | null => {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t.replace(/,/g, '.'));
    return Number.isFinite(n) ? n : null;
  };

  const onSave = async () => {
    try {
      setSaving(true);
      const payload = {
        v: 1,
        growth: {
          height_in: parseNum(heightIn),
          width_in: parseNum(widthIn),
          leaf_count: parseNum(leafCount),
        },
        medium: {
          soil_moisture: soilMoisture || null,
          depth_in: parseNum(depthIn),
        },
        health: {
          is_healthy: !!isHealthy,
          damage_desc: damageDesc || '—',
        },
        env: {
          temp_f: parseNum(tempF),
          rh_pct: parseNum(rhPct),
        },
        notes: notes || null,
        source: { method: 'manual' },
      };

      // Create the event first to get the ID
      const { data: evt, error: evtErr } = await supabase
        .from('user_plant_timeline_events')
        .insert({
          owner_id: user?.id ?? null,
          user_plant_id: id,
          event_time: new Date().toISOString(),
          event_type: 'observe',
          event_data: payload as any,
          note: null,
        })
        .select('id')
        .single();
      if (evtErr) throw evtErr;

      const eventId = evt.id as string;

      // Upload and link photos
      for (const a of assets) {
        try {
          const resp = await fetch(a.uri);
          const arrayBuffer = await resp.arrayBuffer();
          const now = new Date();
          const yyyy = String(now.getFullYear());
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const rand = (global as any).crypto?.randomUUID
            ? (global as any).crypto.randomUUID()
            : Math.random().toString(36).slice(2);
          const extMatch = /\.(\w+)$/.exec(a.fileName ?? a.uri);
          const ext = (extMatch?.[1] || 'jpg').toLowerCase();
          const objectPath = `${user?.id || 'anon'}/${id}/timeline/${yyyy}/${mm}/${Date.now()}-${rand}.${ext}`;
          const contentType = a.mimeType || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');

          const { error: uploadErr } = await supabase.storage
            .from('plant-photos')
            .upload(objectPath, arrayBuffer, { contentType, upsert: false });
          if (uploadErr) throw uploadErr;

          const { data: photoRow, error: photoErr } = await supabase
            .from('user_plant_photos')
            .insert({
              owner_id: user?.id ?? null,
              user_plant_id: id,
              bucket: 'plant-photos',
              object_path: objectPath,
              content_type: contentType,
              bytes: arrayBuffer.byteLength ?? null,
              width_px: a.width ?? null,
              height_px: a.height ?? null,
            })
            .select('id')
            .single();
          if (photoErr) throw photoErr;

          // Link photo to timeline event
          const { error: linkErr } = await supabase
            .from('user_plant_timeline_event_photos')
            .insert({ timeline_event_id: eventId, user_plant_photo_id: photoRow!.id });
          if (linkErr) throw linkErr;
        } catch (e) {
          // continue others but notify at the end
          console.warn('Failed to attach one photo:', e);
        }
      }

      Alert.alert('Saved', 'Observation added to timeline.');
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Failed to save', e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const onPickPhotos = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.9,
        selectionLimit: 10,
      } as any);
      if (res.canceled) return;
      const newAssets = (res.assets || []).map((a: any) => ({
        uri: a.uri,
        width: a.width,
        height: a.height,
        fileName: a.fileName || a.filename,
        mimeType: a.mimeType,
      }));
      setAssets((prev) => [...prev, ...newAssets]);
    } catch (e: any) {
      Alert.alert('Gallery error', e?.message ?? 'Unable to pick photos');
    }
  };

  const removeAssetAt = (idx: number) => {
    setAssets((prev) => prev.filter((_, i) => i !== idx));
  };

  // Removed inner Section/Input to preserve focus stability

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
      keyboardVerticalOffset={KEYBOARD_OFFSET}
    >
      <ThemedView style={{ flex: 1 }}>
      <TopBar
        title="Add Observation"
        isFavorite={false}
        hideActions
        onBack={() => nav.goBack()}
        onToggleFavorite={() => {}}
        onToggleMenu={() => {}}
      />

      <KeyboardAvoidingScreen>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
        >
          <Section title="Growth">
            <LabeledInput label="Height (in)" value={heightIn} onChangeText={setHeightIn} keyboardType="numeric" placeholder="e.g. 12.5" />
            <LabeledInput label="Width (in)" value={widthIn} onChangeText={setWidthIn} keyboardType="numeric" placeholder="e.g. 7.0" />
            <LabeledInput label="Leaf count" value={leafCount} onChangeText={setLeafCount} keyboardType="number-pad" placeholder="e.g. 12" />
          </Section>

          <Section title="Medium">
            <LabeledInput label="Soil moisture" value={soilMoisture} onChangeText={setSoilMoisture} placeholder="e.g. Moist" />
            <LabeledInput label="Depth (in)" value={depthIn} onChangeText={setDepthIn} keyboardType="numeric" placeholder="e.g. 2.0" />
          </Section>

          <Section title="Health">
            <View style={styles.switchRow}>
              <ThemedText style={styles.label}>Is healthy?</ThemedText>
              <Switch value={isHealthy} onValueChange={setIsHealthy} />
            </View>
            <LabeledInput label="Damage description" value={damageDesc} onChangeText={setDamageDesc} placeholder="—" />
          </Section>

          <Section title="Environment">
            <LabeledInput label="Temperature (°F)" value={tempF} onChangeText={setTempF} keyboardType="numeric" placeholder="e.g. 72" />
            <LabeledInput label="Relative humidity (%)" value={rhPct} onChangeText={setRhPct} keyboardType="numeric" placeholder="e.g. 45" />
          </Section>

          <Section title="Notes">
            <TextInput
              style={[styles.input, styles.textarea, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="New leaf emerging"
              placeholderTextColor={theme.colors.mutedText}
              multiline
            />
          </Section>

          <Section title="Photos">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.photoGalleryContent, { paddingHorizontal: 8 }]}
              style={[styles.photoGalleryContainer, { paddingVertical: 8 }]}
            >
              {/* Add button tile */}
              <TouchableOpacity onPress={onPickPhotos} style={[styles.photoGalleryItem, { borderColor: theme.colors.border }]}> 
                <View style={styles.addTileInner}>
                  <IconSymbol name="plus" size={24} color={theme.colors.primary} />
                  <ThemedText style={{ color: theme.colors.mutedText, marginTop: 4 }}>Add</ThemedText>
                </View>
              </TouchableOpacity>

              {assets.map((a, i) => (
                <View key={`${a.uri}-${i}`} style={[styles.photoGalleryItem, { borderColor: 'transparent' }]}> 
                  <Image source={{ uri: a.uri }} style={styles.photoGalleryImage} />
                  <TouchableOpacity onPress={() => removeAssetAt(i)} style={styles.removeBadge}>
                    <ThemedText style={styles.removeBadgeText}>×</ThemedText>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </Section>

          <TouchableOpacity
            onPress={onSave}
            disabled={saving}
            style={[styles.primaryButton, { backgroundColor: theme.colors.primary, opacity: saving ? 0.75 : 1 }]}
          >
            <ThemedText style={styles.primaryLabel}>{saving ? 'Saving…' : 'Save observation'}</ThemedText>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingScreen>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

function KeyboardAvoidingScreen({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 16 },
  sectionTitle: { fontWeight: '700', fontSize: 16, marginBottom: 8 },
  label: { fontSize: 13, opacity: 0.8, marginBottom: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  primaryButton: {
    marginTop: 8,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryLabel: { color: '#fff', fontWeight: '600' },
  photoGalleryContainer: { },
  photoGalleryContent: { alignItems: 'center', gap: 8 },
  photoGalleryItem: {
    width: 100,
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoGalleryImage: { width: '100%', height: '100%' },
  addTileInner: { alignItems: 'center', justifyContent: 'center' },
  removeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  removeBadgeText: { color: '#fff', fontWeight: '700' },
});


