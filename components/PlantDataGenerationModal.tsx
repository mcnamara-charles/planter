// components/PlantDataGenerationModal.tsx
import React from 'react';
import { Modal, View, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';

type ProgressEvent = {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'error';
  startedAt?: number;
  endedAt?: number;
  percent?: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onGenerate: () => void;
  loading: boolean;
  progressEvents?: ProgressEvent[];
  isFirstTime?: boolean;
};

export default function PlantDataGenerationModal({ 
  visible, 
  onClose, 
  onGenerate, 
  loading, 
  progressEvents = [],
  isFirstTime = true 
}: Props) {
  const { theme } = useTheme();

  const getOverallProgress = () => {
    if (progressEvents.length === 0) return 0;
    const completed = progressEvents.filter(e => e.status === 'success').length;
    return Math.round((completed / progressEvents.length) * 100);
  };

  const getCurrentStage = () => {
    const running = progressEvents.find(e => e.status === 'running');
    return running?.label || 'Preparing...';
  };

  if (!visible) return null;

  const progress = getOverallProgress();
  const currentStage = getCurrentStage();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlayBackdrop}>
        <View style={[styles.overlayCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
          {!loading && (
            <>
              <ThemedText style={styles.title}>
                {isFirstTime ? "Setting Up Your Plant!" : "Plant Needs Update"}
              </ThemedText>
              
              <ThemedText style={styles.subtitle}>
                {isFirstTime 
                  ? "Please bear with us while we create a care guide and add facts."
                  : "This plant is missing basic information like description, rarity, and care details."
                }
              </ThemedText>
            </>
          )}

          {loading && progressEvents.length > 0 && (
            <View style={styles.progressContainer}>
              <ActivityIndicator color={theme.colors.text as any} />
              <ThemedText style={styles.progressMessage}>
                {isFirstTime ? 'Setting up your plant...' : 'Updating plant data...'}
              </ThemedText>
              {currentStage && (
                <ThemedText style={styles.progressSublabel}>
                  {currentStage}
                </ThemedText>
              )}
              <View style={styles.progressWrap}>
                <View 
                  style={[
                    styles.progressBar, 
                    { 
                      backgroundColor: theme.colors.primary,
                      width: `${progress}%` 
                    }
                  ]} 
                />
              </View>
              <ThemedText style={styles.progressPercent}>
                {progress}%
              </ThemedText>
            </View>
          )}

          {/* Buttons removed for auto-run flow */}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    minWidth: 320,
    maxWidth: '90%',
    paddingVertical: 24,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  title: {
    fontWeight: '800',
    fontSize: 20,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  progressContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  progressMessage: {
    marginTop: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  progressSublabel: {
    marginTop: 4,
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
  },
  progressWrap: {
    width: 200,
    height: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginTop: 12,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 8,
  },
  progressPercent: {
    marginTop: 6,
    opacity: 0.7,
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  secondaryButton: {
    // No special styling needed for secondary button
  },
  buttonLabel: {
    fontWeight: '700',
    fontSize: 14,
    color: '#000000',
  },
});
