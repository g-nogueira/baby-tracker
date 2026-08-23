import { CareEventError } from '@baby-tracker/domain';

import {
  CareEventWriteConflictError,
  InvalidStoredCareEventError,
} from './sqlite-care-event-repository';

/** Maps care-event failures to fixed copy so Medicine text can never reach UI diagnostics. */
export function careEventErrorMessage(error: unknown): string {
  if (error instanceof CareEventWriteConflictError) {
    return 'This care event changed before your update was saved. Reopen it and try again.';
  }
  if (error instanceof InvalidStoredCareEventError) {
    return 'Stored care-event data is invalid and cannot be displayed.';
  }
  if (error instanceof CareEventError) {
    switch (error.code) {
      case 'deleted_event':
        return 'This care event was already deleted. Reopen the day and try again.';
      case 'future_occurrence':
        return 'Care event time cannot be in the future.';
      case 'invalid_event':
        return 'Check the care-event details and try again.';
      case 'invalid_transition':
        return 'That care-event change is no longer available. Reopen it and try again.';
    }
  }
  return 'The care event could not be saved. Please try again.';
}
