// AboutBox.tsx
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

export default function AboutBox({
  title,
  body,
  backgroundColor,
  containerStyle,
  borderColor,
}: {
  title: string;
  body: string;
  backgroundColor?: string;
  containerStyle?: any;
  borderColor?: string;
}) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = React.useState(false);

  const hasBody = !!body?.trim();

  return (
    <View style={[styles.box, { borderColor: borderColor || theme.colors.border, backgroundColor: backgroundColor || theme.colors.card }, containerStyle]}>
      <ThemedText style={styles.title}>{title}</ThemedText>
      {hasBody ? (
        <ThemedText style={styles.body} numberOfLines={expanded ? undefined : 4}>
          {body}
        </ThemedText>
      ) : (
        <ThemedText style={[styles.body, { opacity: 0.6 }]}>No description yet. Tap “Generate Facts” to add one.</ThemedText>
      )}
      {hasBody ? (
        <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
          <ThemedText style={styles.seeMoreButton}>
            {expanded ? 'See less' : 'See more'}
          </ThemedText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginTop: 12 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 20, opacity: 0.9, marginBottom: 6 },
  seeMoreButton: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
