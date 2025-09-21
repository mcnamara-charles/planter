import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function AccountScreen() {
  return (
    <ThemedView style={styles.container}>
      <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        <ThemedText type="title">Account</ThemedText>
        <ThemedText style={{ opacity: 0.8 }}>
          Coming soon
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});


