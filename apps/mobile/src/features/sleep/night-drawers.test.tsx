import { recordCompletedSleep, reopenNap } from '@baby-tracker/domain';
import { ActivityTimestampField } from '@/features/shared/activity-drawer/activity-timestamp-field';
import { StableDateTimePicker } from '@/features/shared/activity-drawer/stable-date-time-picker';
import { NapEditorSheet } from '@/features/naps/nap-editor-sheet';
import { HistoricalActivityDrawer } from '@/features/shared/activity-drawer/historical-activity-drawer';
import {
  deleteNightWaking,
  resumeNightSleep,
  startNightSleep,
  startNightWaking,
  startNursing,
  endNightSleep,
} from '@baby-tracker/domain';
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
    announceForAccessibility: vi.fn(),
    getRecommendedTimeoutMillis: async (value: number) => value,
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
import { CompletedNursingEditorDrawer } from '@/features/nursing/completed-nursing-editor-drawer';
import { NursingSplitSlider } from '@/features/nursing/nursing-split-slider';
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
    .findAllByType('View' as never)
    .find((node) => node.props.accessibilityRole === 'adjustable');
  expect(handle?.props.onStartShouldSetPanResponder()).toBe(true);
  expect(handle?.props.onPanResponderTerminationRequest()).toBe(false);
  await act(async () => handle?.props.onPanResponderRelease({}, { dx: 0, dy: 0, vy: 0 }));
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
    removeNightWaking: vi
      .fn()
      .mockResolvedValue(
        deleteNightWaking(current, awake.phases[1].id, context('2026-08-16T02:00:00Z')).session,
      ),
    restoreNightWaking: vi.fn().mockResolvedValue(current),
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
  expect(live).toBeUndefined();
  await act(async () => renderer.root.findByType(RadialCycle).props.onPressAnchor(current.id));
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
  expect(text()).toContain('Delete Night waking');
  expect(text()).not.toContain('Delete Night sleep');
  await act(async () => pressable('Delete Night waking')?.props.onPress());
  expect(sleep.removeNightWaking).toHaveBeenCalledWith(current, awake.phases[1].id);
  expect(text()).toContain('Night waking deleted');
  await act(async () => pressable('Undo')?.props.onPress());
  expect(sleep.restoreNightWaking).toHaveBeenCalledWith(
    expect.objectContaining({ id: current.id, version: current.version + 1 }),
    current,
  );
  expect(text()).not.toContain('Night waking deleted');

  hooks.sleep.mockReturnValue({ ...sleep, isToday: false, selectedDay: '2026-08-15' });
  await act(async () => renderer.update(<TodayScreen />));
  expect(
    renderer.root
      .findAllByType('Pressable' as never)
      .some((node) => String(node.props.accessibilityLabel).startsWith('Night sleep running')),
  ).toBe(false);
});

it('opens a live Nursing correction, edits its start and split, and keeps a failed save draft', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-16T02:00:00Z'));
  const session = startNursing('right', context('2026-08-16T01:50:00Z')).session;
  const editActive = vi.fn().mockResolvedValue(null);
  hooks.sleep.mockReturnValue({
    activeSleep: null,
    activeNap: null,
    isLoading: false,
    isMutating: false,
    isToday: true,
    selectedDay: '2026-08-16',
    sleepSessions: [],
    latestCompletedEnd: null,
    pendingOperationCount: 1,
    error: null,
  });
  hooks.nursing.mockReturnValue({
    activeSession: session,
    cycleSessions: [session],
    isLoading: false,
    isMutating: false,
    latestCompletedLast: null,
    pendingOperationCount: 1,
    error: null,
    clearError: vi.fn(),
    editActive,
  });
  hooks.care.mockReturnValue({
    cycleEvents: [],
    isLoading: false,
    isMutating: false,
    pendingOperationCount: 1,
    error: null,
  });
  await act(async () => {
    renderer = create(<TodayScreen />);
  });
  const action = renderer.root
    .findByType(HomeQuickActions)
    .props.actions.find((item: { id: string }) => item.id === 'nursing');
  expect(action).toBeDefined();
  await act(async () => action.onPress());
  const handle = renderer.root
    .findAllByType('View' as never)
    .find((node) => node.props.accessibilityLabel === 'Nursing controls collapsed');
  await act(async () => handle?.props.onPanResponderRelease({}, { dx: 0, dy: 0, vy: 0 }));
  await act(async () => pressable('Edit start time and split')?.props.onPress());
  expect(renderer.root.findByType(CompletedNursingEditorDrawer).props.editor.activeSession).toEqual(
    session,
  );
  expect(text()).toContain('keeps running');
  expect(text()).not.toContain('Delete Nursing session');
  expect(
    renderer.root
      .findAllByType('Pressable' as never)
      .some((node) => String(node.props.accessibilityLabel).startsWith('End time')),
  ).toBe(false);
  const startTime = renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => String(node.props.accessibilityLabel).startsWith('Start time'));
  await act(async () => startTime?.props.onPress());
  await act(async () =>
    renderer.root
      .findByType('DateTimePicker' as never)
      .props.onChange({ type: 'set' }, new Date('2026-08-16T01:45:00Z')),
  );
  await act(async () => renderer.root.findByType(NursingSplitSlider).props.onValueChange(300));
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  await act(async () => pressable('Save changes')?.props.onPress());
  expect(editActive).toHaveBeenCalledWith(session, {
    startedAt: new Date('2026-08-16T01:45:00Z'),
    snapshotAt: new Date('2026-08-16T02:00:00Z'),
    leftDurationSeconds: 300,
  });
  expect(renderer.root.findByType(CompletedNursingEditorDrawer).props.editor.startedAt).toEqual(
    new Date('2026-08-16T01:45:00Z'),
  );
});

it('keeps the Android dialog value and callback stable through timer renders', async () => {
  const firstChange = vi.fn();
  const latestChange = vi.fn();
  await act(async () => {
    renderer = create(<StableDateTimePicker value={now} mode="time" onChange={firstChange} />);
  });
  const native = renderer.root.findByType('DateTimePicker' as never);
  const callback = native.props.onChange;
  await act(async () => {
    renderer.update(
      <StableDateTimePicker
        value={new Date(now.getTime() + 1000)}
        mode="time"
        onChange={latestChange}
      />,
    );
  });
  expect(renderer.root.findByType('DateTimePicker' as never).props.value).toBe(now);
  expect(renderer.root.findByType('DateTimePicker' as never).props.onChange).toBe(callback);
  callback({ type: 'set' }, new Date('2026-08-16T00:45:00Z'));
  expect(latestChange).toHaveBeenCalledOnce();
  expect(firstChange).not.toHaveBeenCalled();
});
it('opens the proposed Nap start time before expanding and saves the edited start', async () => {
  const save = vi.fn();
  function Harness() {
    const [editor, setEditor] = useState<import('@/features/naps/nap-editor-state').NapEditorState>(
      { mode: 'start', startedAt: now },
    );
    return (
      <NapEditorSheet
        editor={editor}
        isMutating={false}
        mutationError={null}
        onCancel={vi.fn()}
        onDelete={null}
        onChange={setEditor}
        onSave={save}
      />
    );
  }
  await act(async () => {
    renderer = create(<Harness />);
  });
  await act(async () => pressable('Set nap start time')?.props.onPress());
  await act(async () =>
    renderer.root
      .findByType('DateTimePicker' as never)
      .props.onChange({ type: 'set' }, new Date('2026-08-16T01:00:00Z')),
  );
  await act(async () => pressable('Start nap')?.props.onPress());
  expect(save).toHaveBeenCalledWith({ mode: 'start', startedAt: new Date('2026-08-16T01:00:00Z') });
});
it('updates the Nursing slider during the drag before releasing the finger', async () => {
  function Harness() {
    const [value, setValue] = useState(0);
    return (
      <NursingSplitSlider
        accessibilityText="Split"
        disabled={false}
        maximumValue={600}
        value={value}
        onValueChange={setValue}
      />
    );
  }
  await act(async () => {
    renderer = create(<Harness />);
  });
  const slider = () =>
    renderer.root
      .findAllByType('View' as never)
      .find((node) => node.props.accessibilityRole === 'adjustable');
  slider()?.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
  expect(slider()?.props.onStartShouldSetPanResponder()).toBe(true);
  await act(async () => slider()?.props.onPanResponderGrant({ nativeEvent: { locationX: 50 } }));
  expect(renderer.root.findByType(NursingSplitSlider).props.value).toBe(150);
  await act(async () => slider()?.props.onPanResponderMove({}, { dx: 60, dy: 0 }));
  expect(renderer.root.findByType(NursingSplitSlider).props.value).toBe(330);
});
it('projects a newly persisted Nursing start between idle ticks without crashing', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-16T02:00:00Z'));
  const sleep = {
    activeSleep: null,
    activeNap: null,
    isLoading: false,
    isMutating: false,
    isToday: true,
    selectedDay: '2026-08-16',
    sleepSessions: [],
    latestCompletedEnd: null,
    pendingOperationCount: 0,
    error: null,
  };
  const nursing = {
    activeSession: null,
    cycleSessions: [],
    isLoading: false,
    isMutating: false,
    latestCompletedLast: null,
    pendingOperationCount: 0,
    error: null,
  };
  hooks.sleep.mockReturnValue(sleep);
  hooks.nursing.mockReturnValue(nursing);
  hooks.care.mockReturnValue({
    cycleEvents: [],
    isLoading: false,
    isMutating: false,
    pendingOperationCount: 0,
    error: null,
  });
  await act(async () => {
    renderer = create(<TodayScreen />);
  });
  vi.setSystemTime(new Date('2026-08-16T02:00:00.250Z'));
  const session = startNursing('left', context('2026-08-16T02:00:00.250Z')).session;
  hooks.nursing.mockReturnValue({ ...nursing, activeSession: session, cycleSessions: [session] });
  await act(async () => renderer.update(<TodayScreen />));
  expect(
    renderer.root
      .findByType(RadialCycle)
      .props.view.records.some((record: { id: string }) => record.id === session.id),
  ).toBe(true);
});
it('adds a completed waking to the selected historical Night without a live transition', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-17T12:00:00Z'));
  const night = endNightSleep(asleep, context('2026-08-16T06:00:00Z')).session;
  const recordWaking = vi.fn().mockResolvedValue(null);
  hooks.sleep.mockReturnValue({
    activeSleep: null,
    activeNap: null,
    isLoading: false,
    isMutating: false,
    isToday: false,
    selectedDay: '2026-08-15',
    sleepSessions: [night],
    latestCompletedEnd: night.endedAt,
    pendingOperationCount: 0,
    error: null,
    clearError: vi.fn(),
    recordWaking,
  });
  hooks.nursing.mockReturnValue({
    activeSession: null,
    cycleSessions: [],
    isLoading: false,
    isMutating: false,
    latestCompletedLast: null,
    pendingOperationCount: 0,
    error: null,
    clearError: vi.fn(),
  });
  hooks.care.mockReturnValue({
    cycleEvents: [],
    isLoading: false,
    isMutating: false,
    pendingOperationCount: 0,
    error: null,
    clearError: vi.fn(),
  });
  await act(async () => {
    renderer = create(<TodayScreen />);
  });
  const selector = renderer.root
    .findAllByType('Pressable' as never)
    .find(
      (node) =>
        node.props.accessibilityRole === 'tab' &&
        node.findByType('Text' as never).children[0] === 'Night',
    );
  await act(async () => selector?.props.onPress());
  await act(async () => pressable('Add past activity')?.props.onPress());
  const drawer = renderer.root.findByType(HistoricalActivityDrawer);
  const draft = {
    kind: 'night-waking',
    startedAt: new Date('2026-08-16T00:00:00Z'),
    endedAt: new Date('2026-08-16T00:10:00Z'),
    leftDurationSeconds: 0,
    last: 'left',
  };
  await act(async () => drawer.props.onSave(draft));
  expect(recordWaking).toHaveBeenCalledWith(night, draft.startedAt, draft.endedAt);
  expect(renderer.root.findByType(HistoricalActivityDrawer)).toBeDefined();
});

it('edits the saved Night timezone rather than the device timezone', async () => {
  const session = { ...asleep, timezone: 'America/New_York' };
  await act(async () => {
    renderer = create(
      <NightRecordEditorDrawer
        editor={createNightRecordEditorState(session, null, 'edit')}
        now={now}
        isMutating={false}
        mutationError={null}
        onCancel={vi.fn()}
        onChange={vi.fn()}
        onDelete={null}
        onSave={vi.fn()}
        onFinish={vi.fn()}
      />,
    );
  });
  expect(renderer.root.findByType(ActivityTimestampField).props.timezone).toBe('America/New_York');
  const bedtime = renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => String(node.props.accessibilityLabel).startsWith('Bedtime time'));
  expect(String(bedtime?.props.accessibilityLabel)).toMatch(/04:00|16:00/);
  await act(async () => bedtime?.props.onPress());
  expect(renderer.root.findByType('DateTimePicker' as never).props.timeZoneName).toBe(
    'America/New_York',
  );
});
it('routes Continue this nap to the same stopped record and returns to its running drawer', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-16T12:00:00Z'));
  const nap = recordCompletedSleep(
    'nap',
    new Date('2026-08-16T10:00:00Z'),
    new Date('2026-08-16T10:30:00Z'),
    context('2026-08-16T10:31:00Z'),
  ).session;
  if (nap.kind !== 'nap') throw new Error('Expected Nap');
  const resumed = reopenNap(nap, context('2026-08-16T10:32:00Z')).session;
  const reopen = vi.fn().mockResolvedValue(resumed);
  hooks.sleep.mockReturnValue({
    activeSleep: null,
    activeNap: null,
    isLoading: false,
    isMutating: false,
    isToday: true,
    selectedDay: '2026-08-16',
    sleepSessions: [nap],
    latestCompletedEnd: nap.endedAt,
    pendingOperationCount: 0,
    error: null,
    clearError: vi.fn(),
    reopen,
  });
  hooks.nursing.mockReturnValue({
    activeSession: null,
    cycleSessions: [],
    isLoading: false,
    isMutating: false,
    latestCompletedLast: null,
    pendingOperationCount: 0,
    error: null,
  });
  hooks.care.mockReturnValue({
    cycleEvents: [],
    isLoading: false,
    isMutating: false,
    pendingOperationCount: 0,
    error: null,
  });
  await act(async () => {
    renderer = create(<TodayScreen />);
  });
  const radial = renderer.root.findByType(RadialCycle);
  const record = radial.props.view.records.find((record: { id: string }) => record.id === nap.id);
  await act(async () => radial.props.onPressRecord(record));
  await act(async () => pressable('Continue this nap')?.props.onPress());
  expect(reopen).toHaveBeenCalledWith(nap);
  expect(renderer.root.findByType(NapEditorSheet).props.editor).toMatchObject({
    mode: 'stop',
    nap: resumed,
  });
});
