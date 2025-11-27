import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/context/themeContext';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface DatePickerProps {
  value: string; // YYYY-MM-DD format
  onChange: (date: string) => void; // receives YYYY-MM-DD format
  placeholder?: string;
}

export default function DatePicker({ value, onChange, placeholder = "Select date" }: DatePickerProps) {
  const { theme } = useTheme();
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date | null>(null);

  // Convert YYYY-MM-DD string to Date object
  const dateValue = value ? new Date(value + 'T00:00:00') : new Date();

  // Convert YYYY-MM-DD to MM/DD/YYYY for display
  const formatDisplayDate = (dateString: string): string => {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    return `${month}/${day}/${year}`;
  };

  // Convert MM/DD/YYYY to YYYY-MM-DD for storage
  const formatStorageDate = (dateString: string): string => {
    if (!dateString) return '';
    const [month, day, year] = dateString.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
      // On Android, only update if user didn't cancel (event.type !== 'dismissed')
      if (event.type !== 'dismissed' && selectedDate) {
        // Convert Date to YYYY-MM-DD format
        const year = selectedDate.getFullYear();
        const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
        const day = String(selectedDate.getDate()).padStart(2, '0');
        const formattedDate = `${year}-${month}-${day}`;
        onChange(formattedDate);
      }
    } else {
      // On iOS, just update the temp date for preview
      if (selectedDate) {
        setTempDate(selectedDate);
      }
    }
  };

  const handlePickerOpen = () => {
    setTempDate(dateValue);
    setShowPicker(true);
  };

  const handleConfirm = () => {
    if (tempDate) {
      // Convert Date to YYYY-MM-DD format
      const year = tempDate.getFullYear();
      const month = String(tempDate.getMonth() + 1).padStart(2, '0');
      const day = String(tempDate.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;
      onChange(formattedDate);
    }
    setShowPicker(false);
  };

  const handleCancel = () => {
    setTempDate(null);
    setShowPicker(false);
  };

  return (
    <View style={{ position: 'relative' }}>
      <View style={[styles.input, { backgroundColor: theme.colors.input, borderColor: theme.colors.border }]}>
        <TouchableOpacity
          style={styles.inputContent}
          onPress={handlePickerOpen}
          accessibilityRole="button"
          accessibilityLabel={placeholder}
        >
          <ThemedText style={{ color: value ? theme.colors.text : theme.colors.mutedText }}>
            {value ? formatDisplayDate(value) : placeholder}
          </ThemedText>
        </TouchableOpacity>
        {value && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => onChange('')}
            accessibilityRole="button"
            accessibilityLabel="Clear date"
          >
            <IconSymbol name="xmark.circle.fill" size={18} color={theme.colors.mutedText} />
          </TouchableOpacity>
        )}
      </View>

      {showPicker && (
        <>
          {Platform.OS === 'ios' && (
            <View style={[styles.pickerContainer, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={handleCancel}>
                  <ThemedText style={[styles.pickerButton, { color: theme.colors.mutedText }]}>Cancel</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleConfirm}>
                  <ThemedText style={[styles.pickerButton, { color: theme.colors.primary }]}>Done</ThemedText>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate || dateValue}
                mode="date"
                display="compact"
                onChange={handleDateChange}
                style={styles.picker}
                textColor={theme.colors.text}
                accentColor={theme.colors.primary}
              />
            </View>
          )}
          {Platform.OS === 'android' && (
            <DateTimePicker
              value={dateValue}
              mode="date"
              display="default"
              onChange={handleDateChange}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputContent: {
    flex: 1,
  },
  clearButton: {
    padding: 4,
    marginLeft: 8,
  },
  pickerContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  pickerButton: {
    fontWeight: '600',
    fontSize: 16,
  },
  picker: {
    height: 200,
  },
});
