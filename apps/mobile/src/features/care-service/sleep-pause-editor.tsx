import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from '@/features/shared/tracking-text';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { ActivityTimestampField } from '@/features/shared/activity-drawer/activity-timestamp-field';
import { useActivityTheme } from '@/features/shared/activity-theme';
import { mergeDatePart, mergeTimePart } from '@/features/naps/nap-editor-state';
import type { SleepPauseDraft } from './contracts';

/** A complete draft is saved by its parent, never when a picker or row changes. */
export function SleepPauseEditor({
  pauses,
  onChange,
  startedAt,
  endedAt,
  now,
  timezone,
  busy,
}: {
  pauses: readonly SleepPauseDraft[];
  onChange: (pauses: SleepPauseDraft[]) => void;
  startedAt: Date;
  endedAt: Date | null;
  now: Date;
  timezone: string;
  busy: boolean;
}) {
  const theme = useActivityTheme();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [picker, setPicker] = useState<{
    index: number;
    field: 'startedAt' | 'endedAt';
    mode: 'date' | 'time';
  } | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const through = Math.min((endedAt ?? now).getTime(), now.getTime());
  const addStart = Math.max(
    Date.parse(pauses.at(-1)?.endedAt ?? startedAt.toISOString()),
    through - 60000,
  );
  const canAdd = pauses.at(-1)?.endedAt !== null && through > addStart;
  return (
    <View style={{ gap: 12 }}>
      {pauses.map((pause, index) => {
        const seconds = Math.max(
          0,
          Math.floor(
            (Date.parse(pause.endedAt ?? now.toISOString()) - Date.parse(pause.startedAt)) / 1000,
          ),
        );
        return (
          <View
            key={pause.id ?? `new:${index}`}
            style={{ borderRadius: 18, padding: 14, gap: 12, backgroundColor: theme.field }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit pause ${index + 1}`}
                disabled={busy}
                onPress={() => {
                  setExpanded(expanded === index ? null : index);
                  setPicker(null);
                }}
                style={{
                  flex: 1,
                  minHeight: 44,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Text style={{ color: theme.muted, fontSize: 13 }}>PAUSE</Text>
                <Text style={{ color: theme.muted, fontSize: 16 }}>
                  {Math.floor(seconds / 60)}m {seconds % 60}s
                  {pause.endedAt === null ? ' · Running' : ''}
                </Text>
                <ActivityIcon name="down" size={18} color={theme.muted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove pause ${index + 1}`}
                disabled={busy}
                onPress={() => {
                  onChange(pauses.filter((_, i) => i !== index));
                  setExpanded(null);
                  setPicker(null);
                }}
                style={{ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <ActivityIcon name="trash" size={20} color={theme.muted} />
              </Pressable>
            </View>
            {expanded === index
              ? (['startedAt', 'endedAt'] as const).map((field) => (
                  <ActivityTimestampField
                    key={field}
                    label={`Pause ${index + 1} ${field === 'startedAt' ? 'Start' : 'End'}`}
                    value={new Date(pause[field] ?? now)}
                    timezone={timezone}
                    maximumDate={new Date(through)}
                    editable={!busy}
                    pickerMode={
                      picker?.index === index && picker.field === field ? picker.mode : null
                    }
                    onPick={(mode) => setPicker({ index, field, mode })}
                    onDone={() => setPicker(null)}
                    onPickerChange={(event, date) => {
                      if (!picker || !date || event.type === 'dismissed') {
                        setPicker(null);
                        return;
                      }
                      try {
                        const previous = new Date(pause[field] ?? now);
                        const next =
                          picker.mode === 'date'
                            ? mergeDatePart(previous, date, timezone)
                            : mergeTimePart(previous, date, timezone);
                        onChange(
                          pauses.map((p, i) =>
                            i === index ? { ...p, [field]: next.toISOString() } : p,
                          ),
                        );
                        setPickerError(null);
                      } catch {
                        setPickerError('Choose another pause time.');
                      }
                      if (Platform.OS === 'android') setPicker(null);
                    }}
                  />
                ))
              : null}
          </View>
        );
      })}
      {pickerError ? <Text style={{ color: theme.error }}>{pickerError}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add pause"
        disabled={busy || !canAdd}
        onPress={() => {
          onChange([
            ...pauses,
            {
              startedAt: new Date(addStart).toISOString(),
              endedAt: new Date(through).toISOString(),
            },
          ]);
          setExpanded(pauses.length);
        }}
        style={{
          alignSelf: 'center',
          borderRadius: 24,
          backgroundColor: theme.field,
          paddingHorizontal: 18,
          minHeight: 44,
          justifyContent: 'center',
          opacity: canAdd ? 1 : 0.45,
        }}
      >
        <Text style={{ color: theme.muted, fontSize: 16 }}>Add pause +</Text>
      </Pressable>
    </View>
  );
}

export function sleepPauseIssue(
  pauses: readonly SleepPauseDraft[],
  start: Date,
  end: Date | null,
  now: Date,
): string | null {
  let previous = start.getTime();
  const through = (end ?? now).getTime();
  for (let i = 0; i < pauses.length; i++) {
    const pause = pauses[i];
    const from = Date.parse(pause.startedAt),
      to = pause.endedAt === null ? null : Date.parse(pause.endedAt);
    if (
      !Number.isFinite(from) ||
      from < previous ||
      from > through ||
      (to === null
        ? end !== null || i !== pauses.length - 1
        : !Number.isFinite(to) || to <= from || to > through)
    )
      return 'Pauses must be ordered and inside the sleep interval, with only the last pause left running.';
    previous = to ?? through;
  }
  return null;
}
