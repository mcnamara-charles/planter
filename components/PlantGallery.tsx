import React, { useMemo, useState, useCallback, memo, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, FlatList, Text } from 'react-native';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import FavoritePlantCard from '@/components/favorite-plant-card';
import SkeletonTile from '@/components/SkeletonTile';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/context/themeContext';
import { type Plant } from '@/types/plant';

type LayoutPreset = 'gridsmall' | 'gridmed' | 'list';
type GroupByOption = 'none' | 'location' | 'genus';

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

  // Group By functionality
  groupBy?: GroupByOption;         // 'none' | 'location' | 'genus' (default: 'none')
  onGroupByChange?: (groupBy: GroupByOption) => void;
  defaultGroupBy?: GroupByOption;  // Initial group by value (default: 'none')

  // Selection (for external toolbar)
  onSelectionChange?: (selectedIds: string[]) => void;
  // Allow parent to clear selection externally
  clearSelectionTrigger?: number;
  
  // Viewport for image rendering optimization
  viewportBounds?: { top: number; bottom: number };
};

// Memoized list item component to prevent unnecessary re-renders
const PlantListItem = memo(({ 
  item, 
  viewMode, 
  gridSize, 
  cardStyle, 
  onPress,
  onLongPress,
  theme,
  index,
  totalItems,
  isSelected,
  shouldLoadImage = true,
  onLayout
}: {
  item: Plant;
  viewMode: 'grid' | 'list';
  gridSize: 'small' | 'medium';
  cardStyle: any;
  onPress: (plant: Plant) => void;
  onLongPress?: (plant: Plant) => void;
  theme: any;
  index: number;
  totalItems: number;
  isSelected?: boolean;
  shouldLoadImage?: boolean;
  onLayout?: (event: any) => void;
}) => {
  const handlePress = useCallback(() => {
    onPress(item);
  }, [item, onPress]);

  const handleLongPress = useCallback(() => {
    if (onLongPress) {
      onLongPress(item);
    }
  }, [item, onLongPress]);
  
  
  // Use viewport-based rendering - only render images when in viewport
  // shouldLoadImage prop is passed from parent based on viewport detection

  if (viewMode === 'grid') {
    return (
      <View style={cardStyle} onLayout={onLayout}>
        <FavoritePlantCard
          plant={item}
          size={gridSize}
          onPress={handlePress}
          onLongPress={onLongPress ? handleLongPress : undefined}
          shouldLoadImage={shouldLoadImage}
          isSelected={isSelected}
        />
      </View>
    );
  }

  return (
    <View style={styles.listItemContainer} onLayout={onLayout}>
      <TouchableOpacity
        onPress={handlePress}
        onLongPress={onLongPress ? handleLongPress : undefined}
        delayLongPress={250}
        style={[styles.listItem, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}
        activeOpacity={0.7}
      >
        <View style={styles.listItemImageContainer}>
          {shouldLoadImage ? (
            <Image
              source={item.imageUri ? { uri: item.imageUri } : undefined}
              style={styles.listItemImage}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={item.id}
              priority={index < 12 ? "normal" : "low"}
              transition={100}
            />
          ) : (
            <View style={[styles.listItemImage, { backgroundColor: 'rgba(120,120,120,0.12)' }]} />
          )}
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
        <View style={styles.listItemContent}>
          <View style={styles.listItemNameRow}>
            <View style={[styles.lineageChip, item.hasActivePest && styles.lineageChipPest]}>
              {item.lightType === 'grow_light' && (
                <IconSymbol name="light.grow" size={10} color="#fff" style={{ marginRight: 2 }} />
              )}
              {item.systemType === 'reservoir' && (
                <IconSymbol name="drop" size={10} color="#fff" style={{ marginRight: 3 }} />
              )}
              <Text style={styles.lineageText}>{item.lineage?.trim() || 'A'}</Text>
            </View>
            <ThemedText style={styles.listItemName}>{item.name}</ThemedText>
          </View>
          <ThemedText style={styles.listItemScientific}>{item.scientificName}</ThemedText>
        </View>
        <IconSymbol name="chevron.right" size={20} color={theme.colors.mutedText} />
      </TouchableOpacity>
    </View>
  );
}, (prevProps, nextProps) => {
  // Only re-render if plant data, view mode, grid size, or index changes
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.name === nextProps.item.name &&
    prevProps.item.scientificName === nextProps.item.scientificName &&
    prevProps.item.imageUri === nextProps.item.imageUri &&
    prevProps.item.lineage === nextProps.item.lineage &&
    prevProps.item.lightType === nextProps.item.lightType &&
    prevProps.item.systemType === nextProps.item.systemType &&
    prevProps.item.hasActivePest === nextProps.item.hasActivePest &&
    prevProps.viewMode === nextProps.viewMode &&
    prevProps.gridSize === nextProps.gridSize &&
    prevProps.index === nextProps.index &&
    prevProps.isSelected === nextProps.isSelected
  );
});


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

  groupBy = 'none',
  onGroupByChange,
  defaultGroupBy = 'none',
  onSelectionChange,
  clearSelectionTrigger,
  viewportBounds = { top: 0, bottom: 0 },
}: PlantGalleryProps) {
  const { theme } = useTheme();

  // Derive initial view & size from defaultLayout
  const initialView = defaultLayout === 'list' ? 'list' : 'grid';
  const initialSize = defaultLayout === 'gridsmall' ? 'small' : 'medium';

  const [viewMode, setViewMode] = useState<'grid' | 'list'>(initialView);
  const [gridSize, setGridSize] = useState<'small' | 'medium'>(initialSize);
  const [sizeDropdownOpen, setSizeDropdownOpen] = useState(false);
  const [groupByDropdownOpen, setGroupByDropdownOpen] = useState(false);
  const [selectedPlantIds, setSelectedPlantIds] = useState<Record<string, boolean>>({});
  const selectionModeRef = useRef(false);
  
  // Track item positions for viewport-based rendering
  const itemPositionsRef = useRef<Map<string, { top: number; bottom: number }>>(new Map());
  const containerOffsetRef = useRef<number>(0);

  // When toggles are hidden, force the layout defined by defaultLayout
  const effectiveViewMode = enableViewToggle ? viewMode : initialView;
  const effectiveGridSize = enableViewToggle ? gridSize : initialSize;

  const getCardContainerStyle = useCallback(() => {
    switch (effectiveGridSize) {
      case 'small':
        // For 3 columns with 8px gap: each card should be roughly 1/3 of container
        // Accounting for 2 gaps (16px total), use ~31% to ensure proper wrapping
        return { width: '31%' as const }; // 3 columns, accounts for gap spacing
      case 'medium':
      default:
        // For 2 columns with 8px gap: each card should be roughly 50% of container
        // Accounting for 1 gap (8px), use ~48% to ensure proper wrapping
        return { width: '48%' as const }; // 2 columns, accounts for gap spacing
    }
  }, [effectiveGridSize]);
  

  // Helper function to get grouping key for plants
  const getGroupKey = (plant: Plant): string => {
    switch (groupBy) {
      case 'location':
        return plant.location || 'No Location';
      case 'genus':
        return plant.genus || 'Unknown Genus';
      default:
        return '';
    }
  };

  // Group plants based on current groupBy setting
  const groupedPlants = useMemo(() => {
    if (!plants || plants.length === 0) {
      return {};
    }
    
    if (groupBy === 'none') {
      const result = { '': plants };
      return result;
    }

    const groups: Record<string, Plant[]> = {};
    // Use for loop instead of forEach for better performance
    for (let i = 0; i < plants.length; i++) {
      const plant = plants[i];
      const key = getGroupKey(plant);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(plant);
    }

    // Sort groups alphabetically, but put "No Location" and "Unknown Genus" at the bottom
    const sortedGroups: Record<string, Plant[]> = {};
    const fallbackKeys = ['No Location', 'Unknown Genus'];
    const groupKeys = Object.keys(groups);
    
    // First, add all non-fallback groups in alphabetical order
    for (let i = 0; i < groupKeys.length; i++) {
      const key = groupKeys[i];
      if (!fallbackKeys.includes(key)) {
        sortedGroups[key] = groups[key];
      }
    }
    
    // Sort non-fallback keys
    const sortedNonFallbackKeys = Object.keys(sortedGroups).sort();
    const finalSorted: Record<string, Plant[]> = {};
    for (let i = 0; i < sortedNonFallbackKeys.length; i++) {
      const key = sortedNonFallbackKeys[i];
      finalSorted[key] = sortedGroups[key];
    }
    
    // Then add fallback groups at the bottom
    for (let i = 0; i < fallbackKeys.length; i++) {
      const fallbackKey = fallbackKeys[i];
      if (groups[fallbackKey]) {
        finalSorted[fallbackKey] = groups[fallbackKey];
      }
    }

    return finalSorted;
  }, [plants, groupBy]);

  const selectedPlantIdList = useMemo(
    () => Object.keys(selectedPlantIds),
    [selectedPlantIds]
  );

  const selectionMode = selectedPlantIdList.length > 0;
  const selectionCount = selectedPlantIdList.length;

  // Keep ref in sync with selection mode
  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  const toggleSelectionForPlant = useCallback((plantId: string) => {
    setSelectedPlantIds((prev) => {
      const next = { ...prev };
      if (next[plantId]) {
        delete next[plantId];
      } else {
        next[plantId] = true;
      }
      // Notify parent of selection change
      if (onSelectionChange) {
        onSelectionChange(Object.keys(next));
      }
      return next;
    });
  }, [onSelectionChange]);

  const clearSelection = useCallback(() => {
    setSelectedPlantIds({});
    if (onSelectionChange) {
      onSelectionChange([]);
    }
  }, [onSelectionChange]);

  // Memoized handler to prevent re-renders
  const handleItemPress = useCallback((plant: Plant) => {
    // If in selection mode, toggle selection instead of navigating
    if (selectionModeRef.current) {
      toggleSelectionForPlant(plant.id);
      return;
    }
    onItemPress?.(plant);
  }, [onItemPress, toggleSelectionForPlant]);

  const handleItemLongPress = useCallback((plant: Plant) => {
    toggleSelectionForPlant(plant.id);
  }, [toggleSelectionForPlant]);
  
  // Pre-calculate global indices for all items to avoid recalculating in map
  // This must be at the top level, not inside useMemo
  const globalIndices = useMemo(() => {
    const indices = new Map<string, number>();
    let currentIndex = 0;
    Object.values(groupedPlants).forEach(groupPlants => {
      groupPlants.forEach(plant => {
        indices.set(plant.id, currentIndex++);
      });
    });
    return indices;
  }, [groupedPlants]);

  // Helper to check if item is in viewport (with buffer for smoother scrolling)
  // Must be defined at top level, not inside useMemo
  // On medium grid: max 6 items on screen (2 columns, 3 rows)
  // On small grid: max ~9 items on screen (3 columns, ~3 rows)
  const isItemInViewport = useCallback((itemId: string) => {
    const position = itemPositionsRef.current.get(itemId);
    
    // If viewport hasn't been measured yet (still at 0,0), render first items
    // Render more items initially for small grid (3 columns) vs medium (2 columns)
    if (viewportBounds.top === 0 && viewportBounds.bottom === 0) {
      // For initial render, be more conservative - render first batch
      // This will be refined once viewport is measured
      return true;
    }
    
    // If position not yet measured, default to true (will be measured on layout)
    if (!position) return true;
    
    // Calculate buffer based on grid size and estimated item height
    // Medium: 6 items max = ~3 rows, Small: ~9 items max = ~3 rows
    // Estimate item height: portrait aspect ratio 0.75, so if width is ~48% or 31%, 
    // height would be roughly 1.33x width. For a typical screen, estimate ~200-250px per item
    // Buffer should be ~2-3 rows worth to preload ahead/behind
    const estimatedItemHeight = effectiveGridSize === 'small' ? 200 : 250;
    const buffer = estimatedItemHeight * 2.5; // ~2.5 rows buffer for smooth scrolling
    
    const adjustedViewportTop = viewportBounds.top - buffer;
    const adjustedViewportBottom = viewportBounds.bottom + buffer;
    
    // Item is in viewport if it overlaps with the adjusted viewport
    return !(position.bottom < adjustedViewportTop || position.top > adjustedViewportBottom);
  }, [viewportBounds, effectiveGridSize]);

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

    const cardContainerStyle = getCardContainerStyle();

    // Render grouped content
    return (
      <View 
        removeClippedSubviews={true}
        onLayout={(event) => {
          const { y } = event.nativeEvent.layout;
          containerOffsetRef.current = y;
        }}
      >
        {Object.entries(groupedPlants).map(([groupKey, groupPlants]) => {
          // Safety check for groupPlants
          if (!groupPlants || !Array.isArray(groupPlants)) {
            return null;
          }
          
          return (
          <View key={groupKey} style={styles.groupSection} removeClippedSubviews={true}>
            {groupKey && (
              <ThemedText style={styles.groupTitle}>{groupKey}</ThemedText>
            )}
            <View style={effectiveViewMode === 'grid' ? styles.grid : styles.list}>
              {groupPlants.map((item) => {
                const globalIndex = globalIndices.get(item.id) ?? 0;
                const shouldLoadImage = isItemInViewport(item.id);
                
                return (
                  <PlantListItem
                    key={item.id}
                    item={item}
                    viewMode={effectiveViewMode}
                    gridSize={effectiveGridSize}
                    cardStyle={effectiveViewMode === 'grid' ? cardContainerStyle : undefined}
                    onPress={handleItemPress}
                    onLongPress={handleItemLongPress}
                    theme={theme}
                    index={globalIndex}
                    totalItems={plants?.length ?? 0}
                    isSelected={selectedPlantIds[item.id] === true}
                    shouldLoadImage={shouldLoadImage}
                    onLayout={(event) => {
                      const { y, height } = event.nativeEvent.layout;
                      const pageY = y + containerOffsetRef.current;
                      itemPositionsRef.current.set(item.id, {
                        top: pageY,
                        bottom: pageY + height,
                      });
                    }}
                  />
                );
              })}
            </View>
          </View>
          );
        })}
      </View>
    );
  }, [plants, loading, error, effectiveViewMode, effectiveGridSize, groupedPlants, handleItemPress, handleItemLongPress, theme, getCardContainerStyle, globalIndices, selectedPlantIds, isItemInViewport, viewportBounds]);

  // Notify parent when selection changes
  useEffect(() => {
    if (onSelectionChange) {
      onSelectionChange(selectedPlantIdList);
    }
  }, [selectedPlantIdList, onSelectionChange]);

  // Clear selection when parent triggers it
  useEffect(() => {
    if (clearSelectionTrigger !== undefined && clearSelectionTrigger > 0) {
      setSelectedPlantIds({});
      if (onSelectionChange) {
        onSelectionChange([]);
      }
    }
  }, [clearSelectionTrigger, onSelectionChange]);

  return (
    <View>
      {/* Header row: Group By + Toggle buttons */}
      <ThemedView style={styles.titleContainer}>
        {/* Group By Dropdown */}
        <View style={styles.groupByContainer}>
          <TouchableOpacity
            style={[styles.groupByButton, { borderColor: theme.colors.border }]}
            onPress={() => setGroupByDropdownOpen(!groupByDropdownOpen)}
            accessibilityRole="button"
            accessibilityLabel="Group by selector"
          >
            <ThemedText style={styles.groupByLabel}>
              Group By: {groupBy === 'none' ? 'No Group' : groupBy === 'location' ? 'By Location' : 'By Genus'}
            </ThemedText>
            <IconSymbol name="chevron.down" size={16} color={theme.colors.mutedText} />
          </TouchableOpacity>

          {groupByDropdownOpen && (
            <View style={[styles.groupByDropdown, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
              <TouchableOpacity
                style={styles.groupByDropdownItem}
                onPress={() => {
                  onGroupByChange?.('none');
                  setGroupByDropdownOpen(false);
                }}
              >
                <ThemedText style={styles.groupByDropdownText}>No Group</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.groupByDropdownItem}
                onPress={() => {
                  onGroupByChange?.('location');
                  setGroupByDropdownOpen(false);
                }}
              >
                <ThemedText style={styles.groupByDropdownText}>By Location</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.groupByDropdownItem}
                onPress={() => {
                  onGroupByChange?.('genus');
                  setGroupByDropdownOpen(false);
                }}
              >
                <ThemedText style={styles.groupByDropdownText}>By Genus</ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* View Toggle */}
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
    gap: 12,
  },
  groupByContainer: {
    position: 'relative',
    flex: 1,
  },
  groupByButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    backgroundColor: 'transparent',
    height: 36,
  },
  groupByLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  groupByDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 100,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  groupByDropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  groupByDropdownText: {
    fontSize: 14,
    fontWeight: '500',
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
    gap: 8,
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
    gap: 8, // Reduced from 12 to make cards wider
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
  listItemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  listItemName: {
    fontSize: 16,
    fontWeight: '600',
  },
  lineageChip: {
    backgroundColor: 'rgba(10, 132, 255, 0.8)', // Blue translucent
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    minWidth: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineageChipPest: {
    backgroundColor: 'rgba(239, 68, 68, 0.8)', // Red translucent for active pest
  },
  lineageText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 12,
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
  groupSection: {
    marginBottom: 24,
  },
  groupTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
    opacity: 0.9,
  },
  selectionToolbar: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 1000,
    elevation: 10,
  },
  selectionToolbarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  selectionToolbarClear: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3B82F6',
    marginTop: 4,
  },
  selectionToolbarActions: {
    flexDirection: 'row',
    gap: 8,
  },
  selectionToolbarButton: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 0,
    width: 88,
  },
  selectionToolbarButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.8,
    textAlign: 'center',
  },
  selectionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    borderRadius: 8,
  },
  listItemImageContainer: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
});
