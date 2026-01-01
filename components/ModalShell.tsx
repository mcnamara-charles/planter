import React from 'react';
import { View, StyleSheet, Modal } from 'react-native';
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
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}>
          <ThemedText type="title">{title}</ThemedText>
          <View style={{ height: 8 }} />
          {children}
          <View style={{ height: 14 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>{footer}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 520, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
});
