import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

export default function ConfirmNameModal({
  open,
  suggested,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  suggested: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { theme } = useTheme();
  if (!open) return null;
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: '90%', maxWidth: 520, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.card, padding: 16 }}>
        <ThemedText type="title">Use a more common name?</ThemedText>
        <View style={{ height: 8 }} />
        {suggested ? (
          <ThemedText style={{ opacity: 0.9 }}>
            We found a more widely used common name:
            {'\n'}
            {'\n'}
            “{suggested}”
            {'\n'}
            {'\n'}
            Do you want to update the plant’s common name?
          </ThemedText>
        ) : null}
        <View style={{ height: 14 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
          <TouchableOpacity onPress={onCancel} style={[styles.envBtn, { borderColor: theme.colors.border }]}>
            <ThemedText style={{ fontWeight: '700', color: theme.colors.text }}>Keep current</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={onConfirm} style={[styles.envBtn, { borderColor: theme.colors.border }]}>
            <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>Use this name</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  envBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});


