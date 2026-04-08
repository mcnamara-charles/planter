import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IconSymbol } from './ui/icon-symbol';

type LineageIndicatorProps = {
  lineage?: string | null;
  lightType?: 'grow_light' | 'sunlight' | null;
  systemType?: 'normal' | 'reservoir' | null;
  textSize?: number;
  iconSize?: number;
  isInfected?: boolean;
};

export default function LineageIndicator({
  lineage,
  lightType,
  systemType,
  textSize = 10,
  iconSize = 10,
  isInfected = false,
}: LineageIndicatorProps) {
  const lineageDisplay = lineage?.trim() || 'A';
  const hasIcons = lightType === 'grow_light' || systemType === 'reservoir';

  if (!hasIcons && !lineageDisplay) {
    return null;
  }

  const backgroundColor = isInfected ? '#EF4444' : '#FFFFFF';
  const textColor = isInfected ? '#FFFFFF' : '#000000';
  const iconColor = isInfected ? '#FFFFFF' : '#000000';

  return (
    <View style={[styles.container, { backgroundColor }]}>
      {lightType === 'grow_light' && (
        <IconSymbol name="light.grow" size={iconSize} color={iconColor} style={{ marginRight: 2 }} />
      )}
      {systemType === 'reservoir' && (
        <IconSymbol name="drop" size={iconSize} color={iconColor} style={{ marginRight: 3 }} />
      )}
      <Text style={[styles.text, { fontSize: textSize, color: textColor }]}>{lineageDisplay}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    minWidth: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: '600',
    lineHeight: 12,
  },
});

