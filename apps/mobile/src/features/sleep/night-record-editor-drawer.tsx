import { elapsedMilliseconds } from '@baby-tracker/domain';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { formatLiveDuration } from '@/features/naps/nap-clock';
import { mergeDatePart, mergeTimePart } from '@/features/naps/nap-editor-state';
import { ActivityDrawer } from '@/features/shared/activity-drawer/activity-drawer';
import {
  ActivityTimestampField,
  type ActivityTimestampPickerMode,
} from '@/features/shared/activity-drawer/activity-timestamp-field';
import {
  type NightRecordEditorState,
  nightRecordEditorChanged,
  nightRecordEditorError,
} from './night-record-editor-state';

type Boundary = 'startedAt' | 'endedAt';
type Picker = { boundary: Boundary; mode: ActivityTimestampPickerMode } | null;

interface Props {
  editor: NightRecordEditorState;
  now: Date;
  isMutating: boolean;
  mutationError: string | null;
  onCancel: () => void;
  onChange: (editor: NightRecordEditorState) => void;
  onDelete: (() => void) | null;
  onSave: (editor: NightRecordEditorState) => void;
  onFinish: () => void;
}

/** Active controls and exact-record edits share one draft, without changing Night state on open. */
export function NightRecordEditorDrawer({
  editor,
  now,
  isMutating,
  mutationError,
  onCancel,
  onChange,
  onDelete,
  onSave,
  onFinish,
}: Props) {
  const [picker, setPicker] = useState<Picker>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const awake = editor.phaseId !== null;
  const title = awake ? 'Night waking' : 'Night sleep';
  const active = editor.endedAt === null;
  const error = pickerError ?? nightRecordEditorError(editor, now) ?? mutationError;
  const dirty = nightRecordEditorChanged(editor);
  const canSave =
    !isMutating && pickerError === null && nightRecordEditorError(editor, now) === null;
  const record = awake
    ? editor.session.phases.find((phase) => phase.id === editor.phaseId)
    : editor.session;
  // The live clock always describes persisted state; unsaved edits stay in the fields below.
  const duration = formatLiveDuration(
    elapsedMilliseconds(
      record?.startedAt ?? editor.session.startedAt,
      record?.endedAt === null ? now : new Date(record?.endedAt ?? editor.session.startedAt),
    ),
  );
  const finishLabel = awake ? 'Fell asleep again' : 'Wake up';
  const endLabel =
    awake && editor.phaseId !== editor.session.phases.at(-1)?.id ? 'Fell asleep again' : 'Wake up';
  const timezone = LOCAL_DEVELOPMENT_IDENTITY.dayTimezone;

  const pickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const currentPicker = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (currentPicker === null || selected === undefined || event.type === 'dismissed') return;
    const current = editor[currentPicker.boundary];
    if (current === null) return;
    try {
      const value =
        currentPicker.mode === 'date'
          ? mergeDatePart(current, selected, timezone)
          : mergeTimePart(current, selected, timezone);
      setPickerError(null);
      onChange({ ...editor, [currentPicker.boundary]: value });
    } catch (failure: unknown) {
      setPickerError(failure instanceof Error ? failure.message : 'Choose another date or time.');
    }
  };

  return (
    <ActivityDrawer activityLabel={title} mode={editor.mode} onDismiss={onCancel} scrollContent>
      {({ expanded }) => (
        <>
          <View style={styles.hero}>
            <Text style={styles.icon}>{awake ? '↯' : '☾'}</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.duration}>{duration}</Text>
            <Text style={styles.subtitle}>
              {active ? (awake ? 'Awake tonight' : 'Night in progress') : 'Saved record'}
            </Text>
          </View>
          {active ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isMutating || dirty, busy: isMutating }}
              disabled={isMutating || dirty}
              onPress={onFinish}
              style={[styles.primary, (isMutating || dirty) && styles.disabled]}
            >
              <Text style={styles.primaryText}>{finishLabel}</Text>
            </Pressable>
          ) : null}
          {!expanded ? (
            <Text style={styles.subtitle}>Swipe up to edit the start time</Text>
          ) : (
            <>
              <ActivityTimestampField
                editable={!isMutating}
                label={awake ? 'Waking started' : 'Bedtime'}
                maximumDate={now}
                onDone={() => setPicker(null)}
                onPick={(mode) => setPicker({ boundary: 'startedAt', mode })}
                onPickerChange={pickerChange}
                pickerMode={picker?.boundary === 'startedAt' ? picker.mode : null}
                timezone={timezone}
                value={editor.startedAt}
              />
              {editor.endedAt === null ? null : (
                <ActivityTimestampField
                  editable={!isMutating}
                  label={endLabel}
                  maximumDate={now}
                  onDone={() => setPicker(null)}
                  onPick={(mode) => setPicker({ boundary: 'endedAt', mode })}
                  onPickerChange={pickerChange}
                  pickerMode={picker?.boundary === 'endedAt' ? picker.mode : null}
                  timezone={timezone}
                  value={editor.endedAt}
                />
              )}
              {dirty && active ? (
                <Text style={styles.subtitle}>Save the new time before ending this activity.</Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave || !dirty, busy: isMutating }}
                disabled={!canSave || !dirty}
                onPress={() => onSave(editor)}
                style={[styles.primary, (!canSave || !dirty) && styles.disabled]}
              >
                <Text style={styles.primaryText}>Save changes</Text>
              </Pressable>
              {onDelete === null ? null : (
                <Pressable
                  accessibilityRole="button"
                  disabled={isMutating}
                  onPress={onDelete}
                  style={styles.delete}
                >
                  <Text style={styles.deleteText}>Delete Night sleep</Text>
                </Pressable>
              )}
            </>
          )}
          {error === null ? null : (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </>
      )}
    </ActivityDrawer>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6 },
  icon: { color: '#5B4C94', fontSize: 28 },
  title: { color: '#292724', fontSize: 20, fontWeight: '700' },
  duration: { color: '#292724', fontSize: 36, fontVariant: ['tabular-nums'] },
  subtitle: { color: '#746F68', fontSize: 13, textAlign: 'center' },
  primary: {
    minHeight: 50,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#5B4C94',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  delete: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#A64444', fontSize: 14, fontWeight: '700' },
  error: { color: '#A64444', fontSize: 14, textAlign: 'center' },
  disabled: { opacity: 0.45 },
});
