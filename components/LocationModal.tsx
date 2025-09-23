import React from 'react';
import { TextInput } from 'react-native';
import ModalShell from './ModalShell';
import { ButtonPill } from './Buttons';
import { useTheme } from '@/context/themeContext';

export default function LocationModal({
  open,
  value,
  onChange,
  onCancel,
  onSave,
}: {
  open: boolean;
  value: string;
  onChange: (t: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { theme } = useTheme();
  return (
    <ModalShell
      open={open}
      title="Move plant"
      footer={
        <>
          <ButtonPill label="Cancel" onPress={onCancel} />
          <ButtonPill label="Save" onPress={onSave} variant="solid" color="primary" />
        </>
      }
    >
      <TextInput
        style={{
          borderWidth: 1 / 2,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.input,
          color: theme.colors.text,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 12,
        }}
        value={value}
        onChangeText={onChange}
        placeholder="e.g., Living room window"
        placeholderTextColor={theme.colors.mutedText}
      />
    </ModalShell>
  );
}
