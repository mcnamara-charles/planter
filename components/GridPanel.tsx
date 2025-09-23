import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/context/themeContext';

type Props = {
  style?: StyleProp<ViewStyle>;
  /** Extra padding inside the panel; defaults to 20 (roomier than 16) */
  padding?: number;
  /** Center children horizontally (and keep natural vertical flow) */
  center?: boolean;
  /** Optionally pass a style for the content wrapper */
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export default function GridPanel({
  style,
  padding = 20,
  center = false,
  contentContainerStyle,
  children,
}: Props) {
  const { theme } = useTheme();

  return (
    <View style={[styles.panel, { padding }, style]}>
      {/* Grid + fades */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.cols}>{Array.from({ length: 7 }).map((_, i) => <View key={`c-${i}`} style={styles.col} />)}</View>
        <View style={styles.rows}>{Array.from({ length: 6 }).map((_, i) => <View key={`r-${i}`} style={styles.row} />)}</View>
        <LinearGradient colors={[theme.colors.background as string, 'transparent']} style={styles.fadeTop} />
        <LinearGradient colors={['transparent', theme.colors.background as string]} style={styles.fadeBottom} />
        <LinearGradient colors={[theme.colors.background as string, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.fadeLeft} />
        <LinearGradient colors={['transparent', theme.colors.background as string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.fadeRight} />
      </View>

      {/* Content */}
      <View
        style={[
          center && { alignItems: 'center', justifyContent: 'center' },
          contentContainerStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cols: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-around',
  },
  col: { width: 1, backgroundColor: 'rgba(127,127,127,0.18)' },
  rows: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    justifyContent: 'space-around',
  },
  row: { height: 1, backgroundColor: 'rgba(127,127,127,0.18)' },
  fadeTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 16 },
  fadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 16 },
  fadeLeft: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 16 },
  fadeRight: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 16 },
});
