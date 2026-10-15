import { forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WireLog } from './contracts';
import { NapperScreen } from './napper-screen';
import { NapperNursingSheet } from './nursing-sheet';
import { RadialCycle } from '@/features/timeline/radial-cycle';
const hooks = vi.hoisted(() => ({ model: {} as Record<string, unknown> }));
vi.mock('./use-napper', () => ({ useNapper: () => hooks.model }));
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
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
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
const active: WireLog = {
  id: 'synthetic-active',
  category: 'NURSING',
  start: '2026-10-15T02:22:00+01:00',
  end: '2026-10-15T02:22:00+01:00',
  isOpen: true,
  activeBreast: 'RIGHT',
  breastLeftMinutes: 0,
  breastRightMinutes: 0,
};
const previous: WireLog = {
  ...active,
  id: 'synthetic-previous',
  start: '2026-10-14T19:00:00+01:00',
  end: '2026-10-14T19:20:00+01:00',
  isOpen: false,
  breastRightMinutes: 1200,
};
let renderer: ReactTestRenderer;
const press = (label: string) =>
  renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => node.props.accessibilityLabel === label);
const text = () =>
  renderer.root
    .findAllByType('Text' as never)
    .map((node) => node.children.join(''))
    .join('|');
const render = async () => {
  await act(async () => {
    renderer = create(<NapperScreen />);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T01:25:23.000Z'));
  hooks.model = {
    stage: 'ready',
    baby: { id: 'synthetic-baby', name: 'Test baby' },
    current: [previous, active],
    history: [previous, active],
    date: '2026-10-15',
    today: '2026-10-15',
    timezone: 'Europe/Lisbon',
    busy: false,
    needsRefresh: false,
    updatedAt: new Date(),
    error: null,
    refreshing: false,
    clearError: vi.fn(),
    change: vi.fn().mockResolvedValue(true),
    refresh: vi.fn(),
  };
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
});
it('renders the shared offset-bearing feed on the dial and keeps its live drawer and stop usable', async () => {
  await render();
  expect(renderer.root.findByType(RadialCycle).props.view.records).toHaveLength(1);
  expect(text()).not.toContain('could not');
  expect(text()).toContain('3:23 since feed started');
  expect(press('Stop running Nursing')?.props.disabled).toBe(false);
  await act(async () => press('Open Nursing controls')?.props.onPress());
  expect(renderer.root.findByType(NapperNursingSheet).props.log).toEqual(active);
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(press('Stop running Nursing')?.props.disabled).toBe(false);
  await act(async () => press('Stop running Nursing')?.props.onPress());
  expect(hooks.model.change).toHaveBeenCalledWith(active, { kind: 'stop' });
});
it.each(['current', 'history'])(
  'keeps valid live controls available when %s contains a malformed older feed',
  async (source) => {
    const malformed = { ...previous, breastRightMinutes: 'unsupported' };
    hooks.model[source] = [malformed, active];
    await render();
    expect(text()).toContain('read-only here');
    expect(press('Open Nursing controls')?.props.disabled).toBe(false);
    expect(press('Stop running Nursing')?.props.disabled).toBe(false);
    expect(renderer.root.findByType(RadialCycle).props.view.records).toHaveLength(1);
  },
);
it('blocks writes when the running feed itself is unsupported', async () => {
  hooks.model.current = [{ ...active, breastRightMinutes: -1 }];
  await render();
  expect(text()).toContain('This running feed could not be read');
  expect(text()).toContain('A breast duration is invalid.');
  expect(press('Open Nursing controls')?.props.disabled).toBe(true);
  expect(press('Stop running Nursing')).toBeUndefined();
});
it('replaces a stopped record with its externally reopened feed and exposes live controls', async () => {
  const stopped = {
    ...active,
    isOpen: false,
    end: '2026-10-15T02:23:00+01:00',
    breastLeftMinutes: 12.75,
    breastRightMinutes: 47.25,
  };
  hooks.model.current = [previous, stopped];
  hooks.model.history = [stopped];
  await render();
  expect(press('Stop running Nursing')).toBeUndefined();
  const reopened = {
    ...stopped,
    isOpen: true,
    end: active.start,
    pauses: [
      {
        start: Date.parse(String(stopped.end)),
        end: Date.parse('2026-10-15T02:25:00+01:00'),
        breast: 'RIGHT',
      },
    ],
  };
  hooks.model.current = [previous, reopened];
  hooks.model.history = [reopened];
  await act(async () => renderer.update(<NapperScreen />));
  expect(text()).not.toContain('could not be read');
  expect(text()).toContain('01:22');
  expect(press('Stop running Nursing')?.props.disabled).toBe(false);
  expect(renderer.root.findByType(RadialCycle).props.view.records).toHaveLength(1);
  await act(async () => press('Open Nursing controls')?.props.onPress());
  expect(renderer.root.findByType(NapperNursingSheet).props.log).toEqual(reopened);
  await act(async () => press('Stop running Nursing')?.props.onPress());
  expect(hooks.model.change).toHaveBeenCalledWith(reopened, { kind: 'stop' });
});
it('blocks writes when Napper reports multiple running feeds', async () => {
  hooks.model.current = [active, { ...active, id: 'another-active' }];
  await render();
  expect(text()).toContain('More than one feed is running');
  expect(press('Open Nursing controls')?.props.disabled).toBe(true);
});
it('blocks writes when a record has an unknown running state', async () => {
  hooks.model.current = [active, { ...previous, isOpen: null }];
  await render();
  expect(text()).toContain('unknown running state');
  expect(press('Open Nursing controls')?.props.disabled).toBe(true);
  expect(press('Stop running Nursing')?.props.disabled).toBe(true);
});
