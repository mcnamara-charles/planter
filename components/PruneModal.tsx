import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { supabase } from '@/services/supabaseClient';
import { useAuth } from '@/context/AuthContext';

export default function PruneModal({
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
  const [leavesCut, setLeavesCut] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) {
      setLeavesCut('');
      setReason('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: '90%', maxWidth: 520, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.card, padding: 16, position: 'relative', zIndex: 2 }}>
        <ThemedText type="title">Log pruning</ThemedText>
        <View style={{ height: 8 }} />
        
        <ThemedText style={{ fontWeight: '700' }}>Number of leaves cut</ThemedText>
        <TextInput
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
          value={leavesCut}
          onChangeText={setLeavesCut}
          placeholder="e.g., 3"
          placeholderTextColor={theme.colors.mutedText}
          keyboardType="numeric"
        />
        
        <View style={{ height: 10 }} />
        <ThemedText style={{ fontWeight: '700' }}>Reason</ThemedText>
        <TextInput
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.input, color: theme.colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 }}
          value={reason}
          onChangeText={setReason}
          placeholder="e.g., removing damaged leaves, promoting growth"
          placeholderTextColor={theme.colors.mutedText}
          multiline
          numberOfLines={3}
        />
        
        <View style={{ height: 14 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
          <TouchableOpacity onPress={onClose} style={[styles.envBtn, { borderColor: theme.colors.border }]}>
            <ThemedText style={{ fontWeight: '700', color: theme.colors.text }}>Cancel</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              if (!user?.id) { onClose(); return; }
              if (!leavesCut.trim()) { return; }
              try {
                await supabase.from('user_plant_timeline_events').insert({
                  owner_id: user.id,
                  user_plant_id: userPlantId,
                  event_type: 'prune',
                  event_data: { 
                    leaves_cut: parseInt(leavesCut) || 0, 
                    reason: reason.trim() || null 
                  },
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
