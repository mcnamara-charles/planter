// components/Section.tsx
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
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
};

export default function Section({ title, children, open, onToggle, defaultOpen = false }: Props) {
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

  return (
    <View style={[styles.sectionContainer, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={`Toggle section ${title}`}
      >
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        <ThemedText style={[styles.sectionIndicator, { color: theme.colors.text }]}>{isOpen ? '−' : '+'}</ThemedText>
      </TouchableOpacity>

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
  sectionIndicator: { fontSize: 24, opacity: 0.85 },
  sectionBody: { paddingHorizontal: 32, paddingVertical: 14 },
});
