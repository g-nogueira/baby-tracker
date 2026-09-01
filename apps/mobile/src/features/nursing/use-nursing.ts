import {
  type CompletedNursingCorrection,
  createUuidV7,
  deleteNursing,
  editCompletedNursing,
  type NursingMutation,
  type NursingSession,
  type NursingSide,
  pauseNursing,
  restoreNursing,
  resumeNursing,
  startNursing,
  stopNursing,
  switchNursingSide,
} from '@baby-tracker/domain';
import { getRandomValues } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { shiftCalendarDay, zonedDayBounds } from '@/features/naps/calendar-day';
import { recoverFromMutationFailure } from '@/features/naps/mutation-recovery';
import { SQLiteNursingRepository } from './sqlite-nursing-repository';

interface NursingState {
  sessions: NursingSession[];
  cycleSessions: NursingSession[];
  activeSession: NursingSession | null;
  latestCompletedLast: NursingSide | null;
  pendingOperationCount: number;
  isLoading: boolean;
  error: string | null;
}

/** Owns canonical Nursing reads and mutations independently from Sleep state. */
export function useNursing(selectedDay: string) {
  const database = useSQLiteContext();
  const repository = useMemo(() => new SQLiteNursingRepository(database), [database]);
  const mutationInFlight = useRef(false);
  const refreshGeneration = useRef(0);
  const selectedDayRef = useRef(selectedDay);
  selectedDayRef.current = selectedDay;
  const [isMutating, setIsMutating] = useState(false);
  const [state, setState] = useState<NursingState>({
    sessions: [],
    cycleSessions: [],
    activeSession: null,
    latestCompletedLast: null,
    pendingOperationCount: 0,
    isLoading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const requestedDay = selectedDay;
    const [dayStartedAt, nextDayStartedAt] = zonedDayBounds(
      selectedDay,
      LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
    );
    const [cycleStartedAt] = zonedDayBounds(
      shiftCalendarDay(selectedDay, -1),
      LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
    );
    const [, cycleEndedAt] = zonedDayBounds(
      shiftCalendarDay(selectedDay, 1),
      LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
    );
    const [sessions, cycleSessions, activeSession, latestCompletedLast, pendingOperationCount] =
      await Promise.all([
        repository.listVisible(LOCAL_DEVELOPMENT_IDENTITY.childId, dayStartedAt, nextDayStartedAt),
        repository.listVisible(LOCAL_DEVELOPMENT_IDENTITY.childId, cycleStartedAt, cycleEndedAt),
        repository.active(LOCAL_DEVELOPMENT_IDENTITY.childId),
        repository.latestCompletedLastBreast(LOCAL_DEVELOPMENT_IDENTITY.childId),
        repository.pendingOperationCount(),
      ]);
    if (generation !== refreshGeneration.current || requestedDay !== selectedDayRef.current) return;
    setState({
      sessions,
      cycleSessions,
      activeSession,
      latestCompletedLast,
      pendingOperationCount,
      isLoading: false,
      error: null,
    });
  }, [repository, selectedDay]);

  useEffect(() => {
    refresh().catch((error: unknown) => {
      setState((current) => ({ ...current, isLoading: false, error: errorMessage(error) }));
    });
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState !== 'active') return;
      refresh().catch((error: unknown) => {
        setState((current) => ({ ...current, error: errorMessage(error) }));
      });
    });
    return () => subscription.remove();
  }, [refresh]);

  const mutate = useCallback(
    async (mutationFactory: (now: Date) => NursingMutation): Promise<NursingSession | null> => {
      if (mutationInFlight.current) return null;
      mutationInFlight.current = true;
      setIsMutating(true);
      try {
        const mutation = mutationFactory(new Date());
        await repository.save(mutation);
        try {
          await refresh();
        } catch (error: unknown) {
          setState((current) => ({ ...current, error: errorMessage(error) }));
        }
        return mutation.session;
      } catch (error: unknown) {
        await recoverFromMutationFailure(error, refresh, (message) => {
          setState((current) => ({ ...current, error: message }));
        });
        return null;
      } finally {
        mutationInFlight.current = false;
        setIsMutating(false);
      }
    },
    [refresh, repository],
  );

  const requireActive = (message: string): NursingSession | null => {
    if (state.activeSession !== null) return state.activeSession;
    setState((current) => ({ ...current, error: message }));
    return null;
  };

  return {
    ...state,
    isMutating,
    refresh,
    start: (side: NursingSide) => mutate((now) => startNursing(side, createContext(now))),
    switchSide: (side: NursingSide) => {
      const session = requireActive('There is no active Nursing session to switch.');
      return session === null
        ? Promise.resolve(null)
        : mutate((now) => switchNursingSide(session, side, createContext(now)));
    },
    pause: () => {
      const session = requireActive('There is no active Nursing session to pause.');
      return session === null
        ? Promise.resolve(null)
        : mutate((now) => pauseNursing(session, createContext(now)));
    },
    resume: (side: NursingSide) => {
      const session = requireActive('There is no paused Nursing session to resume.');
      return session === null
        ? Promise.resolve(null)
        : mutate((now) => resumeNursing(session, side, createContext(now)));
    },
    stop: () => {
      const session = requireActive('There is no active Nursing session to stop.');
      return session === null
        ? Promise.resolve(null)
        : mutate((now) => stopNursing(session, createContext(now)));
    },
    editCompleted: (session: Readonly<NursingSession>, correction: CompletedNursingCorrection) =>
      mutate((now) => editCompletedNursing({ ...session }, correction, createContext(now))),
    removeCompleted: (session: Readonly<NursingSession>) =>
      mutate((now) => deleteNursing({ ...session }, createContext(now))),
    restoreCompleted: (session: Readonly<NursingSession>) =>
      mutate((now) => restoreNursing({ ...session }, createContext(now))),
    clearError: () => setState((current) => ({ ...current, error: null })),
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
