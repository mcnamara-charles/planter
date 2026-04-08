// ParallaxScrollView.tsx
import React, { useState, useImperativeHandle, forwardRef } from 'react';
import type { PropsWithChildren, ReactElement } from 'react';
import { RefreshControl, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollOffset,
} from 'react-native-reanimated';

import { ThemedView } from '@/components/themed-view';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';
import ImageLightbox from '@/components/ImageLightbox';

const DEFAULT_HEADER_HEIGHT = 250;

type Props = PropsWithChildren<{
  headerImage: ReactElement;
  headerBackgroundColor: { dark: string; light: string };
  /** optional: customize height */
  headerHeight?: number;
  /** optional: render on top of the header (e.g., skeleton) */
  headerOverlay?: ReactElement | null;
  /** optional: render actions on top of the header (with pointer events enabled) */
  headerActions?: ReactElement | null;
  /** optional: pull-to-refresh */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** optional: enable lightbox for header image */
  enableLightbox?: boolean;
  /** optional: lightbox images (single or multiple) */
  lightboxImages?: { uri: string; id?: string }[];
}>;

export type ParallaxScrollViewRef = {
  scrollTo: (y: number, animated?: boolean) => void;
};

const ParallaxScrollView = forwardRef<ParallaxScrollViewRef, Props>(({
  children,
  headerImage,
  headerBackgroundColor,
  headerHeight = DEFAULT_HEADER_HEIGHT,
  headerOverlay = null,
  headerActions = null,
  refreshing = false,
  onRefresh,
  enableLightbox = false,
  lightboxImages = [],
}, ref) => {
  const backgroundColor = useThemeColor({}, 'background');
  const colorScheme = useColorScheme() ?? 'light';
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollOffset = useScrollOffset(scrollRef);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    scrollTo: (y: number, animated = true) => {
      scrollRef.current?.scrollTo({ y, animated });
    },
  }));

  const headerAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          translateY: interpolate(
            scrollOffset.value,
            [-headerHeight, 0, headerHeight],
            [-headerHeight / 2, 0, headerHeight * 0.75]
          ),
        },
        {
          scale: interpolate(
            scrollOffset.value,
            [-headerHeight, 0, headerHeight],
            [2, 1, 1]
          ),
        },
      ],
    };
  });

  return (
    <>
      <Animated.ScrollView
        ref={scrollRef}
        style={{ backgroundColor, flex: 1 }}
        scrollEventThrottle={16}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      >
        <Animated.View
          style={[
            styles.header,
            { height: headerHeight, backgroundColor: headerBackgroundColor[colorScheme] },
            headerAnimatedStyle,
          ]}
        >
          {enableLightbox ? (
            <TouchableOpacity activeOpacity={0.9} onPress={() => setLightboxOpen(true)}>
              {headerImage}
            </TouchableOpacity>
          ) : (
            headerImage
          )}
          {headerOverlay ? <Animated.View style={styles.headerOverlay}>{headerOverlay}</Animated.View> : null}
          {headerActions ? <Animated.View style={styles.headerActions}>{headerActions}</Animated.View> : null}
        </Animated.View>

        <ThemedView style={styles.content}>{children}</ThemedView>
      </Animated.ScrollView>

      {enableLightbox && lightboxImages.length > 0 && (
        <ImageLightbox
          visible={lightboxOpen}
          images={lightboxImages}
          initialIndex={0}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
});

ParallaxScrollView.displayName = 'ParallaxScrollView';

export default ParallaxScrollView;

const styles = StyleSheet.create({
  header: {
    overflow: 'hidden',
  },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'none',
    zIndex: 2,
  },
  headerActions: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'box-none',
    zIndex: 3,
  },
  content: {
    flex: 1,
    padding: 16, // Reduced from 32 to make cards wider
    gap: 16,
    overflow: 'hidden',
  },
});
