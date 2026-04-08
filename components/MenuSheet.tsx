import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

export default function MenuSheet({
  onEdit,
  onDelete,
  onSetDeceased,
  onMarkSold,
  isDeceased = false,
  isSold = false,
}: {
  onEdit: () => void;
  onDelete: () => void;
  onSetDeceased?: () => void;
  onMarkSold?: () => void;
  isDeceased?: boolean;
  isSold?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.menuSheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
      <TouchableOpacity style={styles.menuItem} onPress={onEdit}>
        <ThemedText>Edit details</ThemedText>
      </TouchableOpacity>
      {onMarkSold && !isDeceased && (
        <TouchableOpacity style={styles.menuItem} onPress={onMarkSold}>
          <ThemedText>{isSold ? 'Not sold' : 'Mark Sold'}</ThemedText>
        </TouchableOpacity>
      )}
      {onSetDeceased && !isSold && (
        <TouchableOpacity style={styles.menuItem} onPress={onSetDeceased}>
          <ThemedText>{isDeceased ? 'Mark Living' : 'Set Deceased'}</ThemedText>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.menuItem} onPress={onDelete}>
        <ThemedText style={{ color: '#d11a2a', fontWeight: '600' }}>Delete</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  menuSheet: { position: 'absolute', right: 12, top: 56, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', zIndex: 20 },
  menuItem: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.08)' },
});
