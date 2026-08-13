import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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

export function NapEditorSheet({
  editor,
  isMutating,
  mutationError,
  onCancel,
  onChange,
  onDelete,
  onSave,
}: NapEditorSheetProps) {
  const [expanded, setExpanded] = useState(editor.mode === 'edit');
  const [picker, setPicker] = useState<PickerState>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const translation = useRef(new Animated.Value(0)).current;
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
  const actionTime = editor.mode === 'stop' ? editor.endedAt : startedAt;
  const canSave = !isMutating && error === null && pickerError === null;

  const settleSheet = useCallback(() => {
    Animated.spring(translation, {
      toValue: 0,
      damping: 24,
      stiffness: 260,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [translation]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          translation.setValue(gesture.dy < 0 ? gesture.dy * 0.22 : gesture.dy);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 72 || gesture.vy > 1.15) {
            Animated.timing(translation, {
              toValue: 700,
              duration: 180,
              useNativeDriver: true,
            }).start(onCancel);
            return;
          }
          if (gesture.dy < -38 || gesture.vy < -0.8) setExpanded(true);
          settleSheet();
        },
        onPanResponderTerminate: settleSheet,
      }),
    [onCancel, settleSheet, translation],
  );

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

  const adjustActionTime = (minutes: number) => {
    const field = editor.mode === 'stop' ? 'endedAt' : 'startedAt';
    const proposed = actionTime.getTime() + minutes * 60_000;
    const next = new Date(Math.min(proposed, Date.now()));
    setPickerError(null);
    onChange(updateEditorDate(editor, field, next));
  };

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close nap controls"
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[styles.sheet, { transform: [{ translateY: translation }] }]}
        >
          <Pressable
            accessibilityHint={
              expanded
                ? 'Swipe down to close nap controls'
                : 'Swipe up for date and time options, or down to close'
            }
            accessibilityLabel={expanded ? 'Nap controls expanded' : 'More nap options'}
            accessibilityRole="adjustable"
            onPress={() => setExpanded((current) => !current)}
            style={styles.handleTarget}
            {...panResponder.panHandlers}
          >
            <View style={styles.handle} />
          </Pressable>

          <View style={styles.hero}>
            <View style={styles.napIconCircle}>
              <Text style={styles.napIcon}>z</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {editor.mode === 'stop' ? 'Stop nap' : editor.mode === 'edit' ? 'Edit nap' : 'Nap'}
            </Text>
            {editor.mode !== 'edit' ? (
              <Text style={styles.actionTime}>{timeFormatter.format(actionTime)}</Text>
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
                onPress={() => onSave(editor)}
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
        </Animated.View>
      </View>
    </Modal>
  );
}

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
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(35, 31, 28, 0.38)' },
  sheet: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 30,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: palette.surface,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -5 },
    elevation: 12,
  },
  handleTarget: { minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#C9C2B9' },
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
