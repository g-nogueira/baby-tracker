import type { NapSession } from '@baby-tracker/domain';

import { instantForZonedDateTime, zonedDateTimeParts } from './calendar-day';

export type NapEditorState =
  | { mode: 'start'; startedAt: Date }
  | { mode: 'stop'; nap: NapSession; endedAt: Date }
  | { mode: 'edit'; nap: NapSession; startedAt: Date; endedAt: Date | null };

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
