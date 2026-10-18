import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { calendarDayForInstant, shiftCalendarDay } from '@/features/naps/calendar-day';
import {
  CareServiceError,
  emptySnapshot,
  type CareCommand,
  type CareProfile,
  type CareProvider,
  type CareSnapshot,
} from './contracts';

export type CareProviderFactory = (timezone: string) => Promise<CareProvider>;

interface State {
  stage: 'loading' | 'email' | 'otp' | 'profiles' | 'ready';
  babies: CareProfile[];
  baby: CareProfile | null;
  current: CareSnapshot;
  history: CareSnapshot;
  updatedAt: Date | null;
  error: string | null;
  date: string;
  busy: boolean;
  refreshing: boolean;
  readNeedsRefresh: boolean;
}
export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Owns asynchronous reads and invalidates responses from an old profile/date/session. */
export function useCareTracker(createProvider: CareProviderFactory) {
  const timezone = useRef(deviceTimezone()).current;
  const [state, setState] = useState<State>(() => ({
    stage: 'loading',
    babies: [],
    baby: null,
    current: emptySnapshot(),
    history: emptySnapshot(),
    updatedAt: null,
    error: null,
    date: calendarDayForInstant(new Date(), timezone),
    busy: false,
    refreshing: false,
    readNeedsRefresh: false,
  }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const tracker = useRef<CareProvider | null>(null);
  const busy = useRef(false);
  const followingToday = useRef(true);
  const generation = useRef(0);
  const mounted = useRef(true);
  const startup = useRef<Promise<CareProvider> | null>(null);
  const fail = useCallback((error: unknown) => {
    if (!mounted.current) return;
    setState((s) => ({
      ...s,
      stage: s.stage === 'loading' ? 'email' : s.stage,
      error:
        error instanceof CareServiceError
          ? error.message
          : 'This action could not be completed. Try again.',
      ...(error instanceof CareServiceError && error.code === 'auth'
        ? {
            stage: 'email' as const,
            baby: null,
            current: emptySnapshot(),
            history: emptySnapshot(),
            updatedAt: null,
          }
        : {}),
    }));
  }, []);
  const refresh = useCallback(
    async (manual = false, baby = stateRef.current.baby, requestedDate?: string) => {
      const service = tracker.current;
      if (!service || !baby || busy.current) return;
      const date =
        requestedDate ??
        (followingToday.current
          ? calendarDayForInstant(new Date(), timezone)
          : stateRef.current.date);
      const nonce = ++generation.current;
      setState((s) => ({ ...s, refreshing: true }));
      try {
        const current = manual
          ? await service.care.reconcile(baby.id)
          : await service.care.current(baby.id);
        const history =
          date === calendarDayForInstant(new Date(), timezone)
            ? current
            : await service.care.history(baby.id, date);
        if (mounted.current && nonce === generation.current)
          setState((s) => ({
            ...s,
            current,
            history,
            date,
            updatedAt: new Date(),
            error: null,
            stage: 'ready',
            refreshing: false,
            readNeedsRefresh: false,
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
    const babies = await service.session.profiles();
    if (!mounted.current || nonce !== generation.current) return;
    const baby =
      babies.find((b) => b.id === service.session.selectedProfileId) ??
      (babies.length === 1 ? babies[0] : null);
    if (baby) await service.session.selectProfile(baby.id);
    if (!mounted.current || nonce !== generation.current) return;
    setState((s) => ({
      ...s,
      babies,
      baby,
      stage: baby ? 'ready' : 'profiles',
      current: emptySnapshot(),
      history: emptySnapshot(),
      updatedAt: null,
      error: null,
    }));
    if (baby) await refresh(false, baby);
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    startup.current ??= createProvider(timezone);
    const nonce = ++generation.current;
    void startup.current
      .then(async (service) => {
        if (!mounted.current || nonce !== generation.current) return;
        tracker.current = service;
        if (await service.session.restore()) {
          if (mounted.current && nonce === generation.current) await profiles();
        } else if (mounted.current && nonce === generation.current)
          setState((s) => ({ ...s, stage: 'email' }));
      })
      .catch(fail);
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [createProvider, fail, profiles, timezone]);
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
  const run = async (action: (nonce: number) => Promise<void>) => {
    if (busy.current) return false;
    busy.current = true;
    const nonce = ++generation.current;
    setState((s) => ({ ...s, busy: true, error: null, refreshing: false }));
    try {
      await action(nonce);
      return mounted.current && nonce === generation.current;
    } catch (error) {
      if (nonce === generation.current) fail(error);
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setState((s) => ({ ...s, busy: false }));
    }
  };
  const execute = async (command: CareCommand) => {
    const service = tracker.current;
    const baby = stateRef.current.baby;
    const date = stateRef.current.date;
    if (!service || !baby) return false;
    if (stateRef.current.readNeedsRefresh || service.care.needsRefresh) {
      fail(
        new CareServiceError(
          'uncertain',
          'Refresh and review the last save before making another change.',
        ),
      );
      return false;
    }
    const nonce = generation.current + 1;
    return run(async () => {
      await service.care.execute(baby.id, command);
      let current: CareSnapshot;
      try {
        current = await service.care.current(baby.id);
      } catch {
        if (mounted.current && nonce === generation.current)
          setState((s) => ({
            ...s,
            readNeedsRefresh: true,
            error:
              'The activity was saved. Refresh the shared records before making another change.',
          }));
        return;
      }
      let history = stateRef.current.history;
      let readError: string | null = null;
      try {
        history =
          date === calendarDayForInstant(new Date(), timezone)
            ? current
            : await service.care.history(baby.id, date);
      } catch {
        readError = 'The activity was saved. This history view could not be refreshed.';
      }
      if (mounted.current && nonce === generation.current)
        setState((s) => ({ ...s, current, history, updatedAt: new Date(), error: readError }));
    });
  };
  return {
    ...state,
    timezone,
    providerName: tracker.current?.name ?? 'Shared service',
    execute,
    needsRefresh: state.readNeedsRefresh || (tracker.current?.care.needsRefresh ?? false),
    showProfiles: () => {
      if (!busy.current) {
        generation.current++;
        setState((s) => ({ ...s, stage: 'profiles', refreshing: false }));
      }
    },
    refresh: () => refresh(true),
    enterExistingCode: () => {
      if (busy.current || stateRef.current.stage !== 'email') return;
      generation.current++;
      setState((s) => ({ ...s, stage: 'otp', error: null }));
    },
    sendOtp: (email: string) =>
      run(async (nonce) => {
        const service = tracker.current;
        if (!service) throw new CareServiceError('network', 'Restart the app and try again.');
        await service.session.sendCode(email);
        if (mounted.current && nonce === generation.current)
          setState((s) => ({ ...s, stage: 'otp' }));
      }),
    login: async (email: string, otp: string) => {
      const success = await run(async (nonce) => {
        const service = tracker.current;
        if (!service) throw new CareServiceError('network', 'Restart the app and try again.');
        await service.session.login(email, otp);
        if (mounted.current && nonce === generation.current)
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
    selectBaby: async (baby: CareProfile) => {
      const selected = await run(async (nonce) => {
        await tracker.current?.session.selectProfile(baby.id);
        if (!mounted.current || nonce !== generation.current) return;
        setState((s) => ({
          ...s,
          baby,
          stage: 'ready',
          current: emptySnapshot(),
          history: emptySnapshot(),
          updatedAt: null,
          readNeedsRefresh: false,
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
        current: emptySnapshot(),
        history: emptySnapshot(),
        updatedAt: null,
        readNeedsRefresh: false,
        error: null,
      }));
      try {
        await tracker.current?.session.signOut();
      } catch (error) {
        fail(error);
      }
    },
    setDate: (date: string) => {
      if (busy.current) return;
      followingToday.current = date === calendarDayForInstant(new Date(), timezone);
      generation.current++;
      setState((s) => ({ ...s, date, history: emptySnapshot(), error: null }));
      void refresh(false, stateRef.current.baby, date);
    },
    today: calendarDayForInstant(new Date(), timezone),
    previousDate: () => shiftCalendarDay(state.date, -1),
    clearError: () => setState((s) => ({ ...s, error: null })),
  };
}
