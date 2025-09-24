import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import TopBar from '@/components/TopBar';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';

export default function EditProfileScreen() {
  const nav = useNavigation() as any;
  const { theme } = useTheme();
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const meta = (data.user as any)?.user_metadata || {};
        if (mounted) setDisplayName(meta.full_name || meta.name || '');
      } catch {}
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const onSave = async () => {
    try {
      setSaving(true);
      const trimmed = displayName.trim();
      const { error } = await supabase.auth.updateUser({ data: { full_name: trimmed, name: trimmed } });
      if (error) throw error;
      Alert.alert('Saved', 'Profile updated');
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Edit Profile"
        isFavorite={false}
        hideActions
        onBack={() => nav.goBack()}
        onToggleFavorite={() => {}}
        onToggleMenu={() => {}}
      />

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : (
        <View style={{ padding: 16 }}>
          <ThemedText style={{ marginBottom: 6 }}>Display Name</ThemedText>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor={theme.colors.mutedText}
            autoCapitalize="words"
          />

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: theme.colors.primary, opacity: saving ? 0.75 : 1 }]}
            disabled={saving}
            onPress={onSave}
          >
            <ThemedText style={styles.primaryLabel}>{saving ? 'Saving…' : 'Save'}</ThemedText>
          </TouchableOpacity>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  primaryButton: {
    marginTop: 16,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryLabel: {
    color: '#fff',
    fontWeight: '600',
  },
});


