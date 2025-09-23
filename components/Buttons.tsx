import React from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

/** Pill button with variants/sizes to match the original UI */
export function ButtonPill({
  label,
  onPress,
  variant = 'outline',         // 'outline' (default) or 'solid'
  color = 'neutral',            // 'neutral' or 'primary'
  size = 'md',                  // 'sm' or 'md'
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'outline' | 'solid';
  color?: 'neutral' | 'primary';
  size?: 'sm' | 'md';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();

  const isSolid = variant === 'solid';
  const isPrimary = color === 'primary';
  const isSmall = size === 'sm';

  const backgroundStyle = isSolid
    ? { backgroundColor: isPrimary ? theme.colors.primary : theme.colors.card }
    : { backgroundColor: 'transparent' };

  const borderStyle = {
    borderColor: isSolid
      ? (isPrimary ? theme.colors.primary : theme.colors.border)
      : theme.colors.border,
  };

  const textColor = isSolid
    ? (isPrimary ? '#fff' : theme.colors.text)
    : (isPrimary ? theme.colors.primary : theme.colors.text);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.pill,
        isSmall ? styles.pillSm : styles.pillMd,
        backgroundStyle,
        borderStyle,
        disabled && { opacity: 0.6 },
        style,
      ]}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      activeOpacity={0.8}
    >
      <ThemedText
        style={[
          styles.pillLabel,
          isSmall ? styles.pillLabelSm : styles.pillLabelMd,
          { color: textColor },
        ]}
      >
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

/** Text-only button (for “See more”, etc.) */
export function ButtonText({
  label,
  onPress,
  disabled,
  color, // optional override
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  color?: string;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={styles.textBtn}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      activeOpacity={0.6}
    >
      <ThemedText
        style={[
          styles.textBtnLabel,
          { color: color ?? theme.colors.primary },
          disabled && { opacity: 0.6 },
        ]}
      >
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  pillMd: { paddingHorizontal: 12, paddingVertical: 8 },
  pillSm: { paddingHorizontal: 10, paddingVertical: 6 },

  pillLabel: { fontWeight: '700' },
  pillLabelMd: { fontSize: 14, lineHeight: 18 },
  pillLabelSm: { fontSize: 12, lineHeight: 14 },

  textBtn: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 2 },
  textBtnLabel: { fontWeight: '700', fontSize: 14, lineHeight: 18 },
});
