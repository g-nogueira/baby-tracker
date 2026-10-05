import { StableDateTimePicker } from '@/features/shared/activity-drawer/stable-date-time-picker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

export type ActivityTimestampPickerMode = 'date' | 'time';

interface ActivityTimestampFieldProps {
  editable?: boolean;
  label: string;
  maximumDate: Date;
  onDone: () => void;
  onPick: (mode: ActivityTimestampPickerMode) => void;
  onPickerChange: (event: DateTimePickerEvent, selected?: Date) => void;
  pickerMode: ActivityTimestampPickerMode | null;
  timezone: string;
  value: Date;
}

/** Renders the shared exact date/time controls used by activity drawers. */
export function ActivityTimestampField({
  editable = true,
  label,
  maximumDate,
  onDone,
  onPick,
  onPickerChange,
  pickerMode,
  timezone,
  value,
}: ActivityTimestampFieldProps) {
  const formatters = useMemo(
    () => ({
      date: new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: timezone,
      }),
      time: new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone,
      }),
    }),
    [timezone],
  );

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValues}>
        <Pressable
          accessibilityLabel={`${label} date, ${formatters.date.format(value)}`}
          accessibilityRole="button"
          disabled={!editable}
          onPress={() => onPick('date')}
          style={[styles.valueButton, !editable && styles.readOnly]}
        >
          <Text style={styles.valueText}>{formatters.date.format(value)}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`${label} time, ${formatters.time.format(value)}`}
          accessibilityRole="button"
          disabled={!editable}
          onPress={() => onPick('time')}
          style={[styles.valueButton, styles.timeButton, !editable && styles.readOnly]}
        >
          <Text style={styles.valueText}>{formatters.time.format(value)}</Text>
        </Pressable>
      </View>

      {pickerMode === null ? null : (
        <View style={styles.pickerPanel}>
          <StableDateTimePicker
            key={pickerMode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={maximumDate}
            mode={pickerMode}
            onChange={onPickerChange}
            timeZoneName={timezone}
            value={value}
          />
          {Platform.OS === 'ios' ? (
            <Pressable accessibilityRole="button" onPress={onDone} style={styles.doneButton}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  fieldLabel: { color: '#292724', fontSize: 14, fontWeight: '700' },
  fieldValues: { flexDirection: 'row', gap: 10 },
  valueButton: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#EEEAF9',
  },
  timeButton: { flex: 0, minWidth: 104 },
  readOnly: { backgroundColor: '#F3F1EE' },
  valueText: { color: '#292724', fontSize: 15, fontWeight: '600' },
  pickerPanel: { alignItems: 'flex-end', padding: 8, borderRadius: 14, backgroundColor: '#F7F4EF' },
  doneButton: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: '#7367B9', fontSize: 15, fontWeight: '700' },
});
