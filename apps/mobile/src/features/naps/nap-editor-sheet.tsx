import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { elapsedMilliseconds } from '@baby-tracker/domain';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { ActivityDrawer } from '@/features/shared/activity-drawer/activity-drawer';
import { formatLiveDuration } from './nap-clock';
import {
  editorForPrimaryAction,
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
  onSave: (editor: NapEditorState) => void;
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

/**
 * Renders the interface for starting, stopping, or editing a nap.
 *
 * @param editor - The current nap editor state and mode.
 * @param isMutating - Whether a nap mutation is in progress.
 * @param mutationError - The current mutation error, if any.
 * @param onCancel - Called when the editor is dismissed.
 * @param onChange - Called when an editor date or time changes.
 * @param onDelete - Called when the nap is deleted, if deletion is available.
 * @param onSave - Called to start, stop, or save the nap.
 */
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
  const [actionTimeWasAdjusted, setActionTimeWasAdjusted] = useState(false);
  const now = useLiveNow(editor.mode === 'stop');
  const error = useMemo(() => editorIntervalError(editor), [editor]);
  const startedAt =
    editor.mode === 'start'
      ? editor.startedAt
      : editor.mode === 'edit'
        ? editor.startedAt
        : new Date(editor.nap.startedAt);
  const endedAt =
    editor.mode === 'stop'
      ? actionTimeWasAdjusted
        ? editor.endedAt
        : now
      : editor.mode === 'edit'
        ? editor.endedAt
        : null;
  const canEditStart = editor.mode !== 'stop';
  const canEditEnd = editor.mode !== 'start' && endedAt !== null;
  const selectedPickerValue = picker?.field === 'endedAt' && endedAt !== null ? endedAt : startedAt;
  const actionTime = editor.mode === 'stop' ? (endedAt ?? editor.endedAt) : startedAt;
  const canSave = !isMutating && error === null && pickerError === null;

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
      if (editor.mode === 'stop' && activePicker.field === 'endedAt') {
        setActionTimeWasAdjusted(true);
      }
      onChange(updateEditorDate(editor, activePicker.field, next));
    } catch (error: unknown) {
      setPickerError(
        error instanceof Error ? error.message : 'Choose another date or time and try again.',
      );
    }
  };

  const adjustActionTime = (minutes: number) => {
    const field = editor.mode === 'stop' ? 'endedAt' : 'startedAt';
    const proposed = actionTime.getTime() + minutes * 60_000;
    const next = new Date(Math.min(proposed, Date.now()));
    setPickerError(null);
    if (editor.mode === 'stop') setActionTimeWasAdjusted(true);
    onChange(updateEditorDate(editor, field, next));
  };

  return (
    <ActivityDrawer
      activityLabel="Nap"
      mode={editor.mode === 'start' ? 'create' : editor.mode === 'stop' ? 'active' : 'edit'}
      onDismiss={onCancel}
    >
      {({ expanded }) => (
        <>
          <View style={styles.hero}>
            <View style={styles.napIconCircle}>
              <Text style={styles.napIcon}>z</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {editor.mode === 'stop' ? 'Stop nap' : editor.mode === 'edit' ? 'Edit nap' : 'Nap'}
            </Text>
            {editor.mode !== 'edit' ? (
              <Text style={styles.actionTime}>
                {editor.mode === 'stop'
                  ? formatLiveDuration(elapsedMilliseconds(editor.nap.startedAt, endedAt ?? now))
                  : timeFormatter.format(actionTime)}
              </Text>
            ) : null}
          </View>

          {editor.mode === 'edit' ? null : (
            <View style={styles.quickActions}>
              <MinuteButton label="−1 min" onPress={() => adjustActionTime(-1)} />
              <Pressable
                accessibilityLabel={editor.mode === 'start' ? 'Start nap' : 'Stop nap'}
                accessibilityRole="button"
                accessibilityState={{ busy: isMutating, disabled: !canSave }}
                disabled={!canSave}
                onPress={() =>
                  onSave(editorForPrimaryAction(editor, actionTimeWasAdjusted, new Date()))
                }
                style={({ pressed }) => [
                  styles.primaryAction,
                  !canSave && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryActionIcon}>{editor.mode === 'start' ? '▶' : '■'}</Text>
                <Text style={styles.primaryActionLabel}>
                  {editor.mode === 'start' ? 'Start' : 'Stop'}
                </Text>
              </Pressable>
              <MinuteButton label="+1 min" onPress={() => adjustActionTime(1)} />
            </View>
          )}

          {!expanded ? <Text style={styles.swipeHint}>Swipe up for date and time</Text> : null}

          {expanded ? (
            <View style={styles.expandedContent}>
              <Text style={styles.optionsTitle}>Date and time</Text>
              <TimeField
                editable={canEditStart}
                label="Start"
                onPick={(mode) => setPicker({ field: 'startedAt', mode })}
                value={startedAt}
              />
              {endedAt !== null ? (
                <TimeField
                  editable={canEditEnd}
                  label="End"
                  onPick={(mode) => setPicker({ field: 'endedAt', mode })}
                  value={endedAt}
                />
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

              {editor.mode === 'edit' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: isMutating, disabled: !canSave }}
                  disabled={!canSave}
                  onPress={() => onSave(editor)}
                  style={({ pressed }) => [
                    styles.saveEditButton,
                    !canSave && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.saveEditText}>Save changes</Text>
                </Pressable>
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
        </>
      )}
    </ActivityDrawer>
  );
}

/**
 * Tracks the current time while enabled and refreshes when the app becomes active.
 *
 * @param enabled - Whether to update the current time continuously
 * @returns The latest current time
 */
function useLiveNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => setNow(new Date()), 1_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [enabled]);

  return now;
}

/**
 * Renders a button for adjusting a timestamp by one minute.
 *
 * @param label - The adjustment label displayed on the button
 * @param onPress - The callback invoked when the button is pressed
 */
function MinuteButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`Adjust time ${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.minuteButton, pressed && styles.pressed]}
    >
      <Text style={styles.minuteIcon}>{label.startsWith('−') ? '↶' : '↷'}</Text>
      <Text style={styles.minuteLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * Displays a labeled date and time field with optional picker interaction.
 *
 * @param editable - Whether the date and time controls can be pressed
 * @param label - The field label
 * @param onPick - Handles selection of the date or time control
 * @param value - The date and time to display
 */
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
  hero: { alignItems: 'center', gap: 6 },
  napIconCircle: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: palette.accentSoft,
  },
  napIcon: { color: palette.accent, fontSize: 22, fontWeight: '900' },
  title: { color: palette.ink, fontSize: 18, fontWeight: '700' },
  actionTime: {
    color: palette.ink,
    fontSize: 32,
    fontWeight: '500',
    letterSpacing: -0.7,
    fontVariant: ['tabular-nums'],
  },
  quickActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingVertical: 2,
  },
  minuteButton: {
    width: 58,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  minuteIcon: { color: palette.muted, fontSize: 22 },
  minuteLabel: { color: palette.muted, fontSize: 11, fontWeight: '600' },
  primaryAction: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 38,
    backgroundColor: palette.accent,
    shadowColor: '#40377C',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  primaryActionIcon: { color: '#FFFFFF', fontSize: 20 },
  primaryActionLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  swipeHint: { color: palette.muted, fontSize: 12, textAlign: 'center', marginTop: 2 },
  expandedContent: {
    gap: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  optionsTitle: { color: palette.ink, fontSize: 15, fontWeight: '800' },
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
  pickerPanel: { alignItems: 'flex-end', padding: 8, borderRadius: 14, backgroundColor: '#F7F4EF' },
  doneButton: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: palette.accent, fontSize: 15, fontWeight: '700' },
  saveEditButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
    backgroundColor: palette.accent,
  },
  saveEditText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  deleteButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: palette.danger, fontSize: 15, fontWeight: '700' },
  errorText: { color: palette.danger, fontSize: 14, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
});
