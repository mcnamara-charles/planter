import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

export default function ModalShell({
  open,
  title,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { theme } = useTheme();
  if (!open) return null;
  return (
    <View style={styles.backdrop}>
      <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}>
        <ThemedText type="title">{title}</ThemedText>
        <View style={{ height: 8 }} />
        {children}
        <View style={{ height: 14 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>{footer}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  card: { width: '90%', maxWidth: 520, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
});
