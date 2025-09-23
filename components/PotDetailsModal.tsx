import React from 'react';
import { TextInput, View } from 'react-native';
import ModalShell from './ModalShell';
import { ButtonPill } from './Buttons';
import PotDetailsFields, { type PotDetailsValues } from '@/components/PotDetailsFields';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

export default function PotDetailsModal({
  open,
  mode,
  draft,
  setDraft,
  note,
  setNote,
  onCancel,
  onSave,
}: {
  open: boolean;
  mode: 'add' | 'repot';
  draft: PotDetailsValues;
  setDraft: (v: PotDetailsValues) => void;
  note: string;
  setNote: (t: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { theme } = useTheme();
  return (
    <ModalShell
      open={open}
      title={mode === 'repot' ? 'Repot' : 'Add pot details'}
      footer={
        <>
          <ButtonPill label="Cancel" onPress={onCancel} />
          <ButtonPill label="Save" onPress={onSave} variant="solid" color="primary" />
        </>
      }
    >
      <PotDetailsFields {...draft} onChange={setDraft} />
      {mode === 'repot' && (
        <>
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>Note</ThemedText>
          <TextInput
            style={{
              borderWidth: 1 / 2,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.input,
              color: theme.colors.text,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              minHeight: 44,
            }}
            placeholder="Optional note"
            placeholderTextColor={theme.colors.mutedText}
            value={note}
            onChangeText={setNote}
          />
        </>
      )}
    </ModalShell>
  );
}
