import { Text } from '@/features/shared/tracking-text';
import { clockLabel, shortDuration } from './presentation';
import { useActivityTheme, type ActivityTheme } from '@/features/shared/activity-theme';
import { ActivityBadge } from '@/features/shared/icons/activity-badge';
import { SheetToolbar } from './sheet-toolbar';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import Slider from '@react-native-community/slider';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { mergeDatePart, mergeTimePart } from '@/features/naps/nap-editor-state';
import { formatLiveDuration } from '@/features/naps/nap-clock';
import { ActivityTimestampField } from '@/features/shared/activity-drawer/activity-timestamp-field';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import type { ActivityReference, Breast, NursingActivity, NursingCommand } from './contracts';
import { nursingTimes } from './nursing';

interface Props {
  log: NursingActivity | null;
  last: Breast | null;
  timezone: string;
  now: Date;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onStart: (side: Breast, start: Date) => void;
  onChange: (command: NursingCommand) => void;
  onCorrect: (start: Date, end: Date, left: number, last: Breast) => void;
  onRemove?: (expected: ActivityReference) => void;
  onAdjustStart?: (start: Date, expected: ActivityReference) => void;
}
/** TrueSheet v3 owns native drag, nested-scroll and dismissal behavior on both platforms. */
export function NursingSheet({
  log,
  last,
  timezone,
  now,
  busy,
  error,
  onClose,
  onStart,
  onChange,
  onCorrect,
  onAdjustStart,
  onRemove,
}: Props) {
  const theme = useActivityTheme();
  const color = theme.night ? '#8EEBBE' : '#B35D7D';
  const styles = useMemo(() => createStyles(theme, color), [theme, color]);
  const nursing = log;
  const completed = nursing !== null && nursing.status === 'completed';
  const initial = useRef({
    start: new Date(nursing?.startedAt ?? now),
    end: new Date(nursing?.endedAt ?? nursing?.startedAt ?? now),
    // The completed editor's slider edits whole seconds; round only its draft.
    left: Math.round(nursing?.leftSeconds ?? 0),
    last: nursing?.lastBreast ?? null,
  }).current;
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [left, setLeft] = useState(initial.left);
  const [lastSide, setLast] = useState(initial.last);
  const [adjusted, setAdjusted] = useState(false);
  const [picker, setPicker] = useState<{ field: 'start' | 'end'; mode: 'date' | 'time' } | null>(
    null,
  );
  const [pickerError, setPickerError] = useState<string | null>(null);
  const startRevision = useRef<ActivityReference | null>(null);
  const runningStartedAt = nursing && nursing.status !== 'completed' ? nursing.startedAt : null;
  useEffect(() => {
    if (runningStartedAt && !adjusted && !picker) setStart(new Date(runningStartedAt));
  }, [runningStartedAt, adjusted, picker]);
  const sheet = useRef<TrueSheet>(null);
  const openingPicker = useRef(false);
  const { height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const expandStartPicker = async () => {
    if (openingPicker.current) return;
    openingPicker.current = true;
    try {
      // Wait for native expansion before showing a platform time picker over the sheet.
      await sheet.current?.resize(1);
      setExpanded(true);
      setPicker({ field: 'start', mode: 'time' });
    } catch {
      setPickerError('The time editor could not be opened. Close and reopen Nursing.');
    } finally {
      openingPicker.current = false;
    }
  };
  const totals = nursing ? nursingTimes(nursing, now) : null;
  const paused = totals?.paused ?? false;
  const pauseSeconds = nursing?.pauseSeconds ?? 0;
  const total = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000 - pauseSeconds));
  const canSave =
    !busy &&
    !pickerError &&
    start <= end &&
    end <= now &&
    lastSide !== null &&
    left <= total &&
    (total === 0 || (lastSide === 'LEFT' ? left > 0 : total - left > 0));
  const pick = (event: DateTimePickerEvent, selected?: Date) => {
    const current = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (event.type === 'dismissed' || !selected || !current) return;
    try {
      const value = current.field === 'start' ? start : end;
      const next =
        current.mode === 'date'
          ? mergeDatePart(value, selected, timezone)
          : mergeTimePart(value, selected, timezone);
      if (completed) {
        const nextStart = current.field === 'start' ? next : start;
        const nextEnd = current.field === 'end' ? next : end;
        const nextTotal = Math.max(
          0,
          Math.round((nextEnd.getTime() - nextStart.getTime()) / 1000 - pauseSeconds),
        );
        setLeft(Math.min(nextTotal, Math.round((total === 0 ? 0 : left / total) * nextTotal)));
      }
      if (current.field === 'start') setStart(next);
      else setEnd(next);
      setAdjusted(true);
      setPickerError(null);
    } catch {
      setPickerError('Choose another date or time.');
    }
  };
  const format = (date: Date) =>
    new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(date);
  const time = (seconds: number) => formatLiveDuration(seconds * 1000);
  return (
    <TrueSheet
      ref={sheet}
      initialDetentIndex={0}
      detents={[Math.min(0.7, (completed ? 450 : 540) / height), Math.min(0.9, 760 / height)]}
      scrollable
      draggable
      dismissible
      backgroundColor={theme.surface}
      grabberOptions={{ color: theme.muted, width: 42, adaptive: false }}
      accessibilityOptions={{ paneTitle: 'Nursing', grabberLabel: 'Nursing drawer' }}
      onDidDismiss={onClose}
      onDidPresent={({ nativeEvent }) => setExpanded(nativeEvent.index === 1)}
      onDetentChange={({ nativeEvent }) => setExpanded(nativeEvent.index === 1)}
    >
      <ScrollView
        style={styles.scroll}
        nestedScrollEnabled
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <SheetToolbar
          label="Nursing"
          busy={busy}
          onClose={() => void sheet.current?.dismiss()}
          onExpand={() => {
            void sheet.current
              ?.resize(1)
              .then(() => setExpanded(true))
              .catch(() => {
                setPickerError('Close and reopen the Nursing drawer to view its details.');
              });
          }}
          onRemove={nursing && onRemove ? () => onRemove(nursing) : undefined}
        />
        <View style={styles.hero}>
          <ActivityBadge
            icon="nursing"
            color={color}
            size={72}
            active={nursing?.status === 'active'}
          />
          <Text accessibilityRole="header" style={styles.title}>
            Nursing
          </Text>
          {!expanded ? (
            nursing && totals ? (
              completed ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Set Nursing start time"
                  disabled={busy}
                  onPress={() => void expandStartPicker()}
                >
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.time, styles.range]}>
                    {clockLabel(start, timezone, false)} – {clockLabel(end, timezone, false)}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.time}>{time(totals.total)}</Text>
              )
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set Nursing start time"
                onPress={() => void expandStartPicker()}
              >
                <Text style={styles.time}>{format(start)}</Text>
              </Pressable>
            )
          ) : (
            <Text style={[styles.time, styles.range]}>
              {clockLabel(start, timezone, false)} –{' '}
              {completed ? clockLabel(end, timezone, false) : '…'}
            </Text>
          )}
          {completed ? (
            <Text style={styles.muted}>
              {shortDuration(total * 1000)} long · {shortDuration(now.getTime() - end.getTime())}{' '}
              ago
            </Text>
          ) : null}
          {nursing && nursing.status !== 'completed' ? (
            <Text style={styles.muted}>
              {paused
                ? 'Paused'
                : `${nursing.lastBreast === 'LEFT' ? 'Left' : 'Right'} breast active`}
            </Text>
          ) : null}
        </View>
        {!completed ? (
          <View style={styles.sides}>
            {(['LEFT', 'RIGHT'] as const).map((side) => (
              <Pressable
                key={side}
                accessibilityRole="button"
                accessibilityLabel={
                  nursing
                    ? `${paused ? 'Resume' : nursing.lastBreast === side ? 'Pause' : 'Switch to'} ${side === 'LEFT' ? 'Left' : 'Right'} breast`
                    : `Start Nursing on ${side === 'LEFT' ? 'Left' : 'Right'} breast`
                }
                disabled={busy || pickerError !== null}
                onPress={() =>
                  nursing
                    ? onChange(
                        paused
                          ? { kind: 'resume', side }
                          : nursing.lastBreast === side
                            ? { kind: 'pause' }
                            : { kind: 'switch', side },
                      )
                    : onStart(side, adjusted ? start : new Date())
                }
                style={[
                  styles.side,
                  {
                    backgroundColor:
                      nursing && !paused && nursing.lastBreast === side
                        ? theme.night
                          ? '#999BFF'
                          : color
                        : theme.field,
                  },
                  busy && styles.disabled,
                ]}
              >
                <Text
                  style={[
                    styles.sideLabel,
                    {
                      color:
                        nursing && !paused && nursing.lastBreast === side
                          ? theme.onAccent
                          : theme.text,
                    },
                  ]}
                >
                  {side === 'LEFT' ? 'L' : 'R'}
                </Text>
                <ActivityIcon
                  color={nursing && !paused && nursing.lastBreast === side ? theme.onAccent : color}
                  name={nursing && !paused && nursing.lastBreast === side ? 'pause' : 'play'}
                />
                <Text
                  style={[
                    styles.sideMeta,
                    {
                      color:
                        nursing && !paused && nursing.lastBreast === side
                          ? theme.onAccent
                          : theme.muted,
                    },
                  ]}
                >
                  {totals
                    ? time(side === 'LEFT' ? totals.left : totals.right)
                    : last === null
                      ? ''
                      : last === side
                        ? 'Last'
                        : 'Next'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {nursing && nursing.status !== 'completed' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop Nursing"
            disabled={busy}
            onPress={() => onChange({ kind: 'stop' })}
            style={[styles.stop, busy && styles.disabled]}
          >
            <ActivityIcon name="stop" color={theme.onAccent} size={24} />
          </Pressable>
        ) : null}
        {completed && !expanded ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save Nursing changes"
            disabled={!canSave}
            onPress={() => {
              if (lastSide) onCorrect(start, end, left, lastSide);
            }}
            style={[styles.save, !canSave && styles.disabled]}
          >
            <ActivityIcon name="check" color={theme.onAccent} size={28} />
          </Pressable>
        ) : null}
        {expanded ? (
          <>
            <ActivityTimestampField
              label="Start"
              value={start}
              timezone={timezone}
              maximumDate={now}
              editable={!busy && (!nursing || completed || Boolean(onAdjustStart))}
              pickerMode={picker?.field === 'start' ? picker.mode : null}
              onPick={(mode) => {
                if (!adjusted && nursing)
                  startRevision.current = { id: nursing.id, revision: nursing.revision };
                setPicker({ field: 'start', mode });
              }}
              onDone={() => setPicker(null)}
              onPickerChange={pick}
            />
            {completed ? (
              <>
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
                <View style={styles.split}>
                  <Text style={{ color: theme.text }}>Left · {time(left)}</Text>
                  <Text style={{ color: theme.text }}>
                    Right · {time(Math.max(0, total - left))}
                  </Text>
                </View>
                <Slider
                  accessibilityLabel="Left and Right Nursing time split"
                  minimumValue={0}
                  maximumValue={Math.max(1, total)}
                  step={1}
                  value={Math.min(left, total)}
                  disabled={busy || total === 0}
                  onValueChange={(value) => setLeft(Math.round(value))}
                  minimumTrackTintColor={color}
                  maximumTrackTintColor={theme.border}
                  thumbTintColor={color}
                  style={styles.slider}
                />
                <Text style={styles.muted}>
                  Total · {time(total)}
                  {pauseSeconds > 0 ? ` · Pauses ${time(pauseSeconds)}` : ''}
                </Text>
                <Text style={styles.label}>Last breast used</Text>
                <View style={styles.split}>
                  {(['LEFT', 'RIGHT'] as const).map((side) => (
                    <Pressable
                      key={side}
                      accessibilityRole="button"
                      accessibilityState={{ selected: lastSide === side }}
                      disabled={busy}
                      onPress={() => setLast(side)}
                      style={[styles.last, lastSide === side && styles.lastSelected]}
                    >
                      <Text style={{ color: theme.text }}>
                        {side === 'LEFT' ? 'Left' : 'Right'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save Nursing changes"
                  disabled={!canSave}
                  onPress={() => {
                    if (lastSide) onCorrect(start, end, left, lastSide);
                  }}
                  style={[styles.save, !canSave && styles.disabled]}
                >
                  <ActivityIcon name="check" color={theme.onAccent} size={28} />
                </Pressable>
              </>
            ) : nursing ? (
              <>
                <Text style={styles.muted}>End · Running · {format(now)}</Text>
                {adjusted && onAdjustStart ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save Nursing start time"
                    disabled={busy || pickerError !== null || start > now}
                    onPress={() => {
                      if (startRevision.current) onAdjustStart(start, startRevision.current);
                    }}
                    style={styles.save}
                  >
                    <ActivityIcon name="check" color={theme.onAccent} size={28} />
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <Text style={styles.hint}>Swipe up for date and time</Text>
        )}
        {error || pickerError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {pickerError ?? error}
          </Text>
        ) : null}
      </ScrollView>
    </TrueSheet>
  );
}
const createStyles = (theme: ActivityTheme, color: string) =>
  StyleSheet.create({
    scroll: { flex: 1 },
    content: { padding: 16, paddingBottom: 32, gap: 20 },
    hero: { alignItems: 'center', gap: 20, marginTop: -28, paddingHorizontal: 32 },
    title: { fontSize: 20, fontWeight: '500', color: theme.muted },
    range: { fontSize: 40, lineHeight: 52, letterSpacing: -0.5, textAlign: 'center' },
    time: { fontSize: 38, fontWeight: '500', color: theme.text, fontVariant: ['tabular-nums'] },
    muted: { color: theme.muted, fontSize: 13, textAlign: 'center' },
    sides: { flexDirection: 'row', justifyContent: 'center', gap: 22 },
    side: {
      width: 96,
      minHeight: 96,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 48,
      borderWidth: 1.5,
      borderColor: theme.accent,
      backgroundColor: color,
    },
    sideLabel: { fontSize: 20, color: theme.onAccent, fontWeight: '700' },
    sideMeta: { color: theme.onAccent, fontSize: 12 },
    stop: {
      width: 80,
      height: 80,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#999BFF',
      borderWidth: 2,
      borderColor: '#BCBDFF',
      borderRadius: 40,
    },
    hint: { color: theme.muted, fontSize: 12, textAlign: 'center' },
    split: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    slider: { height: 44, width: '100%' },
    last: {
      minHeight: 44,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 14,
    },
    lastSelected: { backgroundColor: theme.accentSoft, borderColor: color },
    label: { fontWeight: '600', color: theme.text },
    save: {
      backgroundColor: '#999BFF',
      borderWidth: 2,
      borderColor: '#BCBDFF',
      marginTop: 16,
      width: 80,
      height: 80,
      alignSelf: 'center',
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    white: { color: theme.onAccent, fontWeight: '700' },
    error: { fontSize: 14, color: theme.error, textAlign: 'center' },
    disabled: { opacity: 0.45 },
  });
