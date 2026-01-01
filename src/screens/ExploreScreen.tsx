import { Image } from 'expo-image';
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';
import { IconSymbol } from '@/components/ui/icon-symbol';

type Taxon = {
  id: string;
  name: string;
  type: string;
  wfo_id: string | null;
  rank: number;
  parent_id: string | null;
};

export default function ExploreScreen() {
  const { theme } = useTheme();
  const route = useRoute();
  const nav = useNavigation();
  const taxonId = (route.params as any)?.taxonId as string | undefined;
  
  const [loading, setLoading] = useState(true);
  const [taxa, setTaxa] = useState<Taxon[]>([]);
  const [currentTaxon, setCurrentTaxon] = useState<Taxon | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTaxa = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let parentTaxon: Taxon | null = null;

      if (taxonId) {
        // Fetch the specific taxon
        const { data: taxonData, error: taxonError } = await supabase
          .from('taxa')
          .select('id, name, type, wfo_id, rank, parent_id')
          .eq('id', taxonId)
          .maybeSingle();

        if (taxonError) throw taxonError;
        if (!taxonData) {
          setError('Taxon not found');
          setLoading(false);
          return;
        }

        parentTaxon = taxonData;
        setCurrentTaxon(taxonData);

        // Get all taxa where parent_id = taxonId
        const { data: childrenData, error: childrenError } = await supabase
          .from('taxa')
          .select('id, name, type, wfo_id, rank, parent_id')
          .eq('parent_id', taxonId)
          .order('name', { ascending: true });

        if (childrenError) throw childrenError;
        setTaxa(childrenData || []);
      } else {
        // No taxonId provided, show Plantae
        const { data: plantaeData, error: plantaeError } = await supabase
          .from('taxa')
          .select('id, name, type, wfo_id, rank, parent_id')
          .or('rank.eq.1,type.eq.kingdom')
          .maybeSingle();

        if (plantaeError) throw plantaeError;
        if (!plantaeData) {
          setError('Plantae kingdom not found');
          setLoading(false);
          return;
        }

        parentTaxon = plantaeData;
        setCurrentTaxon(plantaeData);

        // Get all taxa where parent_id = plantaeData.id
        const { data: childrenData, error: childrenError } = await supabase
          .from('taxa')
          .select('id, name, type, wfo_id, rank, parent_id')
          .eq('parent_id', plantaeData.id)
          .order('name', { ascending: true });

        if (childrenError) throw childrenError;
        setTaxa(childrenData || []);
      }
    } catch (err: any) {
      console.error('Error fetching taxa:', err);
      setError(err?.message || 'Failed to load taxa');
    } finally {
      setLoading(false);
    }
  }, [taxonId]);

  useEffect(() => {
    fetchTaxa();
  }, [fetchTaxa]);

  const handleTaxonPress = (taxon: Taxon) => {
    (nav as any).navigate('Explore', { taxonId: taxon.id });
  };

  const handleBackPress = () => {
    // Always go back to previous page in navigation history
    nav.goBack();
  };

  const handleUpPress = () => {
    if (currentTaxon?.parent_id) {
      // Navigate to parent taxon
      (nav as any).navigate('Explore', { taxonId: currentTaxon.parent_id });
    }
  };

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
      <View style={styles.container}>
        {/* Navigation buttons */}
        <View style={styles.navigationRow}>
          {/* Back button - always show to go back in navigation history */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBackPress}
            activeOpacity={0.7}
          >
            <IconSymbol name="arrow.left" size={20} color={theme.colors.text} />
            <ThemedText style={[styles.backButtonText, { color: theme.colors.text }]}>
              Back
            </ThemedText>
          </TouchableOpacity>

          {/* Up button - show if we have a parent taxon */}
          {currentTaxon?.parent_id && (
            <TouchableOpacity
              style={styles.upButton}
              onPress={handleUpPress}
              activeOpacity={0.7}
            >
              <IconSymbol name="chevron.up" size={20} color={theme.colors.text} />
              <ThemedText style={[styles.upButtonText, { color: theme.colors.text }]}>
                Up
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>
        
        <View style={styles.titleContainer}>
          <ThemedText type="title" style={styles.title}>
            {currentTaxon?.name || 'Plantae'}
          </ThemedText>
          {currentTaxon?.type && (
            <ThemedText style={[styles.typeText, { color: '#0a84ff' }]}>
              {currentTaxon.type.charAt(0).toUpperCase() + currentTaxon.type.slice(1)}
            </ThemedText>
          )}
        </View>
        
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <ThemedText style={[styles.errorText, { color: theme.colors.danger }]}>
              {error}
            </ThemedText>
          </View>
        ) : (
          <View style={styles.listContent}>
            {taxa.map((taxon) => (
              <TouchableOpacity
                key={taxon.id}
                style={[styles.taxonItem, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
                activeOpacity={0.7}
                onPress={() => handleTaxonPress(taxon)}
              >
                <View style={styles.taxonContent}>
                  <View style={styles.taxonTextContainer}>
                    <ThemedText style={styles.taxonName}>{taxon.name}</ThemedText>
                    <ThemedText style={[styles.taxonType, { color: theme.colors.mutedText }]}>
                      {taxon.type}
                    </ThemedText>
                  </View>
                  <IconSymbol name="chevron.right" size={20} color={theme.colors.mutedText} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 16,
    paddingBottom: 16,
  },
  navigationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  upButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  upButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  titleContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 4,
  },
  typeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  errorContainer: {
    padding: 16,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  taxonItem: {
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  taxonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taxonTextContainer: {
    flex: 1,
  },
  taxonName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  taxonType: {
    fontSize: 14,
  },
  reactLogo: {
    width: '100%',
    height: '100%',
  },
});

