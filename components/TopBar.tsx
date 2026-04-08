import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/context/themeContext';
import LineageIndicator from './LineageIndicator';

export default function TopBar({
  title,
  isFavorite,
  onBack,
  onToggleFavorite,
  onToggleMenu,
  hideActions,
  showUpdateButton,
  onUpdate,
  lineage,
  lightType,
  systemType,
  backgroundColor,
  isInfected,
}: {
  title: string;
  isFavorite: boolean;
  onBack: () => void;
  onToggleFavorite: () => void;
  onToggleMenu: () => void;
  hideActions?: boolean;
  showUpdateButton?: boolean;
  onUpdate?: () => void;
  lineage?: string | null;
  lightType?: 'grow_light' | 'sunlight' | null;
  systemType?: 'normal' | 'reservoir' | null;
  backgroundColor?: string;
  isInfected?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.topBar, { backgroundColor: backgroundColor || theme.colors.card, borderBottomColor: theme.colors.border }]}>
      <View style={styles.leftGroup}>
        <TouchableOpacity style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack}>
          <IconSymbol name="arrow.left" color={theme.colors.text} size={20} />
        </TouchableOpacity>
        {(lineage || lightType === 'grow_light' || systemType === 'reservoir') && (
          <View style={styles.lineageWrapper}>
            <LineageIndicator lineage={lineage} lightType={lightType} systemType={systemType} textSize={10} iconSize={10} isInfected={isInfected} />
          </View>
        )}
        <ThemedText style={[styles.topTitle, !hideActions && { marginRight: 15 }]} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </ThemedText>
      </View>
      {!hideActions && (
        <View style={styles.rightGroup}>
          {showUpdateButton && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Update plant data"
              onPress={onUpdate}
              style={styles.iconBtn}
            >
              <IconSymbol name="arrow.clockwise" color={theme.colors.primary} size={20} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={isFavorite ? 'Unfavorite' : 'Favorite'}
            onPress={onToggleFavorite}
            style={styles.iconBtn}
          >
            <IconSymbol name={isFavorite ? 'heart.fill' : 'heart'} color={isFavorite ? '#e63946' : theme.colors.text} size={22} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="More options" onPress={onToggleMenu} style={styles.iconBtn}>
            <IconSymbol name="ellipsis.vertical" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { height: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  leftGroup: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  lineageWrapper: { marginRight: 8 },
  rightGroup: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  topTitle: { fontWeight: '600', fontSize: 18, lineHeight: 20, includeFontPadding: false as any, flexShrink: 1, minWidth: 0 },
});
