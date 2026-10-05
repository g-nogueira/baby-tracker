import type { NursingSide } from '@baby-tracker/domain';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { mergeDatePart, mergeTimePart } from '@/features/naps/nap-editor-state';
import { NursingSplitSlider } from '@/features/nursing/nursing-split-slider';
import { ActivityDrawer } from './activity-drawer';
import { ActivityTimestampField } from './activity-timestamp-field';

export interface HistoricalActivityDraft {
  kind: 'nap' | 'night' | 'night-waking' | 'nursing';
  startedAt: Date;
  endedAt: Date;
  leftDurationSeconds: number;
  last: NursingSide;
}

/** Completed entries never pass through a live controller or live transition. */
export function HistoricalActivityDrawer({
  startedAt,
  endedAt,
  timezone,
  hasNight,
  busy,
  error,
  onDismiss,
  onSave,
  onCare,
}: {
  startedAt: Date;
  endedAt: Date;
  timezone: string;
  hasNight: boolean;
  busy: boolean;
  error: string | null;
  onDismiss: () => void;
  onSave: (draft: HistoricalActivityDraft) => void;
  onCare: (kind: 'diaper' | 'medicine', at: Date) => void;
}) {
  const [draft, setDraft] = useState<HistoricalActivityDraft>({
    kind: hasNight ? 'night-waking' : 'nap',
    startedAt,
    endedAt,
    leftDurationSeconds: Math.floor((endedAt.getTime() - startedAt.getTime()) / 2000),
    last: 'left',
  });
  const [picker, setPicker] = useState<{
    field: 'startedAt' | 'endedAt';
    mode: 'date' | 'time';
  } | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const total = Math.max(
    0,
    Math.floor((draft.endedAt.getTime() - draft.startedAt.getTime()) / 1000),
  );
  const invalid = draft.startedAt >= draft.endedAt || draft.endedAt.getTime() > Date.now();
  const pick = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setPicker(null);
    if (event.type === 'dismissed' || !selected || !picker) return;
    try {
      const at =
        picker.mode === 'date'
          ? mergeDatePart(draft[picker.field], selected, timezone)
          : mergeTimePart(draft[picker.field], selected, timezone);
      setDraft({ ...draft, [picker.field]: at });
      setPickerError(null);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'Choose another time.');
    }
  };
  return (
    <ActivityDrawer
      activityLabel="Add past activity"
      mode="edit"
      scrollContent
      onDismiss={onDismiss}
    >
      {() => (
        <>
          <Text
            accessibilityRole="header"
            style={{ fontSize: 20, fontWeight: '700', color: '#292724' }}
          >
            Add past activity
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['nap', 'night', 'night-waking', 'nursing', 'diaper', 'medicine'] as const)
              .filter((kind) => kind !== 'night-waking' || hasNight)
              .map((kind) => (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  accessibilityState={{ selected: kind === draft.kind }}
                  disabled={busy}
                  onPress={() =>
                    kind === 'diaper' || kind === 'medicine'
                      ? onCare(kind, draft.startedAt)
                      : setDraft({ ...draft, kind })
                  }
                  style={{
                    minHeight: 44,
                    padding: 12,
                    borderRadius: 12,
                    backgroundColor: kind === draft.kind ? '#DCD5F1' : '#F1EDE6',
                  }}
                >
                  <Text>
                    {kind === 'night-waking'
                      ? 'Night waking'
                      : kind[0].toUpperCase() + kind.slice(1)}
                  </Text>
                </Pressable>
              ))}
          </View>
          {(['startedAt', 'endedAt'] as const).map((field) => (
            <ActivityTimestampField
              key={field}
              label={field === 'startedAt' ? 'Start' : 'End'}
              value={draft[field]}
              timezone={timezone}
              maximumDate={new Date()}
              editable={!busy}
              pickerMode={picker?.field === field ? picker.mode : null}
              onDone={() => setPicker(null)}
              onPick={(mode) => setPicker({ field, mode })}
              onPickerChange={pick}
            />
          ))}
          {draft.kind === 'nursing' ? (
            <>
              <Text>Left / Right · {total} seconds total</Text>
              <NursingSplitSlider
                disabled={busy}
                accessibilityText="Left and Right nursing split"
                maximumValue={total}
                value={Math.min(total, draft.leftDurationSeconds)}
                onValueChange={(leftDurationSeconds) => setDraft({ ...draft, leftDurationSeconds })}
              />
              <Text>Last breast used</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {(['left', 'right'] as const).map((last) => (
                  <Pressable
                    key={last}
                    accessibilityRole="button"
                    accessibilityState={{ selected: draft.last === last }}
                    onPress={() => setDraft({ ...draft, last })}
                    style={{
                      padding: 14,
                      borderRadius: 12,
                      backgroundColor: draft.last === last ? '#F6D7E4' : '#F1EDE6',
                    }}
                  >
                    <Text>{last}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          {invalid ? (
            <Text accessibilityRole="alert">End must follow Start and be in the past.</Text>
          ) : null}
          {error || pickerError ? (
            <Text accessibilityRole="alert" style={{ color: '#A64444' }}>
              {pickerError ?? error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || invalid || pickerError !== null}
            onPress={() =>
              onSave({ ...draft, leftDurationSeconds: Math.min(total, draft.leftDurationSeconds) })
            }
            style={{
              minHeight: 52,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 16,
              backgroundColor: '#7367B9',
              opacity: busy || invalid ? 0.5 : 1,
            }}
          >
            <Text style={{ color: 'white', fontWeight: '700' }}>Save completed activity</Text>
          </Pressable>
        </>
      )}
    </ActivityDrawer>
  );
}
