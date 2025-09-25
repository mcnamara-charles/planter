// components/PlantTimeline.tsx
// Tweaks for continuous rail:
// - No outer spacing between rows; we render an inner padded wrapper for the card.
// - Rail uses spacer views (not margins) to simulate the same vertical padding,
//   so the connector line fills those areas and never breaks.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, TouchableOpacity, View, FlatList, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import ImageLightbox from '@/components/ImageLightbox';
import { useNavigation } from '@react-navigation/native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';

// ---- Types ----
export type TimelineEvent = {
  id: string;
  owner_id: string;
  user_plant_id: string;
  group_id: string;
  event_time: string; // ISO
  event_type: string;
  event_data: Record<string, any>;
  note?: string | null;
};

export type EventPhoto = {
  timeline_event_id: string;
  user_plant_photo_id: string;
  bucket: string;
  object_path: string;
};

const PAGE_SIZE = 10;

// ---------- Utils ----------
function formatDate(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const isSameDay = d.toDateString() === now.toDateString();
  if (isSameDay) return 'Today';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(d);
}

function timeOfDay(ts: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
}

function humanizeType(t: string) {
  if (!t) return 'Event';
  return t.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

// ---------- Event-type map ----------
type EventConfig = {
  icon: string;
  title?: (e: TimelineEvent) => string;
  chips?: (e: TimelineEvent) => string[];
  renderExtra?: (e: TimelineEvent) => React.ReactNode;
  cardStyle?: (theme: any) => ViewStyle; // per-type tint/border override
};

function changed(prev: unknown, next: unknown) {
  if (prev == null || next == null) return false;
  return String(prev) !== String(next);
}

const EVENT_MAP: Record<string, EventConfig> = {
  added: {
    icon: 'star',
    title: () => 'Added',
    chips: () => [],
    cardStyle: () => ({
      backgroundColor: 'rgba(56,139,253,0.12)',
      borderColor: 'rgba(56,139,253,0.35)',
    }),
  },
  edited: {
    icon: 'star',
    title: () => 'Edited',
    chips: () => [],
    cardStyle: () => ({
      backgroundColor: 'rgba(56,139,253,0.12)',
      borderColor: 'rgba(56,139,253,0.35)',
    }),
  },
  water: {
    icon: 'drop',
    title: () => 'Watered',
    chips: (e) => {
      const d = e.event_data || {};
      const chips: string[] = [];
      if (d.amount_l) chips.push(`${d.amount_l} L`);
      if (d.amount_ml) chips.push(`${d.amount_ml} mL`);
      if (d.moisture_before) chips.push(`Before: ${d.moisture_before}`);
      if (d.moisture_after) chips.push(`After: ${d.moisture_after}`);
      if (d.method) chips.push(String(d.method));
      if (d.water_type) chips.push(String(d.water_type));
      return chips;
    },
  },
  repot: {
    icon: 'cycle',
    title: () => 'Repotted',
    cardStyle: () => ({
      backgroundColor: 'rgba(16,185,129,0.12)', // subtle green
      borderColor: 'rgba(16,185,129,0.35)',
    }),
    chips: (e) => {
      const d = e.event_data || {};
      const chips: string[] = [];
      const {
        previous_height,
        new_height,
        previous_diameter,
        new_diameter,
        previous_pot_type,
        new_pot_type,
        previous_drainage_system,
        new_drainage_system,
      } = d;

      if (changed(previous_diameter, new_diameter)) chips.push(`Diameter ${previous_diameter} → ${new_diameter} cm`);
      if (changed(previous_height, new_height)) chips.push(`Height ${previous_height} → ${new_height} cm`);
      if (changed(previous_pot_type, new_pot_type)) chips.push(`${previous_pot_type} → ${new_pot_type}`);
      if (changed(previous_drainage_system, new_drainage_system)) chips.push(`${previous_drainage_system} → ${new_drainage_system}`);
      return chips;
    },
  },
  fertilize: {
    icon: 'bolt',
    title: () => 'Fertilized',
    chips: (e) => {
      const d = e.event_data || {};
      const chips: string[] = [];
      if (d.product) chips.push(String(d.product));
      if (d.npk) chips.push(`NPK ${d.npk}`);
      if (d.dose_ml) chips.push(`${d.dose_ml} mL`);
      if (d.schedule) chips.push(String(d.schedule));
      return chips;
    },
  },
  move: {
    icon: 'location',
    title: () => 'Moved',
    cardStyle: () => ({
      backgroundColor: 'rgba(16,185,129,0.12)',
      borderColor: 'rgba(16,185,129,0.35)',
    }),
    chips: (e) => {
      const d = e.event_data || {};
      const chips: string[] = [];
      if (d.from && d.to) chips.push(`${d.from} → ${d.to}`);
      if (d.light_level) chips.push(String(d.light_level));
      return chips;
    },
  },
  prune: {
    icon: 'scissors',
    title: () => 'Pruned',
    cardStyle: () => ({
      backgroundColor: 'rgba(16,185,129,0.12)',
      borderColor: 'rgba(16,185,129,0.35)',
    }),
    chips: (e) => {
      const d = e.event_data || {};
      const chips: string[] = [];
      if (d.parts) chips.push(String(d.parts));
      if (d.count) chips.push(`${d.count} cuts`);
      return chips;
    },
  },
  soil_changed: {
    icon: 'leaf',
    title: () => 'Soil changed',
    cardStyle: () => ({
      backgroundColor: 'rgba(16,185,129,0.12)',
      borderColor: 'rgba(16,185,129,0.35)',
    }),
    chips: (e) => {
      const d = e.event_data || {};
      const prev = d.previous ? Object.keys(d.previous).length : 0;
      const next = d.next ? Object.keys(d.next).length : 0;
      const arr: string[] = [];
      if (prev || next) arr.push(`${prev} → ${next} parts`);
      return arr;
    },
  },
  observe: {
    icon: 'eye',
    title: () => 'Observed',
    chips: (e) => {
      const d = e.event_data || {};
      const healthy = d.health?.is_healthy;
      const soil = d.medium?.soil_moisture;
      const chips: string[] = [];
      if (healthy !== undefined) chips.push(healthy ? 'Healthy' : 'Sick');
      if (soil) chips.push(`Soil: ${String(soil)}`);
      return chips;
    },
  },
};

function getEventConfig(type: string): EventConfig {
  return EVENT_MAP[type] ?? {
    icon: 'clock',
    title: (e) => humanizeType(e.event_type),
    chips: (e) => {
      const d = e.event_data || {};
      const keys = ['amount_ml', 'amount_l', 'severity', 'stage', 'mix', 'product'];
      const res: string[] = [];
      for (const k of keys) if (d[k]) res.push(String(d[k]));
      return res;
    },
  };
}

function EventIcon({ type, size = 18 }: { type: string; size?: number }) {
  const { theme } = useTheme();
  const name = getEventConfig(type).icon || 'clock';
  return <IconSymbol name={name as any} size={size} color={theme.colors.text} />;
}

function Chip({ label }: { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: 'rgba(0,0,0,0.2)' }]}> 
      <ThemedText style={styles.chipLabel}>{label}</ThemedText>
    </View>
  );
}

function PhotoStrip({ photos }: { photos: { thumb: string; full: string; id: string }[] }) {
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [startIndex, setStartIndex] = React.useState(0);

  if (!photos?.length) return null;

  const onPress = (idx: number) => {
    setStartIndex(idx);
    setLightboxOpen(true);
  };

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        {photos.slice(0, 3).map((p, idx) => {
          const isLastVisible = idx === 2 && photos.length > 3;
          const remaining = photos.length - 3;
          return (
            <TouchableOpacity key={p.id} activeOpacity={0.8} onPress={() => onPress(idx)}>
              <View style={{ width: 84, height: 84 }}>
                <Image
                  source={{ uri: p.thumb }}
                  style={{ width: 84, height: 84, borderRadius: 10 }}
                  contentFit="cover"
                  transition={150}
                />
                {isLastVisible ? (
                  <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }]}>
                    <ThemedText style={{ color: '#fff', fontWeight: '800' }}>{`+${remaining}`}</ThemedText>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <ImageLightbox
        visible={lightboxOpen}
        images={photos.map((p) => ({ uri: p.full, id: p.id }))}
        initialIndex={startIndex}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
}

type FlatRow =
  | { kind: 'header'; key: string; title: string }
  | {
      kind: 'item';
      key: string;
      item: TimelineEvent;
      isFirstInGroup: boolean;
      isLastInGroup: boolean;
      groupSize: number;
    };

export default function PlantTimeline({
  userPlantId,
  withinScrollView = false,
}: {
  userPlantId: string;
  withinScrollView?: boolean;
}) {
  const { theme } = useTheme();
  const nav = useNavigation();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [photosByEvent, setPhotosByEvent] = useState<Record<string, { thumb: string; full: string; id: string }[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadPage = useCallback(
    async (startOffset: number, replace = false) => {
      try {
        if (replace) setError(null);
        const end = startOffset + PAGE_SIZE - 1;

        const { data: evts, error: e1, count } = await supabase
          .from('user_plant_timeline_events')
          .select('*', { count: 'exact' })
          .eq('user_plant_id', userPlantId)
          .order('event_time', { ascending: false })
          .range(startOffset, end);
        if (e1) throw e1;

        const nextOffset = startOffset + (evts?.length ?? 0);
        setHasMore((count ?? 0) > nextOffset);
        setEvents((prev) => (replace ? evts ?? [] : [...prev, ...(evts ?? [])]));

        const evtIds = (evts ?? []).map((e) => e.id);
        if (evtIds.length) {
          const { data: links, error: e2 } = await supabase
            .from('user_plant_timeline_event_photos')
            .select('timeline_event_id, user_plant_photo_id')
            .in('timeline_event_id', evtIds);
          if (e2) throw e2;

          if (links?.length) {
            const photoIds = links.map((l) => l.user_plant_photo_id);
            const { data: photos, error: e3 } = await supabase
              .from('user_plant_photos')
              .select('id, bucket, object_path')
              .in('id', photoIds);
            if (e3) throw e3;

            const signedThumbByPhotoId: Record<string, string> = {};
            const signedFullByPhotoId: Record<string, string> = {};
            await Promise.all(
              (photos ?? []).map(async (ph) => {
                const bucket = ph.bucket || 'plant-photos';
                const { data: signedThumb } = await supabase.storage.from(bucket).createSignedUrl(ph.object_path, 60 * 60, {
                  transform: { width: 168, height: 168, quality: 85, resize: 'cover' },
                });
                // Full-size (no transform) to view original; fallback to a large contain if needed
                const { data: signedFull } = await supabase.storage.from(bucket).createSignedUrl(ph.object_path, 60 * 60);
                signedThumbByPhotoId[ph.id] = signedThumb?.signedUrl ?? '';
                signedFullByPhotoId[ph.id] = signedFull?.signedUrl ?? signedThumb?.signedUrl ?? '';
              })
            );

            const urlMap: Record<string, { thumb: string; full: string; id: string }[]> = {};
            for (const link of links) {
              const thumb = signedThumbByPhotoId[link.user_plant_photo_id];
              const full = signedFullByPhotoId[link.user_plant_photo_id];
              if (!thumb && !full) continue;
              if (!urlMap[link.timeline_event_id]) urlMap[link.timeline_event_id] = [];
              urlMap[link.timeline_event_id].push({ thumb: thumb || full, full: full || thumb, id: link.user_plant_photo_id });
            }

            setPhotosByEvent((prev) => ({ ...prev, ...urlMap }));
          }
        }

        setOffset(nextOffset);
      } catch (err: any) {
        setError(err?.message ?? 'Failed to load timeline');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userPlantId]
  );

  useEffect(() => {
    setEvents([]);
    setPhotosByEvent({});
    setOffset(0);
    setHasMore(true);
    setLoading(true);
    loadPage(0, true);
  }, [userPlantId, loadPage]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadPage(0, true);
  }, [loadPage]);

  const grouped = useMemo(() => {
    const groups: { dateLabel: string; items: TimelineEvent[] }[] = [];
    let current: { dateLabel: string; items: TimelineEvent[] } | null = null;
    for (const e of events) {
      const lbl = formatDate(e.event_time);
      if (!current || current.dateLabel !== lbl) {
        current = { dateLabel: lbl, items: [] };
        groups.push(current);
      }
      current.items.push(e);
    }
    return groups;
  }, [events]);

  const flatData: FlatRow[] = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const g of grouped) {
      const size = g.items.length;
      rows.push({ kind: 'header', key: `h-${g.dateLabel}`, title: g.dateLabel });
      g.items.forEach((e, idx) => {
        rows.push({
          kind: 'item',
          key: e.id,
          item: e,
          isFirstInGroup: idx === 0,
          isLastInGroup: idx === size - 1,
          groupSize: size,
        });
      });
    }
    return rows;
  }, [grouped]);

  // constants for inner padding
  const ROW_VPAD = 10;

  // ----- Renderers -----
  const renderEventCard = (e: TimelineEvent) => {
    const cfg = getEventConfig(e.event_type);
    const chips = cfg.chips?.(e) ?? [];
    const title = cfg.title?.(e) ?? humanizeType(e.event_type);
    const photos = photosByEvent[e.id] ?? [];
    const isObserve = e.event_type === 'observe';

    const perTypeCard = cfg.cardStyle?.(theme) ?? {};
    const baseCardStyle: ViewStyle = {
      backgroundColor: theme.colors.card,
      borderColor: theme.colors.border,
    };
    // Keep a neutral base and use a separate overlay for any translucent tint
    const { backgroundColor: overlayColor, ...restPerType } = perTypeCard as ViewStyle & { backgroundColor?: string };
    const mergedCardStyle = { ...baseCardStyle, ...restPerType } as ViewStyle;
    const UseContainer = cfg.cardStyle ? View : ThemedView;

    const cardContent = (
      <UseContainer style={[styles.card, mergedCardStyle, cfg.cardStyle ? styles.cardTintFix : null]}>
        {overlayColor ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: overlayColor }]} />
        ) : null}
        <View style={styles.cardHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            <EventIcon type={e.event_type} />
            <ThemedText style={styles.cardTitle} numberOfLines={1}>
              {title}
            </ThemedText>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ThemedText style={[styles.timeLabel, { color: theme.colors.mutedText }]}>{timeOfDay(e.event_time)}</ThemedText>
            {isObserve && (
              <IconSymbol name="chevron.right" size={16} color={theme.colors.mutedText} />
            )}
          </View>
        </View>

        {e.note ? <ThemedText style={{ opacity: 0.9 }}>{String(e.note)}</ThemedText> : null}

        {chips.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 8, marginTop: 8 }}>
            {chips.map((c, i) => (
              <Chip key={i} label={String(c)} />
            ))}
          </View>
        ) : null}

        {cfg.renderExtra ? <View style={{ marginTop: 8 }}>{cfg.renderExtra(e)}</View> : null}

        <PhotoStrip photos={photos} />
      </UseContainer>
    );

    if (isObserve) {
      return (
        <TouchableOpacity
          onPress={() => {
            // Navigate to ViewObservation screen with the timeline event ID and plant ID
            (nav as any).navigate('ViewObservation', { 
              timelineEventId: e.id, 
              userPlantId: userPlantId 
            });
          }}
          activeOpacity={0.7}
        >
          {cardContent}
        </TouchableOpacity>
      );
    }

    return cardContent;
  };

  const renderRowCore = (row: FlatRow) => {
    if (row.kind === 'header') {
      return (
        <ThemedText key={row.key} style={[styles.dayHeader, { color: theme.colors.mutedText }]}>
          {row.title}
        </ThemedText>
      );
    }

    const { item: ev, isFirstInGroup, isLastInGroup, groupSize, key } = row;
    const showTopConnector = groupSize > 1 && !isFirstInGroup;
    const showBottomConnector = groupSize > 1 && !isLastInGroup;

    // No outer margins/padding between rows. We use an inner "pad" wrapper for the card,
    // and mirror that same padding in the rail via spacer views so the vertical line is continuous.
    return (
      <View key={key} style={styles.rowOuter}>
        {/* Rail column */}
        <View style={styles.railCol}>
          {/* top padding spacer (line should fill it if there's a previous sibling) */}
          <View
            style={{
              width: 2,
              height: ROW_VPAD,
              backgroundColor: showTopConnector ? theme.colors.border : 'transparent',
              borderRadius: 1,
            }}
          />
          {/* dot (aligned with card top because of the top spacer) */}
          <View style={[styles.railDot, { backgroundColor: theme.colors.mutedText }]} />
          {/* body connector */}
          <View
            style={{
              width: 2,
              flex: 1,
              backgroundColor: showBottomConnector ? theme.colors.border : 'transparent',
              borderRadius: 1,
            }}
          />
          {/* bottom padding spacer (also filled to keep line continuous when there is a next item) */}
          <View
            style={{
              width: 2,
              height: ROW_VPAD,
              backgroundColor: showBottomConnector ? theme.colors.border : 'transparent',
              borderRadius: 1,
            }}
          />
        </View>

        {/* Content column with inner invisible padding */}
        <View style={{ flex: 1 }}>
          <View style={{ paddingVertical: ROW_VPAD }}>
            {renderEventCard(ev)}
          </View>
        </View>
      </View>
    );
  };

  // ----- Empty / Loading states -----
  if (loading && !events.length) {
    return (
      <View style={{ paddingVertical: 12 }}>
        <SkeletonRow />
        <SkeletonRow />
      </View>
    );
  }

  if (!events.length && !loading) {
    return (
      <View style={[styles.emptyBox, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}>
        <IconSymbol name="clock" size={22} color={theme.colors.mutedText} />
        <ThemedText style={{ fontWeight: '700', marginTop: 6 }}>No timeline events yet</ThemedText>
        <ThemedText style={{ opacity: 0.8, textAlign: 'center' }}>
          When you log care actions like watering, repotting, or pruning, they’ll appear here.
        </ThemedText>
      </View>
    );
  }

  // ----- Render mode selection -----
  if (withinScrollView) {
    return (
      <View>
        {flatData.map(renderRowCore)}
        {hasMore ? (
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => loadPage(offset)}
              style={[styles.loadMoreBtn, { borderColor: theme.colors.border }]}
            >
              {loading ? <ActivityIndicator /> : <ThemedText style={{ fontWeight: '700' }}>Load older events</ThemedText>}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ height: 8 }} />
        )}
        {error ? <ThemedText style={{ color: '#d11a2a', marginTop: 8 }}>{error}</ThemedText> : null}
      </View>
    );
  }

  // Default: Virtualized FlatList (preferred)
  return (
    <View>
      <FlatList
        data={flatData}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => renderRowCore(item)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListFooterComponent={
          hasMore ? (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => loadPage(offset)}
                style={[styles.loadMoreBtn, { borderColor: theme.colors.border }]}
              >
                {loading ? <ActivityIndicator /> : <ThemedText style={{ fontWeight: '700' }}>Load older events</ThemedText>}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ height: 8 }} />
          )
        }
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 8 }}
      />
      {error ? <ThemedText style={{ color: '#d11a2a', marginTop: 8 }}>{error}</ThemedText> : null}
    </View>
  );
}

function SkeletonRow() {
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 10 }}>
      <View style={{ height: 14, borderRadius: 7, opacity: 0.18, backgroundColor: '#888', width: 160 }} />
      <View style={{ height: 64, borderRadius: 12, opacity: 0.12, backgroundColor: '#888', marginTop: 10 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  dayHeader: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 6,
    opacity: 0.8,
  },
  rowOuter: {
    // IMPORTANT: no padding/margin here; rows butt together so the rail never breaks.
    flexDirection: 'row',
    gap: 10, // horizontal gap only (rail ↔ card)
  },
  railCol: {
    width: 16,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  railDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  card: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  cardTintFix: {
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  timeLabel: {
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.8,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipLabel: {
    fontWeight: '700',
    fontSize: 12,
  },
  emptyBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  loadMoreBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
