import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCareTracker } from '@/features/care-service/use-care-tracker';
import { createCareProvider } from '@/composition/care-provider';
const useNapper = () => useCareTracker(createCareProvider);
import type { NapperCredentials } from './contracts';
const boundary = vi.hoisted(() => ({
  saved: null as NapperCredentials | null,
  listener: null as null | ((state: string) => void),
}));
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      boundary.listener = listener;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-id' }));
vi.mock('./secure-credentials', () => ({
  napperDeviceId: async () => 'synthetic-device',
  SecureNapperCredentials: class {
    async load() {
      return boundary.saved;
    }
    async save(value: NapperCredentials | null) {
      boundary.saved = value;
    }
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let model: ReturnType<typeof useNapper>;
let renderer: ReactTestRenderer;
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const auth = {
  item: {
    idToken: { token: 'synthetic-token', payload: { sub: 'synthetic-parent' } },
    refreshToken: { token: 'synthetic-refresh' },
  },
};
function Harness() {
  model = useNapper();
  return null;
}
const ready = async () => {
  await act(async () => {
    renderer = create(<Harness />);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  boundary.saved = null;
  boundary.listener = null;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('logs in, chooses a real profile, restores it after restart and reads again on foreground', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    if (path === '/auth/send-otp') return new Response('OK', { status: 200 });
    if (path === '/auth/email-login') return json(auth);
    if (path === '/babies')
      return json({ items: [{ type: 'BABY', id: 'synthetic-baby', name: 'Test baby' }] });
    return json({ item: { logs: [] } });
  });
  vi.stubGlobal('fetch', fetcher);
  await ready();
  expect(model.stage).toBe('email');
  await act(async () => {
    await model.sendOtp('test@example.invalid');
  });
  expect(model.stage).toBe('otp');
  await act(async () => {
    await model.login('test@example.invalid', '123456');
  });
  expect(model.stage).toBe('ready');
  expect(model.baby?.id).toBe('synthetic-baby');
  expect(boundary.saved?.babyId).toBe('synthetic-baby');
  const calls = fetcher.mock.calls.length;
  await act(async () => {
    boundary.listener?.('active');
  });
  expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
  await act(async () => renderer.unmount());
  await ready();
  expect(model.stage).toBe('ready');
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes('/auth/email-login')),
  ).toHaveLength(1);
});
it('requires profile selection when the account has multiple babies', async () => {
  boundary.saved = {
    idToken: 'synthetic',
    refreshToken: 'synthetic-refresh',
    accountId: 'synthetic-parent',
    babyId: null,
    expiresAt: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/babies')
        ? json({
            items: [
              { type: 'BABY', id: 'a', name: 'A' },
              { type: 'BABY', id: 'b', name: 'B' },
            ],
          })
        : json({ item: { logs: [] } }),
    ),
  );
  await ready();
  expect(model.stage).toBe('profiles');
  await act(async () => {
    await model.selectBaby(model.babies[1]);
  });
  expect(model.baby?.id).toBe('b');
  expect(boundary.saved?.babyId).toBe('b');
});
it('discards an old history response after navigating back to today and clears data at sign-out', async () => {
  boundary.saved = {
    idToken: 'synthetic',
    refreshToken: 'synthetic-refresh',
    accountId: 'synthetic-parent',
    babyId: 'a',
    expiresAt: null,
  };
  let release: ((value: Response) => void) | undefined;
  const old = new Promise<Response>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/babies')) return json({ items: [{ type: 'BABY', id: 'a', name: 'A' }] });
      if (url.endsWith('/2026-10-10')) return old;
      return json({ item: { logs: [] } });
    }),
  );
  await ready();
  await act(async () => {
    model.setDate('2026-10-10');
  });
  await act(async () => {
    model.setDate(model.today);
  });
  await act(async () => {
    release?.(
      json({ item: { logs: [{ id: 'old', category: 'NURSING', start: '2026-10-10T10:00:00Z' }] } }),
    );
  });
  expect(model.date).toBe(model.today);
  expect(model.history).toEqual({ activities: [], issues: [] });
  await act(async () => {
    await model.signOut();
  });
  expect(model.stage).toBe('email');
  expect(model.baby).toBeNull();
  expect(model.current).toEqual({ activities: [], issues: [] });
  expect(boundary.saved).toBeNull();
});
it('lets an already-delivered code reach verification after a failed send acknowledgment, without resending', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    if (path === '/auth/send-otp') throw new Error('connection lost after email delivery');
    if (path === '/auth/email-login') return json(auth);
    if (path === '/babies')
      return json({ items: [{ type: 'BABY', id: 'synthetic-baby', name: 'Test baby' }] });
    return json({ item: { logs: [] } });
  });
  vi.stubGlobal('fetch', fetcher);
  await ready();
  await act(async () => {
    await model.sendOtp('test@example.invalid');
  });
  expect(model.stage).toBe('email');
  expect(model.error).toBeTruthy();
  await act(async () => {
    model.enterExistingCode();
  });
  expect(model.stage).toBe('otp');
  expect(model.error).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/auth/send-otp'))).toHaveLength(
    1,
  );
  expect(boundary.saved).toBeNull();
  await act(async () => {
    await model.login('test@example.invalid', '123456');
  });
  expect(model.stage).toBe('ready');
});
it('keeps credentials unset when an existing code is rejected by verification', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
  vi.stubGlobal('fetch', fetcher);
  await ready();
  await act(async () => {
    model.enterExistingCode();
  });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    await model.login('test@example.invalid', '123456');
  });
  expect(model.stage).toBe('email');
  expect(model.baby).toBeNull();
  expect(boundary.saved).toBeNull();
});
