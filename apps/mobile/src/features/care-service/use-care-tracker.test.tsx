import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCareTracker } from './use-care-tracker';
import { emptySnapshot, type CareCommand, type CareProvider, type CareSnapshot } from './contracts';
const boundary = vi.hoisted(() => ({ foreground: null as null | ((state: string) => void) }));
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      boundary.foreground = listener;
      return { remove: vi.fn() };
    },
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
let model: ReturnType<typeof useCareTracker>;
function setup() {
  let rows: CareSnapshot = emptySnapshot();
  let selected: string | null = 'own-service-baby';
  const current = vi.fn(async () => rows);
  const history = vi.fn(async () => rows);
  const execute = vi.fn(async (_profile: string, command: CareCommand) => {
    if (command.type === 'start-nursing')
      rows = {
        activities: [
          {
            id: 'own-feed',
            revision: 'own-version-1',
            kind: 'nursing',
            startedAt: command.at,
            endedAt: null,
            status: 'active',
            leftSeconds: 0,
            rightSeconds: 0,
            lastBreast: command.side,
            measuredAt: command.at,
            pauseSeconds: 0,
          },
        ],
        issues: [],
      };
  });
  // This provider deliberately uses no Napper objects, HTTP routes, credentials or field names.
  const provider: CareProvider = {
    name: 'Our service',
    session: {
      get selectedProfileId() {
        return selected;
      },
      restore: async () => true,
      sendCode: async () => undefined,
      login: async () => undefined,
      profiles: async () => [{ id: 'own-service-baby', name: 'Test child' }],
      selectProfile: async (id) => {
        selected = id;
      },
      signOut: async () => {
        selected = null;
      },
    },
    care: { needsRefresh: false, current, history, reconcile: current, execute },
  };
  const factory = async () => provider;
  function Harness() {
    model = useCareTracker(factory);
    return null;
  }
  return { Harness, provider, current, history, execute };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('The generic hook must not use HTTP');
    }),
  );
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('can replace the whole provider without modifying the hook, UI commands or canonical read model', async () => {
  const h = setup();
  await act(async () => {
    renderer = create(<h.Harness />);
  });
  expect(model.stage).toBe('ready');
  expect(model.providerName).toBe('Our service');
  const command: CareCommand = {
    type: 'start-nursing',
    side: 'LEFT',
    at: new Date().toISOString(),
  };
  let success = false;
  await act(async () => {
    success = await model.execute(command);
  });
  expect(success).toBe(true);
  expect(h.execute).toHaveBeenCalledWith('own-service-baby', command);
  expect(model.current.activities[0]).toMatchObject({ id: 'own-feed', revision: 'own-version-1' });
  expect(fetch).not.toHaveBeenCalled();
  const reads = h.current.mock.calls.length;
  await act(async () => boundary.foreground?.('active'));
  expect(h.current.mock.calls.length).toBeGreaterThan(reads);
});
it('treats a confirmed save followed by a view-read failure as saved and blocks duplicate submissions until refresh', async () => {
  const h = setup();
  await act(async () => {
    renderer = create(<h.Harness />);
  });
  h.current.mockRejectedValueOnce(new Error('synthetic view read failed'));
  const command: CareCommand = {
    type: 'start-nursing',
    side: 'RIGHT',
    at: new Date().toISOString(),
  };
  let saved = false;
  await act(async () => {
    saved = await model.execute(command);
  });
  expect(saved).toBe(true);
  expect(model.error).toContain('activity was saved');
  expect(model.needsRefresh).toBe(true);
  await act(async () => {
    expect(await model.execute(command)).toBe(false);
  });
  expect(h.execute).toHaveBeenCalledOnce();
  await act(async () => model.refresh());
  expect(model.needsRefresh).toBe(false);
  expect(model.current.activities).toHaveLength(1);
});
it('follows the new local date after midnight while retaining an explicitly selected historical date', async () => {
  const h = setup();
  await act(async () => {
    renderer = create(<h.Harness />);
  });
  const first = model.today;
  vi.setSystemTime(new Date(Date.now() + 26 * 3600000));
  await act(async () => boundary.foreground?.('active'));
  expect(model.today).not.toBe(first);
  expect(model.date).toBe(model.today);
  await act(async () => model.setDate('2026-10-10'));
  vi.setSystemTime(new Date(Date.now() + 26 * 3600000));
  await act(async () => boundary.foreground?.('active'));
  expect(model.date).toBe('2026-10-10');
  expect(h.history).toHaveBeenLastCalledWith('own-service-baby', '2026-10-10');
});
it('discards a late login response after sign-out instead of restoring the old profile', async () => {
  const h = setup();
  h.provider.session.restore = async () => false;
  let release: () => void = () => undefined;
  h.provider.session.login = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  await act(async () => {
    renderer = create(<h.Harness />);
  });
  let pending: Promise<boolean>;
  await act(async () => {
    pending = model.login('test@example.invalid', 'synthetic-code');
  });
  await act(async () => model.signOut());
  await act(async () => {
    release();
    await pending;
  });
  expect(model.stage).toBe('email');
  expect(model.baby).toBeNull();
  expect(model.current).toEqual(emptySnapshot());
});
it('does not let an older foreground refresh dismiss the profile picker', async () => {
  const h = setup();
  await act(async () => {
    renderer = create(<h.Harness />);
  });
  let release: (value: CareSnapshot) => void = () => undefined;
  h.current.mockReturnValueOnce(
    new Promise<CareSnapshot>((resolve) => {
      release = resolve;
    }),
  );
  await act(async () => boundary.foreground?.('active'));
  await act(async () => model.showProfiles());
  await act(async () => release(emptySnapshot()));
  expect(model.stage).toBe('profiles');
});
