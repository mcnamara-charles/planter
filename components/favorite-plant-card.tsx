// components/favorite-plant-card.tsx
import React, { useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import SkeletonTile from '@/components/SkeletonTile';
import { ThemedText } from '@/components/themed-text';

type Plant = {
  id: string;
  name: string;
  scientificName?: string;
  imageUri?: string;
};

export default function FavoritePlantCard({
  plant,
  onPress,
}: {
  plant: Plant;
  onPress?: () => void;
}) {
  // Show skeleton only if we actually expect an image
  const [imgLoading, setImgLoading] = useState(Boolean(plant.imageUri));
  const [imgError, setImgError] = useState(false);

  // A tiny cache-buster if you want to avoid stale signed URLs (optional)
  const imgSource = useMemo(() => {
    if (!plant.imageUri) return null;
    return { uri: plant.imageUri };
  }, [plant.imageUri]);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Media */}
      <View style={styles.media}>
        {/* Skeleton while the image loads */}
        {imgLoading && <SkeletonTile style={styles.mediaSkeleton} rounded={12} />}

        {/* Image (if present) */}
        {imgSource && !imgError ? (
          <Image
            source={imgSource}
            style={styles.mediaImg}
            contentFit="cover"
            transition={160}
            onLoadStart={() => setImgLoading(true)}
            onLoad={() => setImgLoading(false)}     // hide skeleton as soon as first frame decodes
            onError={() => {
              setImgLoading(false);
              setImgError(true);
            }}
          />
        ) : (
          // Fallback if there’s no image or it failed
          <View style={styles.mediaFallback} />
        )}
      </View>

      {/* Meta */}
      <View style={styles.meta}>
        <ThemedText style={styles.title} numberOfLines={1}>
          {plant.name || 'Unnamed Plant'}
        </ThemedText>
        {!!plant.scientificName && (
          <ThemedText style={styles.subtitle} numberOfLines={1}>
            {plant.scientificName}
          </ThemedText>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  media: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(120,120,120,0.12)',
  },
  mediaImg: {
    ...StyleSheet.absoluteFillObject,
  },
  mediaSkeleton: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 0, // parent already rounded
  },
  mediaFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(120,120,120,0.12)',
  },
  meta: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
  },
  title: {
    fontWeight: '700',
    // pull the subtitle up a touch
    marginBottom: -2,
  },
  subtitle: {
    opacity: 0.75,
    fontStyle: 'italic',
    // tighter stack
    marginTop: 0,
    fontSize: 12,
    lineHeight: 14,        // <= tighten line box
    includeFontPadding: false as any, // Android: removes extra top/bottom padding
  },
});
