import { elapsedMilliseconds } from '@baby-tracker/domain';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { formatLiveDuration } from '@/features/naps/nap-clock';
import { mergeDatePart, mergeTimePart } from '@/features/naps/nap-editor-state';
import { ActivityDrawer } from '@/features/shared/activity-drawer/activity-drawer';
import {
  activeNightDurationStartedAt,
  adjustNightTransitionTime,
  type NightTransitionDraft,
  nightTransitionDraftForSave,
  nightTransitionError,
  updateNightTransitionTime,
} from './night-transition-drawer-state';

interface NightTransitionDrawerProps {
  draft: NightTransitionDraft;
  isMutating: boolean;
  mutationError: string | null;
  onCancel: () => void;
  onChange: (draft: NightTransitionDraft) => void;
  onSave: (draft: NightTransitionDraft) => void;
}

type PickerMode = 'date' | 'time' | null;

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

/** Renders the collapsed-first controls for one canonical Night transition. */
export function NightTransitionDrawer({
  draft,
  isMutating,
  mutationError,
  onCancel,
  onChange,
  onSave,
}: NightTransitionDrawerProps) {
  const [picker, setPicker] = useState<PickerMode>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const metadata = transitionMetadata(draft.kind);
  const error = useMemo(() => nightTransitionError(draft), [draft]);
  const canSave = !isMutating && error === null && pickerError === null;
  const liveNow = useLiveNow(draft.session !== null);
  const liveDuration =
    draft.session === null
      ? null
      : formatLiveDuration(
          elapsedMilliseconds(activeNightDurationStartedAt(draft.session), liveNow),
        );

  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const activePicker = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (event.type === 'dismissed' || selected === undefined || activePicker === null) return;
    try {
      const effectiveAt =
        activePicker === 'date'
          ? mergeDatePart(draft.effectiveAt, selected, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone)
          : mergeTimePart(draft.effectiveAt, selected, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone);
      setPickerError(null);
      onChange(updateNightTransitionTime(draft, effectiveAt));
    } catch (error: unknown) {
      setPickerError(
        error instanceof Error ? error.message : 'Choose another date or time and try again.',
      );
    }
  };

  return (
    <ActivityDrawer
      activityLabel={metadata.title}
      mode={draft.kind === 'start-night-sleep' ? 'create' : 'active'}
      onDismiss={onCancel}
    >
      {({ expanded }) => (
        <>
          <View style={styles.hero}>
            <View style={[styles.iconCircle, { backgroundColor: metadata.softColor }]}>
              <Text style={[styles.icon, { color: metadata.color }]}>{metadata.icon}</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {metadata.title}
            </Text>
            <Text accessibilityLiveRegion="polite" style={styles.actionTime}>
              {liveDuration ?? timeFormatter.format(draft.effectiveAt)}
            </Text>
            {liveDuration === null ? null : (
              <Text style={styles.transitionTime}>
                Transition at {timeFormatter.format(draft.effectiveAt)}
              </Text>
            )}
          </View>

          <View style={styles.quickActions}>
            <MinuteButton
              label="−1 min"
              onPress={() => onChange(adjustNightTransitionTime(draft, -1))}
            />
            <Pressable
              accessibilityLabel={metadata.accessibilityLabel}
              accessibilityRole="button"
              accessibilityState={{ busy: isMutating, disabled: !canSave }}
              disabled={!canSave}
              onPress={() => onSave(nightTransitionDraftForSave(draft))}
              style={({ pressed }) => [
                styles.primaryAction,
                { backgroundColor: metadata.color },
                !canSave && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryActionIcon}>{metadata.primaryIcon}</Text>
              <Text style={styles.primaryActionLabel}>{metadata.primaryLabel}</Text>
            </Pressable>
            <MinuteButton
              label="+1 min"
              onPress={() => onChange(adjustNightTransitionTime(draft, 1))}
            />
          </View>

          {!expanded ? (
            <Text style={styles.swipeHint}>Swipe up for exact date and time</Text>
          ) : null}

          {expanded ? (
            <View style={styles.expandedContent}>
              <Text style={styles.optionsTitle}>Date and time</Text>
              <View style={styles.fieldValues}>
                <TimeButton
                  label={`Transition date, ${dateFormatter.format(draft.effectiveAt)}`}
                  onPress={() => setPicker('date')}
                  text={dateFormatter.format(draft.effectiveAt)}
                />
                <TimeButton
                  label={`Transition time, ${timeFormatter.format(draft.effectiveAt)}`}
                  onPress={() => setPicker('time')}
                  text={timeFormatter.format(draft.effectiveAt)}
                />
              </View>
              {picker !== null ? (
                <View style={styles.pickerPanel}>
                  <DateTimePicker
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    maximumDate={new Date()}
                    mode={picker}
                    onChange={handlePickerChange}
                    timeZoneName={LOCAL_DEVELOPMENT_IDENTITY.dayTimezone}
                    value={draft.effectiveAt}
                  />
                  {Platform.OS === 'ios' ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setPicker(null)}
                      style={styles.doneButton}
                    >
                      <Text style={[styles.doneText, { color: metadata.color }]}>Done</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {error === null ? null : (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          )}
          {mutationError === null ? null : (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {mutationError}
            </Text>
          )}
          {pickerError === null ? null : (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {pickerError}
            </Text>
          )}
        </>
      )}
    </ActivityDrawer>
  );
}

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

function TimeButton({
  label,
  onPress,
  text,
}: {
  label: string;
  onPress: () => void;
  text: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.valueButton}
    >
      <Text style={styles.valueText}>{text}</Text>
    </Pressable>
  );
}

function transitionMetadata(kind: NightTransitionDraft['kind']) {
  switch (kind) {
    case 'start-night-sleep':
      return metadata('Night sleep', '☾', 'Start', '▶', 'Start Night sleep', '#5B4C94');
    case 'start-night-waking':
      return metadata('Night waking', '↯', 'Start', '▶', 'Start Night waking', '#52728A');
    case 'resume-night-sleep':
      return metadata('Fell asleep again', 'z', 'Resume', '▶', 'Resume Night sleep', '#7367B9');
    case 'end-night-sleep':
      return metadata('Wake up', '☀', 'Finish', '■', 'End Night sleep', '#5B4C94');
  }
}

function metadata(
  title: string,
  icon: string,
  primaryLabel: string,
  primaryIcon: string,
  accessibilityLabel: string,
  color: string,
) {
  return {
    title,
    icon,
    primaryLabel,
    primaryIcon,
    accessibilityLabel,
    color,
    softColor: `${color}20`,
  };
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6 },
  iconCircle: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
  },
  icon: { fontSize: 22, fontWeight: '900' },
  title: { color: '#292724', fontSize: 18, fontWeight: '700' },
  actionTime: {
    color: '#292724',
    fontSize: 32,
    fontWeight: '500',
    letterSpacing: -0.7,
    fontVariant: ['tabular-nums'],
  },
  transitionTime: { color: '#746F68', fontSize: 12 },
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
  minuteIcon: { color: '#746F68', fontSize: 22 },
  minuteLabel: { color: '#746F68', fontSize: 11, fontWeight: '600' },
  primaryAction: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 38,
    shadowColor: '#40377C',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  primaryActionIcon: { color: '#FFFFFF', fontSize: 20 },
  primaryActionLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  swipeHint: { color: '#746F68', fontSize: 12, textAlign: 'center', marginTop: 2 },
  expandedContent: {
    gap: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E7E0D7',
  },
  optionsTitle: { color: '#292724', fontSize: 15, fontWeight: '800' },
  fieldValues: { flexDirection: 'row', gap: 10 },
  valueButton: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#EEEAF9',
  },
  valueText: { color: '#292724', fontSize: 15, fontWeight: '600' },
  pickerPanel: { alignItems: 'flex-end', padding: 8, borderRadius: 14, backgroundColor: '#F7F4EF' },
  doneButton: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontSize: 15, fontWeight: '700' },
  errorText: { color: '#A64444', fontSize: 14, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
});
