import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

export type PotDetailsValues = {
  potType: string;
  drainageSystem: string;
  potHeightIn: string; // keep as string for input control
  potDiameterIn: string;
};

type Props = PotDetailsValues & {
  onChange: (values: PotDetailsValues) => void;
};

export default function PotDetailsFields({ potType, drainageSystem, potHeightIn, potDiameterIn, onChange }: Props) {
  const { theme } = useTheme();
  const inputStyle = [styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }];

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.fieldGroup}>
        <ThemedText style={styles.label}>Pot type</ThemedText>
        <TextInput
          style={inputStyle}
          value={potType}
          onChangeText={(t) => onChange({ potType: t, drainageSystem, potHeightIn, potDiameterIn })}
          placeholder="Terracotta, Nursery pot, etc."
          placeholderTextColor={theme.colors.mutedText}
        />
      </View>

      <View style={styles.fieldGroup}>
        <ThemedText style={styles.label}>Drainage system</ThemedText>
        <TextInput
          style={inputStyle}
          value={drainageSystem}
          onChangeText={(t) => onChange({ potType, drainageSystem: t, potHeightIn, potDiameterIn })}
          placeholder="Saucer, cachepot, etc."
          placeholderTextColor={theme.colors.mutedText}
        />
      </View>

      <View style={styles.fieldRow}>
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.label}>Pot height (inches)</ThemedText>
          <TextInput
            keyboardType="numeric"
            style={inputStyle}
            value={potHeightIn}
            onChangeText={(t) => onChange({ potType, drainageSystem, potHeightIn: t, potDiameterIn })}
            placeholder="8"
            placeholderTextColor={theme.colors.mutedText}
          />
        </View>
        <View style={{ width: 10 }} />
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.label}>Pot diameter (inches)</ThemedText>
          <TextInput
            keyboardType="numeric"
            style={inputStyle}
            value={potDiameterIn}
            onChangeText={(t) => onChange({ potType, drainageSystem, potHeightIn, potDiameterIn: t })}
            placeholder="6"
            placeholderTextColor={theme.colors.mutedText}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { gap: 6 },
  fieldRow: { flexDirection: 'row', alignItems: 'flex-start' },
  label: { fontSize: 14, opacity: 0.8 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
});


