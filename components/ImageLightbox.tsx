import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, View, StyleSheet, Dimensions, FlatList, TouchableOpacity, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

type LightboxImage = { uri: string; id?: string };

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
      if (listRef.current && initialIndex > 0) {
        listRef.current.scrollToIndex({ index: initialIndex, animated: false });
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
      </View>
    </Modal>
  );
}

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
});


