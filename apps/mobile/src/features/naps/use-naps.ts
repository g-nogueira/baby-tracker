import {
  createUuidV7,
  deleteNap,
  editNap,
  restoreNap,
  startNap,
  stopNap,
  type NapMutation,
  type NapSession,
} from '@baby-tracker/domain';
import { getRandomValues } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { calendarDayForInstant, shiftCalendarDay, zonedDayBounds } from './calendar-day';
import { SQLiteNapRepository } from './sqlite-nap-repository';

interface NapState {
  naps: NapSession[];
  activeNap: NapSession | null;
  pendingOperationCount: number;
  latestCompletedEnd: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useNaps() {
  const database = useSQLiteContext();
  const repository = useMemo(() => new SQLiteNapRepository(database), [database]);
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
    activeNap: null,
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
    const [naps, activeNap, pendingOperationCount, latestCompletedEnd] = await Promise.all([
      repository.listVisible(LOCAL_DEVELOPMENT_IDENTITY.childId, dayStartedAt, nextDayStartedAt),
      repository.active(LOCAL_DEVELOPMENT_IDENTITY.childId),
      repository.pendingOperationCount(),
      repository.latestCompletedEnd(LOCAL_DEVELOPMENT_IDENTITY.childId),
    ]);
    if (generation !== refreshGeneration.current || requestedDay !== selectedDayRef.current) return;
    setState({
      naps,
      activeNap,
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

  const mutate = useCallback(
    async (mutationFactory: (now: Date) => NapMutation): Promise<NapSession | null> => {
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
        setState((current) => ({ ...current, error: errorMessage(error) }));
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
      const activeNap = state.activeNap;
      if (activeNap === null) return Promise.resolve(null);
      return mutate((now) => stopNap(activeNap, createContext(now), endedAt ?? now));
    },
    edit: (nap: NapSession, startedAt: Date, endedAt: Date | null) =>
      mutate((now) => editNap(nap, startedAt, endedAt, createContext(now))),
    remove: (nap: NapSession) => mutate((now) => deleteNap(nap, createContext(now))),
    restore: (deletedNap: NapSession) =>
      mutate((now) => restoreNap(deletedNap, createContext(now))),
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
