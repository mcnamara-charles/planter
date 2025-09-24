// screens/CameraPreviewScreen.tsx
import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Image } from 'expo-image';
import TopBar from '@/components/TopBar';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { useIdentifier } from '@/hooks/useIdentifier';

type Params = { uri: string };

export default function CameraPreviewScreen() {
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const { uri } = (route.params as any as Params) || { uri: '' };

  const { loading, data, candidatesTop3, error, identify, networkLog } = useIdentifier();

  const [modalOpen, setModalOpen] = useState(false);
  const [currIdx, setCurrIdx] = useState(0);
  const [overlay, setOverlay] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });
  const [showTech, setShowTech] = useState(false); // NEW: toggle for diagnostics

  const current = useMemo(() => {
    return candidatesTop3[currIdx] || candidatesTop3[0] || data || null;
  }, [candidatesTop3, currIdx, data]);

  const titleLine = useMemo(() => {
    if (!current) return '';
    const common = current.commonNames?.[0];
    if (common) return `${common} (${current.scientificName})`;
    return current.scientificName;
  }, [current]);

  const hasPrev = currIdx > 0;
  const hasNext = currIdx < Math.max(0, candidatesTop3.length - 1);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <TopBar
        title={"Identify Plant Species"}
        isFavorite={false}
        onBack={() => (nav as any).goBack()}
        onToggleFavorite={() => {}}
        onToggleMenu={() => {}}
        hideActions
      />

      <View style={{ flex: 1 }}>
        {!!uri && (
          <Image
            source={{ uri }}
            contentFit="contain"
            style={{ flex: 1, backgroundColor: 'black' }}
          />
        )}
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}
          onPress={() => (nav as any).goBack()}
        >
          <ThemedText style={styles.actionLabel}>Retake</ThemedText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary }]}
          onPress={async () => {
            if (!uri) return;
            try {
              setOverlay({ visible: true, message: 'Identifying…' });
              const top3 = await identify(uri, {
                // optional tunables if you want:
                // timeoutMsPerAttempt: 20000,
                // maxAttempts: 3,
              });
              setOverlay({ visible: false, message: '' });
              if (top3 && top3.length) {
                (nav as any).navigate('PlantIdentificationResult', {
                  candidates: top3,
                  currentIndex: 0,
                  imageUri: uri
                });
              } else {
                setShowTech(false);
                setModalOpen(true);
              }
            } catch {
              setOverlay({ visible: false, message: '' });
              setShowTech(false);
              setModalOpen(true);
            }
          }}
        >
          <ThemedText style={[styles.actionLabel, { color: '#fff' }]}>
            {loading ? 'Working…' : 'Identify'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Full-page progress overlay */}
      <Modal visible={overlay.visible} transparent animationType="fade">
        <View style={styles.overlayBackdrop}>
          <View style={[styles.overlayCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <ActivityIndicator color={theme.colors.text as any} />
            <ThemedText style={{ marginTop: 12 }}>{overlay.message || 'Working…'}</ThemedText>
          </View>
          <Pressable style={styles.overlayBlocker} />
        </View>
      </Modal>

      {/* Result / error modal */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <ThemedText style={{ fontWeight: '800', fontSize: 18, marginBottom: 8 }}>
              {error ? 'Identification Failed' : 'Top Match'}
            </ThemedText>

            {error ? (
              <>
                <ThemedText style={{ color: '#d11a2a' }}>{error}</ThemedText>
                <View style={{ height: 10 }} />
                <TouchableOpacity
                  onPress={() => setShowTech((v) => !v)}
                  style={[styles.modalBtn, { borderColor: theme.colors.border }]}
                >
                  <ThemedText style={{ fontWeight: '800' }}>
                    {showTech ? 'Hide technical details' : 'Show technical details'}
                  </ThemedText>
                </TouchableOpacity>

                {showTech ? (
                  <View style={{ maxHeight: 260, marginTop: 10 }}>
                    <ScrollView style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 8, padding: 8 }}>
                      {networkLog.length === 0 ? (
                        <ThemedText style={{ opacity: 0.7 }}>No diagnostics available.</ThemedText>
                      ) : (
                        networkLog.map((a, idx) => (
                          <View key={`${a.attempt}-${idx}`} style={{ marginBottom: 10 }}>
                            <ThemedText style={{ fontWeight: '700' }}>{`Attempt ${a.attempt} (${a.label})`}</ThemedText>
                            <ThemedText style={{ fontFamily: 'monospace', fontSize: 12 }}>
                              {`status: ${a.status ?? '-'} | ok: ${a.ok ? 'true' : 'false'} | ${a.durationMs}ms`}
                            </ThemedText>
                            {a.cfId ? (
                              <ThemedText style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                {`cf-id: ${a.cfId}`}
                              </ThemedText>
                            ) : null}
                            {a.contentType ? (
                              <ThemedText style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                {`content-type: ${a.contentType}`}
                              </ThemedText>
                            ) : null}
                            {a.error ? (
                              <ThemedText style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                {`error: ${a.error}`}
                              </ThemedText>
                            ) : null}
                            {a.bodyPreview ? (
                              <ThemedText style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.8 }}>
                                {`body: ${a.bodyPreview}`}
                              </ThemedText>
                            ) : null}
                          </View>
                        ))
                      )}
                    </ScrollView>
                  </View>
                ) : null}
              </>
            ) : current ? (
              <>
                <ThemedText style={{ fontWeight: '700', fontSize: 16 }}>{titleLine}</ThemedText>
                {typeof current.score === 'number' ? (
                  <ThemedText style={{ opacity: 0.8, marginTop: 6 }}>
                    Confidence: {(current.score * 100).toFixed(1)}%
                  </ThemedText>
                ) : null}

                {/* Pager row */}
                <View style={styles.pagerRow}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={!hasPrev}
                    onPress={() => hasPrev && setCurrIdx((i) => Math.max(0, i - 1))}
                    style={[
                      styles.pagerBtn,
                      { borderColor: theme.colors.border, opacity: hasPrev ? 1 : 0.45 },
                    ]}
                  >
                    <ThemedText style={{ fontWeight: '800' }}>{'‹'}</ThemedText>
                  </TouchableOpacity>

                  <ThemedText style={{ fontWeight: '700' }}>
                    {Math.min(currIdx + 1, Math.max(1, candidatesTop3.length || 1))}/{Math.max(1, candidatesTop3.length || 1)}
                  </ThemedText>

                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={!hasNext}
                    onPress={() =>
                      hasNext && setCurrIdx((i) => Math.min((candidatesTop3.length || 1) - 1, i + 1))
                    }
                    style={[
                      styles.pagerBtn,
                      { borderColor: theme.colors.border, opacity: hasNext ? 1 : 0.45 },
                    ]}
                  >
                    <ThemedText style={{ fontWeight: '800' }}>{'›'}</ThemedText>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <ThemedText>No results.</ThemedText>
            )}

            <View style={{ height: 12 }} />
            <TouchableOpacity
              style={[styles.modalBtn, { borderColor: theme.colors.border }]}
              onPress={() => setModalOpen(false)}
            >
              <ThemedText style={{ fontWeight: '800' }}>Close</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}


const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontWeight: '800' },

  // overlay
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    minWidth: 220,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  overlayBlocker: { position: 'absolute', inset: 0 },

  // result modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
    minWidth: 260,
    maxWidth: 420,
  },
  modalBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // pager
  pagerRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  pagerBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
  },
});
