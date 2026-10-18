import { RoundAction } from '@/features/shared/round-action';
import { SleepDetailsFields } from './sleep-details-fields';
import type { ActivityDetails } from './contracts';
import { Text } from '@/features/shared/tracking-text';
import { clockLabel, shortDuration, dayLabel } from './presentation';
import { useActivityTheme, type ActivityTheme } from '@/features/shared/activity-theme';
import { SheetToolbar } from './sheet-toolbar';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import Slider from '@react-native-community/slider';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { mergeDatePart, mergeTimePart } from '@/features/naps/nap-editor-state';
import { formatLiveDuration } from '@/features/naps/nap-clock';
import { ActivityTimestampField } from '@/features/shared/activity-drawer/activity-timestamp-field';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { activityDuration } from './sleep-state';
import type {
  ActivityReference,
  Breast,
  CareActivity,
  CareCommand,
  CareKind,
  DiaperType,
  PastActivity,
} from './contracts';

export const activityLabels: Record<CareKind, string> = {
  bedtime: 'Night sleep',
  'wake-up': 'Wake up',
  nap: 'Nap',
  'night-waking': 'Night waking',
  nursing: 'Nursing',
  diaper: 'Diaper',
  medicine: 'Medicine',
};
export const activityIcons: Record<CareKind, string> = {
  bedtime: 'bedtime',
  'wake-up': 'wake',
  nap: 'nap',
  'night-waking': 'night-waking',
  nursing: 'nursing',
  diaper: 'diaper',
  medicine: 'medicine',
};
export const activityColors: Record<CareKind, string> = {
  bedtime: '#5B4C94',
  'wake-up': '#D29B57',
  nap: '#7367B9',
  'night-waking': '#52728A',
  nursing: '#B35D7D',
  diaper: '#47735A',
  medicine: '#A65F35',
};
export const nightActivityColors: Record<CareKind, string> = {
  bedtime: '#E9A26E',
  'wake-up': '#F1C764',
  nap: '#8587FF',
  'night-waking': '#F09C8C',
  nursing: '#8EEBBE',
  diaper: '#A3CCB0',
  medicine: '#DDE876',
};
type Transition =
  | 'bedtime'
  | 'start-nap'
  | 'wake-up'
  | 'start-night-waking'
  | 'stop-nap'
  | 'fall-asleep';
export type ActivitySheetIntent =
  | { type: 'transition'; command: Transition; expected?: ActivityReference }
  | { type: 'edit'; activity: Exclude<CareActivity, { kind: 'nursing' }> }
  | { type: 'past'; at: string; kind?: CareKind }
  | { type: 'care'; kind: 'diaper' | 'medicine'; at: string };
interface Props {
  intent: ActivitySheetIntent;
  now: Date;
  timezone: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onExecute: (command: CareCommand) => void;
}
const transitionKind = (type: Transition): CareKind =>
  type === 'bedtime'
    ? 'bedtime'
    : type === 'wake-up'
      ? 'wake-up'
      : type === 'start-nap' || type === 'stop-nap'
        ? 'nap'
        : 'night-waking';

/** Native drawer for sleep, care records and historical creation; timestamps remain stable while ticking. */
export function ActivitySheet({ intent, now, timezone, busy, error, onClose, onExecute }: Props) {
  const theme = useActivityTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const record = intent.type === 'edit' ? intent.activity : null;
  const initial = useRef({
    start: new Date(record?.startedAt ?? ('at' in intent ? intent.at : now)),
    end: new Date(
      record?.endedAt ??
        (intent.type === 'past' ? Math.min(now.getTime(), Date.parse(intent.at) + 1800000) : now),
    ),
  }).current;
  const [kind, setKind] = useState<CareKind>(
    record?.kind ??
      (intent.type === 'transition'
        ? transitionKind(intent.command)
        : intent.type === 'care'
          ? intent.kind
          : intent.type === 'past'
            ? (intent.kind ?? 'nap')
            : 'nap'),
  );
  const color = (theme.night ? nightActivityColors : activityColors)[kind];
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [adjusted, setAdjusted] = useState(false);
  const [ending, setEnding] = useState(false);
  const [detailPatch, setDetailPatch] = useState<ActivityDetails>({});
  const details = { ...record?.details, ...detailPatch };
  const detailDirty = Object.keys(detailPatch).length > 0;
  const annotations = detailDirty ? { details: detailPatch } : {};
  const sleepDetails =
    kind === 'bedtime' || kind === 'nap' || kind === 'night-waking' || kind === 'wake-up';
  const [diaper, setDiaper] = useState<DiaperType>(
    record?.kind === 'diaper' ? (record.diaperType ?? 'wet') : 'wet',
  );
  const [note, setNote] = useState(record?.kind === 'medicine' ? (record.note ?? '') : '');
  const [left, setLeft] = useState(0);
  const [last, setLast] = useState<Breast | null>(null);
  const [picker, setPicker] = useState<{ field: 'start' | 'end'; mode: 'date' | 'time' } | null>(
    null,
  );
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(intent.type === 'past');
  const sheet = useRef<TrueSheet>(null);
  const opening = useRef(false);
  const { height } = useWindowDimensions();
  const timed = kind === 'nap' || kind === 'night-waking' || kind === 'nursing';
  const active = record !== null && record.status !== 'completed';
  const total = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const interval = timed && !active && (intent.type !== 'transition' || ending);
  const valid =
    start <= now &&
    (!interval || (end >= start && end <= now)) &&
    (kind !== 'nursing' ||
      (last !== null &&
        left <= total &&
        (total === 0 || (last === 'LEFT' ? left > 0 : total - left > 0))));
  const title =
    intent.type === 'transition' && intent.command === 'fall-asleep'
      ? 'Fell asleep again'
      : intent.type === 'past'
        ? 'Add past activity'
        : activityLabels[kind];
  const openTime = async (field: 'start' | 'end' = 'start', mode: 'date' | 'time' = 'time') => {
    if (opening.current || busy) return;
    opening.current = true;
    try {
      await sheet.current?.resize(1);
      setExpanded(true);
      setPicker({ field, mode });
    } catch {
      setPickerError('The time editor could not be opened. Close and reopen the drawer.');
    } finally {
      opening.current = false;
    }
  };
  const pick = (event: DateTimePickerEvent, selected?: Date) => {
    const current = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (!selected || !current || event.type === 'dismissed') return;
    try {
      const previous = current.field === 'start' ? start : end;
      const next =
        current.mode === 'date'
          ? mergeDatePart(previous, selected, timezone)
          : mergeTimePart(previous, selected, timezone);
      if (current.field === 'start') setStart(next);
      else {
        setEnd(next);
        setEnding(true);
      }
      setAdjusted(true);
      setPickerError(null);
    } catch {
      setPickerError('Choose another date or time.');
    }
  };
  const save = () => {
    if (!valid || busy || pickerError) return;
    if (intent.type === 'transition' && ending && (kind === 'nap' || kind === 'night-waking')) {
      onExecute({
        type: 'record-past',
        activity: {
          kind,
          startedAt: start.toISOString(),
          endedAt: end.toISOString(),
          ...annotations,
        },
      });
    } else if (intent.type === 'transition') {
      const at = (adjusted ? start : new Date()).toISOString();
      if (intent.command === 'bedtime' || intent.command === 'start-nap')
        onExecute({ type: intent.command, at, ...annotations });
      else if (intent.expected)
        onExecute({ type: intent.command, expected: intent.expected, at, ...annotations });
    } else if (intent.type === 'edit') {
      onExecute({
        ...annotations,
        type: 'edit-activity',
        expected: intent.activity,
        startedAt: start.toISOString(),
        ...(interval ? { endedAt: end.toISOString() } : {}),
        ...(kind === 'diaper' ? { diaperType: diaper } : {}),
        ...(kind === 'medicine' ? { note } : {}),
      });
    } else {
      const startedAt = (intent.type === 'care' && !adjusted ? new Date() : start).toISOString();
      let activity: PastActivity;
      if (kind === 'nursing') {
        if (!last) return;
        activity = {
          kind,
          startedAt,
          endedAt: end.toISOString(),
          leftSeconds: left,
          lastBreast: last,
        };
      } else if (kind === 'nap' || kind === 'night-waking')
        activity = { kind, startedAt, endedAt: end.toISOString() };
      else if (kind === 'diaper') activity = { kind, startedAt, diaperType: diaper };
      else if (kind === 'medicine') activity = { kind, startedAt, note };
      else activity = { kind, startedAt };
      onExecute({ type: 'record-past', activity: { ...activity, ...annotations } });
    }
  };
  const activeStop =
    active && (record.kind === 'nap' || record.kind === 'night-waking')
      ? () =>
          onExecute({
            type: record.kind === 'nap' ? 'stop-nap' : 'fall-asleep',
            expected: record,
            at: new Date().toISOString(),
            ...annotations,
          })
      : null;
  const footer = (
    <View pointerEvents="box-none" style={[styles.footer, { width: '100%' }]}>
      <View style={[styles.footerActions, { width: '100%' }]}>
        {intent.type === 'transition' && !active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start one minute earlier"
            disabled={busy}
            onPress={() => {
              setStart(new Date(start.getTime() - 60000));
              setAdjusted(true);
            }}
            style={styles.minute}
          >
            <ActivityIcon name="rewind" size={22} color={theme.muted} />
            <Text style={styles.muted}>-1 min</Text>
          </Pressable>
        ) : null}
        {!active || (expanded && (adjusted || detailDirty)) ? (
          <RoundAction
            label={
              active ? 'Save start time' : intent.type === 'transition' ? title : 'Save activity'
            }
            icon={
              intent.type === 'transition' &&
              (intent.command === 'start-nap' || intent.command === 'start-night-waking') &&
              !ending
                ? 'play'
                : 'check'
            }
            disabled={busy || !valid || pickerError !== null}
            onPress={save}
          />
        ) : null}
        {activeStop ? (
          <RoundAction
            label={record?.kind === 'nap' ? 'Stop Nap' : 'Fell asleep again'}
            icon="stop"
            disabled={busy}
            onPress={activeStop}
          />
        ) : null}
        {intent.type === 'transition' && !active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start one minute later"
            disabled={busy || start.getTime() + 60000 > now.getTime()}
            onPress={() => {
              setStart(new Date(start.getTime() + 60000));
              setAdjusted(true);
            }}
            style={[styles.minute, start.getTime() + 60000 > now.getTime() && styles.disabled]}
          >
            <ActivityIcon name="forward" size={22} color={theme.muted} />
            <Text style={styles.muted}>+1 min</Text>
          </Pressable>
        ) : null}
      </View>
      {record?.kind === 'nap' && active ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={record.status === 'paused' ? 'Resume Nap' : 'Pause Nap'}
          disabled={busy}
          onPress={() =>
            onExecute({
              type: record.status === 'paused' ? 'resume-nap' : 'pause-nap',
              expected: record,
              at: new Date().toISOString(),
            })
          }
          style={styles.pause}
        >
          <ActivityIcon
            name={record.status === 'paused' ? 'play' : 'pause'}
            size={18}
            color={theme.muted}
          />
          <Text style={styles.muted}>{record.status === 'paused' ? 'Resume' : 'Pause'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
  return (
    <TrueSheet
      ref={sheet}
      initialDetentIndex={intent.type === 'past' ? 1 : 0}
      detents={[
        kind === 'bedtime' ? 0.74 : Math.min(0.62, (kind === 'medicine' ? 490 : 450) / height),
        0.94,
      ]}
      scrollable
      footer={footer}
      cornerRadius={28}
      draggable
      dismissible
      backgroundColor={theme.surface}
      grabberOptions={{ color: theme.muted, width: 42, adaptive: false }}
      accessibilityOptions={{ paneTitle: title, grabberLabel: `${title} drawer` }}
      onDidDismiss={onClose}
      onDidPresent={({ nativeEvent }) => setExpanded(nativeEvent.index === 1)}
      onDetentChange={({ nativeEvent }) => setExpanded(nativeEvent.index === 1)}
    >
      <ScrollView
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <SheetToolbar
          label={activityLabels[kind]}
          busy={busy}
          onClose={() => void sheet.current?.dismiss()}
          onExpand={() => {
            void sheet.current
              ?.resize(1)
              .then(() => setExpanded(true))
              .catch(() => {
                setPickerError('Close and reopen the activity drawer to view its details.');
              });
          }}
          onRemove={
            record && record.kind !== 'bedtime' && record.kind !== 'wake-up'
              ? () => onExecute({ type: 'remove-activity', expected: record })
              : undefined
          }
        />
        <View style={styles.hero}>
          <ActivityIcon name={activityIcons[kind]} color={color} size={88} />
          <Text accessibilityRole="header" style={styles.title}>
            {kind === 'bedtime' ? 'Bedtime' : title}
          </Text>
          {!expanded && active && (record.kind === 'nap' || record.kind === 'night-waking') ? (
            <Text style={styles.timer}>{formatLiveDuration(activityDuration(record, now))}</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Set ${activityLabels[kind]} time`}
              disabled={busy}
              onPress={() => void openTime()}
              style={{ width: '100%', alignItems: 'center' }}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[styles.timer, record?.status === 'completed' && timed && styles.range]}
              >
                {record?.status === 'completed' && timed
                  ? `${clockLabel(start, timezone, false)} – ${clockLabel(end, timezone, false)}`
                  : expanded && timed
                    ? `${clockLabel(start, timezone, false)} – ${ending ? clockLabel(end, timezone, false) : active ? '…' : 'Set time'}`
                    : clockLabel(start, timezone, false)}
              </Text>
            </Pressable>
          )}
          {expanded && timed && (active || (intent.type === 'transition' && !ending)) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Set activity end time"
              disabled={busy || active}
              onPress={() => void openTime('end')}
              style={styles.setEnd}
            >
              <Text style={styles.muted}>{active ? 'End · Running' : 'Set end time'}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Set activity date"
            disabled={busy}
            onPress={() => void openTime('start', 'date')}
            style={styles.date}
          >
            <Text style={[styles.muted, { width: '100%', textAlign: 'center' }]}>
              {dayLabel(start, now, timezone)}
            </Text>
          </Pressable>
          {record?.status === 'completed' && timed ? (
            <Text style={styles.summary}>
              {shortDuration(end.getTime() - start.getTime())} long ·{' '}
              {shortDuration(now.getTime() - end.getTime())} ago
            </Text>
          ) : null}
        </View>
        {intent.type === 'past' ? (
          <View style={styles.choices}>
            {(Object.keys(activityLabels) as CareKind[]).map((choice) => (
              <Pressable
                key={choice}
                accessibilityRole="radio"
                accessibilityState={{ checked: kind === choice }}
                disabled={busy}
                onPress={() => {
                  setKind(choice);
                  setDetailPatch({});
                  setPicker(null);
                }}
                style={[styles.choice, kind === choice && styles.selected]}
              >
                <Text style={styles.choiceText}>{activityLabels[choice]}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {expanded && (!sleepDetails || picker !== null || intent.type === 'past') ? (
          <>
            <ActivityTimestampField
              label={intent.type === 'transition' ? 'Time' : 'Start'}
              value={start}
              timezone={timezone}
              maximumDate={now}
              editable={!busy}
              pickerMode={picker?.field === 'start' ? picker.mode : null}
              onPick={(mode) => setPicker({ field: 'start', mode })}
              onDone={() => setPicker(null)}
              onPickerChange={pick}
            />
            {interval || picker?.field === 'end' ? (
              <ActivityTimestampField
                label="End"
                value={end}
                timezone={timezone}
                maximumDate={now}
                editable={!busy}
                pickerMode={picker?.field === 'end' ? picker.mode : null}
                onPick={(mode) => setPicker({ field: 'end', mode })}
                onDone={() => setPicker(null)}
                onPickerChange={pick}
              />
            ) : active ? (
              <Text style={styles.muted}>End · Running</Text>
            ) : null}
          </>
        ) : null}
        {sleepDetails && (expanded || kind === 'bedtime') ? (
          <SleepDetailsFields
            kind={kind as 'bedtime' | 'nap' | 'night-waking' | 'wake-up'}
            details={details}
            disabled={busy}
            onChange={(patch) => setDetailPatch((previous) => ({ ...previous, ...patch }))}
          />
        ) : null}
        {kind === 'diaper' ? (
          <View style={styles.choices}>
            {(['dry', 'wet', 'dirty', 'mixed'] as const).map((choice) => (
              <Pressable
                key={choice}
                accessibilityRole="radio"
                accessibilityLabel={`${choice} diaper`}
                accessibilityState={{ checked: diaper === choice }}
                disabled={busy}
                onPress={() => setDiaper(choice)}
                style={[styles.choice, diaper === choice && styles.selected]}
              >
                <Text style={styles.choiceText}>{choice[0].toUpperCase() + choice.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {kind === 'medicine' ? (
          <TextInput
            accessibilityLabel="Medicine note"
            multiline
            placeholder="Medicine / note"
            value={note}
            editable={!busy}
            onChangeText={setNote}
            style={styles.note}
          />
        ) : null}
        {kind === 'nursing' ? (
          <>
            <Text style={styles.muted}>
              Left {formatLiveDuration(left * 1000)} · Right{' '}
              {formatLiveDuration(Math.max(0, total - left) * 1000)}
            </Text>
            <Slider
              accessibilityLabel="Past Nursing Left seconds"
              minimumValue={0}
              maximumValue={total}
              step={1}
              value={Math.min(left, total)}
              disabled={busy}
              onValueChange={setLeft}
            />
            <Text style={styles.muted}>Last breast used</Text>
            <View style={styles.choices}>
              {(['LEFT', 'RIGHT'] as const).map((side) => (
                <Pressable
                  key={side}
                  accessibilityRole="radio"
                  accessibilityLabel={`Last breast ${side}`}
                  accessibilityState={{ checked: last === side }}
                  disabled={busy}
                  onPress={() => setLast(side)}
                  style={[styles.choice, last === side && styles.selected]}
                >
                  <Text style={styles.choiceText}>{side === 'LEFT' ? 'Left' : 'Right'}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        {!valid ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {kind === 'nursing' && last === null
              ? 'Choose the last breast used.'
              : 'Keep Start and End in order and in the past, with a valid breast split.'}
          </Text>
        ) : null}
        {pickerError || error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {pickerError ?? error}
          </Text>
        ) : null}
        {record?.kind === 'nap' &&
        record.status === 'completed' &&
        record.endedAt &&
        now.getTime() - Date.parse(record.endedAt) <= 3600000 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue Nap"
            disabled={busy}
            onPress={() =>
              onExecute({ type: 'continue-nap', expected: record, at: new Date().toISOString() })
            }
            style={styles.choice}
          >
            <Text style={styles.choiceText}>Continue Nap</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </TrueSheet>
  );
}
const createStyles = (theme: ActivityTheme) =>
  StyleSheet.create({
    content: { padding: 20, paddingTop: 16, paddingBottom: 160, gap: 28 },
    footer: { paddingTop: 12, paddingBottom: 24, alignItems: 'center', gap: 8 },
    footerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 32,
    },
    minute: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 6 },
    pause: {
      minHeight: 44,
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    date: { minHeight: 32, justifyContent: 'center', width: '100%', alignItems: 'center' },
    setEnd: {
      minHeight: 44,
      justifyContent: 'center',
      backgroundColor: theme.field,
      borderRadius: 12,
      paddingHorizontal: 16,
    },
    hero: { alignItems: 'center', gap: 16, marginTop: -28, paddingHorizontal: 24 },
    title: { fontSize: 20, fontWeight: '500', color: theme.muted },
    summary: { marginTop: 4, fontSize: 14, color: theme.muted, opacity: 0.65, textAlign: 'center' },
    range: { fontSize: 40, lineHeight: 52, letterSpacing: -0.5, textAlign: 'center' },
    timer: { fontSize: 38, color: theme.text, fontWeight: '500', fontVariant: ['tabular-nums'] },
    choices: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
    choice: {
      padding: 12,
      minHeight: 44,
      borderRadius: 14,
      backgroundColor: theme.field,
      justifyContent: 'center',
      alignItems: 'center',
    },
    selected: { backgroundColor: theme.accentSoft, borderWidth: 1, borderColor: theme.accent },
    choiceText: { fontSize: 14, color: theme.text, fontWeight: '600' },
    muted: { color: theme.muted, fontSize: 13 },
    note: {
      minHeight: 90,
      padding: 12,
      borderRadius: 14,
      backgroundColor: theme.field,
      textAlignVertical: 'top',
      fontSize: 16,
      color: theme.text,
    },
    save: {
      width: 80,
      height: 80,
      backgroundColor: '#999BFF',
      borderWidth: 2,
      borderColor: '#BCBDFF',
      marginTop: 16,
      alignSelf: 'center',
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 12,
    },
    white: { color: theme.onAccent, fontSize: 16, fontWeight: '700' },
    stop: {
      alignSelf: 'center',
      width: 80,
      height: 80,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#999BFF',
      borderWidth: 2,
      borderColor: '#BCBDFF',
      borderRadius: 40,
    },
    disabled: { opacity: 0.4 },
    error: { color: theme.error, fontSize: 14 },
  });
