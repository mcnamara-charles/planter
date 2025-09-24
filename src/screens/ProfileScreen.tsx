import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator, Clipboard, Alert } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import TopBar from '@/components/TopBar';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

export default function ProfileScreen() {
  const { theme } = useTheme();
  const { user, signOut } = useAuth();
  const nav = useNavigation() as any;
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<{
    email: string | undefined;
    id: string | undefined;
    lastSignInAt: string | undefined;
    displayName: string | undefined;
  }>({ email: undefined, id: undefined, lastSignInAt: undefined, displayName: undefined });

  const refreshDetails = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      const u = data.user;
      setDetails({
        email: u?.email ?? user?.email,
        id: u?.id ?? user?.id,
        lastSignInAt: (u as any)?.last_sign_in_at ?? undefined,
        displayName: (u as any)?.user_metadata?.full_name ?? (u as any)?.user_metadata?.name ?? undefined,
      });
    } catch {
      setDetails({
        email: user?.email,
        id: user?.id,
        lastSignInAt: undefined,
        displayName: undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [user?.email, user?.id]);

  // Initial load
  useEffect(() => { refreshDetails(); }, [refreshDetails]);

  // Refresh whenever this screen is focused
  useFocusEffect(
    useCallback(() => {
      refreshDetails();
    }, [refreshDetails])
  );

  const initials = useMemo(() => {
    const name = details.displayName || details.email || '';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }, [details.displayName, details.email]);

  const copyToClipboard = (text?: string) => {
    if (!text) return;
    try {
      Clipboard.setString(text);
      Alert.alert('Copied', 'Copied to clipboard');
    } catch {}
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Profile"
        isFavorite={false}
        hideActions
        onBack={() => (nav as any).goBack()}
        onToggleFavorite={() => {}}
        onToggleMenu={() => {}}
      />

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 12 }}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : (
        <View style={{ flex: 1, paddingTop: 12 }}>
          <View style={[styles.card, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <TouchableOpacity style={styles.actionRow} onPress={() => (nav as any).navigate('EditProfile')}>
              <View style={styles.actionLeft}>
                <IconSymbol name="pencil" size={20} color={theme.colors.text} />
                <ThemedText style={styles.actionText}>Edit Profile</ThemedText>
              </View>
              <IconSymbol name="chevron.right" size={18} color={theme.colors.mutedText} />
            </TouchableOpacity>

            <View style={styles.row}>
              <View style={[styles.avatar, { backgroundColor: theme.colors.primary }]}>
                <ThemedText style={styles.avatarText}>{initials}</ThemedText>
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="subtitle">{details.displayName || 'Your Account'}</ThemedText>
                <ThemedText style={{ opacity: 0.8 }}>{details.email ?? 'Unknown email'}</ThemedText>
              </View>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.infoRow}>
              <ThemedText style={styles.infoLabel}>User ID</ThemedText>
              <View style={styles.infoValueRow}>
                <ThemedText numberOfLines={1} style={styles.infoValue}>{details.id ?? '—'}</ThemedText>
                <TouchableOpacity onPress={() => copyToClipboard(details.id)} hitSlop={8}>
                  <IconSymbol name="doc.on.doc" size={18} color={theme.colors.mutedText} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.infoRow}>
              <ThemedText style={styles.infoLabel}>Last sign-in</ThemedText>
              <ThemedText style={styles.infoValue}>{details.lastSignInAt ? new Date(details.lastSignInAt).toLocaleString() : '—'}</ThemedText>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}> 
            <TouchableOpacity style={styles.actionRow} onPress={async () => { await signOut(); }}>
              <View style={styles.actionLeft}>
                <IconSymbol name="rectangle.portrait.and.arrow.right" size={20} color={theme.colors.text} />
                <ThemedText style={styles.actionText}>Sign out</ThemedText>
              </View>
              <IconSymbol name="chevron.right" size={18} color={theme.colors.mutedText} />
            </TouchableOpacity>
          </View>
        </View>
      )}
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
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  infoRow: {
    marginBottom: 10,
  },
  infoLabel: {
    opacity: 0.7,
    marginBottom: 2,
  },
  infoValue: {
    fontWeight: '600',
    maxWidth: '85%',
  },
  infoValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionText: {
    fontWeight: '600',
  },
});


