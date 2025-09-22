import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/services/supabaseClient';
import { useAuth } from '@/context/AuthContext';

type WaterMethod = '' | 'top water' | 'bottom water' | 'soak' | 'misting' | 'flush';

export default function WaterModal({
  open,
  onClose,
  userPlantId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userPlantId: string;
  onSaved?: () => void;
}) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [methodOpen, setMethodOpen] = useState(false);
  const [method, setMethod] = useState<WaterMethod>('');
  const [waterType, setWaterType] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!open) {
      setMethodOpen(false);
      setMethod('');
      setWaterType('');
      setAmount('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
      {/* Click-away closes dropdown only */}
      {methodOpen ? (
        <TouchableOpacity onPress={() => setMethodOpen(false)} style={StyleSheet.absoluteFillObject} />
      ) : null}
      <View style={{ width: '90%', maxWidth: 520, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.card, padding: 16, position: 'relative', zIndex: 2 }}>
        <ThemedText type="title">Log watering</ThemedText>
        <View style={{ height: 8 }} />
        <ThemedText style={{ fontWeight: '700' }}>Method</ThemedText>
        <View style={{ position: 'relative', marginTop: 6 }}>
          <TouchableOpacity
            onPress={() => setMethodOpen((o) => !o)}
            activeOpacity={0.8}
            style={{
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.input,
              borderRadius: 10,
              paddingLeft: 12,
              paddingRight: 40,
              paddingVertical: 12,
            }}
          >
            <ThemedText style={{ color: method ? theme.colors.text : theme.colors.mutedText }}>
              {method || 'Select method'}
            </ThemedText>
            <View style={{ position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
              <IconSymbol name={methodOpen ? 'chevron.up' : 'chevron.down'} size={20} color={theme.colors.mutedText} />
            </View>
          </TouchableOpacity>
          {methodOpen && (
            <View
              style={{
                position: 'absolute',
                top: 46,
                left: 0,
                right: 0,
                zIndex: 100,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                borderRadius: 10,
                overflow: 'hidden',
                backgroundColor: theme.colors.card,
                shadowColor: '#000',
                shadowOpacity: 0.12,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              }}
            >
              {(['top water','bottom water','soak','misting','flush'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => { setMethod(m); setMethodOpen(false); }}
                  style={{ paddingHorizontal: 12, paddingVertical: 10, backgroundColor: method === m ? theme.colors.input : 'transparent' }}
                >
                  <ThemedText style={{ fontWeight: '600' }}>{m}</ThemedText>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        <View style={{ height: 10 }} />
        <ThemedText style={{ fontWeight: '700' }}>Water type</ThemedText>
        <TextInput
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}
          value={waterType}
          onChangeText={setWaterType}
          placeholder="e.g., tap, filtered, rainwater"
          placeholderTextColor={theme.colors.mutedText}
        />
        <View style={{ height: 10 }} />
        <ThemedText style={{ fontWeight: '700' }}>Amount (optional)</ThemedText>
        <TextInput
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}
          value={amount}
          onChangeText={setAmount}
          placeholder="e.g., 500 mL or 0.5 L"
          placeholderTextColor={theme.colors.mutedText}
        />
        <View style={{ height: 14 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
          <TouchableOpacity onPress={onClose} style={[styles.envBtn, { borderColor: theme.colors.border }]}>
            <ThemedText style={{ fontWeight: '700', color: theme.colors.text }}>Cancel</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              if (!user?.id) { onClose(); return; }
              if (!method) { return; }
              try {
                await supabase.from('user_plant_timeline_events').insert({
                  owner_id: user.id,
                  user_plant_id: userPlantId,
                  event_type: 'water',
                  event_data: { method, water_type: waterType || null, amount: amount || null },
                  note: null,
                });
                onClose();
                onSaved?.();
              } catch {}
            }}
            style={[styles.envBtn, { borderColor: theme.colors.border }]}
          >
            <ThemedText style={{ fontWeight: '700', color: theme.colors.primary }}>Save</ThemedText>
          </TouchableOpacity>
        </View>
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
});


