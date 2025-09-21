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
import { Image } from 'expo-image'; // NEW
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/services/supabaseClient';

export type SpeciesResult = {
  id: string;
  common: string;
  scientific?: string | null;
};

type Props = {
  onPick: (item: SpeciesResult) => void;
  onCustomChange?: (text: string) => void;
  displayText?: string;
  selectedItem?: SpeciesResult | null;
  minChars?: number;
  debounceMs?: number;
  placeholder?: string;
  maxResults?: number;
  clearInputOnPick?: boolean;
};

type PickedDetails = {
  imageUrl?: string | null;
  synonyms?: string[];
};

function makeLRU(cap = 50) {
  const map = new Map<string, SpeciesResult[]>();
  return {
    get(k: string) {
      if (!map.has(k)) return undefined;
      const v = map.get(k)!;
      map.delete(k); map.set(k, v);
      return v;
    },
    set(k: string, v: SpeciesResult[]) {
      if (map.has(k)) map.delete(k);
      map.set(k, v);
      if (map.size > cap) {
        const first = map.keys().next().value as string;
        map.delete(first);
      }
    },
  };
}

export function SpeciesAutocomplete(props: Props) {
  const {
    onPick,
    onCustomChange,
    displayText,
    selectedItem,
    minChars = 2,
    debounceMs = 250,
    placeholder = 'Search species (e.g., Ficus elastica)',
    maxResults = 25,
    clearInputOnPick = true
  } = props;

  const { theme } = useTheme();

  const inputRef = useRef<TextInput | null>(null);
  const [input, setInput] = useState<string>(() =>
    selectedItem ? '' : (displayText ?? '')
  );
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<SpeciesResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const pickedRef = useRef<boolean>(!!selectedItem);
  const [showInput, setShowInput] = useState<boolean>(() => !selectedItem);

  const searchStateRef = useRef<{
    token: number;
    abort?: AbortController;
    cache: ReturnType<typeof makeLRU>;
    lastSent?: string;
  }>({ token: 0, cache: makeLRU(80) });

  const [picked, setPicked] = useState<SpeciesResult | null>(selectedItem ?? null);

  // NEW: selected card “details” (image + synonyms)
  const [pickedDetails, setPickedDetails] = useState<PickedDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (selectedItem) {
      pickedRef.current = true;
      setPicked(selectedItem);
      if (clearInputOnPick) setInput('');        // <— keep input empty after pick
      setOpen(false);
      setResults([]);
      setShowInput(false);
    } else {
      setPicked(null);
      setPickedDetails(null);
      // when nothing is selected, reflect displayText (if provided)
      setInput(displayText ?? '');
      setShowInput(true);
    }
  }, [selectedItem?.id, displayText, clearInputOnPick]);

  // NEW: fetch image + synonyms when a species is picked
  useEffect(() => {
    let cancelled = false;
    async function fetchDetails(sel: SpeciesResult) {
      try {
        setLoadingDetails(true);
        // plants: image
        const { data: plant, error: pErr } = await supabase
          .from('plants')
          .select('plant_main_image')
          .eq('id', sel.id)
          .single();
        if (pErr) throw pErr;

        // synonyms: prefer common/synonym kinds; exclude duplicate of main common
        const { data: syns, error: sErr } = await supabase
          .from('plant_synonyms')
          .select('name, kind')
          .eq('plant_id', sel.id)
          .in('kind', ['common', 'synonym'])
          .limit(6);
        if (sErr) throw sErr;

        const primaryCommon = (sel.common || '').trim().toLowerCase();
        const names = (syns ?? [])
          .map((s: any) => String(s.name).trim())
          .filter(Boolean)
          .filter((n: string) => n.toLowerCase() !== primaryCommon);

        if (!cancelled) {
          setPickedDetails({
            imageUrl: plant?.plant_main_image ?? null,
            synonyms: names.slice(0, 5),
          });
        }
      } catch {
        if (!cancelled) setPickedDetails({ imageUrl: null, synonyms: [] });
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    }
    if (picked?.id) fetchDetails(picked);
    return () => { cancelled = true; };
  }, [picked?.id]);

  useEffect(() => {
    if (pickedRef.current) {
      pickedRef.current = false;
      return;
    }

    const q = query.trim();
    if (q.length < minChars) {
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

    const t = setTimeout(() => {
      void doSearch(q);
    }, adaptiveDelay);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, minChars, debounceMs]);

  async function doSearch(q: string) {
    const state = searchStateRef.current;
    if (state.lastSent === q) return;

    const cached = state.cache.get(q);
    if (cached) {
      setResults(cached);
      setOpen(cached.length > 0);
      state.lastSent = q;
      return;
    }

    if (state.abort) {
      try { state.abort.abort(); } catch {}
    }
    const ac = new AbortController();
    state.abort = ac;

    const token = ++state.token;

    try {
      setSearching(true);
      const shortCap = q.length === 2 ? Math.min(15, maxResults) : maxResults;

      const rpc = supabase.rpc('search_species_prefix' /* or 'search_species_prefix' */, {
        q,
        max_results: shortCap,
      });
      // @ts-ignore (supabase-js v2)
      if (typeof rpc.abortSignal === 'function') rpc.abortSignal(ac.signal);

      const { data, error } = await rpc;
      if (token !== searchStateRef.current.token) return;
      if (error) throw error;

      const items: SpeciesResult[] = (data ?? []).map((r: any) => ({
        id: String(r.id),
        common: r.common,
        scientific: r.scientific,
      }));

      state.cache.set(q, items);
      state.lastSent = q;

      setResults(items);
      setOpen(items.length > 0);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      console.warn('Species search failed', e);
      setResults([]);
      setOpen(false);
    } finally {
      if (token === searchStateRef.current.token) {
        setSearching(false);
        if (searchStateRef.current.abort === ac) {
          searchStateRef.current.abort = undefined;
        }
      }
    }
  }

  function handleChange(text: string) {
    setInput(text);
    const t = text.replace(/\s+/g, ' ').trimStart();
    setQuery(t);
    setOpen(false);
    setResults([]);
    if (!picked) {              // <-- only notify parent when nothing is selected
      onCustomChange?.(text);
    }
  }

  function handleClearSelected() {
    setPicked(null);
    setPickedDetails(null);
    // leave input/query/results as-is so the user can keep searching
    // optionally notify parent that selection is gone but keep their typed text
    onCustomChange?.(input);
    setShowInput(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handlePick(item: SpeciesResult) {
    const display = formatDisplay(item);
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

  const synonymsLine =
    pickedDetails?.synonyms && pickedDetails.synonyms.length > 0
      ? `Also known as: ${pickedDetails.synonyms.join(', ')}`
      : null;

  return (
    <View style={styles.root}>

      {/* Selected species card */}
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

            {/* Text block: common → scientific → synonyms */}
            <View style={styles.cardText}>
                {/* Common (fallback to scientific if no common) */}
                <ThemedText style={styles.cardTitle} numberOfLines={1}>
                {picked.common?.trim() || picked.scientific || 'Selected species'}
                </ThemedText>

                {/* Scientific (only if present and not identical to common) */}
                {!!picked.scientific &&
                picked.scientific.trim().toLowerCase() !== (picked.common || '').trim().toLowerCase() && (
                    <ThemedText style={styles.cardSubtitle} numberOfLines={1}>
                    {picked.scientific}
                    </ThemedText>
                )
                }

                {/* Synonyms */}
                {!loadingDetails && synonymsLine ? (
                <ThemedText style={styles.cardAlsoKnown} numberOfLines={2}>
                    {synonymsLine}
                </ThemedText>
                ) : null}
            </View>

            {/* Clear button */}
            <TouchableOpacity
                onPress={handleClearSelected}   // <— use the “selected-only” clear
                accessibilityLabel="Clear selected species"
                style={styles.cardClear}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                <IconSymbol name="xmark.circle.fill" size={18} color={theme.colors.mutedText} />
            </TouchableOpacity>
            </View>
        </View>
        )}


      {/* Input (hidden when a species is picked unless user taps Change) */}
      {showInput && (
        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={handleChange}
            placeholder={picked ? 'Search to change species' : placeholder}
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
                    {item.common || item.scientific || 'Unknown'}
                  </ThemedText>
                  {!!item.scientific && (
                    <ThemedText style={styles.rowSecondary}>{item.scientific}</ThemedText>
                  )}
                </View>
                <IconSymbol name="chevron.right" size={16} color={theme.colors.mutedText} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Change button when a species is selected and input is hidden */}
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

function formatDisplay(item: SpeciesResult) {
  const a = item.common?.trim();
  const b = item.scientific?.trim();
  if (a && b) return `${a} · ${b}`;
  return a || b || '';
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
      paddingVertical: 12,        // a bit taller
      minHeight: inputPadY * 2 + 36, // ~2x input visual height
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
    thumbPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardText: { flex: 1, paddingRight: 8, flexShrink: 1, minWidth: 0 },
    cardTitle: { fontWeight: '700', fontSize: 16 },
    cardSubtitle: {
      marginTop: 2,
      opacity: 0.75,
      fontStyle: 'italic',
      fontSize: 14,
    },
    cardAlsoKnown: {
      marginTop: 6,
      opacity: 0.8,
      fontSize: 12,
    },
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
      right: 36,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      paddingHorizontal: 6,
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
    rowSecondary: { opacity: 0.7, fontStyle: 'italic' },
  });
}
