import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/context/themeContext';

export default function TopBar({
  title,
  isFavorite,
  onBack,
  onToggleFavorite,
  onToggleMenu,
  hideActions,
}: {
  title: string;
  isFavorite: boolean;
  onBack: () => void;
  onToggleFavorite: () => void;
  onToggleMenu: () => void;
  hideActions?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.topBar, { backgroundColor: theme.colors.card, borderBottomColor: theme.colors.border }]}>
      <View style={styles.leftGroup}>
        <TouchableOpacity style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack}>
          <IconSymbol name="arrow.left" color={theme.colors.text} size={20} />
        </TouchableOpacity>
        <ThemedText style={[styles.topTitle, !hideActions && { marginRight: 15 }]} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </ThemedText>
      </View>
      {!hideActions && (
        <View style={styles.rightGroup}>
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
  rightGroup: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  topTitle: { fontWeight: '600', fontSize: 18, lineHeight: 20, includeFontPadding: false as any, flexShrink: 1, minWidth: 0 },
});
