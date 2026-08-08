import { createUuidV7, deleteNap, startNap, stopNap, type NapSession } from '@baby-tracker/domain';
import { getRandomValues } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { SQLiteNapRepository } from './sqlite-nap-repository';

interface NapState {
  naps: NapSession[];
  pendingOperationCount: number;
  isLoading: boolean;
  error: string | null;
}

export function useNaps() {
  const database = useSQLiteContext();
  const repository = useMemo(() => new SQLiteNapRepository(database), [database]);
  const [state, setState] = useState<NapState>({
    naps: [],
    pendingOperationCount: 0,
    isLoading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    const [dayStartedAt, nextDayStartedAt] = localDayBounds(new Date());
    const [naps, pendingOperationCount] = await Promise.all([
      repository.listVisible(LOCAL_DEVELOPMENT_IDENTITY.childId, dayStartedAt, nextDayStartedAt),
      repository.pendingOperationCount(),
    ]);
    setState({ naps, pendingOperationCount, isLoading: false, error: null });
  }, [repository]);

  useEffect(() => {
    refresh().catch((error: unknown) => {
      setState((current) => ({ ...current, isLoading: false, error: errorMessage(error) }));
    });
  }, [refresh]);

  const mutate = useCallback(
    async (mutationFactory: (now: Date) => ReturnType<typeof startNap>) => {
      try {
        await repository.save(mutationFactory(new Date()));
        await refresh();
      } catch (error: unknown) {
        setState((current) => ({ ...current, error: errorMessage(error) }));
      }
    },
    [refresh, repository],
  );

  const activeNap = state.naps.find((nap) => nap.status === 'active') ?? null;

  return {
    ...state,
    activeNap,
    start: () => mutate((now) => startNap(createContext(now))),
    stop: () => {
      if (activeNap === null) return Promise.resolve();
      return mutate((now) => stopNap(activeNap, createContext(now)));
    },
    remove: (nap: NapSession) => mutate((now) => deleteNap(nap, createContext(now))),
  };
}

function createContext(now: Date) {
  return {
    ...LOCAL_DEVELOPMENT_IDENTITY,
    now,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    newId: () => createUuidV7(Date.now(), getRandomValues),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function localDayBounds(now: Date): [string, string] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return [start.toISOString(), next.toISOString()];
}
