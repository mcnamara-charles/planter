import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Modal, View, StyleSheet, Dimensions, FlatList, TouchableOpacity, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

type LightboxImage = { uri: string; id?: string; dateCreated?: string | null };

type Props = {
  visible: boolean;
  images: LightboxImage[];
  initialIndex?: number;
  onClose: () => void;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ImageLightbox({ visible, images, initialIndex = 0, onClose }: Props) {
  const { theme } = useTheme();
  const [index, setIndex] = useState(initialIndex);
  const listRef = useRef<FlatList<LightboxImage> | null>(null);

  const data = useMemo(() => images ?? [], [images]);

  // Update index when initialIndex changes (e.g., when opening from a different photo)
  useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
    }
  }, [visible, initialIndex]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length) {
      const i = viewableItems[0]?.index ?? 0;
      if (typeof i === 'number') setIndex(i);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 51 }).current;

  const keyExtractor = useCallback((item: LightboxImage, i: number) => item.id ?? `${i}`, []);

  const renderItem = useCallback(({ item }: { item: LightboxImage }) => {
    return (
      <View style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, backgroundColor: 'black' }}>
        <Image
          source={{ uri: item.uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          transition={150}
        />
      </View>
    );
  }, []);

  const onModalShow = useCallback(() => {
    requestAnimationFrame(() => {
      if (listRef.current && initialIndex >= 0) {
        listRef.current.scrollToIndex({ index: initialIndex, animated: false });
        setIndex(initialIndex);
      }
    });
  }, [initialIndex]);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} onShow={onModalShow}>
      <View style={{ flex: 1, backgroundColor: 'black' }}>
        <FlatList
          ref={(r) => (listRef.current = r)}
          data={data}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialNumToRender={1}
          windowSize={3}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig as any}
        />

        {/* Top bar */}
        <View style={[styles.topBar]} pointerEvents="box-none">
          <TouchableOpacity onPress={onClose} style={[styles.btn, { backgroundColor: 'rgba(0,0,0,0.5)', borderColor: 'rgba(255,255,255,0.3)' }]}>
            <ThemedText style={{ color: '#fff', fontWeight: '800' }}>Close</ThemedText>
          </TouchableOpacity>
          {data.length > 1 ? (
            <View style={styles.counterWrap}>
              <ThemedText style={{ color: '#fff', fontWeight: '800' }}>{index + 1}/{data.length}</ThemedText>
            </View>
          ) : null}
        </View>

        {/* Bottom date chip */}
        {data[index]?.dateCreated && (
          <View style={[styles.bottomBar]} pointerEvents="box-none">
            <View style={styles.dateChip}>
              <ThemedText style={styles.dateChipText}>
                {formatDate(data[index]!.dateCreated!)}
              </ThemedText>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const formatDate = (dateString: string | null): string => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  } catch {
    return '';
  }
};

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    top: 36,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  counterWrap: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 36,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  dateChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  dateChipText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});


