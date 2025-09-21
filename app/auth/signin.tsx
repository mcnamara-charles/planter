import { useState } from 'react';
import { Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/context/AuthContext';

export default function SignInScreen() {
  const { signInWithEmail, signUpWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSignIn = async () => {
    try {
      setSubmitting(true);
      await signInWithEmail(email.trim(), password);
    } catch (e: any) {
      Alert.alert('Sign in failed', e.message ?? 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  const onSignUp = async () => {
    try {
      setSubmitting(true);
      await signUpWithEmail(email.trim(), password);
      Alert.alert('Signed up', 'Please check your email if confirmation is required.');
    } catch (e: any) {
      Alert.alert('Sign up failed', e.message ?? 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Welcome to Planter</ThemedText>
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          inputMode="email"
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
        />
        <TouchableOpacity style={styles.button} onPress={onSignIn} disabled={submitting}>
          <ThemedText style={styles.buttonLabel}>{submitting ? 'Signing in…' : 'Sign In'}</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={onSignUp} disabled={submitting}>
          <ThemedText style={styles.secondaryLabel}>Create account</ThemedText>
        </TouchableOpacity>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
    justifyContent: 'center',
  },
  form: {
    gap: 12,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.15)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  button: {
    backgroundColor: '#0a7ea4',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonLabel: {
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
  },
  secondaryLabel: {
    color: '#0a7ea4',
    fontWeight: '600',
    textAlign: 'center',
  },
});


