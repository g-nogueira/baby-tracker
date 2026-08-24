import { CareEventError } from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';

import {
  CareEventWriteConflictError,
  InvalidStoredCareEventError,
} from './sqlite-care-event-repository';
import { careEventErrorMessage } from './care-event-application-state';

describe('CareEvent application errors', () => {
  it.each([
    new CareEventWriteConflictError(),
    new InvalidStoredCareEventError(),
    new CareEventError('invalid_event', 'Secret Medicine note from a hostile source'),
    new Error('Secret Medicine note from an unexpected database error'),
    'Secret Medicine note from a non-error rejection',
  ])('never exposes Medicine text from %s', (error) => {
    const message = careEventErrorMessage(error);
    expect(message).not.toContain('Secret Medicine note');
    expect(message.length).toBeGreaterThan(0);
  });

  it('uses actionable fixed conflict copy after canonical refresh', () => {
    expect(careEventErrorMessage(new CareEventWriteConflictError())).toBe(
      'This care event changed before your update was saved. Reopen it and try again.',
    );
  });
});
