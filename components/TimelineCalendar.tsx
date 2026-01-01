// components/TimelineCalendar.tsx
// Calendar view for timeline events
import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import * as d3Time from 'd3-time';
import * as d3TimeFormat from 'd3-time-format';

// Background cleanup function to remove duplicate events
async function cleanupDuplicateEvents(userPlantId: string) {
  try {
    // Fetch all events for this plant, ordered by time
    const { data: allEvents, error: fetchError } = await supabase
      .from('user_plant_timeline_events')
      .select('id, event_time, event_type')
      .eq('user_plant_id', userPlantId)
      .order('event_time', { ascending: true });

    if (fetchError) throw fetchError;
    if (!allEvents || allEvents.length < 2) return;

    // Find events that are 0d or 1d apart from the previous event
    const eventsToDelete: string[] = [];
    
    for (let i = 1; i < allEvents.length; i++) {
      const prevEvent = allEvents[i - 1];
      const currEvent = allEvents[i];
      
      const prevDate = new Date(prevEvent.event_time);
      const currDate = new Date(currEvent.event_time);
      
      // Calculate difference in days
      const diffMs = currDate.getTime() - prevDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      // If events are 0 or 1 day apart and same type, mark current for deletion
      if ((diffDays === 0 || diffDays === 1) && prevEvent.event_type === currEvent.event_type) {
        eventsToDelete.push(currEvent.id);
      }
    }

    // Delete duplicate events in batches
    if (eventsToDelete.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < eventsToDelete.length; i += batchSize) {
        const batch = eventsToDelete.slice(i, i + batchSize);
        const { error: deleteError } = await supabase
          .from('user_plant_timeline_events')
          .delete()
          .in('id', batch);
        
        if (deleteError) {
          console.error('Error deleting duplicate events batch:', deleteError);
        }
      }
    }
  } catch (err) {
    // Silently fail - this is a background operation
    console.error('Error in cleanupDuplicateEvents:', err);
  }
}
import { Image } from 'expo-image';
import ImageLightbox from '@/components/ImageLightbox';
import type { TimelineEvent, EventPhoto } from '@/components/PlantTimeline';

// Import utility functions from PlantTimeline
function humanizeType(t: string) {
  if (!t) return 'Event';
  return t.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

type EventConfig = {
  icon: string;
  title?: (e: TimelineEvent) => string;
  chips?: (e: TimelineEvent) => string[];
  renderExtra?: (e: TimelineEvent) => React.ReactNode;
};

const EVENT_MAP: Record<string, EventConfig> = {
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
  repot: {
    icon: 'cycle',
    title: () => 'Repotted',
    chips: (e) => {
      const d = e.event_data || {};
      const chips: string[] = [];
      if (d.previous_diameter && d.new_diameter) chips.push(`Diameter ${d.previous_diameter} → ${d.new_diameter} cm`);
      if (d.previous_height && d.new_height) chips.push(`Height ${d.previous_height} → ${d.new_height} cm`);
      if (d.previous_pot_type && d.new_pot_type) chips.push(`${d.previous_pot_type} → ${d.new_pot_type}`);
      return chips;
    },
  },
  prune: {
    icon: 'scissors',
    title: () => 'Pruned',
    chips: (e) => {
      const d = e.event_data || {};
      const chips: string[] = [];
      if (d.previous && d.next) {
        const prev = d.previous ? Object.keys(d.previous).length : 0;
        const next = d.next ? Object.keys(d.next).length : 0;
        if (prev || next) chips.push(`${prev} → ${next} parts`);
      }
      return chips;
    },
  },
  observe: {
    icon: 'eye',
    title: () => 'Observed',
    chips: (e) => {
      const d = e.event_data || {};
      const chips: string[] = [];
      if (d.health?.is_healthy !== undefined) chips.push(d.health.is_healthy ? 'Healthy' : 'Sick');
      if (d.medium?.soil_moisture) chips.push(`Soil: ${String(d.medium.soil_moisture)}`);
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

type TimelineCalendarProps = {
  eventType: 'Water' | 'Fertilize';
  userPlantId: string;
};

type CalendarEvent = {
  id: string;
  event_time: string;
  event_type: string;
  event_data?: Record<string, any>;
};

export default function TimelineCalendar({ eventType, userPlantId }: TimelineCalendarProps) {
  const { theme } = useTheme();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedDayEvents, setSelectedDayEvents] = useState<TimelineEvent[]>([]);
  const [selectedDayPhotos, setSelectedDayPhotos] = useState<EventPhoto[]>([]);
  const [loadingSelectedEvents, setLoadingSelectedEvents] = useState(false);

  // Fetch events
  useEffect(() => {
    if (!userPlantId) {
      setEvents([]);
      setLoading(false);
      return;
    }

    const fetchEvents = async () => {
      try {
        setLoading(true);
        // Fetch last 10 events for the calendar (not filtered by type)
        // Order by descending to get newest first, then limit, then reverse to get chronological order
        const { data, error } = await supabase
          .from('user_plant_timeline_events')
          .select('id, event_time, event_type, event_data')
          .eq('user_plant_id', userPlantId)
          .order('event_time', { ascending: false })
          .limit(10);

        if (error) throw error;
        // Reverse to get chronological order (oldest first)
        const eventsList = (data || []).reverse();
        setEvents(eventsList);

        // Background cleanup: remove duplicate events (0d or 1d apart)
        // Run this async without blocking the UI
        cleanupDuplicateEvents(userPlantId).catch((err) => {
          console.error('Failed to cleanup duplicate events:', err);
          // Silently fail - this is a background operation
        });
      } catch (err) {
        console.error('Failed to fetch events:', err);
        setEvents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [eventType, userPlantId]);

  // Group events by date
  const eventsByDate = useMemo(() => {
    const grouped: Record<string, CalendarEvent[]> = {};
    events.forEach((event) => {
      const date = new Date(event.event_time);
      const dateKey = d3TimeFormat.timeFormat('%Y-%m-%d')(date);
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(event);
    });
    return grouped;
  }, [events]);

  // Fetch full event details for selected day
  useEffect(() => {
    if (!selectedDate || !userPlantId) {
      setSelectedDayEvents([]);
      setSelectedDayPhotos([]);
      return;
    }

    const fetchSelectedDayEvents = async () => {
      try {
        setLoadingSelectedEvents(true);
        // Parse the date string (YYYY-MM-DD) and create date range in local timezone
        const [year, month, day] = selectedDate.split('-').map(Number);
        const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
        const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

        // Fetch events for the selected day
        // Query a wider range to account for timezone differences, then filter by local date
        const dateStr = selectedDate; // Already in YYYY-MM-DD format
        
        // Create a wider query range (from previous day 00:00 UTC to next day 23:59 UTC)
        // This ensures we capture all events that might appear on the selected day in any timezone
        const queryStart = new Date(year, month - 1, day - 1, 0, 0, 0, 0);
        const queryEnd = new Date(year, month - 1, day + 1, 23, 59, 59, 999);
        
        const { data: eventsData, error: eventsError } = await supabase
          .from('user_plant_timeline_events')
          .select('*')
          .eq('user_plant_id', userPlantId)
          .gte('event_time', queryStart.toISOString())
          .lte('event_time', queryEnd.toISOString())
          .order('event_time', { ascending: false });
        
        // Filter events to match the selected date in local timezone
        // This ensures we get events that show on the correct day regardless of UTC offset
        const filteredEvents = (eventsData || []).filter((event) => {
          const eventDate = new Date(event.event_time);
          const eventDateKey = d3TimeFormat.timeFormat('%Y-%m-%d')(eventDate);
          return eventDateKey === dateStr;
        });

        if (eventsError) throw eventsError;

        // Fetch photos for these events
        const eventIds = (eventsData || []).map((e) => e.id);
        let photos: EventPhoto[] = [];
        if (eventIds.length > 0) {
          const { data: links, error: linksError } = await supabase
            .from('user_plant_timeline_event_photos')
            .select('timeline_event_id, user_plant_photo_id')
            .in('timeline_event_id', eventIds);

          if (linksError) throw linksError;

          if (links?.length) {
            const photoIds = links.map((l) => l.user_plant_photo_id);
            const { data: photosData, error: photosError } = await supabase
              .from('user_plant_photos')
              .select('id, bucket, object_path')
              .in('id', photoIds);

            if (photosError) throw photosError;

            // Map to EventPhoto format
            photos = (photosData || []).map((ph) => ({
              timeline_event_id: links.find((l) => l.user_plant_photo_id === ph.id)?.timeline_event_id || '',
              user_plant_photo_id: ph.id,
              bucket: ph.bucket || 'plant-photos',
              object_path: ph.object_path,
            }));
          }
        }

        setSelectedDayEvents((filteredEvents || []) as TimelineEvent[]);
        setSelectedDayPhotos(photos);
      } catch (err) {
        console.error('Failed to fetch selected day events:', err);
        setSelectedDayEvents([]);
        setSelectedDayPhotos([]);
      } finally {
        setLoadingSelectedEvents(false);
      }
    };

    fetchSelectedDayEvents();
  }, [selectedDate, userPlantId]);

  // Get calendar days for current month
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    // First day of month
    const firstDay = new Date(year, month, 1);
    // Last day of month
    const lastDay = new Date(year, month + 1, 0);
    
    // Start from the first day of the week that contains the first day of month
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay());
    
    // End on the last day of the week that contains the last day of month
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));
    
    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      days.push({
        date: new Date(current),
        isCurrentMonth: current.getMonth() === month,
      });
      current.setDate(current.getDate() + 1);
    }
    
    return days;
  }, [currentMonth]);

  // Navigation
  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentMonth(new Date());
  };

  const formatMonthYear = d3TimeFormat.timeFormat('%B %Y');
  const formatDay = d3TimeFormat.timeFormat('%d');

  if (loading) {
    return (
      <View style={styles.container}>
        <ThemedText style={{ opacity: 0.5, fontSize: 12 }}>Loading calendar...</ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Month header */}
      <View style={styles.monthHeader}>
        <TouchableOpacity onPress={goToPreviousMonth} style={styles.navButton}>
          <IconSymbol name="chevron.left" size={20} color={theme.colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={goToToday} style={styles.monthTitle}>
          <ThemedText style={styles.monthTitleText}>{formatMonthYear(currentMonth)}</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={goToNextMonth} style={styles.navButton}>
          <IconSymbol name="chevron.right" size={20} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      {/* Day headers */}
      <View style={styles.dayHeaders}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <View key={day} style={styles.dayHeader}>
            <ThemedText style={styles.dayHeaderText}>{day}</ThemedText>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={styles.calendarGrid}>
        {calendarDays.map((day, index) => {
          const dateKey = d3TimeFormat.timeFormat('%Y-%m-%d')(day.date);
          const dayEvents = eventsByDate[dateKey] || [];
          const isToday = d3TimeFormat.timeFormat('%Y-%m-%d')(day.date) === d3TimeFormat.timeFormat('%Y-%m-%d')(new Date());
          const isSelected = selectedDate === dateKey;

          return (
            <TouchableOpacity
              key={index}
              onPress={() => setSelectedDate(isSelected ? null : dateKey)}
              activeOpacity={0.7}
              style={[
                styles.calendarDay,
                { borderColor: theme.colors.border, backgroundColor: theme.colors.card },
                !day.isCurrentMonth && styles.calendarDayOtherMonth,
                isToday && styles.calendarDayToday,
                isSelected && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary, borderWidth: 2 },
              ]}
            >
              <ThemedText
                style={[
                  styles.dayNumber,
                  !day.isCurrentMonth && { opacity: 0.3 },
                  isToday && { fontWeight: '800', color: theme.colors.primary },
                  isSelected && { fontWeight: '800', color: theme.colors.primary },
                ]}
              >
                {formatDay(day.date)}
              </ThemedText>
              {dayEvents.length > 0 && (() => {
                // Prioritize showing different event types
                // Group events by type to ensure we show at least one of each important type
                const eventGroups: Record<string, CalendarEvent[]> = {};
                dayEvents.forEach(event => {
                  const type = event.event_type;
                  if (!eventGroups[type]) {
                    eventGroups[type] = [];
                  }
                  eventGroups[type].push(event);
                });
                
                // Build display list: show at least one of each type, then fill remaining slots
                const displayEvents: CalendarEvent[] = [];
                const maxDots = 3;
                
                // Priority order: water, fertilize, observe, then others
                const priorityOrder = ['water', 'fertilize', 'fertilizer', 'observe'];
                
                // Add one event of each priority type
                for (const type of priorityOrder) {
                  if (displayEvents.length >= maxDots) break;
                  const eventsOfType = eventGroups[type];
                  if (eventsOfType && eventsOfType.length > 0) {
                    displayEvents.push(eventsOfType[0]);
                  }
                }
                
                // Fill remaining slots with other event types
                for (const [type, eventsOfType] of Object.entries(eventGroups)) {
                  if (displayEvents.length >= maxDots) break;
                  if (!priorityOrder.includes(type) && eventsOfType.length > 0) {
                    displayEvents.push(eventsOfType[0]);
                  }
                }
                
                return (
                  <View style={styles.eventsIndicator}>
                    {displayEvents.map((event, idx) => {
                      // Determine dot style based on event type
                      const isWater = event.event_type === 'water';
                      const isFertilize = event.event_type === 'fertilize' || event.event_type === 'fertilizer';
                      const countsAsWatering = isFertilize && event.event_data?.is_watering === true;
                    
                    if (isWater) {
                      // Blue dot for water
                      return (
                        <View
                          key={event.id}
                          style={[
                            styles.eventDot,
                            { backgroundColor: '#3B82F6' },
                            idx > 0 && { marginLeft: 2 },
                          ]}
                        />
                      );
                    } else if (countsAsWatering) {
                      // Half green, half blue for fertilize that counts as watering
                      return (
                        <View
                          key={event.id}
                          style={[
                            styles.eventDot,
                            styles.eventDotSplit,
                            idx > 0 && { marginLeft: 2 },
                          ]}
                        >
                          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#10B981', borderTopLeftRadius: 3, borderBottomLeftRadius: 3, width: '50%' }]} />
                          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#3B82F6', borderTopRightRadius: 3, borderBottomRightRadius: 3, left: '50%', width: '50%' }]} />
                        </View>
                      );
                    } else if (isFertilize) {
                      // Green dot for fertilize only
                      return (
                        <View
                          key={event.id}
                          style={[
                            styles.eventDot,
                            { backgroundColor: '#10B981' },
                            idx > 0 && { marginLeft: 2 },
                          ]}
                        />
                      );
                    } else if (event.event_type === 'observe') {
                      // Yellow dot for observations
                      return (
                        <View
                          key={event.id}
                          style={[
                            styles.eventDot,
                            { backgroundColor: '#FBBF24' },
                            idx > 0 && { marginLeft: 2 },
                          ]}
                        />
                      );
                    } else {
                      // Grey dot for any other event type
                      return (
                        <View
                          key={event.id}
                          style={[
                            styles.eventDot,
                            { backgroundColor: '#6B7280' },
                            idx > 0 && { marginLeft: 2 },
                          ]}
                        />
                      );
                    }
                    })}
                    {dayEvents.length > displayEvents.length && (
                      <ThemedText style={styles.eventCount}>+{dayEvents.length - displayEvents.length}</ThemedText>
                    )}
                  </View>
                );
              })()}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Selected day events */}
      {selectedDate && (() => {
        // Parse the date string (YYYY-MM-DD) and create date in local timezone
        const [year, month, day] = selectedDate.split('-').map(Number);
        const selectedDateObj = new Date(year, month - 1, day);
        return (
          <View style={styles.selectedDayEvents}>
            <ThemedText style={[styles.selectedDayHeader, { color: theme.colors.text }]}>
              {d3TimeFormat.timeFormat('%B %d, %Y')(selectedDateObj)}
            </ThemedText>
          {loadingSelectedEvents ? (
            <ThemedText style={{ opacity: 0.5, fontSize: 12, marginTop: 8 }}>Loading events...</ThemedText>
          ) : selectedDayEvents.length === 0 ? (
            <ThemedText style={{ opacity: 0.5, fontSize: 12, marginTop: 8 }}>No events on this day</ThemedText>
          ) : (
            <ScrollView style={styles.eventsList} nestedScrollEnabled>
              {selectedDayEvents.map((event, idx) => {
                const cfg = getEventConfig(event.event_type);
                const chips = cfg.chips?.(event) ?? [];
                const title = cfg.title?.(event) ?? humanizeType(event.event_type);
                const eventPhotos = selectedDayPhotos.filter((p) => p.timeline_event_id === event.id);
                // Photos will be loaded asynchronously - for now we'll fetch signed URLs when needed
                const photos: { thumb: string; full: string; id: string }[] = [];
                // Note: In a production app, you'd want to fetch signed URLs here similar to PlantTimeline
                // For now, we'll leave photos empty and they can be added later if needed

                return (
                  <ThemedView key={event.id} style={[styles.eventCard, { borderColor: theme.colors.border }]}>
                    <View style={styles.eventCardHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, flexShrink: 1 }}>
                        <EventIcon type={event.event_type} />
                        <ThemedText style={styles.eventCardTitle} numberOfLines={2}>{title}</ThemedText>
                      </View>
                      <ThemedText style={[styles.eventTime, { color: theme.colors.mutedText, flexShrink: 0 }]}>
                        {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(event.event_time))}
                      </ThemedText>
                    </View>
                    {event.note && <ThemedText style={{ marginTop: 8, opacity: 0.9 }} numberOfLines={10}>{String(event.note)}</ThemedText>}
                    {chips.length > 0 && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 8, marginTop: 8 }}>
                        {chips.map((c, i) => (
                          <Chip key={i} label={String(c)} />
                        ))}
                      </View>
                    )}
                    {photos.length > 0 && <PhotoStrip photos={photos} />}
                  </ThemedView>
                );
              })}
            </ScrollView>
          )}
          </View>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 12,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  navButton: {
    padding: 8,
  },
  monthTitle: {
    flex: 1,
    alignItems: 'center',
  },
  monthTitleText: {
    fontSize: 18,
    fontWeight: '700',
  },
  dayHeaders: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  dayHeader: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  dayHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.7,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarDay: {
    width: '14.28%', // 7 days per week
    minHeight: 60,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 6,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  calendarDayOtherMonth: {
    opacity: 0.3,
  },
  calendarDayToday: {
    borderWidth: 2,
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: '600',
  },
  eventsIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 2,
  },
  eventDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  eventDotSplit: {
    overflow: 'hidden',
  },
  eventCount: {
    fontSize: 9,
    fontWeight: '700',
    opacity: 0.8,
  },
  selectedDayEvents: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.2)',
  },
  selectedDayHeader: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  eventsList: {
    maxHeight: 400,
  },
  eventCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  eventCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    flexShrink: 1,
  },
  eventCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    flexShrink: 1,
  },
  eventTime: {
    fontSize: 12,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});

