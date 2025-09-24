import { useState } from 'react';
import { Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '@/context/AuthContext';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';

export default function SignUpScreen() {
  const { signUpWithEmail } = useAuth();
  const { theme } = useTheme();
  const nav = useNavigation();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSignUp = async () => {
    try {
      setSubmitting(true);
      await signUpWithEmail(email.trim(), password, fullName.trim() || undefined);
      (nav as any).navigate('VerifyEmail', { email: email.trim() });
    } catch (e: any) {
      Alert.alert('Sign up failed', e?.message ?? 'Unknown error');
    } finally {
      setSubmitting(false);
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
          <ThemedText type="title" style={styles.appTitle}>Create your account</ThemedText>
          <ThemedText style={styles.appSubtitle}>Start tracking your plants today.</ThemedText>
        </View>
      </View>

      <View style={[
        styles.card,
        { backgroundColor: theme.colors.card, borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth }
      ]}>
        <ThemedText type="subtitle" style={styles.cardTitle}>Sign up</ThemedText>

        <View style={styles.fieldGroup}>
          <ThemedText style={styles.label}>Full name</ThemedText>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Jane Doe"
            placeholderTextColor={theme.colors.mutedText}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.fieldGroup}>
          <ThemedText style={styles.label}>Email</ThemedText>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={theme.colors.mutedText}
            autoCapitalize="none"
            keyboardType="email-address"
            inputMode="email"
          />
        </View>

        <View style={styles.fieldGroup}>
          <ThemedText style={styles.label}>Password</ThemedText>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={theme.colors.mutedText}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!passwordVisible}
              textContentType="password"
            />
            <TouchableOpacity onPress={() => setPasswordVisible((v) => !v)} style={styles.eyeButton}>
              <ThemedText style={{ color: theme.colors.primary }}>{passwordVisible ? 'Hide' : 'Show'}</ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]} onPress={onSignUp} disabled={submitting}>
          <ThemedText style={styles.primaryLabel}>{submitting ? 'Creating…' : 'Create account'}</ThemedText>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkButton} onPress={() => (nav as any).goBack()}>
          <ThemedText style={[styles.linkLabel, { color: theme.colors.primary }]}>Back to sign in</ThemedText>
        </TouchableOpacity>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hero: {
    height: 240,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  heroContent: {
    position: 'absolute',
    bottom: 16,
    left: 20,
    right: 20,
  },
  appTitle: {
    color: '#fff',
  },
  appSubtitle: {
    color: 'rgba(255,255,255,0.9)',
  },
  card: {
    marginTop: 40,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 16,
  },
  cardTitle: {
    marginBottom: 8,
  },
  fieldGroup: {
    marginTop: 8,
    gap: 6,
  },
  label: {
    fontSize: 14,
    opacity: 0.8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  passwordRow: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 64,
  },
  eyeButton: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    padding: 8,
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
  linkButton: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 10,
  },
  linkLabel: {
    fontWeight: '600',
  },
});


