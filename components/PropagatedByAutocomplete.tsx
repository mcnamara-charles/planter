import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/services/supabaseClient';
import { useAuth } from '@/context/AuthContext';

export type PropagatedByResult = {
  id: string;             // user_plants.id
  nickname: string;
  common: string;
  scientific?: string | null;
};

type Props = {
  onPick: (item: PropagatedByResult) => void;
  onCustomChange?: (text: string) => void;
  displayText?: string;
  selectedItem?: PropagatedByResult | null;
  minChars?: number;
  debounceMs?: number;
  placeholder?: string;
  maxResults?: number;
  clearInputOnPick?: boolean;
};

type PickedDetails = {
  imageUrl?: string | null;
};

function makeLRU(cap = 50) {
  const map = new Map<string, PropagatedByResult[]>();
  return {
    get(k: string) {
      if (!map.has(k)) return undefined;
      const v = map.get(k)!;
      map.delete(k); map.set(k, v);
      return v;
    },
    set(k: string, v: PropagatedByResult[]) {
      if (map.has(k)) map.delete(k);
      map.set(k, v);
      if (map.size > cap) {
        const first = map.keys().next().value as string;
        map.delete(first);
      }
    },
  };
}

export function PropagatedByAutocomplete(props: Props) {
  const {
    onPick,
    onCustomChange,
    displayText,
    selectedItem,
    minChars = 2,
    debounceMs = 250,
    placeholder = 'Search your plants',
    maxResults = 25,
    clearInputOnPick = true
  } = props;

  const { user } = useAuth();
  const ownerId = user?.id ?? null;

  const { theme } = useTheme();

  const inputRef = useRef<TextInput | null>(null);
  const [input, setInput] = useState<string>(() =>
    selectedItem ? '' : (displayText ?? '')
  );
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<PropagatedByResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const pickedRef = useRef<boolean>(!!selectedItem);
  const [showInput, setShowInput] = useState<boolean>(() => !selectedItem);

  const searchStateRef = useRef<{
    token: number;
    cache: ReturnType<typeof makeLRU>;
    lastSent?: string;
  }>({ token: 0, cache: makeLRU(80) });

  const [picked, setPicked] = useState<PropagatedByResult | null>(selectedItem ?? null);

  // Selected card "details" (image)
  const [pickedDetails, setPickedDetails] = useState<PickedDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (selectedItem) {
      pickedRef.current = true;
      setPicked(selectedItem);
      if (clearInputOnPick) setInput('');
      setOpen(false);
      setResults([]);
      setShowInput(false);
    } else {
      setPicked(null);
      setPickedDetails(null);
      setInput(displayText ?? '');
      setShowInput(true);
    }
  }, [selectedItem?.id, displayText, clearInputOnPick]);

  // Fetch image for selected user plant (primary if flagged; otherwise first)
  useEffect(() => {
    let cancelled = false;
    async function fetchDetails(selId: string) {
      try {
        setLoadingDetails(true);
        const { data: photo } = await supabase
          .from('user_plant_photos')
          .select('bucket, object_path, is_primary')
          .eq('user_plant_id', selId)
          .order('is_primary', { ascending: false }) // primary first
          .limit(1)
          .maybeSingle();

        if (!photo) {
          if (!cancelled) setPickedDetails({ imageUrl: null });
          return;
        }

        // Sign the URL (works for both public and private buckets)
        const { data: signed } = await supabase
          .storage
          .from(photo.bucket || 'plant-photos')
          .createSignedUrl(photo.object_path, 60 * 60);

        if (!cancelled) {
          setPickedDetails({ imageUrl: signed?.signedUrl ?? null });
        }
      } catch {
        if (!cancelled) setPickedDetails({ imageUrl: null });
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    }
    if (picked?.id) fetchDetails(picked.id);
    return () => { cancelled = true; };
  }, [picked?.id]);

  useEffect(() => {
    if (pickedRef.current) {
      pickedRef.current = false;
      return;
    }
    const q = query.trim();
    if (q.length < minChars || !ownerId) {
      setResults([]);
      setOpen(false);
      return;
    }

    const len = q.length;
    const adaptiveDelay =
      len >= 5 ? Math.max(150, debounceMs - 100) :
      len >= 4 ? Math.max(200, debounceMs - 50)  :
      len === 3 ? Math.max(275, debounceMs)      :
      /* len===2 */ Math.max(400, debounceMs + 150);

    const t = setTimeout(() => { void doSearch(q); }, adaptiveDelay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, minChars, debounceMs, ownerId]);

  async function doSearch(q: string) {
    const state = searchStateRef.current;
    if (state.lastSent === q) return;
  
    const ownerId = user?.id;
    if (!ownerId) {
      setResults([]);
      setOpen(false);
      return;
    }
  
    const key = `${ownerId}::${q}`;
    const cached = state.cache.get(key);
    if (cached) {
      setResults(cached);
      setOpen(cached.length > 0);
      state.lastSent = q;
      return;
    }
  
    const token = ++state.token;
  
    try {
      setSearching(true);
  
      // Use *…* wildcard for .or(), and strip commas/parens that break logic parser
      const esc = q.replace(/[(),]/g, ' ').trim();
      const pat = `*${esc}*`;
      const cap = q.length === 2 ? Math.min(15, maxResults) : maxResults;
  
      // 1) Base select with join alias
      let queryBuilder = supabase
        .from('user_plants')
        .select(`
          id,
          nickname,
          custom_species_name,
          plants:plants_table_id (
            plant_name,
            plant_scientific_name
          )
        `)
        .eq('owner_id', ownerId)
        // 2) OR over columns on user_plants
        .or(
          [
            `nickname.ilike.${pat}`,
            `custom_species_name.ilike.${pat}`,
          ].join(',')
        )
        // 3) OR over columns on the joined foreign table
        .or(
          [
            `plant_name.ilike.${pat}`,
            `plant_scientific_name.ilike.${pat}`,
          ].join(','),
          { foreignTable: 'plants' }   // <-- key fix
        )
        .limit(cap);
  
      const { data, error } = await queryBuilder;
  
      if (token !== searchStateRef.current.token) return;
      if (error) throw error;
  
      const items: PropagatedByResult[] = (data ?? []).map((row: any) => ({
        id: String(row.id),
        nickname: row.nickname || '',
        common: row.plants?.plant_name ?? row.custom_species_name ?? '',
        scientific: row.plants?.plant_scientific_name ?? null,
      }));
  
      state.cache.set(key, items);
      state.lastSent = q;
  
      setResults(items);
      setOpen(items.length > 0);
    } catch (e) {
      if (token !== searchStateRef.current.token) return;
      console.warn('PropagatedBy search failed', e);
      setResults([]);
      setOpen(false);
    } finally {
      if (token === searchStateRef.current.token) {
        setSearching(false);
      }
    }
  }

  function handleChange(text: string) {
    setInput(text);
    const t = text.replace(/\s+/g, ' ').trimStart();
    setQuery(t);
    setOpen(false);
    setResults([]);
    if (!picked) {
      onCustomChange?.(text);
    }
  }

  function handleClearSelected() {
    setPicked(null);
    setPickedDetails(null);
    onCustomChange?.(input);
    setShowInput(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handlePick(item: PropagatedByResult) {
    setInput('');
    setQuery('');
    setOpen(false);
    setResults([]);
    setPicked(item);
    pickedRef.current = true;
    Keyboard.dismiss();
    setShowInput(false);
    onPick(item);
  }

  function handleClear() {
    setPicked(null);
    setPickedDetails(null);
    setInput('');
    setQuery('');
    setResults([]);
    setOpen(false);
    onCustomChange?.('');
  }

  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.root}>
      {/* Selected plant card */}
      {picked && (
        <View style={styles.cardWrap}>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
            ]}
          >
            {/* Left thumbnail */}
            <View style={styles.thumbWrap}>
              {pickedDetails?.imageUrl ? (
                <Image
                  source={{ uri: pickedDetails.imageUrl }}
                  style={styles.thumb}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <IconSymbol name="leaf" size={18} color={theme.colors.mutedText} />
                </View>
              )}
            </View>

            {/* Text block: nickname → common → scientific */}
            <View style={styles.cardText}>
              <ThemedText style={styles.cardTitle} numberOfLines={1}>
                {picked.nickname?.trim() || picked.common || 'Selected plant'}
              </ThemedText>

              {!!picked.common && picked.nickname &&
                picked.common.trim().toLowerCase() !== picked.nickname.trim().toLowerCase() && (
                  <ThemedText style={styles.cardSubtitle} numberOfLines={1}>
                    {picked.common}
                  </ThemedText>
                )
              }

              {!!picked.scientific &&
                picked.scientific.trim().toLowerCase() !== (picked.common || picked.nickname || '').trim().toLowerCase() && (
                  <ThemedText style={styles.cardScientific} numberOfLines={1}>
                    {picked.scientific}
                  </ThemedText>
                )
              }
            </View>

            {/* Clear button */}
            <TouchableOpacity
              onPress={handleClearSelected}
              accessibilityLabel="Clear selected plant"
              style={styles.cardClear}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <IconSymbol name="xmark.circle.fill" size={18} color={theme.colors.mutedText} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Input (hidden when a plant is picked unless user taps Change) */}
      {showInput && (
        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={handleChange}
            placeholder={picked ? 'Search to change plant' : placeholder}
            placeholderTextColor={theme.colors.mutedText}
            style={[
              styles.input,
              {
                backgroundColor: theme.colors.input,
                borderColor: theme.colors.border,
                color: theme.colors.text,
              },
            ]}
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => {
              if (results.length > 0) setOpen(true);
            }}
            onBlur={() => {
              if (picked) setShowInput(false);
            }}
          />

          {searching && <ActivityIndicator style={styles.spinner} size="small" />}

          {input.length > 0 && !searching && (
            <TouchableOpacity onPress={handleClear} style={styles.clearBtn} accessibilityLabel="Clear">
              <IconSymbol name="xmark.circle.fill" size={16} color={theme.colors.mutedText} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Results */}
      {open && showInput && (
        <View
          style={[
            styles.dropdown,
            { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
          >
            {results.map((item) => (
              <TouchableOpacity key={item.id} style={styles.row} onPress={() => handlePick(item)}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.rowPrimary}>
                    {item.nickname || item.common || 'Unknown'}
                  </ThemedText>
                  {!!item.common && item.common !== item.nickname && (
                    <ThemedText style={styles.rowSecondary}>{item.common}</ThemedText>
                  )}
                  {!!item.scientific && (
                    <ThemedText style={styles.rowScientific}>{item.scientific}</ThemedText>
                  )}
                </View>
                <IconSymbol name="chevron.right" size={16} color={theme.colors.mutedText} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Change button */}
      {picked && !showInput && (
        <View style={{ marginTop: 6, alignItems: 'flex-start' }}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => {
              setShowInput(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>Change</ThemedText>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: any) {
  const inputPadY = Platform.OS === 'android' ? 10 : 12;
  return StyleSheet.create({
    root: { position: 'relative' },

    // Selected card
    cardWrap: { marginBottom: 10 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      minHeight: inputPadY * 2 + 36,
      ...(Platform.OS === 'ios'
        ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }
        : { elevation: 1 }),
    },
    thumbWrap: { marginRight: 10 },
    thumb: {
      width: 56,
      height: 56,
      borderRadius: 8,
      backgroundColor: 'rgba(0,0,0,0.06)',
    },
    thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    cardText: { flex: 1, paddingRight: 8, flexShrink: 1, minWidth: 0 },
    cardTitle: { fontWeight: '700', fontSize: 16 },
    cardSubtitle: { marginTop: 2, opacity: 0.75, fontSize: 14 },
    cardScientific: { marginTop: 2, opacity: 0.6, fontStyle: 'italic', fontSize: 13 },
    cardClear: { padding: 6, marginLeft: 'auto' },

    // Input
    inputWrap: { position: 'relative' },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      paddingLeft: 12,
      paddingRight: 64,
      paddingVertical: inputPadY,
    },
    clearBtn: {
      position: 'absolute',
      right: 8,
      top: 8,
      padding: 6,
    },
    spinner: { position: 'absolute', right: 8, top: 8 },

    // Dropdown
    dropdown: {
      marginTop: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      maxHeight: 260,
      overflow: 'hidden',
    },
    scroll: { maxHeight: 260 },
    scrollContent: { paddingVertical: 2 },

    // Rows
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(0,0,0,0.08)',
      gap: 8,
    },
    rowPrimary: { fontWeight: '600' },
    rowSecondary: { opacity: 0.7 },
    rowScientific: { opacity: 0.6, fontStyle: 'italic', fontSize: 12 },
  });
}
