/** Refreshes canonical state after a failed mutation without losing the original error. */
export async function recoverFromMutationFailure(
  error: unknown,
  refresh: () => Promise<void>,
  reportError: (message: string) => void,
): Promise<void> {
  const message = errorMessage(error);
  try {
    await refresh();
  } catch {
    // The mutation error is the actionable failure and must remain visible.
  }
  reportError(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
