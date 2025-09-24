import React from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useNavigation } from '@react-navigation/native';
import TopBar from '@/components/TopBar';
import { useTheme } from '@/context/themeContext';

export default function AccountScreen() {
  const nav = useNavigation() as any;
  const { theme } = useTheme();

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Account & Settings"
        isFavorite={false}
        hideActions
        onBack={() => (nav as any).goBack()}
        onToggleFavorite={() => {}}
        onToggleMenu={() => {}}
      />

      <View style={{ flex: 1, paddingTop: 12 }}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.actionRow} onPress={() => nav.navigate('Profile')}>
            <View style={styles.actionLeft}>
              <IconSymbol name="person.circle" size={20} color={theme.colors.primary} />
              <ThemedText style={styles.actionText}>Profile</ThemedText>
            </View>
            <IconSymbol name="chevron.right" size={18} color={theme.colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionRow} onPress={() => {}}>
            <View style={styles.actionLeft}>
              <IconSymbol name="gearshape" size={20} color={theme.colors.primary} />
              <ThemedText style={styles.actionText}>Preferences</ThemedText>
            </View>
            <IconSymbol name="chevron.right" size={18} color={theme.colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionRow} onPress={() => {}}>
            <View style={styles.actionLeft}>
              <IconSymbol name="bell" size={20} color={theme.colors.primary} />
              <ThemedText style={styles.actionText}>Notifications</ThemedText>
            </View>
            <IconSymbol name="chevron.right" size={18} color={theme.colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionRow} onPress={() => {}}>
            <View style={styles.actionLeft}>
              <IconSymbol name="lock" size={20} color={theme.colors.primary} />
              <ThemedText style={styles.actionText}>Privacy & Security</ThemedText>
            </View>
            <IconSymbol name="chevron.right" size={18} color={theme.colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionRow} onPress={() => {}}>
            <View style={styles.actionLeft}>
              <IconSymbol name="questionmark.circle" size={20} color={theme.colors.primary} />
              <ThemedText style={styles.actionText}>Help & Support</ThemedText>
            </View>
            <IconSymbol name="chevron.right" size={18} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionText: {
    fontWeight: '600',
  },
})


