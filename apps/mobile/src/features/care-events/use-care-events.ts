import {
  type CareEvent,
  type CareEventMutation,
  createDiaperEvent,
  createMedicineEvent,
  createUuidV7,
  type DiaperCareEvent,
  type DiaperType,
  deleteCareEvent,
  editCareEvent,
  type MedicineCareEvent,
  restoreCareEvent,
} from '@baby-tracker/domain';
import { getRandomValues } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { shiftCalendarDay, zonedDayBounds } from '@/features/naps/calendar-day';
import { careEventErrorMessage } from './care-event-application-state';
import { SQLiteCareEventRepository } from './sqlite-care-event-repository';

interface CareEventState {
  events: CareEvent[];
  cycleEvents: CareEvent[];
  pendingOperationCount: number;
  isLoading: boolean;
  error: string | null;
}

/** Loads selected-day point events and applies exact-record optimistic mutations locally first. */
export function useCareEvents(selectedDay: string) {
  const database = useSQLiteContext();
  const repository = useMemo(() => new SQLiteCareEventRepository(database), [database]);
  const mutationInFlight = useRef(false);
  const refreshGeneration = useRef(0);
  const selectedDayRef = useRef(selectedDay);
  selectedDayRef.current = selectedDay;
  const [isMutating, setIsMutating] = useState(false);
  const [state, setState] = useState<CareEventState>({
    events: [],
    cycleEvents: [],
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
    const [events, cycleEvents, pendingOperationCount] = await Promise.all([
      repository.listVisible(LOCAL_DEVELOPMENT_IDENTITY.childId, dayStartedAt, nextDayStartedAt),
      repository.listVisible(LOCAL_DEVELOPMENT_IDENTITY.childId, cycleStartedAt, cycleEndedAt),
      repository.pendingOperationCount(),
    ]);
    if (generation !== refreshGeneration.current || requestedDay !== selectedDayRef.current) return;
    setState({ events, cycleEvents, pendingOperationCount, isLoading: false, error: null });
  }, [repository, selectedDay]);

  useEffect(() => {
    refresh().catch((error: unknown) => {
      setState((current) => ({
        ...current,
        isLoading: false,
        error: careEventErrorMessage(error),
      }));
    });
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState !== 'active') return;
      refresh().catch((error: unknown) => {
        setState((current) => ({ ...current, error: careEventErrorMessage(error) }));
      });
    });
    return () => subscription.remove();
  }, [refresh]);

  const mutate = useCallback(
    async (factory: (now: Date) => CareEventMutation): Promise<CareEvent | null> => {
      if (mutationInFlight.current) return null;
      mutationInFlight.current = true;
      setIsMutating(true);
      try {
        const mutation = factory(new Date());
        await repository.save(mutation);
        try {
          await refresh();
        } catch (error: unknown) {
          setState((current) => ({ ...current, error: careEventErrorMessage(error) }));
        }
        return mutation.event;
      } catch (error: unknown) {
        try {
          await refresh();
        } catch {
          // Preserve the fixed mutation error even when canonical refresh also fails.
        }
        setState((current) => ({ ...current, error: careEventErrorMessage(error) }));
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
    refresh,
    createDiaper: (diaperType: DiaperType, occurredAt: Date) =>
      mutate((now) => createDiaperEvent(diaperType, createContext(now), occurredAt)),
    createMedicine: (note: string, occurredAt: Date) =>
      mutate((now) => createMedicineEvent(note, createContext(now), occurredAt)),
    editDiaper: (event: DiaperCareEvent, diaperType: DiaperType, occurredAt: Date) =>
      mutate((now) =>
        editCareEvent(event, { occurredAt, data: { diaperType } }, createContext(now)),
      ),
    editMedicine: (event: MedicineCareEvent, note: string, occurredAt: Date) =>
      mutate((now) => editCareEvent(event, { occurredAt, data: { note } }, createContext(now))),
    remove: (event: CareEvent) =>
      event.kind === 'diaper'
        ? mutate((now) => deleteCareEvent(event, createContext(now)))
        : mutate((now) => deleteCareEvent(event, createContext(now))),
    restore: (event: CareEvent) =>
      event.kind === 'diaper'
        ? mutate((now) => restoreCareEvent(event, createContext(now)))
        : mutate((now) => restoreCareEvent(event, createContext(now))),
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
