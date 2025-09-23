import React from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import ModalShell from './ModalShell';
import { ButtonPill } from './Buttons';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import type { SoilRowDraft } from '../utils/types';

export default function SoilModal({
  open,
  rows,
  setRows,
  onCancel,
  onSave,
}: {
  open: boolean;
  rows: SoilRowDraft[];
  setRows: (next: SoilRowDraft[]) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { theme } = useTheme();

  return (
    <ModalShell
      open={open}
      title="Soil mix"
      footer={
        <>
          <ButtonPill label="Cancel" onPress={onCancel} />
          <ButtonPill label="Save" onPress={onSave} variant="solid" color="primary" />
        </>
      }
    >
      {rows.map((row, idx) => (
        <View key={row.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <TextInput
            style={{
              flex: 1,
              borderWidth: 1 / 2,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.input,
              color: theme.colors.text,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 12,
            }}
            value={row.name}
            onChangeText={(t) => setRows(rows.map((x, i) => (i === idx ? { ...x, name: t } : x)))}
            placeholder="Component"
            placeholderTextColor={theme.colors.mutedText}
          />
          <TextInput
            keyboardType="numeric"
            style={{
              width: 88,
              borderWidth: 1 / 2,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.input,
              color: theme.colors.text,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 12,
              textAlign: 'center',
            }}
            value={row.parts}
            onChangeText={(t) => setRows(rows.map((x, i) => (i === idx ? { ...x, parts: t } : x)))}
            placeholder="parts"
            placeholderTextColor={theme.colors.mutedText}
          />
          <TouchableOpacity onPress={() => setRows(rows.filter((_, i) => i !== idx))}>
            <IconSymbol name="xmark.circle.fill" size={20} color={theme.colors.mutedText} />
          </TouchableOpacity>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
        <TouchableOpacity
          onPress={() => setRows([...rows, { id: Math.random().toString(36).slice(2), name: '', parts: '' }])}
          accessibilityLabel="Add component"
          style={{ paddingVertical: 8, paddingHorizontal: 4 }}
        >
          <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>+ Add</ThemedText>
        </TouchableOpacity>
        {rows.length > 0 && <ButtonPill label="Clear" onPress={() => setRows([])} />}
      </View>
    </ModalShell>
  );
}
