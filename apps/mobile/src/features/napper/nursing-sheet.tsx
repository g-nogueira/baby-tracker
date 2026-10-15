import { TrueSheet } from '@lodev09/react-native-true-sheet';
import Slider from '@react-native-community/slider';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { mergeDatePart, mergeTimePart } from '@/features/naps/nap-editor-state';
import { formatLiveDuration } from '@/features/naps/nap-clock';
import { ActivityTimestampField } from '@/features/shared/activity-drawer/activity-timestamp-field';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import type { Breast, WireLog } from './contracts';
import { type NursingCommand, nursingTotals, readNursing } from './nursing';

interface Props {
  log: WireLog | null;
  last: Breast | null;
  timezone: string;
  now: Date;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onStart: (side: Breast, start: Date) => void;
  onChange: (command: NursingCommand) => void;
  onCorrect: (start: Date, end: Date, left: number, last: Breast) => void;
}
/** TrueSheet v3 owns native drag, nested-scroll and dismissal behavior on both platforms. */
export function NapperNursingSheet({
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
}: Props) {
  const nursing = log ? readNursing(log) : null;
  const completed = nursing !== null && !nursing.open;
  const initial = useRef({
    start: new Date(nursing?.start ?? now),
    end: new Date(nursing?.end ?? now),
    // The completed editor's slider edits whole seconds; round only its draft.
    left: Math.round(nursing?.left ?? 0),
    last: nursing?.last ?? null,
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
  const sheet = useRef<TrueSheet>(null);
  const openingPicker = useRef(false);
  const { height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(completed);
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
  const totals = nursing ? nursingTotals(nursing, now) : null;
  const paused = totals?.paused ?? false;
  const pauseSeconds =
    nursing?.pauses.reduce((sum, p) => sum + ((p.end ?? p.start) - p.start) / 1000, 0) ?? 0;
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
      initialDetentIndex={completed ? 1 : 0}
      detents={[Math.min(0.5, 330 / height), Math.min(0.84, 650 / height)]}
      scrollable
      draggable
      dismissible
      backgroundColor="#FFFFFF"
      grabberOptions={{ color: '#C5BBB3', width: 42, adaptive: false }}
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
        <View style={styles.hero}>
          <ActivityIcon name="nursing" color="#B35D7D" size={28} />
          <Text accessibilityRole="header" style={styles.title}>
            {completed ? 'Edit Nursing' : 'Nursing'}
          </Text>
          {!expanded ? (
            nursing && totals ? (
              <Text style={styles.time}>{time(totals.total)}</Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set Nursing start time"
                onPress={() => void expandStartPicker()}
              >
                <Text style={styles.time}>{format(start)}</Text>
              </Pressable>
            )
          ) : null}
          {nursing?.open ? (
            <Text style={styles.muted}>
              {paused ? 'Paused' : `${nursing.last === 'LEFT' ? 'Left' : 'Right'} breast active`}
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
                    ? `${paused ? 'Resume' : nursing.last === side ? 'Pause' : 'Switch to'} ${side === 'LEFT' ? 'Left' : 'Right'} breast`
                    : `Start Nursing on ${side === 'LEFT' ? 'Left' : 'Right'} breast`
                }
                disabled={busy || pickerError !== null}
                onPress={() =>
                  nursing
                    ? onChange(
                        paused
                          ? { kind: 'resume', side }
                          : nursing.last === side
                            ? { kind: 'pause' }
                            : { kind: 'switch', side },
                      )
                    : onStart(side, adjusted ? start : new Date())
                }
                style={[styles.side, busy && styles.disabled]}
              >
                <Text style={styles.sideLabel}>{side === 'LEFT' ? 'L' : 'R'}</Text>
                <ActivityIcon
                  name={nursing && !paused && nursing.last === side ? 'pause' : 'play'}
                />
                <Text style={styles.sideMeta}>
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
        {nursing?.open ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop Nursing"
            disabled={busy}
            onPress={() => onChange({ kind: 'stop' })}
            style={[styles.stop, busy && styles.disabled]}
          >
            <ActivityIcon name="stop" size={24} />
          </Pressable>
        ) : null}
        {expanded ? (
          <>
            <ActivityTimestampField
              label="Start"
              value={nursing?.open ? new Date(nursing.start) : start}
              timezone={timezone}
              maximumDate={now}
              editable={!busy && !nursing?.open}
              pickerMode={picker?.field === 'start' ? picker.mode : null}
              onPick={(mode) => setPicker({ field: 'start', mode })}
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
                  <Text>Left · {time(left)}</Text>
                  <Text>Right · {time(Math.max(0, total - left))}</Text>
                </View>
                <Slider
                  accessibilityLabel="Left and Right Nursing time split"
                  minimumValue={0}
                  maximumValue={Math.max(1, total)}
                  step={1}
                  value={Math.min(left, total)}
                  disabled={busy || total === 0}
                  onValueChange={(value) => setLeft(Math.round(value))}
                  minimumTrackTintColor="#B35D7D"
                  maximumTrackTintColor="#EBDCE2"
                  thumbTintColor="#B35D7D"
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
                      <Text>{side === 'LEFT' ? 'Left' : 'Right'}</Text>
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
                  <Text style={styles.white}>Save changes</Text>
                </Pressable>
              </>
            ) : nursing ? (
              <Text style={styles.muted}>Now · {format(now)}</Text>
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
const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 38, gap: 14 },
  hero: { alignItems: 'center', gap: 6 },
  title: { fontSize: 18, fontWeight: '700', color: '#292724' },
  time: { fontSize: 34, color: '#292724', fontVariant: ['tabular-nums'] },
  muted: { color: '#746F68', fontSize: 13, textAlign: 'center' },
  sides: { flexDirection: 'row', justifyContent: 'center', gap: 22 },
  side: {
    width: 94,
    minHeight: 98,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 24,
    backgroundColor: '#B35D7D',
  },
  sideLabel: { fontSize: 20, color: '#FFFFFF', fontWeight: '700' },
  sideMeta: { color: '#FFFFFF', fontSize: 12 },
  stop: {
    width: 56,
    height: 48,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#292724',
    borderRadius: 14,
  },
  hint: { color: '#746F68', fontSize: 12, textAlign: 'center' },
  split: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  slider: { height: 44, width: '100%' },
  last: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E4DDD5',
    borderRadius: 14,
  },
  lastSelected: { backgroundColor: '#F6E4EB', borderColor: '#B35D7D' },
  label: { fontWeight: '600', color: '#292724' },
  save: {
    backgroundColor: '#B35D7D',
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  white: { color: '#FFFFFF', fontWeight: '700' },
  error: { fontSize: 14, color: '#A64444', textAlign: 'center' },
  disabled: { opacity: 0.45 },
});
