import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import {
  editorIntervalError,
  mergeDatePart,
  mergeTimePart,
  type NapEditorState,
  updateEditorDate,
} from './nap-editor-state';

interface NapEditorSheetProps {
  editor: NapEditorState;
  isMutating: boolean;
  mutationError: string | null;
  onCancel: () => void;
  onChange: (editor: NapEditorState) => void;
  onDelete: (() => void) | null;
  onSave: () => void;
}

type PickerState = { field: 'startedAt' | 'endedAt'; mode: 'date' | 'time' } | null;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
});

export function NapEditorSheet({
  editor,
  isMutating,
  mutationError,
  onCancel,
  onChange,
  onDelete,
  onSave,
}: NapEditorSheetProps) {
  const [picker, setPicker] = useState<PickerState>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const error = useMemo(() => editorIntervalError(editor), [editor]);
  const startedAt =
    editor.mode === 'start'
      ? editor.startedAt
      : editor.mode === 'edit'
        ? editor.startedAt
        : new Date(editor.nap.startedAt);
  const endedAt =
    editor.mode === 'stop' ? editor.endedAt : editor.mode === 'edit' ? editor.endedAt : null;
  const canEditStart = editor.mode !== 'stop';
  const canEditEnd = editor.mode !== 'start' && endedAt !== null;

  const selectedPickerValue = picker?.field === 'endedAt' && endedAt !== null ? endedAt : startedAt;

  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const activePicker = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (event.type === 'dismissed' || selected === undefined || activePicker === null) return;

    const current = activePicker.field === 'startedAt' ? startedAt : (endedAt ?? startedAt);
    try {
      const next =
        activePicker.mode === 'date'
          ? mergeDatePart(current, selected, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone)
          : mergeTimePart(current, selected, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone);
      setPickerError(null);
      onChange(updateEditorDate(editor, activePicker.field, next));
    } catch (error: unknown) {
      setPickerError(
        error instanceof Error ? error.message : 'Choose another date or time and try again.',
      );
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onCancel} transparent>
      <View style={styles.overlay}>
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              disabled={isMutating}
              onPress={onCancel}
              style={styles.headerButton}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>
              {editorTitle(editor)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: isMutating || error !== null || pickerError !== null,
              }}
              disabled={isMutating || error !== null || pickerError !== null}
              onPress={onSave}
              style={styles.headerButton}
            >
              <Text
                style={[
                  styles.saveText,
                  (isMutating || error !== null || pickerError !== null) && styles.disabledText,
                ]}
              >
                Save
              </Text>
            </Pressable>
          </View>

          <TimeField
            label="Start"
            value={startedAt}
            editable={canEditStart}
            onPick={(mode) => setPicker({ field: 'startedAt', mode })}
          />
          {endedAt !== null ? (
            <TimeField
              label="End"
              value={endedAt}
              editable={canEditEnd}
              onPick={(mode) => setPicker({ field: 'endedAt', mode })}
            />
          ) : null}

          {error !== null ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          ) : null}
          {mutationError !== null ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {mutationError}
            </Text>
          ) : null}
          {pickerError !== null ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {pickerError}
            </Text>
          ) : null}

          {picker !== null ? (
            <View style={styles.pickerPanel}>
              <DateTimePicker
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                maximumDate={new Date()}
                mode={picker.mode}
                onChange={handlePickerChange}
                timeZoneName={LOCAL_DEVELOPMENT_IDENTITY.dayTimezone}
                value={selectedPickerValue}
              />
              {Platform.OS === 'ios' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPicker(null)}
                  style={styles.doneButton}
                >
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {onDelete !== null ? (
            <Pressable
              accessibilityRole="button"
              disabled={isMutating}
              onPress={onDelete}
              style={styles.deleteButton}
            >
              <Text style={styles.deleteText}>Delete nap</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function TimeField({
  editable,
  label,
  onPick,
  value,
}: {
  editable: boolean;
  label: string;
  onPick: (mode: 'date' | 'time') => void;
  value: Date;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValues}>
        <Pressable
          accessibilityLabel={`${label} date, ${dateFormatter.format(value)}`}
          accessibilityRole="button"
          disabled={!editable}
          onPress={() => onPick('date')}
          style={[styles.valueButton, !editable && styles.readOnly]}
        >
          <Text style={styles.valueText}>{dateFormatter.format(value)}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`${label} time, ${timeFormatter.format(value)}`}
          accessibilityRole="button"
          disabled={!editable}
          onPress={() => onPick('time')}
          style={[styles.valueButton, styles.timeButton, !editable && styles.readOnly]}
        >
          <Text style={styles.valueText}>{timeFormatter.format(value)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function editorTitle(editor: NapEditorState): string {
  if (editor.mode === 'start') return 'Start a nap';
  if (editor.mode === 'stop') return 'Stop nap';
  return 'Edit nap';
}

const palette = {
  surface: '#FFFFFF',
  ink: '#292724',
  muted: '#746F68',
  accent: '#7367B9',
  accentSoft: '#EEEAF9',
  danger: '#A64444',
  border: '#E7E0D7',
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(35, 31, 28, 0.38)' },
  sheet: {
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: palette.surface,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  title: { color: palette.ink, fontSize: 18, fontWeight: '700' },
  cancelText: { color: palette.muted, fontSize: 16 },
  saveText: { color: palette.accent, fontSize: 16, fontWeight: '700', textAlign: 'right' },
  disabledText: { opacity: 0.45 },
  field: { gap: 8 },
  fieldLabel: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  fieldValues: { flexDirection: 'row', gap: 10 },
  valueButton: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: palette.accentSoft,
  },
  timeButton: { flex: 0, minWidth: 104 },
  readOnly: { backgroundColor: '#F3F1EE' },
  valueText: { color: palette.ink, fontSize: 15, fontWeight: '600' },
  errorText: { color: palette.danger, fontSize: 14 },
  pickerPanel: { alignItems: 'flex-end', padding: 8, borderRadius: 14, backgroundColor: '#F7F4EF' },
  doneButton: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: palette.accent, fontSize: 15, fontWeight: '700' },
  deleteButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: palette.danger, fontSize: 15, fontWeight: '700' },
});
