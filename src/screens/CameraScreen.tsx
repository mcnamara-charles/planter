import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import TopBar from '@/components/TopBar';

export default function CameraScreen() {
  const { theme } = useTheme();
  const nav = useNavigation();
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted) requestPermission();
  }, [permission, requestPermission]);

  const take = async () => {
    if (!cameraRef.current || busy) return;
    try {
      setBusy(true);
      const photo = await cameraRef.current.takePictureAsync?.({ quality: 0.9, skipProcessing: Platform.OS === 'android' });
      if (!photo) return;
      (nav as any).navigate('CameraPreview', { uri: (photo as any).uri });
    } catch (e: any) {
      Alert.alert('Capture failed', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!permission || !permission.granted) {
    return (
      <View style={[styles.centerFill, { backgroundColor: theme.colors.background }] }>
        <ThemedText style={{ marginBottom: 12 }}>Camera permission is required.</ThemedText>
        <TouchableOpacity onPress={requestPermission} style={[styles.reqBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}>
          <ThemedText style={{ fontWeight: '700' }}>Grant permission</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'black' }}>
      <CameraView
        ref={(r) => { cameraRef.current = r; }}
        style={{ flex: 1 }}
        facing={facing}
        enableTorch={false}
      >
        {/* Header overlay */}
        <View style={styles.headerWrap} pointerEvents="box-none">
          <TopBar
            title={"Identify Plant Species"}
            isFavorite={false}
            onBack={() => (nav as any).goBack()}
            onToggleFavorite={() => {}}
            onToggleMenu={() => {}}
          />
        </View>

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.thumb} accessibilityRole="button" accessibilityLabel="Open gallery" onPress={() => Alert.alert('Gallery', 'Coming soon') }>
            <View style={{ flex: 1, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)' }} />
          </TouchableOpacity>

          <TouchableOpacity onPress={take} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Take picture">
            <View style={styles.shutterOuter}>
              <View style={styles.shutterInner} />
            </View>
          </TouchableOpacity>

          <View style={{ width: 56 }} />
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reqBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  headerWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  thumb: { width: 56, height: 56, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  shutterOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#ffffff' },
});


