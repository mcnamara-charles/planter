import { useState } from 'react';
import { Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useAuth } from '@/context/AuthContext';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';

type RouteParams = { email?: string };

export default function VerifyEmailScreen() {
  const { verifyEmailOtp, sendEmailOtp } = useAuth();
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const { email } = ((route.params as any) || {}) as RouteParams;

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onVerify = async () => {
    if (!email) {
      Alert.alert('Missing email', 'Please go back and enter your email.');
      return;
    }
    try {
      setSubmitting(true);
      await verifyEmailOtp(email, code.trim());
      // On success, auth listener will advance to app
    } catch (e: any) {
      Alert.alert('Verification failed', e?.message ?? 'Invalid or expired code.');
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    if (!email) return;
    try {
      await sendEmailOtp(email, true);
      Alert.alert('Code sent', 'Check your email for a new code.');
    } catch (e: any) {
      Alert.alert('Failed to resend', e?.message ?? 'Try again later.');
    }
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.hero}>
        <Image
          source={require('../../assets/images/plants-header.jpg')}
          style={styles.heroImage}
          contentFit="cover"
          transition={200}
        />
        <View style={styles.heroOverlay} />
        <View style={styles.heroContent}>
          <ThemedText type="title" style={styles.appTitle}>Verify your email</ThemedText>
          {!!email && <ThemedText style={styles.appSubtitle}>Sent to {email}</ThemedText>}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.colors.card, borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
        <ThemedText type="subtitle" style={styles.cardTitle}>Enter 6-digit code</ThemedText>

        <TextInput
          style={[styles.codeInput, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          keyboardType="number-pad"
          maxLength={6}
          placeholder="••••••"
          placeholderTextColor={theme.colors.mutedText}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]} onPress={onVerify} disabled={submitting || code.length < 6}>
          <ThemedText style={styles.primaryLabel}>{submitting ? 'Verifying…' : 'Verify'}</ThemedText>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkButton} onPress={onResend}>
          <ThemedText style={[styles.linkLabel, { color: theme.colors.primary }]}>Resend code</ThemedText>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkButton} onPress={() => (nav as any).goBack()}>
          <ThemedText style={[styles.linkLabel, { color: theme.colors.mutedText }]}>Back</ThemedText>
        </TouchableOpacity>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { height: 200, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  heroContent: { position: 'absolute', bottom: 16, left: 20, right: 20 },
  appTitle: { color: '#fff' },
  appSubtitle: { color: 'rgba(255,255,255,0.9)' },
  card: { marginTop: 32, marginHorizontal: 16, padding: 16, borderRadius: 16 },
  cardTitle: { marginBottom: 8 },
  codeInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 20,
    letterSpacing: 6,
    textAlign: 'center',
  },
  primaryButton: { marginTop: 16, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '600' },
  linkButton: { marginTop: 10, alignItems: 'center', paddingVertical: 8 },
  linkLabel: { fontWeight: '600' },
});


