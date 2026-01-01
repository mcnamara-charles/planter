import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import ModalShell from './ModalShell';
import { ButtonPill } from './Buttons';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';

type Taxon = {
  id: string;
  name: string;
  type: string;
  rank: number;
  parent_id: string | null;
};

type TaxonomyModalProps = {
  open: boolean;
  onClose: () => void;
  speciesTaxonId: string | null;
};

// Colors for rank type ovals - mapping by type string (case-insensitive)
const TYPE_COLORS: Record<string, string> = {
  kingdom: '#3b82f6',        // Blue
  subkingdom: '#2563eb',     // Darker blue
  phylum: '#8b5cf6',         // Purple
  class: '#ec4899',           // Pink
  subclass: '#f472b6',        // Light pink
  superorder: '#f59e0b',      // Orange
  order: '#f97316',           // Darker orange
  suborder: '#fb923c',        // Light orange
  family: '#10b981',          // Green
  subfamily: '#34d399',       // Light green
  tribe: '#06b6d4',           // Cyan
  subtribe: '#22d3ee',        // Light cyan
  supertribe: '#0891b2',      // Dark cyan
  genus: '#6366f1',           // Indigo
  subgenus: '#818cf8',        // Light indigo
  section: '#a855f7',         // Purple
  subsection: '#c084fc',      // Light purple
  series: '#e879f9',          // Magenta
  species: '#ef4444',         // Red
};

const getTypeColor = (type: string): string => {
  if (!type) return '#6b7280'; // Default gray
  const normalizedType = type.toLowerCase().trim();
  return TYPE_COLORS[normalizedType] || '#6b7280'; // Default gray for unknown types
};

export default function TaxonomyModal({ open, onClose, speciesTaxonId }: TaxonomyModalProps) {
  const { theme } = useTheme();
  const nav = useNavigation();
  const [loading, setLoading] = useState(false);
  const [taxonomy, setTaxonomy] = useState<Taxon[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchTaxonomy = useCallback(async () => {
    if (!speciesTaxonId || !open) {
      setTaxonomy([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const taxonomyChain: Taxon[] = [];
      let currentTaxonId: string | null = speciesTaxonId;

      // Follow the parent chain up to rank 1 (kingdom)
      while (currentTaxonId) {
        const { data: taxonData, error: taxonError } = await supabase
          .from('taxa')
          .select('id, name, type, rank, parent_id')
          .eq('id', currentTaxonId)
          .maybeSingle();

        if (taxonError) throw taxonError;
        if (!taxonData) break;

        taxonomyChain.push(taxonData);

        // Stop if we've reached rank 1 (kingdom)
        if (taxonData.rank === 1) {
          break;
        }

        // Move to parent
        currentTaxonId = taxonData.parent_id;
      }

      // Sort by rank descending (species first, then genus, etc., down to kingdom)
      taxonomyChain.sort((a, b) => b.rank - a.rank);

      setTaxonomy(taxonomyChain);
    } catch (err: any) {
      console.error('Error fetching taxonomy:', err);
      setError(err?.message || 'Failed to load taxonomy');
    } finally {
      setLoading(false);
    }
  }, [speciesTaxonId, open]);

  useEffect(() => {
    if (open) {
      fetchTaxonomy();
    } else {
      setTaxonomy([]);
      setError(null);
    }
  }, [open, fetchTaxonomy]);

  return (
    <ModalShell
      open={open}
      title="Taxonomy"
      footer={
        <ButtonPill label="Close" onPress={onClose} variant="solid" color="primary" />
      }
    >
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <ThemedText style={[styles.errorText, { color: theme.colors.danger }]}>
            {error}
          </ThemedText>
        </View>
      ) : taxonomy.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ThemedText style={[styles.emptyText, { color: theme.colors.mutedText }]}>
            No taxonomy information available
          </ThemedText>
        </View>
      ) : (
        <ScrollView style={styles.taxonomyList} showsVerticalScrollIndicator={false}>
          {taxonomy.map((taxon) => {
            const typeColor = getTypeColor(taxon.type);
            // Use the type column from the taxa table, capitalize first letter
            const typeDisplay = taxon.type ? taxon.type.charAt(0).toUpperCase() + taxon.type.slice(1) : `Rank ${taxon.rank}`;
            const isSpecies = taxon.type?.toLowerCase() === 'species';
            const canNavigate = !isSpecies;

            const handlePress = () => {
              if (canNavigate) {
                onClose(); // Close the modal first
                (nav as any).navigate('Explore', { taxonId: taxon.id });
              }
            };

            const TaxonContent = (
              <View style={styles.taxonomyItem}>
                <View style={[styles.rankOval, { backgroundColor: typeColor }]}>
                  <ThemedText style={styles.rankText}>{typeDisplay}</ThemedText>
                </View>
                <ThemedText style={[styles.taxonName, { fontWeight: '700' }]}>
                  {taxon.name}
                </ThemedText>
              </View>
            );

            if (canNavigate) {
              return (
                <TouchableOpacity
                  key={taxon.id}
                  onPress={handlePress}
                  activeOpacity={0.7}
                >
                  {TaxonContent}
                </TouchableOpacity>
              );
            }

            return (
              <View key={taxon.id}>
                {TaxonContent}
              </View>
            );
          })}
        </ScrollView>
      )}
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  errorContainer: {
    padding: 16,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
  taxonomyList: {
    maxHeight: 400,
  },
  taxonomyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
  },
  rankOval: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  taxonName: {
    fontSize: 16,
    flex: 1,
  },
});

