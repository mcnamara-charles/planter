import React from 'react';
import { View } from 'react-native';
import { ThemedText } from '@/components/themed-text';

export default function CompactStatus({ rarity, availability }: { rarity: string | null; availability: string | null }) {
  if (!rarity && !availability) return null;
  return (
    <View style={{ marginTop: 6 }}>
      <ThemedText style={{ fontSize: 12, opacity: 0.7, lineHeight: 14, includeFontPadding: false as any }} numberOfLines={1}>
        {[rarity, availability].filter(Boolean).join(' • ')}
      </ThemedText>
    </View>
  );
}
