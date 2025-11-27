import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  Pressable,
  Keyboard,
} from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/services/supabaseClient';

export type LocationResult = { id: string; name: string };

type Props = {
  onPick: (item: LocationResult) => void;
  onCustomChange?: (text: string) => void;
  displayText?: string;
  selectedItem?: LocationResult | null;
  minChars?: number;
  debounceMs?: number;
  placeholder?: string;
  maxResults?: number;
  clearInputOnPick?: boolean;
};

function makeLRU(cap = 50) {
  const map = new Map<string, LocationResult[]>();
  return {
    get(k: string) {
      if (!map.has(k)) return undefined;
      const v = map.get(k)!;
      map.delete(k); map.set(k, v);
      return v;
    },
    set(k: string, v: LocationResult[]) {
      if (map.size >= cap) {
        const first = map.keys().next().value as string | undefined;
        if (first) map.delete(first);
      }
      map.set(k, v);
    },
  };
}
const cache = makeLRU(50);

export default function LocationAutocomplete({
  onPick,
  onCustomChange,
  displayText,
  selectedItem,
  minChars = 2,
  debounceMs = 300,
  placeholder = 'Search locations...',
  maxResults = 10,
  clearInputOnPick = true,
}: Props) {
  const { theme } = useTheme();
  const [query, setQuery] = useState(displayText || '');
  const [results, setResults] = useState<LocationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (selectedItem) setQuery(selectedItem.name);
    else if (displayText !== undefined) setQuery(displayText);
  }, [selectedItem, displayText]);

  async function searchLocations(searchQuery: string) {
    if (!searchQuery.trim() || searchQuery.length < minChars) {
      setResults([]);
      setLoading(false);
      // IMPORTANT: do NOT close here; let caller decide based on query/focus
      return;
    }

    const key = searchQuery.toLowerCase();
    const cached = cache.get(key);
    if (cached) {
      setResults(cached);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('locations')
        .select('id, name')
        .ilike('name', `%${searchQuery}%`)
        .limit(maxResults);

      if (error) throw error;

      const locations: LocationResult[] = (data || []).map(r => ({ id: r.id, name: r.name }));
      cache.set(key, locations);
      setResults(locations);
    } catch (e) {
      console.error('Error searching locations:', e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  const debouncedSearch = useMemo(() => {
    return (searchQuery: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => searchLocations(searchQuery), debounceMs);
    };
  }, [debounceMs, minChars, maxResults]);

  const handleChange = (text: string) => {
    setQuery(text);
    onCustomChange?.(text);

    const ok = text.trim().length >= minChars;
    if (ok) {
      // keep open while user has enough chars, regardless of result count
      if (!open) setOpen(true);
      debouncedSearch(text);
    } else {
      setResults([]);
      setOpen(false);
    }
  };

  const handlePick = (item: LocationResult) => {
    if (clearInputOnPick) setQuery('');
    else setQuery(item.name);
    setOpen(false);
    setResults([]);
    Keyboard.dismiss();
    onPick(item);
  };

  const createLocation = async () => {
    if (creating) return;
    const name = normalizeName(query);
    if (!name || name.length < minChars) return;

    try {
      setCreating(true);
      const { data, error } = await supabase
        .from('locations')
        .insert({ name })
        .select('id, name')
        .single();

      // Unique constraint? Fetch existing.
      // @ts-ignore
      if (error?.code === '23505') {
        const { data: existing, error: selErr } = await supabase
          .from('locations')
          .select('id, name')
          .eq('name', name)
          .single();
        if (selErr) throw selErr;
        if (existing) return handlePick({ id: existing.id, name: existing.name });
      }
      if (error) throw error;

      const created: LocationResult = { id: data!.id, name: data!.name };
      cache.set(query.toLowerCase(), [...results, created]);
      handlePick(created);
    } catch (e) {
      console.error('createLocation failed:', e);
    } finally {
      setCreating(false);
    }
  };

  const clearInput = () => {
    setQuery('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
    onCustomChange?.('');
  };

  function normalizeName(s: string) {
    return s.replace(/\s+/g, ' ').trim();
  }
  const qNorm = normalizeName(query).toLowerCase();
  const exactExists = results.some(r => normalizeName(r.name).toLowerCase() === qNorm);

  // Show "+ New" whenever there’s enough input, the dropdown is open, and there’s no exact match.
  // NOTE: we no longer hide it while `loading` to avoid flicker.
  const showCreateRow = open && qNorm.length >= minChars && !exactExists && !!qNorm;

  return (
    <View style={styles.root} collapsable={false}>
      <View style={styles.searchInputContainer}>
        <TextInput
          ref={inputRef}
          style={[
            styles.searchInput,
            {
              backgroundColor: theme.colors.input,
              borderColor: theme.colors.border,
              color: theme.colors.text,
            },
          ]}
          value={query}
          onChangeText={handleChange}
          onFocus={() => {
            if (query.trim().length >= minChars) setOpen(true);
          }}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.mutedText}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => {
            if (results.length > 0) handlePick(results[0]);
            else if (showCreateRow) void createLocation();
          }}
        />

        {(loading || creating) && (
          <View style={styles.searchSpinner}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
          </View>
        )}

        {query.length > 0 && !(loading || creating) && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={clearInput}
            accessibilityLabel="Clear search"
          >
            <IconSymbol name="xmark.circle.fill" size={16} color={theme.colors.mutedText} />
          </TouchableOpacity>
        )}
      </View>

      {open && (
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          onStartShouldSetResponder={() => true}
        />
      )}

      {open && (results.length > 0 || showCreateRow) && (
        <View
          style={[
            styles.suggestionsBox,
            { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <ScrollView keyboardShouldPersistTaps="always" nestedScrollEnabled style={styles.suggestionsScroll}>
            {results.map((item, index) => (
              <Pressable
                key={item.id}
                style={[
                  styles.suggestionRow,
                  { borderBottomColor: theme.colors.border },
                  index === results.length - 1 && !showCreateRow && styles.lastSuggestionRow,
                ]}
                android_ripple={{ borderless: false }}
                onPress={() => handlePick(item)}
              >
                <View style={styles.suggestionContent}>
                  <ThemedText style={styles.suggestionPrimary}>{item.name}</ThemedText>
                </View>
              </Pressable>
            ))}

            {showCreateRow && (
              <Pressable
                key="__create__"
                style={[styles.suggestionRow, styles.lastSuggestionRow]}
                disabled={creating}
                android_ripple={{ borderless: false }}
                onPress={createLocation}
              >
                <View style={styles.suggestionContent}>
                  <ThemedText style={[styles.suggestionPrimary, { fontWeight: '700' }]}>
                    + New: {normalizeName(query)}
                  </ThemedText>
                  {creating ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <IconSymbol name="plus.circle" size={16} color={theme.colors.mutedText} />
                  )}
                </View>
              </Pressable>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const DROPDOWN_ELEV = 24;

const styles = StyleSheet.create({
  root: { position: 'relative', zIndex: 1 },
  searchInputContainer: { position: 'relative' },
  searchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  searchSpinner: { position: 'absolute', right: 12, top: '50%', marginTop: -10 },
  clearButton: { 
    position: 'absolute', 
    right: 12, 
    top: '50%', 
    marginTop: -12, 
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
  },

  backdrop: {
    position: 'absolute',
    left: -1000, right: -1000, top: -1000, bottom: -1000,
    zIndex: 9998,
    backgroundColor: 'transparent',
  },

  suggestionsBox: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    maxHeight: 260,
    zIndex: 9999,
    elevation: DROPDOWN_ELEV,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  suggestionsScroll: { maxHeight: 260 },
  suggestionRow: { paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  lastSuggestionRow: { borderBottomWidth: 0 },
  suggestionContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  suggestionPrimary: { fontSize: 16, fontWeight: '500' },
});
