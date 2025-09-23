// AboutBox.tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ButtonText } from '@/components/Buttons';  // <-- swap import
import { useTheme } from '@/context/themeContext';

export default function AboutBox({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = React.useState(false);

  const hasBody = !!body?.trim();

  return (
    <View style={[styles.box, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}>
      <ThemedText style={styles.title}>{title}</ThemedText>
      {hasBody ? (
        <ThemedText style={styles.body} numberOfLines={expanded ? undefined : 4}>
          {body}
        </ThemedText>
      ) : (
        <ThemedText style={[styles.body, { opacity: 0.6 }]}>No description yet. Tap “Generate Facts” to add one.</ThemedText>
      )}
      {hasBody ? (
        <ButtonText
          label={expanded ? 'See less' : 'See more'}
          onPress={() => setExpanded((v) => !v)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginTop: 12 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 20, opacity: 0.9, marginBottom: 6 },
});
