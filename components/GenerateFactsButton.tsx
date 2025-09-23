import React from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { IconSymbol } from '@/components/ui/icon-symbol';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export default function GenerateFactsButton({ label, onPress, disabled, style, testID }: Props) {
  const { theme } = useTheme();

  return (
    <TouchableOpacity
      testID={testID}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.btn,
        {
          borderColor: 'rgba(0,0,0,0.15)',      // subtle edge that worked in your original
          backgroundColor: '#FFFFFF',           // white pill even in dark mode (by design)
        },
        disabled && { opacity: 0.6 },
        style,
      ]}
    >
      <IconSymbol name="openai" size={22} color="#000000" />
      <ThemedText style={styles.label}>{label}</ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 12,
  },
});