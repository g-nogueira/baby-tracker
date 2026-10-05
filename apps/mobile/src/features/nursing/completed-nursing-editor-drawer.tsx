import { StableDateTimePicker } from '@/features/shared/activity-drawer/stable-date-time-picker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { formatLiveDuration } from '@/features/naps/nap-clock';
import { mergeDatePart, mergeTimePart } from '@/features/naps/nap-editor-state';
import { ActivityDrawer } from '@/features/shared/activity-drawer/activity-drawer';
import {
  type CompletedNursingEditorState,
  completedNursingEditorError,
  completedNursingEditorTotals,
  updateCompletedNursingBoundary,
  updateCompletedNursingLeftSeconds,
} from './completed-nursing-editor-state';
import { NursingSplitSlider } from './nursing-split-slider';

interface CompletedNursingEditorDrawerProps {
  editor: CompletedNursingEditorState;
  isMutating: boolean;
  mutationError: string | null;
  onCancel: () => void;
  onChange: (editor: CompletedNursingEditorState) => void;
  onDelete: (() => void) | null;
  onSave: (editor: CompletedNursingEditorState) => void;
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

/** Edits one exact completed Nursing aggregate without exposing pause or Right as inputs. */
export function CompletedNursingEditorDrawer({
  editor,
  isMutating,
  mutationError,
  onCancel,
  onChange,
  onDelete,
  onSave,
}: CompletedNursingEditorDrawerProps) {
  const live = editor.activeSession;
  const [picker, setPicker] = useState<PickerState>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const totals = useMemo(() => completedNursingEditorTotals(editor), [editor]);
  const error = completedNursingEditorError(editor);
  const canSave = !isMutating && error === null && pickerError === null;
  const activeDurationSeconds = totals.activeDurationSeconds;
  const rightDurationSeconds = totals.rightDurationSeconds;
  const selectedPickerValue = picker?.field === 'endedAt' ? editor.endedAt : editor.startedAt;

  useEffect(() => {
    if (live === undefined && editor.lastAdjustmentAnnouncement !== null) {
      AccessibilityInfo.announceForAccessibility(editor.lastAdjustmentAnnouncement);
    }
  }, [editor.lastAdjustmentAnnouncement, live]);

  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const activePicker = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (event.type === 'dismissed' || selected === undefined || activePicker === null) return;

    const current = activePicker.field === 'startedAt' ? editor.startedAt : editor.endedAt;
    try {
      const next =
        activePicker.mode === 'date'
          ? mergeDatePart(current, selected, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone)
          : mergeTimePart(current, selected, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone);
      setPickerError(null);
      onChange(updateCompletedNursingBoundary(editor, activePicker.field, next));
    } catch (pickerFailure: unknown) {
      setPickerError(
        pickerFailure instanceof Error
          ? pickerFailure.message
          : 'Choose another date or time and try again.',
      );
    }
  };

  return (
    <ActivityDrawer activityLabel="Nursing" mode="edit" onDismiss={onCancel} scrollContent>
      {() => (
        <>
          <View style={styles.hero}>
            <View style={styles.iconCircle}>
              <Text style={styles.icon}>N</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              Edit Nursing
            </Text>
            <Text style={styles.subtitle}>
              {live === undefined
                ? 'Adjust the interval and redistribute active time.'
                : `Adjust time through ${timeFormatter.format(editor.endedAt)}. ${live.status === 'paused' ? 'The pause' : 'The current breast'} keeps running.`}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Date and time</Text>
            <TimestampField
              disabled={isMutating}
              label="Start"
              onPick={(mode) => setPicker({ field: 'startedAt', mode })}
              value={editor.startedAt}
            />
            {live === undefined ? (
              <TimestampField
                disabled={isMutating}
                label="End"
                onPick={(mode) => setPicker({ field: 'endedAt', mode })}
                value={editor.endedAt}
              />
            ) : null}
            {picker !== null ? (
              <View style={styles.pickerPanel}>
                <StableDateTimePicker
                  key={picker.mode}
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
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle}>Left / Right split</Text>
              <Text style={styles.lastLabel}>
                Last ·{' '}
                {(live?.lastBreastUsed ?? editor.lastBreastUsed) === 'left' ? 'Left' : 'Right'}
              </Text>
            </View>
            <NursingSplitSlider
              accessibilityText={
                rightDurationSeconds === null
                  ? 'Split unavailable until the interval is valid'
                  : `Left ${formatSeconds(editor.leftDurationSeconds)}, Right ${formatSeconds(rightDurationSeconds)}`
              }
              disabled={activeDurationSeconds === null || activeDurationSeconds === 0 || isMutating}
              maximumValue={activeDurationSeconds ?? 0}
              onValueChange={(value) => onChange(updateCompletedNursingLeftSeconds(editor, value))}
              value={editor.leftDurationSeconds}
            />
            <View style={styles.splitLabels}>
              <Metric label="Left" value={formatSeconds(editor.leftDurationSeconds)} />
              <Metric
                label="Right"
                value={rightDurationSeconds === null ? '—' : formatSeconds(rightDurationSeconds)}
              />
            </View>
            {live !== undefined || editor.lastAdjustmentAnnouncement === null ? null : (
              <Text style={styles.adjustmentText}>{editor.lastAdjustmentAnnouncement}</Text>
            )}
          </View>

          <View style={styles.summary}>
            <Metric label="Pause · read only" value={formatSeconds(totals.pauseDurationSeconds)} />
            <Metric
              label="Active total"
              value={activeDurationSeconds === null ? '—' : formatSeconds(activeDurationSeconds)}
            />
            <Metric
              label="Elapsed"
              value={
                totals.elapsedDurationSeconds === null
                  ? '—'
                  : formatSeconds(totals.elapsedDurationSeconds)
              }
            />
          </View>

          {error === null ? null : (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          )}
          {pickerError === null ? null : (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {pickerError}
            </Text>
          )}
          {mutationError === null ? null : (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {mutationError}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: isMutating, disabled: !canSave }}
            disabled={!canSave}
            onPress={() => onSave(editor)}
            style={({ pressed }) => [
              styles.saveButton,
              !canSave && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.saveText}>Save changes</Text>
          </Pressable>
          {onDelete === null ? null : (
            <Pressable
              accessibilityRole="button"
              disabled={isMutating}
              onPress={onDelete}
              style={styles.deleteButton}
            >
              <Text style={styles.deleteText}>Delete Nursing session</Text>
            </Pressable>
          )}
        </>
      )}
    </ActivityDrawer>
  );
}

function TimestampField({
  disabled,
  label,
  onPick,
  value,
}: {
  disabled: boolean;
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
          disabled={disabled}
          onPress={() => onPick('date')}
          style={styles.valueButton}
        >
          <Text style={styles.valueText}>{dateFormatter.format(value)}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`${label} time, ${timeFormatter.format(value)}`}
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => onPick('time')}
          style={[styles.valueButton, styles.timeButton]}
        >
          <Text style={styles.valueText}>{timeFormatter.format(value)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function formatSeconds(seconds: number): string {
  return formatLiveDuration(seconds * 1_000);
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 5 },
  iconCircle: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: '#F6E4EB',
  },
  icon: { color: '#B35D7D', fontSize: 20, fontWeight: '900' },
  title: { color: '#292724', fontSize: 18, fontWeight: '700' },
  subtitle: { color: '#746F68', fontSize: 13, textAlign: 'center' },
  section: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: '#FAF8F5' },
  sectionTitle: { color: '#292724', fontSize: 15, fontWeight: '800' },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  lastLabel: { color: '#B35D7D', fontSize: 12, fontWeight: '800' },
  field: { gap: 6 },
  fieldLabel: { color: '#746F68', fontSize: 12, fontWeight: '700' },
  fieldValues: { flexDirection: 'row', gap: 8 },
  valueButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E7E0D7',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  timeButton: { flex: 0.62 },
  valueText: { color: '#292724', fontSize: 13, fontWeight: '700' },
  pickerPanel: { padding: 8, borderRadius: 14, backgroundColor: '#FFFFFF' },
  doneButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: '#B35D7D', fontWeight: '800' },
  splitLabels: { flexDirection: 'row', gap: 12 },
  summary: { flexDirection: 'row', gap: 8 },
  metric: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  metricLabel: { color: '#746F68', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  metricValue: { color: '#292724', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  adjustmentText: { color: '#8D3E5C', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  errorText: { color: '#A64444', fontSize: 13, textAlign: 'center' },
  saveButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#B35D7D',
  },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  deleteButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#A64444', fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
});
