import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View, ScrollView, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import SkeletonTile from '@/components/SkeletonTile';
import TopBar from '@/components/TopBar';
import Section from '@/components/Section';
import { IconSymbol } from '@/components/ui/icon-symbol';

type RouteParams = {
  timelineEventId: string;
  userPlantId: string;
};

type ObservationData = {
  v: number;
  env: {
    rh_pct: number;
    temp_f: number;
  };
  notes: string;
  growth: {
    width_in: number;
    height_in: number;
    leaf_count: number;
    rootbound?: boolean;
  };
  health: {
    is_healthy: boolean;
    damage_desc: string;
    pests?: string;
    pest_severity?: string | null;
  };
  medium: {
    depth_in: number;
    soil_moisture: string;
  };
  source: {
    method: string;
  };
};

type TimelineEvent = {
  id: string;
  event_time: string;
  event_data: ObservationData;
  note?: string | null;
};

type EventPhoto = {
  id: string;
  coverUrl: string;
  containUrl: string;
};

export default function ViewObservationScreen() {
  const { theme } = useTheme();
  const route = useRoute();
  const nav = useNavigation();
  const { user } = useAuth();
  const { timelineEventId, userPlantId } = (route.params as any) as RouteParams;

  const [ui, setUi] = useState({
    heroLoaded: false,
    loading: true,
  });

  const [timelineEvent, setTimelineEvent] = useState<TimelineEvent | null>(null);
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [selectedPhotoCoverUrl, setSelectedPhotoCoverUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const observationData = useMemo(() => {
    return timelineEvent?.event_data as ObservationData | null;
  }, [timelineEvent]);

  const formatDate = useCallback((timestamp: string) => {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }, []);

  const fetchObservationData = useCallback(async () => {
    try {
      setUi(prev => ({ ...prev, loading: true }));
      setError(null);

      // Fetch the timeline event
      const { data: eventData, error: eventError } = await supabase
        .from('user_plant_timeline_events')
        .select('*')
        .eq('id', timelineEventId)
        .eq('user_plant_id', userPlantId)
        .single();

      if (eventError) throw eventError;
      setTimelineEvent(eventData);

      // Fetch photos for this event
      const { data: photoLinks, error: linkError } = await supabase
        .from('user_plant_timeline_event_photos')
        .select('user_plant_photo_id')
        .eq('timeline_event_id', timelineEventId);

      if (linkError) throw linkError;

      if (photoLinks?.length) {
        const photoIds = photoLinks.map(link => link.user_plant_photo_id);
        const { data: photosData, error: photosError } = await supabase
          .from('user_plant_photos')
          .select('id, bucket, object_path')
          .in('id', photoIds);

        if (photosError) throw photosError;

        // Create signed URLs for photos
        const photosWithUrls: EventPhoto[] = [];
        for (const photo of photosData || []) {
          const bucket = photo.bucket || 'plant-photos';
          const { data: signedCover } = await supabase.storage
            .from(bucket)
            .createSignedUrl(photo.object_path, 60 * 60, {
              transform: { width: 1200, quality: 90, resize: 'cover' },
            });
          const { data: signedContain } = await supabase.storage
            .from(bucket)
            .createSignedUrl(photo.object_path, 60 * 60, {
              transform: { width: 1600, quality: 90, resize: 'contain' },
            });
          if (signedCover?.signedUrl && signedContain?.signedUrl) {
            photosWithUrls.push({
              id: photo.id,
              coverUrl: signedCover.signedUrl,
              containUrl: signedContain.signedUrl,
            });
          }
        }

        setPhotos(photosWithUrls);
        if (photosWithUrls.length > 0) {
          setSelectedPhotoCoverUrl(photosWithUrls[0].coverUrl);
        }
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load observation data');
    } finally {
      setUi(prev => ({ ...prev, loading: false }));
    }
  }, [timelineEventId, userPlantId]);

  useEffect(() => {
    fetchObservationData();
  }, [fetchObservationData]);

  const selectPhoto = useCallback((photo: EventPhoto) => {
    setSelectedPhotoCoverUrl(photo.coverUrl);
  }, []);

  const isRemoteHeader = !!selectedPhotoCoverUrl;
  const showHeaderSkeleton = isRemoteHeader && !ui.heroLoaded;

  if (ui.loading) {
    return (
      <View style={{ flex: 1 }}>
        <TopBar
          title="Observation"
          isFavorite={false}
          onBack={() => (nav as any).goBack()}
          onToggleFavorite={() => {}}
          onToggleMenu={() => {}}
          hideActions
        />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" />
          <ThemedText style={{ marginTop: 12 }}>Loading observation...</ThemedText>
        </View>
      </View>
    );
  }

  if (error || !timelineEvent || !observationData) {
    return (
      <View style={{ flex: 1 }}>
        <TopBar
          title="Observation"
          isFavorite={false}
          onBack={() => (nav as any).goBack()}
          onToggleFavorite={() => {}}
          onToggleMenu={() => {}}
          hideActions
        />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <IconSymbol name="eye" size={48} color={theme.colors.mutedText} />
          <ThemedText style={{ marginTop: 12, textAlign: 'center' }}>
            {error || 'Observation not found'}
          </ThemedText>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <TopBar
        title="Observation"
        isFavorite={false}
        onBack={() => (nav as any).goBack()}
        onToggleFavorite={() => {}}
        onToggleMenu={() => {}}
        hideActions
      />

      <ParallaxScrollView
        headerBackgroundColor={{ light: '#E5F4EF', dark: '#12231F' }}
        enableLightbox={photos.length > 0}
        lightboxImages={photos.map(p => ({ uri: p.containUrl, id: p.id }))}
        headerImage={
          selectedPhotoCoverUrl ? (
            <Image
              key={selectedPhotoCoverUrl}
              source={{ uri: selectedPhotoCoverUrl }}
              contentFit="cover"
              transition={200}
              style={styles.headerImage}
              onLoadStart={() => setUi(prev => ({ ...prev, heroLoaded: false }))}
              onLoadEnd={() => setUi(prev => ({ ...prev, heroLoaded: true }))}
              onError={() => setUi(prev => ({ ...prev, heroLoaded: true }))}
            />
          ) : (
            <View style={[styles.headerImage, { backgroundColor: theme.colors.background }]}>
              <IconSymbol name="eye" size={64} color={theme.colors.mutedText} />
            </View>
          )
        }
        headerOverlay={showHeaderSkeleton ? <SkeletonTile style={styles.headerSkeleton} rounded={0} /> : null}
      >
        {/* Photo Gallery */}
        {photos.length > 0 && (
          <View style={styles.photoGalleryContainer}>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photoGalleryContent}
            >
              {photos.map((photo, idx) => {
                const isSelected = selectedPhotoCoverUrl === photo.coverUrl;
                return (
                  <TouchableOpacity
                    key={photo.id}
                    style={[
                      styles.photoGalleryItem,
                      isSelected && styles.photoGalleryItemSelected
                    ]}
                    onPress={() => selectPhoto(photo)}
                    activeOpacity={0.8}
                  >
                    <Image 
                      source={{ uri: photo.coverUrl }} 
                      contentFit="cover" 
                      style={styles.photoGalleryImage}
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <ThemedView>
          {/* Date and Time */}
          <ThemedText type="title" style={{ marginBottom: 8 }}>
            {formatDate(timelineEvent.event_time)}
          </ThemedText>
          
          {timelineEvent.note && (
            <ThemedText style={{ opacity: 0.9, marginBottom: 16 }}>
              {timelineEvent.note}
            </ThemedText>
          )}

          {/* Growth Section */}
          <Section title="Growth" open={true}>
            <View style={styles.dataGrid}>
              <View style={styles.dataItem}>
                <ThemedText style={styles.dataLabel}>Height</ThemedText>
                <ThemedText style={styles.dataValue}>{observationData.growth.height_in}"</ThemedText>
              </View>
              <View style={styles.dataItem}>
                <ThemedText style={styles.dataLabel}>Width</ThemedText>
                <ThemedText style={styles.dataValue}>{observationData.growth.width_in}"</ThemedText>
              </View>
              <View style={styles.dataItem}>
                <ThemedText style={styles.dataLabel}>Leaf Count</ThemedText>
                <ThemedText style={styles.dataValue}>{observationData.growth.leaf_count}</ThemedText>
              </View>
              {typeof observationData.growth.rootbound !== 'undefined' && (
                <View style={styles.dataItem}>
                  <ThemedText style={styles.dataLabel}>Rootbound</ThemedText>
                  <ThemedText style={styles.dataValue}>{observationData.growth.rootbound ? 'Yes' : 'No'}</ThemedText>
                </View>
              )}
            </View>
          </Section>

          {/* Health Section */}
          <Section title="Health" open={true}>
            <View style={styles.dataGrid}>
              <View style={styles.dataItem}>
                <ThemedText style={styles.dataLabel}>Status</ThemedText>
                <View style={styles.healthStatus}>
                  <IconSymbol 
                    name={observationData.health.is_healthy ? "star" : "xmark.circle.fill"} 
                    size={16} 
                    color={observationData.health.is_healthy ? "#10B981" : "#EF4444"} 
                  />
                  <ThemedText style={[
                    styles.dataValue, 
                    { color: observationData.health.is_healthy ? "#10B981" : "#EF4444" }
                  ]}>
                    {observationData.health.is_healthy ? "Healthy" : "Unhealthy"}
                  </ThemedText>
                </View>
              </View>
              <View style={styles.dataItem}>
                <ThemedText style={styles.dataLabel}>Damage</ThemedText>
                <ThemedText style={styles.dataValue}>{observationData.health.damage_desc}</ThemedText>
              </View>
              <View style={styles.dataItem}>
                <ThemedText style={styles.dataLabel}>Pests</ThemedText>
                <ThemedText style={styles.dataValue}>
                  {observationData.health.pests || 'Clean'}
                </ThemedText>
              </View>
              {observationData.health.pests && observationData.health.pests !== 'Clean' && observationData.health.pest_severity && (
                <View style={styles.dataItem}>
                  <ThemedText style={styles.dataLabel}>Pest Severity</ThemedText>
                  <ThemedText style={styles.dataValue}>{observationData.health.pest_severity}</ThemedText>
                </View>
              )}
            </View>
          </Section>

          {/* Medium Section */}
          <Section title="Medium" open={true}>
            <View style={styles.dataGrid}>
              <View style={styles.dataItem}>
                <ThemedText style={styles.dataLabel}>Soil Moisture</ThemedText>
                <ThemedText style={styles.dataValue}>{observationData.medium.soil_moisture}</ThemedText>
              </View>
              <View style={styles.dataItem}>
                <ThemedText style={styles.dataLabel}>Depth</ThemedText>
                <ThemedText style={styles.dataValue}>{observationData.medium.depth_in}"</ThemedText>
              </View>
            </View>
          </Section>

          {/* Environment Section */}
          <Section title="Environment" open={true}>
            <View style={styles.dataGrid}>
              <View style={styles.dataItem}>
                <ThemedText style={styles.dataLabel}>Temperature</ThemedText>
                <ThemedText style={styles.dataValue}>{observationData.env.temp_f}°F</ThemedText>
              </View>
              <View style={styles.dataItem}>
                <ThemedText style={styles.dataLabel}>Humidity</ThemedText>
                <ThemedText style={styles.dataValue}>{observationData.env.rh_pct}%</ThemedText>
              </View>
            </View>
          </Section>

          {/* Notes Section */}
          {observationData.notes && (
            <Section title="Notes" open={true}>
              <ThemedText style={{ opacity: 0.9 }}>
                {observationData.notes}
              </ThemedText>
            </Section>
          )}
        </ThemedView>
        
        {/* Bottom padding */}
        <View style={{ height: 50 }} />
      </ParallaxScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerImage: { 
    width: '100%', 
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSkeleton: { 
    width: '100%', 
    height: '100%' 
  },

  // Photo gallery styles
  photoGalleryContainer: {
    paddingVertical: 8,
    paddingHorizontal: 0,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  photoGalleryContent: {
    paddingRight: 8,
  },
  photoGalleryItem: {
    width: 100,
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
    marginRight: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    position: 'relative',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  photoGalleryItemSelected: {
    borderColor: '#FFD700',
  },
  photoGalleryImage: {
    width: '100%',
    height: '100%',
  },

  // Data display styles
  dataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  dataItem: {
    flex: 1,
    minWidth: 120,
    paddingVertical: 8,
  },
  dataLabel: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.7,
    marginBottom: 4,
  },
  dataValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  healthStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});

