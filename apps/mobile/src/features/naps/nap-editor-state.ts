import type { NapSession } from '@baby-tracker/domain';

import { instantForZonedDateTime, zonedDateTimeParts } from './calendar-day';

export type NapEditorState =
  | { mode: 'start'; startedAt: Date }
  | { mode: 'stop'; nap: NapSession; endedAt: Date }
  | { mode: 'edit'; nap: NapSession; startedAt: Date; endedAt: Date | null };

/**
 * Validates the start and end times in a nap editor state.
 *
 * @param editor - The nap editor state to validate
 * @param now - The reference time used to detect future timestamps
 * @returns An error message when the interval is invalid, or `null` when it is valid
 */
export function editorIntervalError(editor: NapEditorState, now: Date = new Date()): string | null {
  const startedAt =
    editor.mode === 'start' || editor.mode === 'edit'
      ? editor.startedAt
      : new Date(editor.nap.startedAt);
  const endedAt =
    editor.mode === 'stop' ? editor.endedAt : editor.mode === 'edit' ? editor.endedAt : null;

  if (Number.isNaN(startedAt.getTime()) || (endedAt !== null && Number.isNaN(endedAt.getTime()))) {
    return 'Enter a valid date and time.';
  }

  if (endedAt !== null && endedAt.getTime() <= startedAt.getTime()) {
    return 'End time must be after start time.';
  }

  if (
    startedAt.getTime() > now.getTime() ||
    (endedAt !== null && endedAt.getTime() > now.getTime())
  ) {
    return 'Nap times cannot be in the future.';
  }

  return null;
}

/**
 * Updates the editable start or end date for the current nap editor mode.
 *
 * @param editor - The current nap editor state
 * @param field - The date field to update
 * @param nextDate - The replacement date
 * @returns The updated editor state, or the original state when the field is not editable in the current mode
 */
export function updateEditorDate(
  editor: NapEditorState,
  field: 'startedAt' | 'endedAt',
  nextDate: Date,
): NapEditorState {
  if (field === 'startedAt' && (editor.mode === 'start' || editor.mode === 'edit')) {
    return { ...editor, startedAt: nextDate };
  }

  if (field === 'endedAt' && (editor.mode === 'stop' || editor.mode === 'edit')) {
    return { ...editor, endedAt: nextDate };
  }

  return editor;
}

/**
 * Prepares the editor state for a stop action by setting its end time when the action time was not adjusted.
 *
 * @param actionTimeWasAdjusted - Whether the action time was manually adjusted
 * @param now - The time to use as the end time
 * @returns The updated editor state, or the original state when no update is needed
 */
export function editorForPrimaryAction(
  editor: NapEditorState,
  actionTimeWasAdjusted: boolean,
  now: Date = new Date(),
): NapEditorState {
  if (editor.mode !== 'stop' || actionTimeWasAdjusted) return editor;
  return { ...editor, endedAt: now };
}

/**
 * Replaces the calendar date of an instant while preserving its local time in the specified timezone.
 *
 * @param current - The instant whose local time should be preserved
 * @param selected - The instant providing the replacement calendar date
 * @param timezone - The timezone used to interpret both instants
 * @returns An instant representing the selected calendar date and current local time
 */
export function mergeDatePart(current: Date, selected: Date, timezone: string): Date {
  const currentParts = zonedDateTimeParts(current, timezone);
  const selectedParts = zonedDateTimeParts(selected, timezone);
  return instantForZonedDateTime(
    {
      ...currentParts,
      year: selectedParts.year,
      month: selectedParts.month,
      day: selectedParts.day,
    },
    timezone,
  );
}

/**
 * Combines the selected time with the current date in the specified timezone.
 *
 * @param current - The date providing the year, month, and day.
 * @param selected - The date providing the hour and minute.
 * @param timezone - The timezone in which to combine the date and time.
 * @returns The resulting instant with seconds set to zero.
 */
export function mergeTimePart(current: Date, selected: Date, timezone: string): Date {
  const currentParts = zonedDateTimeParts(current, timezone);
  const selectedParts = zonedDateTimeParts(selected, timezone);
  return instantForZonedDateTime(
    {
      ...currentParts,
      hour: selectedParts.hour,
      minute: selectedParts.minute,
      second: 0,
    },
    timezone,
  );
}
