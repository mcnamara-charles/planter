// components/favorite-plant-card.tsx
import React, { useMemo, useState, memo, useEffect, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';

import SkeletonTile from '@/components/SkeletonTile';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';

type Plant = {
  id: string;
  name: string;
  scientificName?: string;
  imageUri?: string;
  lineage?: string | null;
  lightType?: 'grow_light' | 'sunlight' | null;
  systemType?: 'normal' | 'reservoir' | null;
  scheduleSameYearRound?: boolean | null;
  waterDelay?: number | null;
  hasActivePest?: boolean;
};

function FavoritePlantCard({
  plant,
  size = 'medium',
  onPress,
  onLongPress,
  shouldLoadImage = true, // New prop to control lazy loading
  isSelected = false,
}: {
  plant: Plant;
  size?: 'small' | 'medium';
  onPress?: () => void;
  onLongPress?: () => void;
  shouldLoadImage?: boolean; // Only load image when component is visible
  isSelected?: boolean;
}) {
  // Show skeleton only if we actually expect an image
  const [imgLoading, setImgLoading] = useState(Boolean(plant.imageUri && shouldLoadImage));
  const [imgError, setImgError] = useState(false);
  
  // Track if image has ever been rendered to prevent derendering during layout changes
  // (e.g., when multiselect toolbar appears and shifts layout)
  const [hasRenderedImage, setHasRenderedImage] = useState(false);
  
  // Once image is loaded, keep it rendered even if temporarily out of viewport
  // This prevents flickering during layout changes (like multiselect toolbar)
  const shouldRenderImage = shouldLoadImage || hasRenderedImage;

  // A tiny cache-buster if you want to avoid stale signed URLs (optional)
  // For medium grid, request lower resolution to reduce lag
  const imgSource = useMemo(() => {
    if (!plant.imageUri || !shouldRenderImage) return null;
    
    // For medium grid size, add width/quality parameters to reduce resolution
    // This helps reduce lag when scrolling
    if (size === 'medium') {
      try {
        const url = new URL(plant.imageUri);
        // Request smaller width (600px should be enough for 2-column layout)
        // and reduce quality to 75% for faster loading
        url.searchParams.set('width', '600');
        url.searchParams.set('quality', '75');
        return { uri: url.toString() };
      } catch (e) {
        // If URL parsing fails, fall back to original URI
        // Append query params manually if it's a simple URL
        const separator = plant.imageUri.includes('?') ? '&' : '?';
        return { uri: `${plant.imageUri}${separator}width=600&quality=75` };
      }
    }
    
    return { uri: plant.imageUri };
  }, [plant.imageUri, shouldRenderImage, size]);

  const getTitleStyle = () => {
    switch (size) {
      case 'small':
        return { fontSize: 10, lineHeight: 14 }; // Smaller for 3-column layout
      case 'medium':
        return { fontSize: 14, lineHeight: 16 }; // Medium for 2-column layout
      default:
        return { fontSize: 12, lineHeight: 16 };
    }
  };

  const getSubtitleStyle = () => {
    switch (size) {
      case 'small':
        return { fontSize: 8, lineHeight: 12 }; // Smaller for 3-column layout
      case 'medium':
        return { fontSize: 12, lineHeight: 14 }; // Medium for 2-column layout
      default:
        return { fontSize: 10, lineHeight: 14 };
    }
  };

  // Get lineage display value (default to "A" if empty)
  const lineageDisplay = plant.lineage?.trim() || 'A';

  // Portrait layout with overlay card at bottom
  return (
    <Pressable 
      style={styles.card} 
      onPress={onPress} 
      onLongPress={onLongPress}
      delayLongPress={250}
    >
      {/* Media - Portrait format */}
      <View style={styles.media}>
        {/* Skeleton while the image loads */}
        {imgLoading && <SkeletonTile style={styles.mediaSkeleton} rounded={12} />}

        {/* Image (if present) */}
        {imgSource && !imgError ? (
          <Image
            source={imgSource}
            style={styles.mediaImg}
            contentFit="cover"
            contentPosition={{ top: -10}} // Shift center up by ~20% (equivalent to ~30px+ on typical portrait images)
            transition={100}
            cachePolicy="memory-disk"
            recyclingKey={plant.id}
            priority="low"
            placeholderContentFit="cover"
            onLoadStart={() => setImgLoading(true)}
            onLoad={() => {
              setImgLoading(false);
              setHasRenderedImage(true); // Mark as rendered so it stays mounted
            }}
            onError={() => {
              setImgLoading(false);
              setImgError(true);
            }}
          />
        ) : (
          // Fallback if there's no image or it failed
          <View style={styles.mediaFallback} />
        )}
        
        {/* Selection overlay */}
        {isSelected && (
          <View style={styles.selectionOverlay} pointerEvents="none">
            <IconSymbol
              name="checkmark.circle"
              size={32}
              color="#22C55E"
            />
          </View>
        )}

        {/* Overlay card at bottom with plant info */}
        <View style={styles.overlayCard}>
          <View style={styles.overlayContent}>
            {/* Nickname */}
            <ThemedText style={[styles.nickname, getTitleStyle()]} numberOfLines={1}>
              {plant.name || 'Unnamed Plant'}
            </ThemedText>
            
            {/* Icons and lineage row */}
            <View style={styles.iconsRow}>
              <View style={[styles.lineageChip, plant.hasActivePest && styles.lineageChipPest]}>
                <Text style={styles.lineageText}>{lineageDisplay}</Text>
              </View>
              {/* Seasonal/Year-round icon */}
              {typeof plant.scheduleSameYearRound === 'boolean' && (
                <IconSymbol 
                  name={plant.scheduleSameYearRound ? 'plant' : 'flower'} 
                  size={12} 
                  color="#fff" 
                  style={{ marginLeft: 6 }} 
                />
              )}
              {plant.lightType === 'grow_light' && (
                <IconSymbol name="light.grow" size={12} color="#fff" style={{ marginLeft: 6 }} />
              )}
              {plant.systemType === 'reservoir' && (
                <IconSymbol name="drop" size={12} color="#fff" style={{ marginLeft: 6 }} />
              )}
              {plant.waterDelay !== null && plant.waterDelay !== undefined && (
                <IconSymbol name="clock" size={12} color="#3B82F6" style={{ marginLeft: 6 }} />
              )}
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// Memoize the component to prevent unnecessary re-renders
export default memo(FavoritePlantCard, (prevProps, nextProps) => {
  // Only re-render if plant data, size, or image loading state changes
  return (
    prevProps.plant.id === nextProps.plant.id &&
    prevProps.plant.name === nextProps.plant.name &&
    prevProps.plant.scientificName === nextProps.plant.scientificName &&
    prevProps.plant.imageUri === nextProps.plant.imageUri &&
    prevProps.plant.lineage === nextProps.plant.lineage &&
    prevProps.plant.lightType === nextProps.plant.lightType &&
    prevProps.plant.systemType === nextProps.plant.systemType &&
    prevProps.plant.scheduleSameYearRound === nextProps.plant.scheduleSameYearRound &&
    prevProps.plant.waterDelay === nextProps.plant.waterDelay &&
    prevProps.plant.hasActivePest === nextProps.plant.hasActivePest &&
    prevProps.size === nextProps.size &&
    prevProps.shouldLoadImage === nextProps.shouldLoadImage &&
    prevProps.isSelected === nextProps.isSelected
  );
});

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  media: {
    position: 'relative',
    width: '100%',
    aspectRatio: 0.75, // Portrait format (3:4 ratio)
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
  selectionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    borderRadius: 12,
  },
  overlayCard: {
    position: 'absolute',
    bottom: 6, // Reduced from 8
    left: 6, // Reduced from 8
    right: 6, // Reduced from 8
    backgroundColor: '#000000', // Solid black background
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
  },
  overlayContent: {
    flexDirection: 'column',
  },
  nickname: {
    color: '#ffffff',
    fontWeight: '700',
    marginBottom: 4,
  },
  iconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lineageChip: {
    backgroundColor: 'rgba(10, 132, 255, 0.9)', // Blue translucent
    paddingHorizontal: 5, // Reduced from 6
    paddingVertical: 2,
    borderRadius: 6,
    minWidth: 18, // Reduced from 20
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineageChipPest: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)', // Red translucent for active pest
  },
  lineageText: {
    color: '#ffffff',
    fontSize: 9, // Reduced from 10
    fontWeight: '600',
    lineHeight: 11, // Reduced from 12
  },
  title: {
    fontWeight: '700',
  },
  subtitle: {
    opacity: 0.75,
    fontStyle: 'italic',
    marginTop: 0,
    includeFontPadding: false as any,
  },
});
