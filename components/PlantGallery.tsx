import React, { useMemo, useState, useCallback, memo, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, SectionList, FlatList, Text, RefreshControl, SectionListData } from 'react-native';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import FavoritePlantCard from '@/components/favorite-plant-card';
import SkeletonTile from '@/components/SkeletonTile';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/context/themeContext';
import { type Plant } from '@/types/plant';

type LayoutPreset = 'gridsmall' | 'gridmed' | 'list';
type GroupByOption = 'none' | 'location' | 'genus' | 'status';

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
  groupBy?: GroupByOption;         // 'none' | 'location' | 'genus' | 'status' (default: 'none')
  onGroupByChange?: (groupBy: GroupByOption) => void;
  defaultGroupBy?: GroupByOption;  // Initial group by value (default: 'none')

  // Selection (for external toolbar)
  onSelectionChange?: (selectedIds: string[]) => void;
  // Allow parent to clear selection externally
  clearSelectionTrigger?: number;
  
  // Viewport for image rendering optimization
  viewportBounds?: { top: number; bottom: number };
  
  // Scroll position preservation
  scrollPositionRef?: React.RefObject<{ getScrollOffset: () => number; scrollToOffset: (offset: number) => void } | null>;
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
          onLongPress={handleLongPress}
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
        onLongPress={handleLongPress}
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
  scrollPositionRef,
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
  
  // No longer need viewport tracking - VirtualizedLists handle this internally

  // When toggles are hidden, force the layout defined by defaultLayout
  const effectiveViewMode = enableViewToggle ? viewMode : initialView;
  const effectiveGridSize = enableViewToggle ? gridSize : initialSize;
  
  // Refs for scroll position preservation
  const flatListRef = useRef<FlatList>(null);
  const sectionListRef = useRef<SectionList<Plant, { title: string; data: Plant[] }>>(null);
  const scrollOffsetRef = useRef<number>(0);
  
  // Expose scroll position methods to parent
  React.useImperativeHandle(scrollPositionRef, () => ({
    getScrollOffset: () => scrollOffsetRef.current,
    scrollToOffset: (offset: number) => {
      scrollOffsetRef.current = offset;
      if (effectiveViewMode === 'grid' && flatListRef.current) {
        flatListRef.current.scrollToOffset({ offset, animated: false });
      } else if (effectiveViewMode === 'list' && sectionListRef.current) {
        sectionListRef.current.scrollToLocation({ sectionIndex: 0, itemIndex: 0, viewOffset: offset });
      }
    },
  }), [effectiveViewMode]);

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
  const getGroupKey = useCallback((plant: Plant): string => {
    switch (groupBy) {
      case 'location':
        return plant.location || 'No Location';
      case 'genus':
        // Use the genus column directly (now populated from taxonomy in PlantsScreen)
        return plant.genus || 'Unknown Genus';
      case 'status': {
        if (plant.deceasedAt) return 'Deceased';
        if (plant.soldAt) return 'Sold';
        return 'Active';
      }
      default:
        return '';
    }
  }, [groupBy]);

  // Convert grouped plants to SectionList format for virtualization
  const sections = useMemo(() => {
    if (!plants || plants.length === 0) {
      return [];
    }
    
    let groups: Record<string, Plant[]>;
    
    if (groupBy === 'none') {
      groups = { '': plants };
    } else {
      groups = {};
      // Use for loop instead of forEach for better performance
      for (let i = 0; i < plants.length; i++) {
        const plant = plants[i];
        // When grouping by status, filter out active plants
        if (groupBy === 'status') {
          if (!plant.deceasedAt && !plant.soldAt) {
            continue; // Skip active plants
          }
        }
        const key = getGroupKey(plant);
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(plant);
      }
    }

    // Sort groups
    const sortedGroups: Record<string, Plant[]> = {};
    const groupKeys = Object.keys(groups);

    // Special ordering for status groups (only Sold and Deceased, no Active)
    if (groupBy === 'status') {
      const ordered = ['Sold', 'Deceased'];
      const finalSorted: Record<string, Plant[]> = {};

      for (const k of ordered) {
        if (groups[k]) finalSorted[k] = groups[k];
      }

      return Object.entries(finalSorted).map(([title, data]) => ({ title, data }));
    }

    // Default: Sort alphabetically, but put fallbacks at the bottom
    const fallbackKeys = ['No Location', 'Unknown Genus'];
    
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

    // Convert to SectionList format
    return Object.entries(finalSorted).map(([title, data]) => ({
      title,
      data,
    }));
  }, [plants, groupBy, getGroupKey]);
  
  // Keep groupedPlants for backward compatibility (used in globalIndices)
  const groupedPlants = useMemo(() => {
    const result: Record<string, Plant[]> = {};
    for (const section of sections) {
      result[section.title] = section.data;
    }
    return result;
  }, [sections]);

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

  // Render functions for SectionList
  // With SectionList, items are only rendered when visible (virtualization handles this)
  // So we can always load images for rendered items
  const renderSectionHeader = useCallback((info: { section: SectionListData<Plant, { title: string; data: Plant[] }> }) => {
    const section = info.section as { title: string; data: Plant[] };
    if (!section.title) return null;
    // Find section index to determine if it's the first section
    const sectionIndex = sections.findIndex(s => s.title === section.title && s.data === section.data);
    const isFirstSection = sectionIndex === 0;
    return (
      <View style={[styles.groupTitleContainer, isFirstSection && { marginTop: 0 }]}>
        <ThemedText style={styles.groupTitle}>{section.title}</ThemedText>
        <ThemedText style={[styles.groupCount, { color: theme.colors.primary }]}>
          {' '}({section.data.length})
        </ThemedText>
      </View>
    );
  }, [theme.colors.primary, sections]);

  const renderItem = useCallback(({ item }: { item: Plant }) => {
    const globalIndex = globalIndices.get(item.id) ?? 0;
    const cardContainerStyle = getCardContainerStyle();
    
    return (
      <PlantListItem
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
        shouldLoadImage={true} // VirtualizedLists only render visible items, so always load
      />
    );
  }, [effectiveViewMode, effectiveGridSize, getCardContainerStyle, handleItemPress, handleItemLongPress, theme, globalIndices, plants?.length, selectedPlantIds]);

  // For grid mode, we need to render items in rows manually since headers need to span full width
  // Flatten sections into rows: each section becomes [header, ...items in rows]
  const gridData = useMemo(() => {
    if (effectiveViewMode !== 'grid') return [];
    const numCols = effectiveGridSize === 'small' ? 3 : 2;
    const rows: Array<{ type: 'header' | 'row'; title?: string; data?: Plant[]; sectionIndex?: number; items?: Plant[] }> = [];
    
    sections.forEach((section, sectionIndex) => {
      // Add header
      if (section.title) {
        rows.push({ type: 'header', title: section.title, data: section.data, sectionIndex });
      }
      // Add items in rows
      for (let i = 0; i < section.data.length; i += numCols) {
        rows.push({ type: 'row', items: section.data.slice(i, i + numCols), sectionIndex });
      }
    });
    return rows;
  }, [sections, effectiveViewMode, effectiveGridSize]);

  // Renderer for grid mode with manual row layout
  const renderGridItem = useCallback(({ item: rowItem, index: flatIndex }: { item: { type: 'header' | 'row'; title?: string; data?: Plant[]; sectionIndex?: number; items?: Plant[] }; index: number }) => {
    if (rowItem.type === 'header') {
      // Headers span full width - first header has no top margin
      const isFirstHeader = flatIndex === 0;
      return (
        <View style={{ width: '100%', marginTop: isFirstHeader ? 0 : 24, marginBottom: 8 }}>
          {renderSectionHeader({ section: { title: rowItem.title || '', data: rowItem.data || [] } })}
        </View>
      );
    }
    // Render row of items
    const cardContainerStyle = getCardContainerStyle();
    return (
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
        {rowItem.items!.map((plant) => {
          const globalIndex = globalIndices.get(plant.id) ?? 0;
          return (
            <PlantListItem
              key={plant.id}
              item={plant}
              viewMode="grid"
              gridSize={effectiveGridSize}
              cardStyle={cardContainerStyle}
              onPress={handleItemPress}
              onLongPress={handleItemLongPress}
              theme={theme}
              index={globalIndex}
              totalItems={plants?.length ?? 0}
              isSelected={selectedPlantIds[plant.id] === true}
              shouldLoadImage={true}
            />
          );
        })}
        {/* Fill remaining columns with empty views to maintain spacing */}
        {Array.from({ length: (effectiveGridSize === 'small' ? 3 : 2) - rowItem.items!.length }).map((_, i) => (
          <View key={`empty-${i}`} style={cardContainerStyle} />
        ))}
      </View>
    );
  }, [effectiveGridSize, getCardContainerStyle, handleItemPress, handleItemLongPress, theme, globalIndices, plants?.length, selectedPlantIds, renderSectionHeader]);

  const keyExtractor = useCallback((item: Plant) => item.id, []);


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
      <View style={styles.titleContainer}>
        {/* Group By Dropdown */}
        <View style={styles.groupByContainer}>
          <TouchableOpacity
            style={[styles.groupByButton, { borderColor: theme.colors.border }]}
            onPress={() => setGroupByDropdownOpen(!groupByDropdownOpen)}
            accessibilityRole="button"
            accessibilityLabel="Group by selector"
          >
            <ThemedText style={styles.groupByLabel}>
              Group By: {groupBy === 'none' ? 'No Group' : groupBy === 'location' ? 'By Location' : groupBy === 'genus' ? 'By Genus' : 'By Status'}
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
              <TouchableOpacity
                style={styles.groupByDropdownItem}
                onPress={() => {
                  onGroupByChange?.('status');
                  setGroupByDropdownOpen(false);
                }}
              >
                <ThemedText style={styles.groupByDropdownText}>By Status</ThemedText>
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
      </View>

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

      {/* Content - Use SectionList for virtualization */}
      {loading ? (
        <View style={[effectiveViewMode === 'grid' ? styles.grid : styles.list, { paddingHorizontal: 20 }]}>
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
      ) : error ? (
        <ThemedText style={{ paddingHorizontal: 20 }}>{error}</ThemedText>
      ) : !plants || plants.length === 0 ? (
        <ThemedText style={{ paddingHorizontal: 20 }}>No plants yet.</ThemedText>
      ) : effectiveViewMode === 'grid' ? (
          // For grid, use FlatList with numColumns (SectionList doesn't support it)
          // Headers span full width, items use numColumns
          <FlatList
            ref={flatListRef}
            data={gridData}
            renderItem={renderGridItem}
            keyExtractor={(item: { type: 'header' | 'row'; sectionIndex?: number; items?: Plant[]; title?: string }, index: number) => 
              item.type === 'header' ? `header-${item.sectionIndex}` : `row-${item.sectionIndex}-${index}`
            }
            key={`grid-${effectiveGridSize}`}
            contentContainerStyle={{ padding: 20, paddingBottom: 220 }}
            refreshControl={refreshing !== undefined && onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            ) : undefined}
            removeClippedSubviews={true}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            onScroll={(e) => {
              scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
          />
        ) : (
          // For list, use SectionList
          <SectionList
            ref={sectionListRef}
            sections={sections}
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            keyExtractor={keyExtractor}
            key="list"
            contentContainerStyle={[styles.list, { padding: 20, paddingBottom: 70 }]}
            refreshControl={refreshing !== undefined && onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            ) : undefined}
            removeClippedSubviews={true}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            getItemLayout={(data, index) => {
              // Approximate list item height
              const itemHeight = 80;
              return { length: itemHeight, offset: itemHeight * index, index };
            }}
            onScroll={(e) => {
              scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
          />
        )
      }

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
    paddingHorizontal: 20,
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
    marginTop: 20,
    marginBottom: 20,
    paddingHorizontal: 20,
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
    right: 36, // 20px padding + 16px original
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
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  gridRowMedium: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
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
  groupTitleContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 24,
    marginBottom: 8,
  },
  groupTitle: {
    fontSize: 22,
    fontWeight: '700',
    opacity: 0.9,
  },
  groupCount: {
    fontSize: 16,
    fontWeight: '700',
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
