import {
  createUuidV7,
  deleteNap,
  deleteNightSleep,
  editNap,
  editNightSleep,
  endNightSleep,
  type NapSession,
  type NightSleepSession,
  restoreNap,
  restoreNightSleep,
  resumeNightSleep,
  type SleepMutation,
  type SleepPhaseBoundary,
  type SleepSession,
  startNap,
  startNightSleep,
  startNightWaking,
  stopNap,
} from '@baby-tracker/domain';
import { getRandomValues } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { SQLiteSleepRepository } from '@/features/sleep/sqlite-sleep-repository';
import { calendarDayForInstant, shiftCalendarDay, zonedDayBounds } from './calendar-day';
import { recoverFromMutationFailure } from './mutation-recovery';

interface NapState {
  naps: NapSession[];
  sleepSessions: SleepSession[];
  activeSleep: SleepSession | null;
  pendingOperationCount: number;
  latestCompletedEnd: string | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Manages nap data, calendar-day selection, and nap mutations.
 *
 * @returns The current nap state and controls for navigation, mutations, and error management.
 */
export function useNaps() {
  const database = useSQLiteContext();
  const repository = useMemo(() => new SQLiteSleepRepository(database), [database]);
  const mutationInFlight = useRef(false);
  const refreshGeneration = useRef(0);
  const selectedDayRef = useRef('');
  const followingToday = useRef(true);
  const currentDayRef = useRef('');
  const [isMutating, setIsMutating] = useState(false);
  const [currentDay, setCurrentDay] = useState(() =>
    calendarDayForInstant(new Date(), LOCAL_DEVELOPMENT_IDENTITY.dayTimezone),
  );
  currentDayRef.current = currentDay;
  const [selectedDay, setSelectedDay] = useState(() =>
    calendarDayForInstant(new Date(), LOCAL_DEVELOPMENT_IDENTITY.dayTimezone),
  );
  selectedDayRef.current = selectedDay;
  const [state, setState] = useState<NapState>({
    naps: [],
    sleepSessions: [],
    activeSleep: null,
    pendingOperationCount: 0,
    latestCompletedEnd: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const updateCurrentDay = () => {
      const nextCurrentDay = calendarDayForInstant(
        new Date(),
        LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
      );
      if (currentDayRef.current === nextCurrentDay) return;
      currentDayRef.current = nextCurrentDay;
      setCurrentDay(nextCurrentDay);
      if (followingToday.current) setSelectedDay(nextCurrentDay);
    };
    const interval = setInterval(updateCurrentDay, 60_000);
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') updateCurrentDay();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

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
    const [napSessions, sleepSessions, activeSleep, pendingOperationCount, latestCompletedEnd] =
      await Promise.all([
        repository.listVisible(
          LOCAL_DEVELOPMENT_IDENTITY.childId,
          dayStartedAt,
          nextDayStartedAt,
          'nap',
        ),
        repository.listVisible(LOCAL_DEVELOPMENT_IDENTITY.childId, cycleStartedAt, cycleEndedAt),
        repository.active(LOCAL_DEVELOPMENT_IDENTITY.childId),
        repository.pendingOperationCount(),
        repository.latestCompletedEnd(LOCAL_DEVELOPMENT_IDENTITY.childId),
      ]);
    if (generation !== refreshGeneration.current || requestedDay !== selectedDayRef.current) return;
    setState({
      naps: napSessions.filter((session): session is NapSession => session.kind === 'nap'),
      sleepSessions,
      activeSleep,
      pendingOperationCount,
      latestCompletedEnd,
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
    async <TSession extends SleepSession>(
      mutationFactory: (now: Date) => SleepMutation<TSession>,
    ): Promise<TSession | null> => {
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

  return {
    ...state,
    activeNap: state.activeSleep?.kind === 'nap' ? state.activeSleep : null,
    isMutating,
    selectedDay,
    isToday: selectedDay === currentDay,
    previousDay: () => {
      followingToday.current = false;
      setSelectedDay((current) => shiftCalendarDay(current, -1));
    },
    nextDay: () =>
      setSelectedDay((current) => {
        const nextDay = shiftCalendarDay(current, 1);
        if (nextDay >= currentDayRef.current) {
          followingToday.current = true;
          return currentDayRef.current;
        }
        followingToday.current = false;
        return nextDay;
      }),
    goToToday: () => {
      followingToday.current = true;
      setSelectedDay(currentDayRef.current);
    },
    start: (startedAt?: Date) => mutate((now) => startNap(createContext(now), startedAt ?? now)),
    stop: (endedAt?: Date) => {
      const activeNap = state.activeSleep?.kind === 'nap' ? state.activeSleep : null;
      if (activeNap === null) {
        setState((current) => ({ ...current, error: 'There is no active nap to stop.' }));
        return Promise.resolve(null);
      }
      return mutate((now) => stopNap(activeNap, createContext(now), endedAt ?? now));
    },
    edit: (nap: NapSession, startedAt: Date, endedAt: Date | null) =>
      mutate((now) => editNap(nap, startedAt, endedAt, createContext(now))),
    editNight: (session: NightSleepSession, boundaries: readonly SleepPhaseBoundary[]) =>
      mutate((now) => editNightSleep(session, boundaries, createContext(now))),
    remove: (nap: NapSession) => mutate((now) => deleteNap(nap, createContext(now))),
    restore: (deletedNap: NapSession) =>
      mutate((now) => restoreNap(deletedNap, createContext(now))),
    removeNight: (session: NightSleepSession) =>
      mutate((now) => deleteNightSleep(session, createContext(now))),
    restoreNight: (session: NightSleepSession) =>
      mutate((now) => restoreNightSleep(session, createContext(now))),
    startNight: (startedAt?: Date) =>
      mutate((now) => startNightSleep(createContext(now), startedAt ?? now)),
    startNightWaking: (startedAt?: Date) => {
      const activeNight = state.activeSleep?.kind === 'night' ? state.activeSleep : null;
      if (activeNight === null) {
        setState((current) => ({ ...current, error: 'There is no active Night sleep.' }));
        return Promise.resolve(null);
      }
      return mutate((now) => startNightWaking(activeNight, createContext(now), startedAt ?? now));
    },
    resumeNight: (startedAt?: Date) => {
      const activeNight = state.activeSleep?.kind === 'night' ? state.activeSleep : null;
      if (activeNight === null) {
        setState((current) => ({ ...current, error: 'There is no active Night waking.' }));
        return Promise.resolve(null);
      }
      return mutate((now) => resumeNightSleep(activeNight, createContext(now), startedAt ?? now));
    },
    endNight: (endedAt?: Date) => {
      const activeNight = state.activeSleep?.kind === 'night' ? state.activeSleep : null;
      if (activeNight === null) {
        setState((current) => ({ ...current, error: 'There is no active Night sleep.' }));
        return Promise.resolve(null);
      }
      return mutate((now) => endNightSleep(activeNight, createContext(now), endedAt ?? now));
    },
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

/**
 * Converts an error value into a user-facing message.
 *
 * @param error - The value to convert into a message
 * @returns The error's message, or a generic retry message for other values
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
