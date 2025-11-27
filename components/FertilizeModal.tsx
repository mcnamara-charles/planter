import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View, Pressable, ScrollView, ActivityIndicator } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function FertilizeModal({
  open,
  onClose,
  userPlantIds,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userPlantIds: string[];
  onSaved?: () => void;
}) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [productName, setProductName] = useState('');
  const [productForm, setProductForm] = useState('');
  const [npk, setNpk] = useState('');
  const [method, setMethod] = useState('');
  const [concentration, setConcentration] = useState('');
  const [isWatering, setIsWatering] = useState(false);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const plantIds = userPlantIds ?? [];
  const canPrefill = plantIds.length === 1;

  const handlePrefill = useCallback(async () => {
    if (!canPrefill || !user?.id) return;
    const plantId = plantIds[0];
    try {
      setPrefillLoading(true);
      const { data, error } = await supabase
        .from('user_plant_timeline_events')
        .select('event_data, created_at')
        .eq('user_plant_id', plantId)
        .eq('event_type', 'fertilize')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data?.event_data) return;

      const event = data.event_data as any;
      const product = event?.product ?? {};
      setProductName(product?.name ?? '');
      setProductForm(product?.form ?? '');
      setNpk(product?.npk ?? '');
      setMethod(event?.method ?? '');
      setConcentration(event?.concentration ?? '');
      setIsWatering(!!event?.is_watering);
    } catch (err) {
      console.warn('Fertilize prefill failed', err);
    } finally {
      setPrefillLoading(false);
    }
  }, [canPrefill, plantIds, user?.id]);

  useEffect(() => {
    if (!open) {
      setProductName('');
      setProductForm('');
      setNpk('');
      setMethod('');
      setConcentration('');
      setIsWatering(false);
    }
  }, [open]);

  if (!open) return null;
  if (!plantIds.length) return null;

  const plantCountLabel =
    plantIds.length > 1 ? ` (${plantIds.length} plants)` : '';

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: '90%', maxWidth: 520, maxHeight: 500, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.card }}>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <ThemedText type="title">Log fertilizing{plantCountLabel}</ThemedText>
          {canPrefill && (
            <Pressable
              style={[styles.prefillButton, { borderColor: theme.colors.border }]}
              onPress={handlePrefill}
              disabled={prefillLoading}
            >
              {prefillLoading ? (
                <ActivityIndicator size="small" color={theme.colors.text as any} />
              ) : (
                <ThemedText style={styles.prefillButtonText}>Prefill Event</ThemedText>
              )}
            </Pressable>
          )}
          <View style={{ height: 8 }} />
          
          {/* Product Section */}
          <ThemedText style={{ fontWeight: '700' }}>Product Name</ThemedText>
          <TextInput
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
            value={productName}
            onChangeText={setProductName}
            placeholder="e.g., Miracle-Gro All Purpose"
            placeholderTextColor={theme.colors.mutedText}
          />
          
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>Form</ThemedText>
          <TextInput
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
            value={productForm}
            onChangeText={setProductForm}
            placeholder="e.g., liquid, granular, powder"
            placeholderTextColor={theme.colors.mutedText}
          />
          
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>NPK Ratio</ThemedText>
          <TextInput
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
            value={npk}
            onChangeText={setNpk}
            placeholder="e.g., 10-10-10 or 20-20-20"
            placeholderTextColor={theme.colors.mutedText}
          />
          
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>Method</ThemedText>
          <TextInput
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
            value={method}
            onChangeText={setMethod}
            placeholder="e.g., soil drench, foliar spray, top dress"
            placeholderTextColor={theme.colors.mutedText}
          />
          
          <View style={{ height: 10 }} />
          <ThemedText style={{ fontWeight: '700' }}>Concentration</ThemedText>
          <TextInput
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
            value={concentration}
            onChangeText={setConcentration}
            placeholder="e.g., 1/2 strength, 1 tsp per gallon"
            placeholderTextColor={theme.colors.mutedText}
          />
          
          <View style={{ height: 14 }} />
          
          {/* Is Watering Checkbox */}
          <Pressable
            onPress={() => setIsWatering(!isWatering)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
          >
            <View style={[
              styles.checkbox,
              { borderColor: theme.colors.border, backgroundColor: isWatering ? '#10B981' : 'transparent' }
            ]}>
              {isWatering && (
                <IconSymbol name="checkmark.circle" size={16} color="#fff" />
              )}
            </View>
            <ThemedText style={{ fontWeight: '600' }}>Counts as watering</ThemedText>
          </Pressable>
          
          <View style={{ height: 14 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
            <TouchableOpacity onPress={onClose} style={[styles.envBtn, { borderColor: theme.colors.border }]}>
              <ThemedText style={{ fontWeight: '700', color: theme.colors.text }}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                if (!user?.id) { onClose(); return; }
                if (!productName.trim() || !plantIds.length) { return; }
                try {
                  const now = new Date().toISOString();
                  const rows = plantIds.map((id) => ({
                    owner_id: user.id,
                    user_plant_id: id,
                    event_type: 'fertilize',
                    event_time: now,
                    event_data: { 
                      product: {
                        name: productName.trim(),
                        form: productForm.trim() || null,
                        npk: npk.trim() || null,
                      },
                      method: method.trim() || null,
                      concentration: concentration.trim() || null,
                      is_watering: isWatering,
                    },
                    note: null,
                  }));
                  await supabase.from('user_plant_timeline_events').insert(rows);
                  onClose();
                  onSaved?.();
                } catch {}
              }}
              style={[styles.envBtn, { borderColor: theme.colors.border }]}
            >
              <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>Save</ThemedText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  envBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefillButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  prefillButtonText: {
    fontWeight: '600',
  },
});
