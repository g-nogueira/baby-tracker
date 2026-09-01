import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { mergeDatePart, mergeTimePart } from '@/features/naps/nap-editor-state';
import { ActivityDrawer } from '@/features/shared/activity-drawer/activity-drawer';
import {
  ActivityTimestampField,
  type ActivityTimestampPickerMode,
} from '@/features/shared/activity-drawer/activity-timestamp-field';
import {
  type CompletedNightBoundary,
  type CompletedNightEditorState,
  completedNightEditorError,
  updateCompletedNightBoundary,
} from './completed-night-editor-state';

interface CompletedNightEditorDrawerProps {
  editor: CompletedNightEditorState;
  isMutating: boolean;
  mutationError: string | null;
  onCancel: () => void;
  onChange: (editor: CompletedNightEditorState) => void;
  onDelete: () => void;
  onSave: (editor: CompletedNightEditorState) => void;
}

type Picker = { boundary: CompletedNightBoundary; mode: ActivityTimestampPickerMode } | null;

/** Edits one completed Night's outer bounds while showing retained phase transitions. */
export function CompletedNightEditorDrawer({
  editor,
  isMutating,
  mutationError,
  onCancel,
  onChange,
  onDelete,
  onSave,
}: CompletedNightEditorDrawerProps) {
  const [picker, setPicker] = useState<Picker>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const error = completedNightEditorError(editor);
  const canSave = !isMutating && error === null && pickerError === null;

  const pickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const active = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (active === null || selected === undefined || event.type === 'dismissed') return;
    const current = active.boundary === 'bedtime' ? editor.bedtime : editor.wakeUp;
    try {
      const next =
        active.mode === 'date'
          ? mergeDatePart(current, selected, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone)
          : mergeTimePart(current, selected, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone);
      setPickerError(null);
      onChange(updateCompletedNightBoundary(editor, active.boundary, next));
    } catch (failure: unknown) {
      setPickerError(failure instanceof Error ? failure.message : 'Choose another date or time.');
    }
  };

  return (
    <ActivityDrawer activityLabel="Night sleep" mode="edit" onDismiss={onCancel} scrollContent>
      {() => (
        <>
          <View style={styles.hero}>
            <View style={styles.icon}>
              <Text style={styles.iconText}>☾</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              Edit Night sleep
            </Text>
            <Text style={styles.subtitle}>
              Correct Bedtime and Wake up; phase transitions stay fixed.
            </Text>
          </View>

          <View style={styles.section}>
            <ActivityTimestampField
              label="Bedtime"
              maximumDate={new Date()}
              onDone={() => setPicker(null)}
              onPick={(mode) => setPicker({ boundary: 'bedtime', mode })}
              onPickerChange={pickerChange}
              pickerMode={picker?.boundary === 'bedtime' ? picker.mode : null}
              timezone={LOCAL_DEVELOPMENT_IDENTITY.dayTimezone}
              value={editor.bedtime}
            />
            <ActivityTimestampField
              label="Wake up"
              maximumDate={new Date()}
              onDone={() => setPicker(null)}
              onPick={(mode) => setPicker({ boundary: 'wakeUp', mode })}
              onPickerChange={pickerChange}
              pickerMode={picker?.boundary === 'wakeUp' ? picker.mode : null}
              timezone={LOCAL_DEVELOPMENT_IDENTITY.dayTimezone}
              value={editor.wakeUp}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Phases · read only</Text>
            {editor.session.phases.map((phase, index) => {
              const startedAt = index === 0 ? editor.bedtime : new Date(phase.startedAt);
              const endedAt =
                index === editor.session.phases.length - 1
                  ? editor.wakeUp
                  : new Date(phase.endedAt ?? '');
              return (
                <View key={phase.id} style={styles.phaseRow}>
                  <Text style={styles.phaseKind}>
                    {phase.kind === 'asleep' ? 'Asleep' : 'Awake'}
                  </Text>
                  <Text style={styles.phaseTime}>
                    {clockFormatter.format(startedAt)} – {clockFormatter.format(endedAt)}
                  </Text>
                </View>
              );
            })}
          </View>

          {error === null ? null : (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          {pickerError === null ? null : (
            <Text accessibilityRole="alert" style={styles.error}>
              {pickerError}
            </Text>
          )}
          {mutationError === null ? null : (
            <Text accessibilityRole="alert" style={styles.error}>
              {mutationError}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: isMutating, disabled: !canSave }}
            disabled={!canSave}
            onPress={() => onSave(editor)}
            style={[styles.save, !canSave && styles.disabled]}
          >
            <Text style={styles.saveText}>Save changes</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={isMutating}
            onPress={onDelete}
            style={styles.delete}
          >
            <Text style={styles.deleteText}>Delete Night sleep</Text>
          </Pressable>
        </>
      )}
    </ActivityDrawer>
  );
}

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
});

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6 },
  icon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: '#E9E5F5',
  },
  iconText: { color: '#5B4C94', fontSize: 21, fontWeight: '900' },
  title: { color: '#292724', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#746F68', fontSize: 13, textAlign: 'center' },
  section: { gap: 12, padding: 14, borderRadius: 16, backgroundColor: '#FAF8F5' },
  sectionTitle: { color: '#292724', fontSize: 14, fontWeight: '800' },
  phaseRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E7E0D7',
  },
  phaseKind: { color: '#292724', fontSize: 13, fontWeight: '700' },
  phaseTime: { color: '#746F68', fontSize: 12, fontVariant: ['tabular-nums'] },
  error: { color: '#A64444', fontSize: 13, textAlign: 'center' },
  save: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#5B4C94',
  },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  delete: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#A64444', fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
