import { resumeNightSleep, startNightSleep, startNightWaking } from '@baby-tracker/domain';
import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

// Only platform primitives are mocked: exercise the real drawers, gesture wiring and fields.
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
  ActivityIndicator: 'ActivityIndicator',
  TextInput: 'TextInput',
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Modal: 'Modal',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'android' },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
  useWindowDimensions: () => ({ width: 360, height: 640 }),
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => true,
    addEventListener: () => ({ remove: vi.fn() }),
  },
  PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
  Animated: {
    View: 'AnimatedView',
    Value: class {
      setValue() {}
    },
    spring: () => ({ start: vi.fn() }),
    timing: () => ({ start: (done: () => void) => done() }),
  },
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 24, bottom: 24 }),
}));
vi.mock('@react-native-community/datetimepicker', () => ({ default: 'DateTimePicker' }));

const hooks = vi.hoisted(() => ({ sleep: vi.fn(), nursing: vi.fn(), care: vi.fn() }));
vi.mock('@/features/naps/use-naps', () => ({ useNaps: hooks.sleep }));
vi.mock('@/features/nursing/use-nursing', () => ({ useNursing: hooks.nursing }));
vi.mock('@/features/care-events/use-care-events', () => ({ useCareEvents: hooks.care }));
vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
  Line: 'Line',
  Text: 'SvgText',
  G: 'G',
}));

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { TodayScreen } from '@/features/naps/today-screen';
import { HomeQuickActions } from '@/features/shared/home-actions/home-quick-actions';
import { RadialCycle } from '@/features/timeline/radial-cycle';
import { NightRecordEditorDrawer } from './night-record-editor-drawer';
import { createNightRecordEditorState } from './night-record-editor-state';
import { NightTransitionDrawer } from './night-transition-drawer';
import { createNightTransitionDraft } from './night-transition-drawer-state';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let seq = 0;
const context = (instant: string) => ({
  childId: LOCAL_DEVELOPMENT_IDENTITY.childId,
  caregiverId: 'parent',
  deviceId: 'device',
  householdId: 'home',
  timezone: 'Europe/Lisbon',
  now: new Date(instant),
  newId: () => `id-${++seq}`,
});
const asleep = startNightSleep(context('2026-08-15T20:00:00Z')).session;
const awake = startNightWaking(asleep, context('2026-08-16T01:00:00Z')).session;
const now = new Date('2026-08-16T01:10:00Z');
let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
});
const text = () =>
  renderer.root
    .findAllByType('Text' as never)
    .map((node) => node.children.join(''))
    .join('|');
const pressable = (label: string) =>
  renderer.root
    .findAllByType('Pressable' as never)
    .find(
      (node) =>
        node.props.accessibilityLabel === label ||
        node.findAllByType('Text' as never).some((child) => child.children.join('') === label),
    );

it('shows no live duration before Night waking starts', async () => {
  const save = vi.fn();
  const draft = createNightTransitionDraft('start-night-waking', asleep, now);
  await act(async () => {
    renderer = create(
      <NightTransitionDrawer
        draft={draft}
        isMutating={false}
        mutationError={null}
        onCancel={vi.fn()}
        onChange={vi.fn()}
        onSave={save}
      />,
    );
  });
  expect(text()).toContain('Night waking');
  expect(text()).not.toMatch(/05:10:00|5:10:00|00:10:00|Transition at/);
  expect(save).not.toHaveBeenCalled();
  await act(async () => pressable('Start Night waking')?.props.onPress());
  expect(save).toHaveBeenCalledWith(draft);
});

it.each([
  { session: asleep, phaseId: null, title: 'Night sleep', action: 'Wake up', duration: '5:10:00' },
  {
    session: awake,
    phaseId: awake.phases[1].id,
    title: 'Night waking',
    action: 'Fell asleep again',
    duration: '10:00',
  },
])(
  'keeps the active $title identity, elapsed time and end action distinct',
  async ({ session, phaseId, title, action, duration }) => {
    const finish = vi.fn();
    await act(async () => {
      renderer = create(
        <NightRecordEditorDrawer
          editor={createNightRecordEditorState(session, phaseId, 'active')}
          now={now}
          isMutating={false}
          mutationError={null}
          onCancel={vi.fn()}
          onChange={vi.fn()}
          onDelete={null}
          onSave={vi.fn()}
          onFinish={finish}
        />,
      );
    });
    expect(renderer.root.findByProps({ accessibilityRole: 'header' }).children).toEqual([title]);
    expect(text()).toContain(duration);
    expect(text()).not.toContain('Resume');
    expect(finish).not.toHaveBeenCalled();
    await act(async () => pressable(action)?.props.onPress());
    expect(finish).toHaveBeenCalledOnce();
  },
);

it('expands by drag, corrects Bedtime and saves without waking up', async () => {
  const save = vi.fn();
  const finish = vi.fn();
  const dismiss = vi.fn();
  function Harness() {
    const [editor, setEditor] = useState(() =>
      createNightRecordEditorState(asleep, null, 'active'),
    );
    return (
      <NightRecordEditorDrawer
        editor={editor}
        now={now}
        isMutating={false}
        mutationError={null}
        onCancel={dismiss}
        onChange={setEditor}
        onDelete={null}
        onSave={save}
        onFinish={finish}
      />
    );
  }
  await act(async () => {
    renderer = create(<Harness />);
  });
  expect(text()).not.toContain('Bedtime');
  const surface = renderer.root.findByType('AnimatedView' as never);
  expect(surface.props.onMoveShouldSetPanResponderCapture({}, { dx: 0, dy: -40 })).toBe(true);
  await act(async () => surface.props.onPanResponderRelease({}, { dy: -50, vy: -1 }));
  expect(text()).toContain('Bedtime');
  const time = renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => String(node.props.accessibilityLabel).startsWith('Bedtime time'));
  expect(time?.props.disabled).toBe(false);
  await act(async () => time?.props.onPress());
  await act(async () =>
    renderer.root
      .findByType('DateTimePicker' as never)
      .props.onChange({ type: 'set' }, new Date('2026-08-15T19:45:00Z')),
  );
  expect(pressable('Wake up')?.props.disabled).toBe(true);
  expect(pressable('Save changes')?.props.disabled).toBe(false);
  await act(async () => pressable('Save changes')?.props.onPress());
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ startedAt: new Date('2026-08-15T19:45:00Z'), endedAt: null }),
  );
  expect(finish).not.toHaveBeenCalled();
  const handle = renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => node.props.accessibilityRole === 'adjustable');
  await act(async () => handle?.props.onPress());
  await act(async () =>
    renderer.root
      .findByType('AnimatedView' as never)
      .props.onPanResponderRelease({}, { dy: 80, vy: 1.2 }),
  );
  expect(dismiss).toHaveBeenCalledOnce();
  expect(finish).not.toHaveBeenCalled();
});

it('keeps a drag attached across live-clock rerenders and calls the latest dismiss callback', async () => {
  const oldDismiss = vi.fn();
  const latestDismiss = vi.fn();
  const editor = createNightRecordEditorState(asleep, null, 'active');
  const props = {
    editor,
    now,
    isMutating: false,
    mutationError: null,
    onChange: vi.fn(),
    onDelete: null,
    onSave: vi.fn(),
    onFinish: vi.fn(),
  };
  await act(async () => {
    renderer = create(<NightRecordEditorDrawer {...props} onCancel={oldDismiss} />);
  });
  const before = renderer.root.findByType('AnimatedView' as never).props.onPanResponderRelease;
  await act(async () => {
    renderer.update(
      <NightRecordEditorDrawer
        {...props}
        now={new Date(now.getTime() + 1000)}
        onCancel={latestDismiss}
      />,
    );
  });
  expect(renderer.root.findByType('AnimatedView' as never).props.onPanResponderRelease).toBe(
    before,
  );
  await act(async () => before({}, { dy: 80, vy: 1.2 }));
  expect(latestDismiss).toHaveBeenCalledOnce();
  expect(oldDismiss).not.toHaveBeenCalled();
});

it('routes controller, quick action and past waking tokens to their own correct drawers', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-16T02:00:00Z'));
  const current = resumeNightSleep(awake, context('2026-08-16T01:20:00Z')).session;
  const sleep = {
    activeSleep: current,
    activeNap: null,
    isLoading: false,
    isMutating: false,
    isToday: true,
    selectedDay: '2026-08-16',
    sleepSessions: [current],
    latestCompletedEnd: null,
    pendingOperationCount: 3,
    error: null,
    clearError: vi.fn(),
    editNight: vi.fn(),
  };
  hooks.sleep.mockReturnValue(sleep);
  hooks.nursing.mockReturnValue({
    activeSession: null,
    cycleSessions: [],
    isLoading: false,
    isMutating: false,
    latestCompletedLast: null,
    pendingOperationCount: 3,
    error: null,
  });
  hooks.care.mockReturnValue({
    cycleEvents: [],
    isLoading: false,
    isMutating: false,
    pendingOperationCount: 3,
    error: null,
  });
  await act(async () => {
    renderer = create(<TodayScreen />);
  });
  expect(renderer.root.findByType(RadialCycle).props.view.projection.cycle.id).toBe(current.id);
  const live = renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => String(node.props.accessibilityLabel).startsWith('Night sleep running'));
  await act(async () => live?.props.onPress());
  expect(renderer.root.findByType(NightRecordEditorDrawer).props.editor).toMatchObject({
    phaseId: null,
    mode: 'active',
    endedAt: null,
  });
  await act(async () => renderer.root.findByType(NightRecordEditorDrawer).props.onCancel());

  const action = renderer.root
    .findByType(HomeQuickActions)
    .props.actions.find((item: { id: string }) => item.id === 'start-night-waking');
  await act(async () => action.onPress());
  expect(renderer.root.findByType(NightTransitionDrawer).props.draft.kind).toBe(
    'start-night-waking',
  );
  await act(async () => renderer.root.findByType(NightTransitionDrawer).props.onCancel());

  const radial = renderer.root.findByType(RadialCycle);
  const pastWaking = radial.props.view.records.find(
    (record: { kind: string }) => record.kind === 'night-waking',
  );
  expect(pastWaking.id).toBe(awake.phases[1].id);
  await act(async () => radial.props.onPressRecord(pastWaking));
  expect(renderer.root.findByType(NightRecordEditorDrawer).props.editor).toMatchObject({
    phaseId: awake.phases[1].id,
    mode: 'edit',
    endedAt: new Date('2026-08-16T01:20:00Z'),
  });
  await act(async () => renderer.root.findByType(NightRecordEditorDrawer).props.onCancel());

  hooks.sleep.mockReturnValue({ ...sleep, isToday: false, selectedDay: '2026-08-15' });
  await act(async () => renderer.update(<TodayScreen />));
  expect(
    renderer.root
      .findAllByType('Pressable' as never)
      .some((node) => String(node.props.accessibilityLabel).startsWith('Night sleep running')),
  ).toBe(true);
});
