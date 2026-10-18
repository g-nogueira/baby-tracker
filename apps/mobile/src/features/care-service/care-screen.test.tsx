import { forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import type {
  CareActivity,
  CareSnapshot,
  NursingActivity,
  PointActivity,
  SleepActivity,
} from './contracts';
import type { CareScreen } from './care-screen';
import { NursingSheet } from './nursing-sheet';
import { ActivitySheet } from './activity-sheet';
import { RadialCycle, RadialCycleSelector } from '@/features/timeline/radial-cycle';

/** Exercise Expo's Android transform: source-only rendering misses compiler ordering bugs. */
async function compileNativeScreen(isDev: boolean): Promise<typeof CareScreen> {
  const mobileRequire = createRequire(new URL('../../../package.json', import.meta.url));
  const expoRequire = createRequire(mobileRequire.resolve('expo/package.json'));
  const babel = expoRequire('@babel/core') as {
    transformFileSync: (path: string, options: Record<string, unknown>) => { code: string };
  };
  const compiled = babel.transformFileSync(
    fileURLToPath(new URL('./care-screen.tsx', import.meta.url)),
    {
      babelrc: false,
      configFile: false,
      presets: [expoRequire.resolve('babel-preset-expo')],
      caller: {
        name: 'metro',
        bundler: 'metro',
        platform: 'android',
        engine: 'hermes',
        isDev,
        supportsReactCompiler: true,
        projectRoot: fileURLToPath(new URL('../../../', import.meta.url)),
      },
    },
  );
  const dependencies = new Map<string, unknown>([
    ['react-native', await vi.importMock('react-native')],
    ['react-native-svg', { __esModule: true, ...(await vi.importMock('react-native-svg')) }],
    ['react-native-safe-area-context', await vi.importMock('react-native-safe-area-context')],
    ['./use-care-tracker', await vi.importMock('./use-care-tracker')],
  ]);
  for (const [, id] of compiled.code.matchAll(/require\("([^"]+)"\)/g)) {
    if (!dependencies.has(id)) {
      try {
        dependencies.set(id, id.startsWith('@babel/runtime/') ? expoRequire(id) : await import(id));
      } catch (cause) {
        throw new Error(`Native test import failed: ${id}`, { cause });
      }
    }
  }
  const module = { exports: {} as { CareScreen: typeof CareScreen } };
  runInNewContext(compiled.code, {
    require: (id: string) => {
      if (!dependencies.has(id)) throw new Error(`Unresolved native test import: ${id}`);
      return dependencies.get(id);
    },
    module,
    exports: module.exports,
    get Date() {
      return globalThis.Date;
    },
    get setInterval() {
      return globalThis.setInterval;
    },
    get clearInterval() {
      return globalThis.clearInterval;
    },
  });
  return module.exports.CareScreen;
}
let NativeCareScreen: typeof CareScreen;
beforeAll(async () => {
  NativeCareScreen = await compileNativeScreen(true);
});
const hooks = vi.hoisted(() => ({ model: {} as Record<string, unknown> }));
vi.mock('./use-care-tracker', () => ({ useCareTracker: () => ({ ...hooks.model }) }));
vi.mock('expo-router', () => ({ Link: 'Link' }));
const gestures = vi.hoisted(() => ({
  current: null as null | {
    onMoveShouldSetPanResponder: (event: unknown, move: { dx: number; dy: number }) => boolean;
    onPanResponderRelease: (event: unknown, move: { dx: number; dy: number }) => void;
  },
}));
vi.mock('react-native', () => ({
  LayoutAnimation: { configureNext: () => {}, Presets: { easeInEaseOut: {} } },
  Animated: {
    Value: class {
      setValue() {}
    },
    View: 'View',
    spring: () => ({ start: () => {} }),
  },
  PanResponder: {
    create: (config: NonNullable<typeof gestures.current>) => {
      gestures.current = config;
      return { panHandlers: {} };
    },
  },
  Image: 'Image',
  View: 'View',
  StatusBar: 'StatusBar',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android' },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {}, hairlineWidth: 1 },
  useWindowDimensions: () => ({ height: 800, width: 360 }),
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 24 }),
}));
vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Circle: 'Circle',
  G: 'G',
  Line: 'Line',
  Path: 'Path',
  Defs: 'Defs',
  LinearGradient: 'LinearGradient',
  Stop: 'Stop',
  Rect: 'Rect',
  RadialGradient: 'RadialGradient',
  Text: 'SvgText',
}));
vi.mock('@lodev09/react-native-true-sheet', () => ({
  TrueSheet: forwardRef((props: Record<string, unknown>, ref) => {
    useImperativeHandle(ref, () => ({
      resize: async () => undefined,
      dismiss: async () => (props.onDidDismiss as (() => void) | undefined)?.(),
    }));
    return (
      <>
        {props.children as import('react').ReactNode}
        {props.footer as import('react').ReactNode}
      </>
    );
  }),
}));
vi.mock('@react-native-community/slider', () => ({ default: 'Slider' }));
vi.mock('@react-native-community/datetimepicker', () => ({ default: 'DateTimePicker' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const active: NursingActivity = {
  id: 'synthetic-active',
  revision: 'v-active',
  kind: 'nursing',
  measuredAt: '2026-10-15T01:22:00.000Z',
  startedAt: '2026-10-15T01:22:00.000Z',
  endedAt: null,
  status: 'active',
  lastBreast: 'RIGHT',
  leftSeconds: 0,
  rightSeconds: 0,
  pauseSeconds: 0,
};
const previous: NursingActivity = {
  ...active,
  id: 'synthetic-previous',
  revision: 'v-previous',
  startedAt: '2026-10-14T18:00:00.000Z',
  endedAt: '2026-10-14T18:20:00.000Z',
  status: 'completed',
  rightSeconds: 1200,
};
const bed: PointActivity = {
  id: 'bed',
  revision: 'bed-v1',
  kind: 'bedtime',
  startedAt: '2026-10-14T19:05:00.000Z',
  endedAt: '2026-10-14T19:05:00.000Z',
  status: 'completed',
};
const waking: SleepActivity = {
  id: 'waking',
  revision: 'waking-v1',
  kind: 'night-waking',
  measuredAt: '2026-10-15T12:00:00.000Z',
  startedAt: '2026-10-15T01:10:00.000Z',
  endedAt: null,
  status: 'active',
  pauseSeconds: 0,
};
let renderer: ReactTestRenderer;
const press = (label: string) => {
  const buttons = renderer.root.findAllByType('Pressable' as never);
  return (
    buttons.find((node) => node.props.accessibilityLabel === label) ??
    buttons.find((node) => String(node.props.accessibilityLabel).startsWith(label))
  );
};
const text = () =>
  renderer.root
    .findAllByType('Text' as never)
    .map((node) => node.children.join(''))
    .join('|');
const factory = vi.fn();
const snapshot = (activities: CareActivity[]): CareSnapshot => ({ activities, issues: [] });
const render = async () => {
  await act(async () => {
    renderer = create(<NativeCareScreen createProvider={factory} />);
  });
};
const update = async () => {
  await act(async () => renderer.update(<NativeCareScreen createProvider={factory} />));
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T01:25:23.000Z'));
  hooks.model = {
    stage: 'ready',
    baby: { id: 'synthetic-baby', name: 'Test baby' },
    babies: [{ id: 'synthetic-baby', name: 'Test baby' }],
    current: snapshot([previous, active]),
    history: snapshot([previous, active]),
    date: '2026-10-15',
    today: '2026-10-15',
    timezone: 'Europe/Lisbon',
    providerName: 'Replaceable test service',
    busy: false,
    needsRefresh: false,
    updatedAt: new Date(),
    error: null,
    refreshing: false,
    clearError: vi.fn(),
    execute: vi.fn().mockResolvedValue(true),
    refresh: vi.fn(),
    setDate: vi.fn(),
    showProfiles: vi.fn(),
    signOut: vi.fn(),
  };
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
});
it('renders action recency with the production native compiler', async () => {
  const ProductionCareScreen = await compileNativeScreen(false);
  await act(async () => {
    renderer = create(<ProductionCareScreen createProvider={factory} />);
  });
  expect(press('Nursing, 3 min')).toBeDefined();
});
it('uses the dark surface for both cycles and keeps navigation available on an empty Night', async () => {
  hooks.model.current = snapshot([]);
  hooks.model.history = hooks.model.current;
  await render();
  expect(renderer.root.findByType('StatusBar' as never).props.barStyle).toBe('light-content');
  await act(async () => press('History')?.props.onPress());
  await act(async () => renderer.root.findByType(RadialCycleSelector).props.onChange('night'));
  expect(text()).toContain('No night sleep logged');
  expect(press('Day')).toBeDefined();
  await act(async () => press('Day')?.props.onPress());
  expect(renderer.root.findByType(RadialCycleSelector).props.selection).toBe('day');
});
it('opens history separately and returns Home to the current day', async () => {
  hooks.model.date = '2026-10-14';
  await render();
  expect(text()).not.toContain('Day log');
  await act(async () => press('History')?.props.onPress());
  expect(press('Show 2026-10-14')).toBeDefined();
  expect(press('Cycle dial')).toBeDefined();
  await act(async () => press('Activity list')?.props.onPress());
  expect(text()).toContain('Day log');
  expect(press('Previous day')).toBeDefined();
  await act(async () => press('Home')?.props.onPress());
  expect(hooks.model.setDate).toHaveBeenCalledWith(hooks.model.today);
  expect(text()).not.toContain('Day log');
});
it('swipes between the tracking dial and history without taking horizontal gestures', async () => {
  await render();
  expect(gestures.current?.onMoveShouldSetPanResponder({}, { dx: 80, dy: 10 })).toBe(false);
  expect(gestures.current?.onMoveShouldSetPanResponder({}, { dx: 5, dy: 80 })).toBe(true);
  await act(async () => gestures.current?.onPanResponderRelease({}, { dx: 5, dy: 80 }));
  expect(press('Cycle dial')).toBeDefined();
  expect(press('Activity list')).toBeDefined();
  await act(async () => gestures.current?.onPanResponderRelease({}, { dx: 5, dy: -80 }));
  expect(text()).not.toContain('Day log');
});
it('opens the activity menu from plus and hands off to Nursing after dismissal', async () => {
  await render();
  await act(async () => press('Add activity')?.props.onPress());
  expect(press('Track Nursing')).toBeDefined();
  await act(async () => press('Track Nursing')?.props.onPress());
  expect(renderer.root.findByType(NursingSheet).props.log).toEqual(active);
  expect(press('Track Nursing')).toBeUndefined();
});
it('navigates the week, blocks future dates and switches between history surfaces', async () => {
  await render();
  await act(async () => press('History')?.props.onPress());
  expect(press('Show 2026-10-16')?.props.disabled).toBe(true);
  await act(async () => press('Show 2026-10-13')?.props.onPress());
  expect(hooks.model.setDate).toHaveBeenCalledWith('2026-10-13');
  await act(async () => press('Cycle totals')?.props.onPress());
  expect(text()).toContain('Day totals');
  expect(press('Nursing,')).toBeUndefined();
  await act(async () => press('Activity list')?.props.onPress());
  expect(text()).toContain('Day log');
});
it('switches, pauses and resumes Nursing directly from the persistent side controls', async () => {
  await render();
  await act(async () => press('Switch to Left breast')?.props.onPress());
  expect(hooks.model.execute).toHaveBeenLastCalledWith({
    type: 'change-nursing',
    expected: active,
    command: { kind: 'switch', side: 'LEFT' },
  });
  await act(async () => press('Pause Right breast')?.props.onPress());
  expect(hooks.model.execute).toHaveBeenLastCalledWith({
    type: 'change-nursing',
    expected: active,
    command: { kind: 'pause' },
  });
  const paused = { ...active, status: 'paused' as const };
  hooks.model.current = snapshot([paused]);
  hooks.model.history = hooks.model.current;
  await update();
  await act(async () => press('Resume Left breast')?.props.onPress());
  expect(hooks.model.execute).toHaveBeenLastCalledWith({
    type: 'change-nursing',
    expected: paused,
    command: { kind: 'resume', side: 'LEFT' },
  });
});
it('renders shared canonical Nursing on the dial and keeps live controls available without a Napper dependency', async () => {
  await render();
  expect(press('Profile and sync')).toBeDefined();
  expect(renderer.root.findByType(RadialCycle).props.view.records).toHaveLength(1);
  expect(text()).not.toContain('coming next');
  expect(text()).toContain('03:23');
  expect(press('Stop running Nursing')?.props.disabled).toBe(false);
  await act(async () => press('Open running Nursing')?.props.onPress());
  expect(renderer.root.findByType(NursingSheet).props.log).toEqual(active);
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(text()).toContain('03:25');
  await act(async () => press('Stop running Nursing')?.props.onPress());
  expect(hooks.model.execute).toHaveBeenCalledWith({
    type: 'change-nursing',
    expected: active,
    command: { kind: 'stop' },
  });
});
it('opens profile and sync details without signing out or leaving the shared tracker', async () => {
  await render();
  await act(async () => press('Profile and sync')?.props.onPress());
  expect(text()).toContain('Shared records · Replaceable test service');
  expect(hooks.model.signOut).not.toHaveBeenCalled();
});
it('renders Night waking with Nursing concurrently, and distinguishes falling asleep from morning wake-up', async () => {
  hooks.model.current = snapshot([bed, waking, active]);
  hooks.model.history = hooks.model.current;
  await render();
  expect(renderer.root.findByType(RadialCycle).props.view.kind).toBe('night');
  expect(text()).toContain('Awake for');
  expect(press('Fell asleep again')?.props.disabled).toBe(false);
  expect(press('Stop running Nursing')?.props.disabled).toBe(false);
  await act(async () => press('Wake up,')?.props.onPress());
  expect(renderer.root.findByType(ActivitySheet).props.intent).toEqual({
    type: 'transition',
    command: 'wake-up',
    expected: bed,
  });
  await act(async () => renderer.root.findByType(ActivitySheet).props.onClose());
  await act(async () => press('Fell asleep again')?.props.onPress());
  expect(hooks.model.execute).toHaveBeenCalledWith({
    type: 'fall-asleep',
    expected: waking,
    at: '2026-10-15T01:25:23.000Z',
  });
});
it('treats Night sleep as the containing phase with no separate bottom stop timer', async () => {
  hooks.model.current = snapshot([bed, active]);
  hooks.model.history = hooks.model.current;
  await render();
  expect(text()).toContain('Asleep for');
  expect(press('Stop running Night')).toBeUndefined();
  expect(press('Stop running Nursing')).toBeDefined();
  await act(async () => press('Night waking,')?.props.onPress());
  expect(renderer.root.findByType(ActivitySheet).props.intent).toEqual({
    type: 'transition',
    command: 'start-night-waking',
    expected: bed,
  });
});
it('opens the exact Wake up anchor and permits new records on a past night while retaining current live controls', async () => {
  const wake: PointActivity = {
    id: 'wake',
    revision: 'wake-v1',
    kind: 'wake-up',
    startedAt: '2026-10-15T06:30:00.000Z',
    endedAt: '2026-10-15T06:30:00.000Z',
    status: 'completed',
  };
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  hooks.model.today = '2026-10-16';
  hooks.model.date = '2026-10-14';
  hooks.model.current = snapshot([{ ...active, startedAt: '2026-10-16T11:55:00.000Z' }]);
  hooks.model.history = snapshot([bed, wake]);
  await render();
  await act(async () => press('History')?.props.onPress());
  await act(async () => renderer.root.findByType(RadialCycleSelector).props.onChange('night'));
  const dial = renderer.root.findByType(RadialCycle);
  expect(dial.props.view.projection.cycle.startedAt).toBe(bed.startedAt);
  expect(dial.props.view.projection.cycle.endedAt).toBe(wake.startedAt);
  await act(async () => dial.props.onPressAnchor(wake.id));
  expect(renderer.root.findByType(ActivitySheet).props.intent).toEqual({
    type: 'edit',
    activity: wake,
  });
  await act(async () => renderer.root.findByType(ActivitySheet).props.onClose());
  await act(async () => press('Add past activity')?.props.onPress());
  const intent = renderer.root.findByType(ActivitySheet).props.intent;
  expect(intent.type).toBe('past');
  expect(Date.parse(intent.at)).toBeGreaterThan(Date.parse(bed.startedAt));
  expect(Date.parse(intent.at)).toBeLessThan(Date.parse(wake.startedAt));
  expect(press('Stop running Nursing')?.props.disabled).toBe(false);
});
it.each(['current', 'history'])(
  'keeps valid controls when %s contains a read-only legacy record',
  async (source) => {
    hooks.model[source] = {
      ...snapshot([previous, active]),
      issues: [{ id: 'bad-closed', message: 'A breast duration is invalid.', blocksWrites: false }],
    };
    await render();
    expect(press('Stop running Nursing')?.props.disabled).toBe(false);
  },
);
it('shows an imported sleep collision once while leaving completed records editable and Nursing usable', async () => {
  const wake: PointActivity = {
    id: 'wake',
    revision: 'wake-v1',
    kind: 'wake-up',
    startedAt: '2026-10-15T01:00:00.000Z',
    endedAt: '2026-10-15T01:00:00.000Z',
    status: 'completed',
  };
  const completed = {
    ...waking,
    endedAt: '2026-10-15T01:24:00.000Z',
    status: 'completed' as const,
  };
  const message = 'A night waking must finish by the morning Wake up.';
  hooks.model.current = {
    activities: [bed, wake, completed, active],
    issues: [{ id: 'collision', message, blocksWrites: false }],
  };
  hooks.model.history = hooks.model.current;
  await render();
  expect(text().split(message)).toHaveLength(2);
  expect(press('Stop running Nursing')?.props.disabled).toBe(false);
  await act(async () => press('Edit Wake up')?.props.onPress());
  expect(renderer.root.findByType(ActivitySheet).props.intent).toEqual({
    type: 'edit',
    activity: wake,
  });
});
it('blocks writes and displays a fixed validation reason for an unsupported running record', async () => {
  hooks.model.current = {
    activities: [previous],
    issues: [
      { id: 'bad-active', message: 'The running feed has no active breast.', blocksWrites: true },
    ],
  };
  await render();
  expect(text()).toContain('The running feed has no active breast.');
  expect(press('Nursing,')?.props.disabled).toBe(true);
  expect(press('Stop running Nursing')).toBeUndefined();
});
it('keeps a paused Nap editable alongside Nursing and care actions', async () => {
  const nap: SleepActivity = {
    id: 'paused-nap',
    revision: 'paused-v1',
    kind: 'nap',
    startedAt: '2026-10-15T00:00:00.000Z',
    endedAt: null,
    measuredAt: '2026-10-15T01:25:00.000Z',
    pauseSeconds: 1500,
    status: 'paused',
  };
  hooks.model.current = snapshot([nap, active]);
  hooks.model.history = hooks.model.current;
  await render();
  expect(text()).toContain('Nap paused');
  expect(press('Stop running Nap')?.props.disabled).toBe(false);
  expect(press('Stop running Nursing')?.props.disabled).toBe(false);
  expect(press('Diaper,')?.props.disabled).toBe(false);
  await act(async () => press('Open running Nap')?.props.onPress());
  expect(renderer.root.findByType(ActivitySheet).props.intent).toEqual({
    type: 'edit',
    activity: nap,
  });
  await act(async () => press('Resume Nap')?.props.onPress());
  expect(hooks.model.execute).toHaveBeenCalledWith({
    type: 'resume-nap',
    expected: nap,
    at: new Date().toISOString(),
  });
});
it('blocks multiple active feeds and conflicting sleep state', async () => {
  const nap: SleepActivity = {
    id: 'nap',
    revision: 'nap-v1',
    kind: 'nap',
    measuredAt: '2026-10-15T12:00:00.000Z',
    startedAt: '2026-10-15T01:00:00.000Z',
    endedAt: null,
    status: 'active',
    pauseSeconds: 0,
  };
  hooks.model.current = snapshot([active, { ...active, id: 'another' }, nap, bed]);
  await render();
  expect(text()).toContain('More than one sleep activity');
  expect(press('Stop running Nursing')).toBeUndefined();
  expect(press('Stop running Nap')?.props.disabled).toBe(true);
});
it('replaces a stopped record with its externally reopened feed and restores live controls', async () => {
  const stopped: NursingActivity = {
    ...active,
    status: 'completed',
    endedAt: '2026-10-15T01:23:00.000Z',
    leftSeconds: 12.75,
    rightSeconds: 47.25,
  };
  hooks.model.current = snapshot([stopped]);
  hooks.model.history = hooks.model.current;
  await render();
  expect(press('Stop running Nursing')).toBeUndefined();
  const reopened: NursingActivity = {
    ...stopped,
    revision: 'reopened',
    status: 'active',
    endedAt: null,
    pauseSeconds: 120,
    measuredAt: '2026-10-15T01:25:00.000Z',
  };
  hooks.model.current = snapshot([reopened]);
  hooks.model.history = hooks.model.current;
  await update();
  expect(press('Stop running Nursing')?.props.disabled).toBe(false);
  await act(async () => press('Open running Nursing')?.props.onPress());
  expect(renderer.root.findByType(NursingSheet).props.log).toEqual(reopened);
});
it('opens care logging on the shared screen instead of routing to the separate local tracker', async () => {
  await render();
  await act(async () => press('Diaper,')?.props.onPress());
  expect(renderer.root.findByType(ActivitySheet).props.intent).toMatchObject({
    type: 'care',
    kind: 'diaper',
  });
  await act(async () => renderer.root.findByType(ActivitySheet).props.onClose());
  await act(async () => press('Add activity')?.props.onPress());
  await act(async () => press('Track Medicine')?.props.onPress());
  expect(renderer.root.findByType(ActivitySheet).props.intent).toMatchObject({
    type: 'care',
    kind: 'medicine',
  });
});
it('counts Night sleep and Wake-up recency from the end of the Bedtime routine', async () => {
  vi.setSystemTime(new Date('2026-10-18T20:44:00.000Z'));
  const routine = {
    ...bed,
    startedAt: '2026-10-18T18:45:00.000Z',
    endedAt: '2026-10-18T18:55:00.000Z',
  };
  hooks.model = {
    ...hooks.model,
    current: snapshot([routine]),
    history: snapshot([routine]),
    date: '2026-10-18',
    today: '2026-10-18',
  };
  await render();
  expect(text()).toContain('1h 49m');
  expect(text()).not.toContain('1h 59m');
  expect(press('Wake up, 1h 49m')).toBeDefined();
  expect(press('Edit Bedtime, 07:55 PM')).toBeDefined();
});
