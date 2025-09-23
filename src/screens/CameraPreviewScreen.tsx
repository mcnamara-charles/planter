import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Image } from 'expo-image';
import TopBar from '@/components/TopBar';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

type Params = { uri: string };

export default function CameraPreviewScreen() {
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const { uri } = (route.params as any as Params) || { uri: '' };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <TopBar
        title={"Preview"}
        isFavorite={false}
        onBack={() => (nav as any).goBack()}
        onToggleFavorite={() => {}}
        onToggleMenu={() => {}}
      />

      <View style={{ flex: 1 }}>
        {!!uri && (
          <Image
            source={{ uri }}
            contentFit="contain"
            style={{ flex: 1, backgroundColor: 'black' }}
          />
        )}
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]} onPress={() => (nav as any).goBack()}>
          <ThemedText style={styles.actionLabel}>Retake</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary }]} onPress={() => { /* TODO: proceed */ }}>
          <ThemedText style={[styles.actionLabel, { color: '#fff' }]}>Identify</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontWeight: '800' },
});


