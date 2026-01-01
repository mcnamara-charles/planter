import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IconSymbol } from './ui/icon-symbol';

type LineageIndicatorProps = {
  lineage?: string | null;
  lightType?: 'grow_light' | 'sunlight' | null;
  systemType?: 'normal' | 'reservoir' | null;
  textSize?: number;
  iconSize?: number;
};

export default function LineageIndicator({
  lineage,
  lightType,
  systemType,
  textSize = 10,
  iconSize = 10,
}: LineageIndicatorProps) {
  const lineageDisplay = lineage?.trim() || 'A';
  const hasIcons = lightType === 'grow_light' || systemType === 'reservoir';

  if (!hasIcons && !lineageDisplay) {
    return null;
  }

  return (
    <View style={styles.container}>
      {lightType === 'grow_light' && (
        <IconSymbol name="light.grow" size={iconSize} color="#fff" style={{ marginRight: 2 }} />
      )}
      {systemType === 'reservoir' && (
        <IconSymbol name="drop" size={iconSize} color="#fff" style={{ marginRight: 3 }} />
      )}
      <Text style={[styles.text, { fontSize: textSize }]}>{lineageDisplay}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(10, 132, 255, 0.8)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    minWidth: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#ffffff',
    fontWeight: '600',
    lineHeight: 12,
  },
});

