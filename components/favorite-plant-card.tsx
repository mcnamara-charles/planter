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
  // Show skeleton only if we actually expect an image and are in viewport
  const [imgLoading, setImgLoading] = useState(Boolean(plant.imageUri && shouldLoadImage));
  const [imgError, setImgError] = useState(false);
  
  // Reset loading state when shouldLoadImage changes
  useEffect(() => {
    if (shouldLoadImage && plant.imageUri) {
      setImgLoading(true);
      setImgError(false);
    }
  }, [shouldLoadImage, plant.imageUri]);
  
  // Only render image when in viewport - derender when out of viewport for performance
  // Since images are cached, they'll load quickly when scrolled back into view
  const shouldRenderImage = shouldLoadImage;

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

  // Portrait layout with info card below image
  return (
    <Pressable 
      style={styles.card} 
      onPress={onPress} 
      onLongPress={onLongPress}
      delayLongPress={250}
    >
      {/* Media - Portrait format */}
      <View style={styles.media}>
        {/* Only show skeleton if we're actually going to load the image */}
        {shouldLoadImage && imgLoading && <SkeletonTile style={styles.mediaSkeleton} rounded={12} />}

        {/* Image (if present) - only render when in viewport */}
        {shouldLoadImage && imgSource && !imgError ? (
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
            }}
            onError={() => {
              setImgLoading(false);
              setImgError(true);
            }}
          />
        ) : shouldLoadImage && !imgSource && !imgError ? (
          // Fallback if there's no image or it failed
          <View style={styles.mediaFallback} />
        ) : null}
        
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
      </View>

      {/* Info card below image with plant info */}
      <View style={styles.overlayCard}>
        <View style={styles.overlayContent}>
          {/* Nickname */}
          <ThemedText style={[styles.nickname, getTitleStyle()]} numberOfLines={1}>
            {plant.name || 'Unnamed Plant'}
          </ThemedText>
          
          {/* Icons and lineage row */}
          <View style={styles.iconsRow}>
            <View style={[styles.lineageChip, plant.hasActivePest && styles.lineageChipPest]}>
              <Text style={[styles.lineageText, plant.hasActivePest && styles.lineageTextPest]}>{lineageDisplay}</Text>
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
    aspectRatio: 0.9, // Shorter portrait format
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
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
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  overlayCard: {
    backgroundColor: '#6B8E23', // Olive green background
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
    marginTop: 0,
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
    backgroundColor: '#FFFFFF', // White background (matches TopBar)
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineageChipPest: {
    backgroundColor: '#EF4444', // Red background for active pest
  },
  lineageText: {
    color: '#000000', // Black text (matches TopBar)
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 12,
  },
  lineageTextPest: {
    color: '#FFFFFF', // White text when infected
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
