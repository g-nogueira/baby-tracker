import { forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  CareActivity,
  CareSnapshot,
  NursingActivity,
  PointActivity,
  SleepActivity,
} from './contracts';
import { CareScreen } from './care-screen';
import { NursingSheet } from './nursing-sheet';
import { ActivitySheet } from './activity-sheet';
import { RadialCycle, RadialCycleSelector } from '@/features/timeline/radial-cycle';
const hooks = vi.hoisted(() => ({ model: {} as Record<string, unknown> }));
vi.mock('./use-care-tracker', () => ({ useCareTracker: () => hooks.model }));
vi.mock('expo-router', () => ({ Link: 'Link' }));
vi.mock('react-native', () => ({
  View: 'View',
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
  Text: 'SvgText',
}));
vi.mock('@lodev09/react-native-true-sheet', () => ({
  TrueSheet: forwardRef((props: Record<string, unknown>, ref) => {
    useImperativeHandle(ref, () => ({ resize: async () => undefined }));
    return <>{props.children as import('react').ReactNode}</>;
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
    renderer = create(<CareScreen createProvider={factory} />);
  });
};
const update = async () => {
  await act(async () => renderer.update(<CareScreen createProvider={factory} />));
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
it('renders shared canonical Nursing on the dial and keeps live controls available without a Napper dependency', async () => {
  await render();
  expect(text()).toContain('Shared records · Replaceable test service');
  expect(renderer.root.findByType(RadialCycle).props.view.records).toHaveLength(1);
  expect(text()).not.toContain('coming next');
  expect(press('Stop running Nursing')?.props.disabled).toBe(false);
  await act(async () => press('Open running Nursing')?.props.onPress());
  expect(renderer.root.findByType(NursingSheet).props.log).toEqual(active);
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  await act(async () => press('Stop running Nursing')?.props.onPress());
  expect(hooks.model.execute).toHaveBeenCalledWith({
    type: 'change-nursing',
    expected: active,
    command: { kind: 'stop' },
  });
});
it('renders Night waking with Nursing concurrently, and distinguishes falling asleep from morning wake-up', async () => {
  hooks.model.current = snapshot([bed, waking, active]);
  hooks.model.history = hooks.model.current;
  await render();
  expect(renderer.root.findByType(RadialCycleSelector).props.selection).toBe('night');
  expect(text()).toContain('Awake tonight');
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
  await act(async () => press('Medicine,')?.props.onPress());
  expect(renderer.root.findByType(ActivitySheet).props.intent).toMatchObject({
    type: 'care',
    kind: 'medicine',
  });
});
