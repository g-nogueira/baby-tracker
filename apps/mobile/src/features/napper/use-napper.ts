import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { calendarDayForInstant, shiftCalendarDay } from '@/features/naps/calendar-day';
import { NapperClient } from './client';
import { type Breast, type NapperBaby, NapperError, type WireLog } from './contracts';
import type { NursingCommand } from './nursing';
import { napperDeviceId, SecureNapperCredentials } from './secure-credentials';
import { NapperTracker, type MutationResult } from './tracker';

interface State {
  stage: 'loading' | 'email' | 'otp' | 'profiles' | 'ready';
  babies: NapperBaby[];
  baby: NapperBaby | null;
  current: WireLog[];
  history: WireLog[];
  updatedAt: Date | null;
  error: string | null;
  date: string;
  busy: boolean;
  refreshing: boolean;
}
export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Owns asynchronous reads and invalidates responses from an old profile/date/session. */
export function useNapper() {
  const timezone = useRef(deviceTimezone()).current;
  const [state, setState] = useState<State>(() => ({
    stage: 'loading',
    babies: [],
    baby: null,
    current: [],
    history: [],
    updatedAt: null,
    error: null,
    date: calendarDayForInstant(new Date(), timezone),
    busy: false,
    refreshing: false,
  }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const tracker = useRef<NapperTracker | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const startup = useRef<Promise<NapperTracker> | null>(null);
  const fail = useCallback((error: unknown) => {
    if (!mounted.current) return;
    setState((s) => ({
      ...s,
      error:
        error instanceof NapperError
          ? error.message
          : 'This action could not be completed. Try again.',
      ...(error instanceof NapperError && error.code === 'auth'
        ? { stage: 'email' as const, baby: null, current: [], history: [], updatedAt: null }
        : {}),
    }));
  }, []);
  const refresh = useCallback(
    async (manual = false, baby = stateRef.current.baby, date = stateRef.current.date) => {
      const service = tracker.current;
      if (!service || !baby || busy.current) return;
      const nonce = ++generation.current;
      setState((s) => ({ ...s, refreshing: true }));
      try {
        const current = manual ? await service.reconcile(baby.id) : await service.current(baby.id);
        const history =
          date === calendarDayForInstant(new Date(), timezone)
            ? current
            : await service.history(baby.id, date);
        if (mounted.current && nonce === generation.current)
          setState((s) => ({
            ...s,
            current,
            history,
            updatedAt: new Date(),
            error: null,
            stage: 'ready',
            refreshing: false,
          }));
      } catch (error) {
        if (mounted.current && nonce === generation.current) {
          fail(error);
          setState((s) => ({ ...s, refreshing: false }));
        }
      }
    },
    [fail, timezone],
  );
  const profiles = useCallback(async () => {
    const service = tracker.current;
    if (!service) return;
    const nonce = ++generation.current;
    const babies = await service.client.babies();
    if (!mounted.current || nonce !== generation.current) return;
    const baby =
      babies.find((b) => b.id === service.client.babyId) ??
      (babies.length === 1 ? babies[0] : null);
    if (baby) await service.client.selectBaby(baby.id);
    if (!mounted.current || nonce !== generation.current) return;
    setState((s) => ({
      ...s,
      babies,
      baby,
      stage: baby ? 'ready' : 'profiles',
      current: [],
      history: [],
      updatedAt: null,
      error: null,
    }));
    if (baby) await refresh(false, baby);
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    startup.current ??= (async () =>
      new NapperTracker(
        new NapperClient(new SecureNapperCredentials(), await napperDeviceId()),
        randomUUID,
        timezone,
      ))();
    const nonce = ++generation.current;
    void startup.current
      .then(async (service) => {
        if (!mounted.current || nonce !== generation.current) return;
        tracker.current = service;
        if (await service.client.restore()) {
          if (mounted.current && nonce === generation.current) await profiles();
        } else if (mounted.current && nonce === generation.current)
          setState((s) => ({ ...s, stage: 'email' }));
      })
      .catch(fail);
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [fail, profiles, timezone]);
  useEffect(() => {
    if (state.stage !== 'ready' || !state.baby) return;
    const interval = setInterval(() => void refresh(), 30000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [state.stage, state.baby, refresh]);
  const run = async (action: () => Promise<void>) => {
    if (busy.current) return false;
    busy.current = true;
    const nonce = ++generation.current;
    setState((s) => ({ ...s, busy: true, error: null, refreshing: false }));
    try {
      await action();
      return true;
    } catch (error) {
      if (nonce === generation.current) fail(error);
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setState((s) => ({ ...s, busy: false }));
    }
  };
  const mutate = async (
    action: (service: NapperTracker, babyId: string) => Promise<MutationResult>,
  ) => {
    const service = tracker.current;
    const baby = stateRef.current.baby;
    const date = stateRef.current.date;
    if (!service || !baby) return false;
    const nonce = generation.current + 1;
    return run(async () => {
      const result = await action(service, baby.id);
      const current = result.current;
      let history = stateRef.current.history;
      let readError: string | null = null;
      try {
        history =
          date === calendarDayForInstant(new Date(), timezone)
            ? current
            : result.source === 'day' && date === result.date
              ? result.logs
              : await service.history(baby.id, date);
      } catch {
        readError = 'The feed was saved. This history view could not be refreshed.';
      }
      if (mounted.current && nonce === generation.current)
        setState((s) => ({ ...s, current, history, updatedAt: new Date(), error: readError }));
    });
  };
  return {
    ...state,
    timezone,
    needsRefresh: tracker.current?.writeNeedsRefresh ?? false,
    refresh: () => refresh(true),
    sendOtp: (email: string) =>
      run(async () => {
        const service = tracker.current;
        if (!service) throw new NapperError('network', 'Restart the app and try again.');
        await service.client.sendOtp(email);
        setState((s) => ({ ...s, stage: 'otp' }));
      }),
    login: async (email: string, otp: string) => {
      const success = await run(async () => {
        const service = tracker.current;
        if (!service) throw new NapperError('network', 'Restart the app and try again.');
        await service.client.login(email, otp);
        setState((s) => ({ ...s, stage: 'profiles' }));
      });
      if (success)
        try {
          await profiles();
        } catch (error) {
          fail(error);
        }
      return success;
    },
    loadProfiles: async () => {
      try {
        await profiles();
      } catch (error) {
        fail(error);
      }
    },
    selectBaby: async (baby: NapperBaby) => {
      const selected = await run(async () => {
        await tracker.current?.client.selectBaby(baby.id);
        setState((s) => ({
          ...s,
          baby,
          stage: 'ready',
          current: [],
          history: [],
          updatedAt: null,
        }));
      });
      if (selected) await refresh(false, baby);
    },
    signOut: async () => {
      generation.current++;
      setState((s) => ({
        ...s,
        stage: 'email',
        babies: [],
        baby: null,
        current: [],
        history: [],
        updatedAt: null,
        error: null,
      }));
      try {
        await tracker.current?.client.signOut();
      } catch (error) {
        fail(error);
      }
    },
    setDate: (date: string) => {
      generation.current++;
      setState((s) => ({ ...s, date, history: [], error: null }));
      void refresh(false, stateRef.current.baby, date);
    },
    today: calendarDayForInstant(new Date(), timezone),
    previousDate: () => shiftCalendarDay(state.date, -1),
    start: (side: Breast, at: Date) => mutate((service, babyId) => service.start(babyId, side, at)),
    change: (log: WireLog, command: NursingCommand) =>
      mutate((service, babyId) => service.change(babyId, log, command)),
    correct: (log: WireLog, start: Date, end: Date, left: number, last: Breast) =>
      mutate((service, babyId) => service.correct(babyId, log, start, end, left, last)),
    clearError: () => setState((s) => ({ ...s, error: null })),
  };
}
