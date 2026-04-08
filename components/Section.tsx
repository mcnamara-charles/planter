// components/Section.tsx
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

type Props = {
  title: string;
  children?: React.ReactNode;
  /** Controlled mode: pass `open` + `onToggle` */
  open?: boolean;
  onToggle?: () => void;
  /** Optional: start open in uncontrolled mode */
  defaultOpen?: boolean;
  /** Optional: custom content to render on the right side of the header */
  headerRight?: React.ReactNode;
  /** Optional: custom background color for the header */
  headerBackgroundColor?: string;
};

export default function Section({ title, children, open, onToggle, defaultOpen = false, headerRight, headerBackgroundColor }: Props) {
  const { theme } = useTheme();

  // Uncontrolled fallback if `open` isn't provided
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? (open as boolean) : localOpen;

  const handleToggle = () => {
    if (isControlled) {
      onToggle?.();
    } else {
      setLocalOpen((v) => !v);
    }
  };

  // Calculate pressed state color (slightly darker olive green)
  const getHeaderBackgroundColor = (pressed: boolean) => {
    if (!headerBackgroundColor) return undefined;
    // If it's the olive green (#7FA947), use darker olive green (#6B8E23) when pressed
    if (headerBackgroundColor === '#7FA947' && pressed) {
      return '#6B8E23';
    }
    return headerBackgroundColor;
  };

  return (
    <View style={[styles.sectionContainer, { borderColor: headerBackgroundColor ? 'transparent' : theme.colors.border, backgroundColor: theme.colors.card }]}>
      <Pressable
        style={({ pressed }) => [
          styles.sectionHeader,
          headerBackgroundColor && { backgroundColor: getHeaderBackgroundColor(pressed) },
        ]}
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={`Toggle section ${title}`}
      >
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        <View style={styles.sectionHeaderRight}>
          {headerRight}
          <ThemedText style={[styles.sectionIndicator, { color: theme.colors.text }]}>{isOpen ? '−' : '+'}</ThemedText>
        </View>
      </Pressable>

      {isOpen && (
        <View style={[styles.sectionBody, { backgroundColor: theme.colors.background }]}>
          {children ?? <ThemedText style={{ opacity: 0.8 }}>Coming soon…</ThemedText>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionContainer: {
    marginHorizontal: -32, // full-bleed to match page edges (content has 32 padding)
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 20, fontWeight: '800' },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionIndicator: { fontSize: 24, opacity: 0.85 },
  sectionBody: { paddingHorizontal: 32, paddingVertical: 14 },
});
