// components/FactsValidationModal.tsx
import React from 'react';
import { Modal, View, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import GenerateFactsButton from '@/components/GenerateFactsButton';

type Props = {
  visible: boolean;
  onClose: () => void;
  onGenerate: () => void;
  loading?: boolean;
};

export default function FactsValidationModal({ visible, onClose, onGenerate, loading = false }: Props) {
  const { theme } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
          <ThemedText style={styles.title}>Plant Facts Missing</ThemedText>
          
          <ThemedText style={[styles.message, { color: theme.colors.mutedText }]}>
            This plant is missing basic information like description, rarity, and availability. Would you like to generate these details now?
          </ThemedText>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton, { borderColor: theme.colors.border }]}
              onPress={onClose}
            >
              <ThemedText style={styles.cancelButtonText}>Not Now</ThemedText>
            </TouchableOpacity>

            <GenerateFactsButton
              label={loading ? 'Generating…' : 'Generate Facts'}
              disabled={loading}
              onPress={onGenerate}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 24,
    minWidth: 300,
    maxWidth: 400,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  cancelButtonText: {
    fontWeight: '700',
    fontSize: 16,
  },
});
