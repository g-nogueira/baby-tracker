import { describe, expect, it, vi } from 'vitest';

import { recoverFromMutationFailure } from './mutation-recovery';

describe('mutation failure recovery', () => {
  it('refreshes canonical state before restoring the original mutation error', async () => {
    const order: string[] = [];
    await recoverFromMutationFailure(
      new Error('This sleep session changed before your update was saved.'),
      async () => {
        order.push('refresh');
      },
      (message) => order.push(`error:${message}`),
    );
    expect(order).toEqual([
      'refresh',
      'error:This sleep session changed before your update was saved.',
    ]);
  });

  it('preserves the mutation error when the recovery refresh also fails', async () => {
    const reportError = vi.fn();
    await recoverFromMutationFailure(
      new Error('Original mutation failure'),
      async () => Promise.reject(new Error('Refresh failure')),
      reportError,
    );
    expect(reportError).toHaveBeenCalledWith('Original mutation failure');
  });
});
