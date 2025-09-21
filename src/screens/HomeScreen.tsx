import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import FavoritePlantCard from '@/components/favorite-plant-card';
import { useAuth } from '@/context/AuthContext';
import React, { useEffect, useState } from 'react';
import { type Plant } from '@/types/plant';
import { supabase } from '@/services/supabaseClient';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

export default function HomeScreen() {
  const { user } = useAuth();
  const nav = useNavigation();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlants = async () => {
      if (!user?.id) return;
      setLoading(true);
      setError(null);
      try {
        const { data: userPlants, error: upErr } = await supabase
          .from('user_plants')
          .select('id, plants_table_id, nickname, default_plant_photo_id')
          .eq('owner_id', user.id)
          .eq('favorite', true);
        if (upErr) throw upErr;

        const plantIds = Array.from(new Set((userPlants ?? [])
          .map((p: any) => p.plants_table_id)
          .filter((v: any) => v !== null && v !== undefined)));

        const rawPhotoVals = (userPlants ?? [])
          .map((p: any) => p.default_plant_photo_id)
          .filter((v: any) => v !== null && v !== undefined);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const photoIds = Array.from(new Set(rawPhotoVals.filter((v: any) => typeof v === 'string' && uuidRegex.test(v))));
        const photoPaths = Array.from(new Set(rawPhotoVals.filter((v: any) => typeof v === 'string' && !uuidRegex.test(v))));

        let plantsById: Record<string, any> = {};
        if (plantIds.length > 0) {
          const { data: plantRows, error: pErr } = await supabase
            .from('plants')
            .select('id, plant_name, plant_scientific_name')
            .in('id', plantIds);
          if (pErr) throw pErr;
          plantsById = Object.fromEntries(
            (plantRows ?? []).map((p: any) => [String(p.id), p])
          );
        }

        let photoById: Record<string, string> = {};
        if (photoIds.length > 0) {
          const { data: photoRows, error: phErr } = await supabase
            .from('user_plant_photos')
            .select('id, bucket, object_path')
            .in('id', photoIds);
          if (phErr) throw phErr;

          for (const pr of photoRows ?? []) {
            try {
              const { data: signed, error: sErr } = await supabase.storage
                .from(pr.bucket || 'plant-photos')
                .createSignedUrl(pr.object_path, 60 * 60, {
                  transform: { width: 512, quality: 80, resize: 'contain' },
                });
              if (!sErr && signed?.signedUrl) {
                photoById[String(pr.id)] = signed.signedUrl;
              }
            } catch {}
          }
        }

        let photoByPath: Record<string, string> = {};
        if (photoPaths.length > 0) {
          for (const pth of photoPaths) {
            try {
              const { data: signed, error: sErr } = await supabase.storage
                .from('plant-photos')
                .createSignedUrl(String(pth), 60 * 60, {
                  transform: { width: 512, quality: 80, resize: 'contain' },
                });
              if (!sErr && signed?.signedUrl) {
                photoByPath[String(pth)] = signed.signedUrl;
              }
            } catch {}
          }
        }

        const mapped: Plant[] = (userPlants ?? []).map((row: any) => {
          const ref = plantsById[String(row.plants_table_id)] ?? {};
          const displayName = row.nickname || ref.plant_name || 'Unnamed Plant';
          const sci = ref.plant_scientific_name || '';
          let photo = '';
          if (row.default_plant_photo_id) {
            const key = String(row.default_plant_photo_id);
            photo = photoById[key] ?? photoByPath[key] ?? '';
          }
          return {
            id: String(row.id),
            name: displayName,
            scientificName: sci,
            imageUri: photo,
          };
        });

        setPlants(mapped);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load plants');
      } finally {
        setLoading(false);
      }
    };

  useEffect(() => {
    fetchPlants();
  }, [user?.id]);

  useFocusEffect(
    React.useCallback(() => {
      fetchPlants();
      return () => {};
    }, [user?.id])
  );

  // No pull-to-refresh on Home yet

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#E5F4EF', dark: '#12231F' }}
      headerImage={
        <Image
          source={require('../../assets/images/plants-header.jpg')}
          contentFit="cover"
          transition={200}
          style={styles.reactLogo}
        />
      }>
      <ThemedView style={styles.headerRow}>
        <ThemedText type="title">Favorites</ThemedText>
      </ThemedView>
      {loading ? (
        <View style={styles.loadingRow}><ActivityIndicator /></View>
      ) : error ? (
        <ThemedText>{error}</ThemedText>
      ) : plants.length === 0 ? (
        <ThemedText>No plants yet.</ThemedText>
      ) : (
        <View style={styles.grid}>
          {plants.map((item) => (
            <View key={item.id} style={styles.cardContainer}>
              <FavoritePlantCard plant={item} onPress={() => (nav as any).navigate('PlantDetail', { id: item.id })} />
            </View>
          ))}
        </View>
      )}
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  grid: {
    paddingTop: 4,
    paddingBottom: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  cardContainer: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  reactLogo: {
    width: '100%',
    height: '100%',
  },
  loadingRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },
});


