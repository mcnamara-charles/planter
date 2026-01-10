import React, { useEffect, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, TextInput, Alert, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useNavigation } from '@react-navigation/native';
import TopBar from '@/components/TopBar';
import { useTheme } from '@/context/themeContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabaseClient';

interface Location {
  id: string;
  name: string;
  owner_id: string;
}

export default function LocationsScreen() {
  const nav = useNavigation() as any;
  const { theme } = useTheme();
  const { user } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [deletingLocation, setDeletingLocation] = useState<Location | null>(null);
  const [plantCount, setPlantCount] = useState(0);
  const [plantsUsingLocation, setPlantsUsingLocation] = useState<{id: string, nickname?: string, custom_species_name?: string, plants_table_id?: string}[]>([]);
  const [newLocationName, setNewLocationName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    if (!user?.id) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, owner_id')
        .eq('owner_id', user.id)
        .order('name');
      
      if (error) throw error;
      setLocations(data || []);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to load locations: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddLocation = async () => {
    if (!newLocationName.trim()) {
      Alert.alert('Error', 'Please enter a location name');
      return;
    }
    
    if (!user?.id) {
      Alert.alert('Error', 'Not signed in');
      return;
    }

    try {
      setSaving(true);
      const { error } = await supabase
        .from('locations')
        .insert({
          name: newLocationName.trim(),
          owner_id: user.id
        });
      
      if (error) throw error;
      
      setNewLocationName('');
      setShowAddModal(false);
      fetchLocations();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to add location: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEditLocation = async () => {
    if (!editingLocation || !newLocationName.trim()) {
      Alert.alert('Error', 'Please enter a location name');
      return;
    }

    try {
      setSaving(true);
      const { error } = await supabase
        .from('locations')
        .update({ name: newLocationName.trim() })
        .eq('id', editingLocation.id);
      
      if (error) throw error;
      
      setNewLocationName('');
      setEditingLocation(null);
      setShowEditModal(false);
      fetchLocations();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to update location: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLocation = async (location: Location) => {
    try {
      // Check how many plants are using this location and get their details
      const { data: plants, error: plantsError } = await supabase
        .from('user_plants')
        .select('id, nickname, custom_species_name, plants_table_id')
        .eq('location_id', location.id)
        .eq('owner_id', user?.id || '')
        .order('nickname, custom_species_name');
      
      if (plantsError) throw plantsError;
      
      const plantsList = plants || [];
      setPlantCount(plantsList.length);
      setPlantsUsingLocation(plantsList);
      setDeletingLocation(location);
      setShowDeleteModal(true);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to check plants: ' + error.message);
    }
  };

  const confirmDeleteLocation = async () => {
    if (!deletingLocation || !user?.id) return;
    
    try {
      setSaving(true);
      
      // If there are plants using this location, clear their location_id first
      if (plantCount > 0) {
        const { error: updateError } = await supabase
          .from('user_plants')
          .update({ location_id: null })
          .eq('location_id', deletingLocation.id)
          .eq('owner_id', user.id);
        
        if (updateError) throw updateError;
      }
      
      // Now delete the location
      const { error: deleteError } = await supabase
        .from('locations')
        .delete()
        .eq('id', deletingLocation.id);
      
      if (deleteError) throw deleteError;
      
      setShowDeleteModal(false);
      setDeletingLocation(null);
      setPlantCount(0);
      fetchLocations();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to delete location: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (location: Location) => {
    setEditingLocation(location);
    setNewLocationName(location.name);
    setShowEditModal(true);
  };

  const closeModals = () => {
    setShowAddModal(false);
    setShowEditModal(false);
    setShowDeleteModal(false);
    setEditingLocation(null);
    setDeletingLocation(null);
    setPlantCount(0);
    setPlantsUsingLocation([]);
    setNewLocationName('');
  };

  const getPlantDisplayName = (plant: {nickname?: string, custom_species_name?: string}) => {
    if (plant.nickname) return plant.nickname;
    if (plant.custom_species_name) return plant.custom_species_name;
    return 'Unnamed Plant';
  };

  const renderPlantList = () => {
    if (plantCount === 0) return null;
    
    const visiblePlants = plantsUsingLocation.slice(0, 3);
    const remainingCount = Math.max(0, plantCount - 3);
    
    return (
      <View style={styles.plantList}>
        {visiblePlants.map((plant, index) => (
          <ThemedText key={plant.id} style={styles.plantItem}>
            • {getPlantDisplayName(plant)}
          </ThemedText>
        ))}
        {remainingCount > 0 && (
          <ThemedText style={styles.plantItem}>
            • +{remainingCount} more plant{remainingCount === 1 ? '' : 's'}
          </ThemedText>
        )}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Locations"
        isFavorite={false}
        hideActions
        onBack={() => nav.goBack()}
        onToggleFavorite={() => {}}
        onToggleMenu={() => {}}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 20 }}>
        <View style={styles.header}>
          <ThemedText style={styles.headerText}>Manage your plant locations</ThemedText>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: theme.colors.primary }]}
            onPress={() => setShowAddModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Add location"
          >
            <IconSymbol name="plus" size={20} color="#fff" />
            <ThemedText style={styles.addButtonText}>Add Location</ThemedText>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <ThemedText style={styles.loadingText}>Loading locations...</ThemedText>
          </View>
        ) : locations.length === 0 ? (
          <View style={styles.emptyContainer}>
            <IconSymbol name="location" size={48} color={theme.colors.mutedText} />
            <ThemedText style={styles.emptyTitle}>No locations yet</ThemedText>
            <ThemedText style={styles.emptySubtitle}>Add your first location to get started</ThemedText>
          </View>
        ) : (
          <View style={styles.locationsList}>
            {locations.map((location) => (
              <View key={location.id} style={[styles.locationCard, { borderColor: theme.colors.border }]}>
                <View style={styles.locationInfo}>
                  <IconSymbol name="location" size={20} color={theme.colors.primary} />
                  <ThemedText style={styles.locationName}>{location.name}</ThemedText>
                </View>
                <View style={styles.locationActions}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => nav.navigate('LocationPositioning', { locationId: location.id, locationName: location.name })}
                    accessibilityRole="button"
                    accessibilityLabel={`Position ${location.name}`}
                  >
                    <IconSymbol name="position" size={16} color={theme.colors.mutedText} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => openEditModal(location)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${location.name}`}
                  >
                    <IconSymbol name="pencil" size={16} color={theme.colors.mutedText} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleDeleteLocation(location)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${location.name}`}
                  >
                    <IconSymbol name="trash.fill" size={16} color={theme.colors.mutedText} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add Location Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="fade"
        onRequestClose={closeModals}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <ThemedText style={styles.modalTitle}>Add New Location</ThemedText>
            <TextInput
              style={[styles.textInput, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
              value={newLocationName}
              onChangeText={setNewLocationName}
              placeholder="Enter location name"
              placeholderTextColor={theme.colors.mutedText}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { borderColor: theme.colors.border }]}
                onPress={closeModals}
                disabled={saving}
              >
                <ThemedText style={{ color: theme.colors.text }}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]}
                onPress={handleAddLocation}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <ThemedText style={{ color: '#fff' }}>Add</ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Location Modal */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="fade"
        onRequestClose={closeModals}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <ThemedText style={styles.modalTitle}>Edit Location</ThemedText>
            <TextInput
              style={[styles.textInput, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.text }]}
              value={newLocationName}
              onChangeText={setNewLocationName}
              placeholder="Enter location name"
              placeholderTextColor={theme.colors.mutedText}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { borderColor: theme.colors.border }]}
                onPress={closeModals}
                disabled={saving}
              >
                <ThemedText style={{ color: theme.colors.text }}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]}
                onPress={handleEditLocation}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <ThemedText style={{ color: '#fff' }}>Save</ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Location Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={closeModals}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <ThemedText style={styles.modalTitle}>Delete Location</ThemedText>
            
            {plantCount > 0 ? (
              <>
                <ThemedText style={styles.deleteWarning}>
                  This location is currently used by {plantCount} plant{plantCount === 1 ? '' : 's'}.
                </ThemedText>
                {renderPlantList()}
                <ThemedText style={styles.deleteWarningText}>
                  Deleting this location will remove it from {plantCount === 1 ? 'this plant' : 'all these plants'}. This action cannot be undone.
                </ThemedText>
              </>
            ) : (
              <ThemedText style={styles.deleteWarning}>
                Are you sure you want to delete "{deletingLocation?.name}"?
              </ThemedText>
            )}
            
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { borderColor: theme.colors.border }]}
                onPress={closeModals}
                disabled={saving}
              >
                <ThemedText style={{ color: theme.colors.text }}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#d11a2a', borderColor: '#d11a2a' }]}
                onPress={confirmDeleteLocation}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <ThemedText style={{ color: '#fff' }}>Delete</ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  headerText: {
    fontSize: 16,
    opacity: 0.8,
    marginBottom: 12,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 60,
  },
  loadingText: {
    opacity: 0.8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtitle: {
    opacity: 0.8,
    textAlign: 'center',
  },
  locationsList: {
    paddingHorizontal: 16,
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginBottom: 8,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  locationName: {
    fontWeight: '600',
  },
  locationActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  textInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 20,
    fontSize: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  modalButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 80,
    alignItems: 'center',
  },
  deleteWarning: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#d11a2a',
  },
  deleteWarningText: {
    fontSize: 14,
    opacity: 0.8,
    marginBottom: 20,
    lineHeight: 20,
  },
  plantList: {
    marginVertical: 12,
    paddingLeft: 8,
  },
  plantItem: {
    fontSize: 14,
    marginBottom: 4,
    opacity: 0.9,
  },
});
