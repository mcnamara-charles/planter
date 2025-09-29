import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import FavoritePlantCard from '@/components/favorite-plant-card';
import SkeletonTile from '@/components/SkeletonTile';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/context/themeContext';
import { type Plant } from '@/types/plant';

type LayoutPreset = 'gridsmall' | 'gridmed' | 'list';

type PlantGalleryProps = {
  plants: Plant[];
  loading?: boolean;
  error?: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;

  // Item interaction
  onItemPress?: (plant: Plant) => void;

  // UI controls
  enableSearch?: boolean;          // default: true
  enableViewToggle?: boolean;      // default: true

  // Search (controlled)
  searchValue?: string;
  onSearchChange?: (text: string) => void;
  searchPlaceholder?: string;

  // Layout
  defaultLayout?: LayoutPreset;    // 'gridsmall' | 'gridmed' | 'list' (default: 'gridmed')

  // Optional title for the row (e.g., "Plants")
  title?: string;
};

export default function PlantGallery({
  plants,
  loading = false,
  error = null,
  refreshing = false,
  onRefresh,
  onItemPress,

  enableSearch = true,
  enableViewToggle = true,

  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search nickname or species...',

  defaultLayout = 'gridmed',
  title,
}: PlantGalleryProps) {
  const { theme } = useTheme();

  // Derive initial view & size from defaultLayout
  const initialView = defaultLayout === 'list' ? 'list' : 'grid';
  const initialSize = defaultLayout === 'gridsmall' ? 'small' : 'medium';

  const [viewMode, setViewMode] = useState<'grid' | 'list'>(initialView);
  const [gridSize, setGridSize] = useState<'small' | 'medium'>(initialSize);
  const [sizeDropdownOpen, setSizeDropdownOpen] = useState(false);

  // When toggles are hidden, force the layout defined by defaultLayout
  const effectiveViewMode = enableViewToggle ? viewMode : initialView;
  const effectiveGridSize = enableViewToggle ? gridSize : initialSize;

  const getCardContainerStyle = () => {
    switch (effectiveGridSize) {
      case 'small':
        return { width: '30%' as const }; // 3 columns
      case 'medium':
      default:
        return { width: '47%' as const }; // 2 columns
    }
  };

  const listContent = useMemo(() => {
    if (loading) {
      return (
        <View style={effectiveViewMode === 'grid' ? styles.grid : styles.list}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={`sk-${i}`} style={effectiveViewMode === 'grid' ? getCardContainerStyle() : styles.listItemContainer}>
              {effectiveViewMode === 'grid' ? (
                <>
                  <SkeletonTile style={{ aspectRatio: 1, width: '100%' }} />
                  <View style={{ height: 8 }} />
                  <SkeletonTile style={{ height: 16, width: '70%' }} rounded={6} />
                  <View style={{ height: 6 }} />
                  <SkeletonTile style={{ height: 14, width: '50%' }} rounded={6} />
                </>
              ) : (
                <View style={styles.listItemSkeleton}>
                  <SkeletonTile style={{ width: 60, height: 60, borderRadius: 8 }} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <SkeletonTile style={{ height: 16, width: '70%', marginBottom: 6 }} rounded={6} />
                    <SkeletonTile style={{ height: 14, width: '50%' }} rounded={6} />
                  </View>
                </View>
              )}
            </View>
          ))}
        </View>
      );
    }

    if (error) return <ThemedText>{error}</ThemedText>;
    if (!plants || plants.length === 0) return <ThemedText>No plants yet.</ThemedText>;

    return (
      <View style={effectiveViewMode === 'grid' ? styles.grid : styles.list}>
        {plants.map((item) => (
          <View key={item.id} style={effectiveViewMode === 'grid' ? getCardContainerStyle() : styles.listItemContainer}>
            {effectiveViewMode === 'grid' ? (
              <FavoritePlantCard
                plant={item}
                size={effectiveGridSize}
                onPress={() => onItemPress?.(item)}
              />
            ) : (
              <TouchableOpacity
                onPress={() => onItemPress?.(item)}
                style={[styles.listItem, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}
                activeOpacity={0.7}
              >
                <Image
                  source={item.imageUri ? { uri: item.imageUri } : undefined}
                  style={styles.listItemImage}
                  contentFit="cover"
                />
                <View style={styles.listItemContent}>
                  <ThemedText style={styles.listItemName}>{item.name}</ThemedText>
                  <ThemedText style={styles.listItemScientific}>{item.scientificName}</ThemedText>
                </View>
                <IconSymbol name="chevron.right" size={20} color={theme.colors.mutedText} />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    );
  }, [plants, loading, error, effectiveViewMode, effectiveGridSize]);

  return (
    <View>
      {/* Header row: Title + Toggle buttons (optional) */}
      {(title || enableViewToggle) && (
        <ThemedView style={styles.titleContainer}>
          {title ? <ThemedText type="title">{title}</ThemedText> : <View />}
          {enableViewToggle && (
            <View style={styles.viewToggle}>
              <TouchableOpacity
                onPress={() => {
                  if (viewMode === 'grid') {
                    setSizeDropdownOpen((s) => !s);
                  } else {
                    setViewMode('grid');
                    setSizeDropdownOpen(false);
                  }
                }}
                style={[
                  styles.gridButton,
                  { borderColor: theme.colors.border },
                  effectiveViewMode === 'grid' && { backgroundColor: theme.colors.primary }
                ]}
              >
                <IconSymbol
                  name="grid"
                  size={18}
                  color={effectiveViewMode === 'grid' ? '#fff' : theme.colors.text}
                />
                {effectiveViewMode === 'grid' && (
                  <>
                    <ThemedText style={[styles.sizeLabel, { color: '#fff' }]}>
                      {effectiveGridSize.charAt(0).toUpperCase()}
                    </ThemedText>
                    <IconSymbol
                      name={sizeDropdownOpen ? 'chevron.up' : 'chevron.down'}
                      size={12}
                      color={'#fff'}
                    />
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setViewMode('list');
                  setSizeDropdownOpen(false);
                }}
                style={[
                  styles.toggleButton,
                  { borderColor: theme.colors.border },
                  effectiveViewMode === 'list' && { backgroundColor: theme.colors.primary }
                ]}
              >
                <IconSymbol
                  name="list"
                  size={18}
                  color={effectiveViewMode === 'list' ? '#fff' : theme.colors.text}
                />
              </TouchableOpacity>
            </View>
          )}
        </ThemedView>
      )}

      {/* Size dropdown */}
      {enableViewToggle && sizeDropdownOpen && (
        <View style={[styles.sizeDropdown, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}>
          {(['small', 'medium'] as const).map((size) => (
            <TouchableOpacity
              key={size}
              onPress={() => {
                setGridSize(size);
                setSizeDropdownOpen(false);
              }}
              style={[
                styles.sizeDropdownItem,
                { backgroundColor: effectiveGridSize === size ? theme.colors.input : 'transparent' }
              ]}
            >
              <ThemedText style={styles.sizeDropdownText}>
                {size.charAt(0).toUpperCase()} - {size}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Search (optional) */}
      {enableSearch && (
        <View style={styles.searchWrapper}>
          <TextInput
            value={searchValue}
            onChangeText={onSearchChange}
            placeholder={searchPlaceholder}
            placeholderTextColor={theme.colors.mutedText}
            style={[
              styles.searchInput,
              { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }
            ]}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
      )}

      {/* Content */}
      <View style={styles.contentWrapper}>
        {listContent}
      </View>

      {/* Pull-to-refresh support (wrap this component in a ScrollView that uses refreshing/onRefresh) */}
      {/* Note: If you need internal <ScrollView>, you can pipe refreshing/onRefresh into it here.
          Since your parent ParallaxScrollView already handles it, we keep this component presentational. */}
    </View>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchWrapper: {
    marginTop: 20,               // ⬅️ new
    marginBottom: 20,            // ⬅️ new
  },
  contentWrapper: {
    paddingTop: 4,              // ⬅️ new
    paddingBottom: 16,          // ⬅️ new
  },
  viewToggle: {
    flexDirection: 'row',
    gap: 4,
  },
  toggleButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    minWidth: 36,
    height: 36,
    justifyContent: 'center',
  },
  sizeLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  sizeDropdown: {
    position: 'absolute',
    top: 60,
    right: 16,
    zIndex: 100,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 120,
    overflow: 'hidden',
  },
  sizeDropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sizeDropdownText: {
    fontSize: 14,
    fontWeight: '500',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  list: {
    gap: 8,
  },
  searchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  listItemContainer: {
    width: '100%',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  listItemImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  listItemContent: {
    flex: 1,
    marginLeft: 12,
  },
  listItemName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  listItemScientific: {
    fontSize: 14,
    opacity: 0.7,
    fontStyle: 'italic',
  },
  listItemSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
});
