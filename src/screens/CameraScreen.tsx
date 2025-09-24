import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import TopBar from '@/components/TopBar';

export default function CameraScreen() {
  const { theme } = useTheme();
  const nav = useNavigation();
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [busy, setBusy] = useState(false);
  const [recentImageUri, setRecentImageUri] = useState<string | null>(null);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted) requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!mediaPermission) return;
    if (!mediaPermission.granted) {
      requestMediaPermission();
    } else {
      fetchRecentImage();
    }
  }, [mediaPermission, requestMediaPermission]);

  // Refresh recent image when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      if (mediaPermission?.granted) {
        fetchRecentImage();
      }
    }, [mediaPermission?.granted])
  );

  const fetchRecentImage = async () => {
    try {
      if (!mediaPermission?.granted) return;
      
      const assets = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.photo,
        first: 1,
        sortBy: MediaLibrary.SortBy.creationTime,
      });
      
      if (assets.assets.length > 0) {
        setRecentImageUri(assets.assets[0].uri);
      }
    } catch (error) {
      console.log('Error fetching recent image:', error);
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
      });

      if (!result.canceled && result.assets[0]) {
        (nav as any).navigate('CameraPreview', { uri: result.assets[0].uri });
        // Refresh the recent image after picking
        fetchRecentImage();
      }
    } catch (e: any) {
      Alert.alert('Gallery Error', e?.message ?? 'Failed to open gallery');
    }
  };

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
            hideActions
          />
        </View>

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.thumb} accessibilityRole="button" accessibilityLabel="Open gallery" onPress={pickImage}>
            {recentImageUri ? (
              <Image
                source={{ uri: recentImageUri }}
                style={{ flex: 1, borderRadius: 6 }}
                contentFit="cover"
              />
            ) : (
              <View style={{ flex: 1, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)' }} />
            )}
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


