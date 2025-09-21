import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';

export type SoilPart = {
  label: string;        // e.g., "Perlite"
  parts: number;        // e.g., 2
  icon?: IconSymbolName; // e.g., 'leaf'
};

type Props = {
  mix: SoilPart[];
};

// Explicit soil-type visuals mapping (color + icon)
const SOIL_VISUALS: { matchers: string[]; color: string; icon: IconSymbolName }[] = [
  { matchers: ['perlite'], color: '#F59E0B', icon: 'leaf' },       // Orange
  { matchers: ['pumice'], color: '#F59E0B', icon: 'leaf' },        // Orange
  { matchers: ['vermiculite'], color: '#86EFAC', icon: 'leaf' },   // Light Green
  { matchers: ['compost'], color: '#A855F7', icon: 'leaf' },       // Purple
  { matchers: ['peat'], color: '#047857', icon: 'leaf' },          // Dark Green
  { matchers: ['coco coir', 'coco-coir', 'coir'], color: '#047857', icon: 'leaf' }, // Dark Green
  { matchers: ['orchid bark'], color: '#8B5A2B', icon: 'leaf' },   // Brown
  { matchers: ['bark'], color: '#8B5A2B', icon: 'leaf' },          // Brown (generic bark)
  { matchers: ['sand'], color: '#F59E0B', icon: 'leaf' },          // Orange
  { matchers: ['unknown'], color: '#9CA3AF', icon: 'leaf' },       // Grey
];

function getSoilVisual(label: string): { color: string; icon: IconSymbolName } {
  const norm = (label || '').trim().toLowerCase();
  for (const v of SOIL_VISUALS) {
    for (const m of v.matchers) {
      if (norm.includes(m)) return { color: v.color, icon: v.icon };
    }
  }
  // Fallback for unmapped: grey to keep a neutral base
  return { color: '#9CA3AF', icon: 'leaf' };
}

function createStableColor(label: string): string {
  // simple deterministic hash -> hue
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue}, 65%, 60%)`;
}

export default function SoilMixViz({ mix }: Props) {
  const { theme } = useTheme();

  const normalized = useMemo(() => {
    const items = [...mix].sort((a, b) => b.parts - a.parts);
    const maxParts = Math.max(1, ...items.map((i) => i.parts));
    const top = items.filter((i) => i.parts === items[0].parts);
    const rest = items.slice(top.length);
    return { top, rest, maxParts };
  }, [mix]);

  const renderRow = (items: SoilPart[], maxParts: number, isTop: boolean) => {
    // Precompute sizes and row max to keep circles aligned regardless of text wraps
    const computed = items.map((it) => {
      const scale = Math.max(0.55, Math.min(1, it.parts / maxParts));
      const size = Math.round(84 * (isTop ? Math.max(scale, 0.85) : scale));
      const visual = getSoilVisual(it.label);
      const color = visual.color;
      const icon = visual.icon || it.icon || 'leaf';
      return { it, size, color, icon };
    });
    const rowMax = computed.reduce((m, c) => Math.max(m, c.size), 0);

    return (
      <View style={[styles.row, isTop ? styles.rowTop : styles.rowBottom]}>
        {computed.map(({ it, size, color, icon }, idx) => (
          <View key={`${it.label}-${idx}`} style={styles.itemWrap}>
            <View style={[styles.circleSlot, { height: rowMax }]}>
              <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderColor: theme.colors.border }]}>
                <IconSymbol name={icon} size={Math.round(size * 0.42)} color={'#ffffff'} />
              </View>
            </View>
            <ThemedText style={styles.itemText} numberOfLines={2}>
              {`${it.parts} part${it.parts === 1 ? '' : 's'} ${it.label}`.toLowerCase()}
            </ThemedText>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      {renderRow(normalized.top, normalized.maxParts, true)}
      {normalized.rest.length > 0 && renderRow(normalized.rest, normalized.maxParts, false)}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12, marginVertical: 10 },
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap', columnGap: 16, rowGap: 10 },
  rowTop: {},
  rowBottom: {},
  itemWrap: { alignItems: 'center', maxWidth: 120 },
  circleSlot: { alignItems: 'center', justifyContent: 'flex-end', width: 120 },
  circle: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  itemText: { marginTop: 4, textAlign: 'center', fontWeight: '600', fontSize: 11, lineHeight: 14 },
});


