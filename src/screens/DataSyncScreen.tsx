import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';
import { useBulkRulesetSweep } from '@/hooks/useBulkRulesetSweep';

type DataSyncScreenProps = {
  onComplete: () => void;
};

export default function DataSyncScreen({ onComplete }: DataSyncScreenProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { run: runSweep } = useBulkRulesetSweep();
  const hasRun = useRef(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, percent: 0 });
  const [status, setStatus] = useState<'loading' | 'syncing' | 'complete' | 'error'>('loading');

  useEffect(() => {
    if (hasRun.current || !user?.id) return;
    hasRun.current = true;

    const syncData = async () => {
      try {
        console.log('[DataSyncScreen] Starting data sync...');
        setStatus('loading');

        // Fetch all plant IDs for this user
        const { data: userPlants, error } = await supabase
          .from('user_plants')
          .select('plants_table_id')
          .eq('owner_id', user.id);

        if (error) throw error;

        const plantIds = (userPlants ?? [])
          .map(p => p.plants_table_id)
          .filter((id): id is string => !!id);

        console.log('[DataSyncScreen] Found', plantIds.length, 'plants to check');

        if (plantIds.length === 0) {
          console.log('[DataSyncScreen] No plants to sync, completing');
          setStatus('complete');
          setTimeout(onComplete, 500);
          return;
        }

        // Run the sweep
        setStatus('syncing');
        const result = await runSweep({
          ids: plantIds,
          concurrency: 3,
          onProgress: (p) => {
            console.log('[DataSyncScreen] Progress:', p);
            setProgress(p);
          },
        });

        console.log('[DataSyncScreen] Sync complete:', result);
        setStatus('complete');
        
        // Brief delay to show completion state
        setTimeout(onComplete, 800);
      } catch (err) {
        console.error('[DataSyncScreen] Sync failed:', err);
        setStatus('error');
        // Still proceed to app after a delay
        setTimeout(onComplete, 2000);
      }
    };

    syncData();
  }, [user?.id, runSweep, onComplete]);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        {/* Icon/Logo */}
        <View style={[styles.iconContainer, { backgroundColor: theme.colors.card }]}>
          <ThemedText style={styles.icon}>🌱</ThemedText>
        </View>

        {/* Status Text */}
        {status === 'loading' && (
          <>
            <ThemedText style={styles.title}>Loading your plants...</ThemedText>
            <ActivityIndicator size="large" color={theme.colors.tint} style={styles.spinner} />
          </>
        )}

        {status === 'syncing' && (
          <>
            <ThemedText style={styles.title}>Updating plant data</ThemedText>
            <ThemedText style={styles.subtitle}>
              {progress.done} of {progress.total} plants
            </ThemedText>
            
            {/* Progress Bar */}
            <View style={[styles.progressBarContainer, { backgroundColor: theme.colors.border }]}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${progress.percent}%`, backgroundColor: '#10B981' },
                ]}
              />
            </View>

            <ThemedText style={styles.progressText}>{progress.percent}%</ThemedText>
          </>
        )}

        {status === 'complete' && (
          <>
            <ThemedText style={styles.title}>✓ All set!</ThemedText>
            <ThemedText style={styles.subtitle}>Loading your garden...</ThemedText>
          </>
        )}

        {status === 'error' && (
          <>
            <ThemedText style={styles.title}>⚠ Sync incomplete</ThemedText>
            <ThemedText style={styles.subtitle}>Continuing anyway...</ThemedText>
          </>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 40,
    maxWidth: 400,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  icon: {
    fontSize: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
    textAlign: 'center',
    marginBottom: 24,
  },
  spinner: {
    marginTop: 16,
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 8,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    opacity: 0.8,
  },
});

