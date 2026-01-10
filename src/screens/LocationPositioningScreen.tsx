import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, View, Dimensions, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Alert, Pressable } from 'react-native';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import TopBar from '@/components/TopBar';
import { useTheme } from '@/context/themeContext';
import { useNavigation, useRoute } from '@react-navigation/native';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Image } from 'expo-image';
import { supabase } from '@/services/supabaseClient';
import { useAuth } from '@/context/AuthContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CELL_SIZE = 80; // Base cell size in pixels
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

type GridCell = {
  row: number;
  col: number;
};

type PlantPosition = {
  id: string; // user_plant_id
  gridRow: number;
  gridCol: number;
  x: number; // Position within cell (0-80, centered at 40)
  y: number; // Position within cell (0-80, centered at 40)
  size: number; // Radius in pixels (min: 10, max: 35)
};

type AvailablePlant = {
  id: string;
  nickname: string | null;
  plantName: string | null;
  imageUri: string | null;
};

export default function LocationPositioningScreen() {
  const nav = useNavigation() as any;
  const route = useRoute() as any;
  const { theme } = useTheme();
  const { user } = useAuth();
  const locationId = route.params?.locationId;
  const locationName = route.params?.locationName || 'Location';

  // Grid state - starts as 1x1 at position (0,0)
  const [gridCells, setGridCells] = useState<GridCell[]>([{ row: 0, col: 0 }]);
  
  // Plant state
  const [plantPositions, setPlantPositions] = useState<PlantPosition[]>([]);
  const [availablePlants, setAvailablePlants] = useState<AvailablePlant[]>([]);
  const [loadingPlants, setLoadingPlants] = useState(true);
  const [showPlantPicker, setShowPlantPicker] = useState(false);
  
  // Transform state - start at origin
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Pan gesture - accumulates translation for grid
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Pinch gesture for zoom
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = savedScale.value * e.scale;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      // Clamp to min/max on end
      if (scale.value < MIN_ZOOM) {
        scale.value = withTiming(MIN_ZOOM);
        savedScale.value = MIN_ZOOM;
      } else if (scale.value > MAX_ZOOM) {
        scale.value = withTiming(MAX_ZOOM);
        savedScale.value = MAX_ZOOM;
      }
    });

  // Combined gesture for grid
  const gridGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Fetch available plants for this location
  useEffect(() => {
    if (!locationId || !user?.id) return;

    const fetchPlants = async () => {
      try {
        setLoadingPlants(true);
        const { data, error } = await supabase
          .from('user_plants')
          .select(`
            id,
            nickname,
            plants:plants_table_id (
              plant_name
            ),
            photo:user_plant_photos!user_plants_default_plant_photo_id_fkey (
              id,
              bucket,
              object_path
            )
          `)
          .eq('owner_id', user.id)
          .eq('location_id', locationId)
          .is('deceased_at', null);

        if (error) throw error;

        const plants: AvailablePlant[] = (data || []).map((row: any) => {
          let imageUri: string | null = null;
          if (row.photo && row.photo.length > 0) {
            const photo = row.photo[0];
            imageUri = supabase.storage
              .from(photo.bucket || 'plant-photos')
              .getPublicUrl(photo.object_path).data?.publicUrl || null;
          }

          return {
            id: row.id,
            nickname: row.nickname,
            plantName: row.plants?.plant_name || null,
            imageUri,
          };
        });

        setAvailablePlants(plants);
      } catch (err: any) {
        console.error('Failed to fetch plants:', err);
        Alert.alert('Error', 'Failed to load plants');
      } finally {
        setLoadingPlants(false);
      }
    };

    fetchPlants();
  }, [locationId, user?.id]);

  const addCell = useCallback((newCell: GridCell) => {
    setGridCells((prev) => {
      // Check if cell already exists
      const exists = prev.some(c => c.row === newCell.row && c.col === newCell.col);
      if (exists) return prev;

      return [...prev, newCell];
    });
  }, []);

  // Calculate center of grid
  const gridCenter = React.useMemo(() => {
    if (gridCells.length === 0) return { row: 0, col: 0 };
    
    const rows = gridCells.map(c => c.row);
    const cols = gridCells.map(c => c.col);
    const centerRow = Math.round((Math.min(...rows) + Math.max(...rows)) / 2);
    const centerCol = Math.round((Math.min(...cols) + Math.max(...cols)) / 2);
    
    // Find the cell closest to center
    return { row: centerRow, col: centerCol };
  }, [gridCells]);

  const addPlantToGrid = useCallback((plantId: string) => {
    setPlantPositions((prev) => {
      // Check if plant already exists
      if (prev.some(p => p.id === plantId)) return prev;

      // Add plant centered in grid center cell with default size
      return [...prev, {
        id: plantId,
        gridRow: gridCenter.row,
        gridCol: gridCenter.col,
        x: CELL_SIZE / 2, // Center of cell
        y: CELL_SIZE / 2,
        size: 20, // Default radius
      }];
    });
    setShowPlantPicker(false);
  }, [gridCenter]);

  const updatePlantPosition = useCallback((plantId: string, newGridRow: number, newGridCol: number, x: number, y: number) => {
    setPlantPositions((prev) =>
      prev.map((p) => (p.id === plantId ? { ...p, gridRow: newGridRow, gridCol: newGridCol, x, y } : p))
    );
  }, []);

  const updatePlantSize = useCallback((plantId: string, size: number) => {
    // Allow plants up to 4x4 grid cells (320px diameter = 160px radius)
    const clampedSize = Math.max(10, Math.min(160, size)); // Min 10, max 160 radius
    setPlantPositions((prev) =>
      prev.map((p) => (p.id === plantId ? { ...p, size: clampedSize } : p))
    );
  }, []);

  const handleSave = useCallback(() => {
    // Mock save functionality for now
    Alert.alert('Save', 'Save functionality coming soon!');
  }, []);

  const handleAddPlant = useCallback(() => {
    setShowPlantPicker(true);
  }, []);


  // Calculate all possible new cell positions (neighbors of existing cells that don't exist)
  const possibleNewCells = React.useMemo(() => {
    const newCells: GridCell[] = [];
    const existingCellsSet = new Set(gridCells.map(c => `${c.row},${c.col}`));
    
    gridCells.forEach((cell) => {
      // Check each direction for missing neighbors
      const neighbors = [
        { row: cell.row - 1, col: cell.col }, // up
        { row: cell.row + 1, col: cell.col }, // down
        { row: cell.row, col: cell.col - 1 }, // left
        { row: cell.row, col: cell.col + 1 }, // right
      ];

      neighbors.forEach((neighbor) => {
        const key = `${neighbor.row},${neighbor.col}`;
        if (!existingCellsSet.has(key)) {
          // Check if we've already added this position
          if (!newCells.some(c => c.row === neighbor.row && c.col === neighbor.col)) {
            newCells.push(neighbor);
          }
        }
      });
    });

    return newCells;
  }, [gridCells]);

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title={`Position: ${locationName}`}
        isFavorite={false}
        hideActions
        onBack={() => nav.goBack()}
        onToggleFavorite={() => {}}
        onToggleMenu={() => {}}
      />

      <GestureHandlerRootView style={styles.gridContainer}>
        <View style={StyleSheet.absoluteFillObject}>
          <GestureDetector gesture={gridGesture}>
            <Animated.View style={[styles.gridWrapper, animatedStyle]}>
            {/* Grid cells - positioned relative to center */}
            {gridCells.map((cell) => {
              // Position cells relative to center of wrapper
              // Center is at (SCREEN_WIDTH * 2.5, SCREEN_HEIGHT * 2.5)
              const centerX = SCREEN_WIDTH * 2.5;
              const centerY = SCREEN_HEIGHT * 2.5;
              const x = centerX + (cell.col * CELL_SIZE) - (CELL_SIZE / 2);
              const y = centerY + (cell.row * CELL_SIZE) - (CELL_SIZE / 2);
              
              // Check for adjacent cells to determine which corners should be rounded
              const hasTop = gridCells.some(c => c.row === cell.row - 1 && c.col === cell.col);
              const hasBottom = gridCells.some(c => c.row === cell.row + 1 && c.col === cell.col);
              const hasLeft = gridCells.some(c => c.row === cell.row && c.col === cell.col - 1);
              const hasRight = gridCells.some(c => c.row === cell.row && c.col === cell.col + 1);
              
              // A corner is rounded only if both adjacent edges are exposed
              const borderTopLeftRadius = (!hasTop && !hasLeft) ? 8 : 0;
              const borderTopRightRadius = (!hasTop && !hasRight) ? 8 : 0;
              const borderBottomLeftRadius = (!hasBottom && !hasLeft) ? 8 : 0;
              const borderBottomRightRadius = (!hasBottom && !hasRight) ? 8 : 0;
              
              return (
                <View
                  key={`${cell.row}-${cell.col}`}
                  style={[
                    styles.gridCell,
                    {
                      left: x,
                      top: y,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.card,
                      borderTopLeftRadius,
                      borderTopRightRadius,
                      borderBottomLeftRadius,
                      borderBottomRightRadius,
                    },
                  ]}
                >
                  {/* 12x12 grid pattern */}
                  {Array.from({ length: 11 }).map((_, i) => {
                    const linePos = ((i + 1) * CELL_SIZE) / 12;
                    return (
                      <React.Fragment key={i}>
                        {/* Horizontal line */}
                        <View
                          style={[
                            styles.gridLine,
                            {
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              top: linePos,
                              height: StyleSheet.hairlineWidth,
                              backgroundColor: theme.colors.border,
                              opacity: 0.3,
                            },
                          ]}
                        />
                        {/* Vertical line */}
                        <View
                          style={[
                            styles.gridLine,
                            {
                              position: 'absolute',
                              top: 0,
                              bottom: 0,
                              left: linePos,
                              width: StyleSheet.hairlineWidth,
                              backgroundColor: theme.colors.border,
                              opacity: 0.3,
                            },
                          ]}
                        />
                      </React.Fragment>
                    );
                  })}
                </View>
              );
            })}

            {/* Add cell buttons at positions where new cells can be created */}
            {possibleNewCells.map((cell) => {
              const centerX = SCREEN_WIDTH * 2.5;
              const centerY = SCREEN_HEIGHT * 2.5;
              const x = centerX + (cell.col * CELL_SIZE) - (CELL_SIZE / 2);
              const y = centerY + (cell.row * CELL_SIZE) - (CELL_SIZE / 2);
              
              return (
                <TouchableOpacity
                  key={`new-${cell.row}-${cell.col}`}
                  style={[
                    styles.addButton,
                    {
                      position: 'absolute',
                      left: x + (CELL_SIZE / 2) - 12, // Center the 24x24 button
                      top: y + (CELL_SIZE / 2) - 12,
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      zIndex: 100, // Ensure buttons are above background
                    },
                  ]}
                  onPress={() => addCell(cell)}
                >
                  <ThemedText style={styles.addButtonText}>+</ThemedText>
                </TouchableOpacity>
              );
            })}

            {/* Plants - rendered outside cells so they can overflow */}
            {plantPositions.map((plant) => (
              <PlantPot
                key={plant.id}
                plant={availablePlants.find(ap => ap.id === plant.id)}
                position={plant}
                onPositionUpdate={(newGridRow, newGridCol, x, y) => updatePlantPosition(plant.id, newGridRow, newGridCol, x, y)}
                onSizeUpdate={(size) => updatePlantSize(plant.id, size)}
                gridCells={gridCells}
              />
            ))}
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>

      {/* Floating action bar */}
      <View style={[styles.actionBar, { backgroundColor: theme.colors.card, borderTopColor: theme.colors.border }]}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: theme.colors.input, borderColor: theme.colors.border }]}
          onPress={handleSave}
        >
          <ThemedText style={styles.actionButtonText}>Save</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]}
          onPress={handleAddPlant}
        >
          <ThemedText style={[styles.actionButtonText, { color: '#fff' }]}>Add Plant</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Plant Picker Modal */}
      <Modal
        visible={showPlantPicker}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowPlantPicker(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Add Plant</ThemedText>
              <TouchableOpacity
                onPress={() => {
                  setShowPlantPicker(false);
                }}
              >
                <IconSymbol name="xmark.circle.fill" size={24} color={theme.colors.text} />
              </TouchableOpacity>
            </View>

            {loadingPlants ? (
              <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginVertical: 40 }} />
            ) : availablePlants.length === 0 ? (
              <ThemedText style={[styles.emptyText, { color: theme.colors.mutedText }]}>
                No plants available in this location
              </ThemedText>
            ) : (
              <ScrollView style={styles.plantsList}>
                {availablePlants
                  .filter(plant => !plantPositions.some(p => p.id === plant.id))
                  .map((plant) => (
                    <TouchableOpacity
                      key={plant.id}
                      style={[styles.plantItem, { borderColor: theme.colors.border }]}
                      onPress={() => addPlantToGrid(plant.id)}
                    >
                      {plant.imageUri ? (
                        <Image source={{ uri: plant.imageUri }} style={styles.plantImage} contentFit="cover" />
                      ) : (
                        <View style={[styles.plantImagePlaceholder, { backgroundColor: theme.colors.input }]}>
                          <IconSymbol name="leaf" size={24} color={theme.colors.mutedText} />
                        </View>
                      )}
                      <ThemedText style={styles.plantName} numberOfLines={1}>
                        {plant.nickname || plant.plantName || 'Unnamed Plant'}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

// Plant Pot Component with drag and resize
function PlantPot({
  plant,
  position,
  onPositionUpdate,
  onSizeUpdate,
  gridCells,
}: {
  plant: AvailablePlant | undefined;
  position: PlantPosition;
  onPositionUpdate: (newGridRow: number, newGridCol: number, x: number, y: number) => void;
  onSizeUpdate: (size: number) => void;
  gridCells: GridCell[];
}) {
  const { theme } = useTheme();
  const [isDragging, setIsDragging] = useState(false);

  const centerX = SCREEN_WIDTH * 2.5;
  const centerY = SCREEN_HEIGHT * 2.5;
  const cellX = centerX + (position.gridCol * CELL_SIZE) - (CELL_SIZE / 2);
  const cellY = centerY + (position.gridRow * CELL_SIZE) - (CELL_SIZE / 2);
  const absoluteX = cellX + position.x;
  const absoluteY = cellY + position.y;

  const startX = useSharedValue(absoluteX);
  const startY = useSharedValue(absoluteY);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Track if we're currently dragging to prevent useEffect from interfering
  const isDraggingRef = React.useRef(false);
  
  // Track initial size for resize gesture
  const initialSizeRef = React.useRef(position.size);

  // Update initial size when position.size changes (when not dragging)
  React.useEffect(() => {
    if (!isDraggingRef.current) {
      initialSizeRef.current = position.size;
    }
  }, [position.size]);

  // Update start position when position prop changes - only when not dragging
  React.useEffect(() => {
    if (!isDraggingRef.current) {
      const newCellX = centerX + (position.gridCol * CELL_SIZE) - (CELL_SIZE / 2);
      const newCellY = centerY + (position.gridRow * CELL_SIZE) - (CELL_SIZE / 2);
      const newAbsoluteX = newCellX + position.x;
      const newAbsoluteY = newCellY + position.y;
      startX.value = newAbsoluteX;
      startY.value = newAbsoluteY;
      translateX.value = 0;
      translateY.value = 0;
    }
  }, [position.x, position.y, position.gridRow, position.gridCol]);

  // Pan gesture for dragging - allows 1-2 pointers (first finger always drags)
  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .onStart(() => {
      isDraggingRef.current = true;
      runOnJS(setIsDragging)(true);
      const cellX = centerX + (position.gridCol * CELL_SIZE) - (CELL_SIZE / 2);
      const cellY = centerY + (position.gridRow * CELL_SIZE) - (CELL_SIZE / 2);
      const absoluteX = cellX + position.x;
      const absoluteY = cellY + position.y;
      startX.value = absoluteX;
      startY.value = absoluteY;
      translateX.value = 0;
      translateY.value = 0;
    })
    .onUpdate((e) => {
      // Always use the first finger's translation for dragging
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd(() => {
      const finalAbsoluteX = startX.value + translateX.value;
      const finalAbsoluteY = startY.value + translateY.value;
      
      // Calculate which cell and position within that cell
      const finalCellCol = Math.round((finalAbsoluteX - centerX) / CELL_SIZE);
      const finalCellRow = Math.round((finalAbsoluteY - centerY) / CELL_SIZE);
      const finalCellX = centerX + (finalCellCol * CELL_SIZE) - (CELL_SIZE / 2);
      const finalCellY = centerY + (finalCellRow * CELL_SIZE) - (CELL_SIZE / 2);
      const finalX = finalAbsoluteX - finalCellX;
      const finalY = finalAbsoluteY - finalCellY;
      
      // Check if target cell exists
      const targetCellExists = gridCells.some(c => c.row === finalCellRow && c.col === finalCellCol);
      if (targetCellExists) {
        startX.value = finalCellX + finalX;
        startY.value = finalCellY + finalY;
        runOnJS(onPositionUpdate)(finalCellRow, finalCellCol, finalX, finalY);
      }
      translateX.value = 0;
      translateY.value = 0;
      isDraggingRef.current = false;
      runOnJS(setIsDragging)(false);
    });

  // Pinch gesture for resizing (two fingers - works simultaneously with pan)
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      initialSizeRef.current = position.size;
    })
    .onUpdate((e: any) => {
      // Use the pinch scale to resize the plant
      const newSize = Math.max(10, Math.min(160, initialSizeRef.current * e.scale));
      runOnJS(onSizeUpdate)(newSize);
    })
    .onEnd(() => {
      // Nothing needed
    });

  // Combine gestures - pan and pinch can work simultaneously
  const combinedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  if (!plant) return null;

  return (
    <GestureDetector gesture={combinedGesture}>
      <Animated.View
        style={[
          styles.plantContainer,
          {
            left: absoluteX - position.size,
            top: absoluteY - position.size,
          },
          animatedStyle,
        ]}
      >
        <View
          style={[
            styles.plantPot,
            {
              width: position.size * 2,
              height: position.size * 2,
              borderRadius: position.size,
              backgroundColor: theme.colors.input,
              borderColor: theme.colors.border,
              borderWidth: StyleSheet.hairlineWidth,
            },
            isDragging && { opacity: 0.8 },
          ]}
        >
          {plant.imageUri ? (
            <Image
              source={{ uri: plant.imageUri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
            />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, styles.plantPlaceholder, { backgroundColor: theme.colors.background }]}>
              <IconSymbol name="leaf" size={position.size * 0.6} color={theme.colors.mutedText} />
            </View>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gridContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  gridWrapper: {
    width: SCREEN_WIDTH * 5, // Allow for panning
    height: SCREEN_HEIGHT * 5,
    position: 'absolute',
    top: -SCREEN_HEIGHT * 2,
    left: -SCREEN_WIDTH * 2,
  },
  gridCell: {
    position: 'absolute',
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden', // Clip grid lines to cell bounds
    // borderRadius is now set dynamically per corner
  },
  gridLine: {
    position: 'absolute',
  },
  addButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  addButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 20,
  },
  plantContainer: {
    position: 'absolute',
    zIndex: 10,
  },
  plantPot: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plantPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.2)',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  plantsList: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  plantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  plantImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  plantImagePlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plantName: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    padding: 40,
    fontSize: 16,
  },
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 40, // Safe area padding
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
  },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

