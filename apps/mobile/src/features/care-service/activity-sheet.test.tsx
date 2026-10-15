import { forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActivitySheet, type ActivitySheetIntent } from './activity-sheet';
import { NursingSheet } from './nursing-sheet';
import type { NursingActivity, PointActivity, SleepActivity } from './contracts';
import { ActivityTimestampField } from '@/features/shared/activity-drawer/activity-timestamp-field';
const native = vi.hoisted(() => ({ resize: vi.fn().mockResolvedValue(undefined) }));
vi.mock('react-native', () => ({
  View: 'View',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  Pressable: 'Pressable',
  Platform: { OS: 'android' },
  StyleSheet: { create: (v: unknown) => v },
  useWindowDimensions: () => ({ height: 800, width: 360 }),
}));
vi.mock('@lodev09/react-native-true-sheet', () => ({
  TrueSheet: forwardRef((props: Record<string, unknown>, ref) => {
    useImperativeHandle(ref, () => native);
    return <SheetBoundary {...props} />;
  }),
}));
function SheetBoundary(props: Record<string, unknown>) {
  return <>{props.children as import('react').ReactNode}</>;
}
vi.mock('@react-native-community/slider', () => ({ default: 'Slider' }));
vi.mock('@react-native-community/datetimepicker', () => ({ default: 'DateTimePicker' }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
const now = new Date('2026-10-15T12:00:00Z');
const base = {
  now,
  timezone: 'UTC',
  busy: false,
  error: null,
  onClose: vi.fn(),
  onExecute: vi.fn(),
};
const press = (label: string) =>
  renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => String(node.props.accessibilityLabel).startsWith(label));
const textButton = (label: string) =>
  renderer.root
    .findAllByType('Pressable' as never)
    .find((node) =>
      node.findAllByType('Text' as never).some((text) => text.children.join('') === label),
    );
const render = async (intent: ActivitySheetIntent) => {
  await act(async () => {
    renderer = create(<ActivitySheet {...base} intent={intent} />);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
});
it('lets a proposed transition time be edited before starting and keeps the native picker stable across ticks', async () => {
  const intent: ActivitySheetIntent = {
    type: 'transition',
    command: 'wake-up',
    expected: { id: 'bed', revision: 'bed-v1' },
  };
  await render(intent);
  await act(async () => press('Set Wake up time')?.props.onPress());
  expect(native.resize).toHaveBeenCalledWith(1);
  const picker = renderer.root.findByType('DateTimePicker' as never);
  const callback = picker.props.onChange;
  const initial = picker.props.value;
  vi.setSystemTime(new Date(now.getTime() + 1000));
  await act(async () =>
    renderer.update(<ActivitySheet {...base} now={new Date()} intent={intent} />),
  );
  expect(renderer.root.findByType('DateTimePicker' as never).props.onChange).toBe(callback);
  expect(renderer.root.findByType('DateTimePicker' as never).props.value).toBe(initial);
  await act(async () => callback({ type: 'set' }, new Date('2026-10-15T11:45:00Z')));
  await act(async () => press('Wake up')?.props.onPress());
  expect(base.onExecute).toHaveBeenCalledWith({
    type: 'wake-up',
    expected: intent.expected,
    at: '2026-10-15T11:45:00.000Z',
  });
});
it('uses the instant of confirmation when the proposed start time was left untouched', async () => {
  await render({ type: 'transition', command: 'start-nap' });
  vi.setSystemTime(new Date('2026-10-15T12:01:05Z'));
  await act(async () => press('Nap')?.props.onPress());
  expect(base.onExecute).toHaveBeenCalledWith({
    type: 'start-nap',
    at: '2026-10-15T12:01:05.000Z',
  });
});
it('retains an edited diaper timestamp/category through ticking and saves the exact revision', async () => {
  const activity: PointActivity = {
    id: 'diaper',
    revision: 'diaper-v1',
    kind: 'diaper',
    startedAt: '2026-10-15T09:00:00.000Z',
    endedAt: '2026-10-15T09:00:00.000Z',
    status: 'completed',
    diaperType: 'wet',
  };
  const intent: ActivitySheetIntent = { type: 'edit', activity };
  await render(intent);
  await act(async () => press('Start time')?.props.onPress());
  await act(async () =>
    renderer.root
      .findByType('DateTimePicker' as never)
      .props.onChange({ type: 'set' }, new Date('2026-10-15T08:30:00Z')),
  );
  await act(async () => press('dirty diaper')?.props.onPress());
  await act(async () =>
    renderer.update(
      <ActivitySheet {...base} now={new Date(now.getTime() + 3000)} intent={intent} />,
    ),
  );
  expect(renderer.root.findByType(ActivityTimestampField).props.value.toISOString()).toBe(
    '2026-10-15T08:30:00.000Z',
  );
  await act(async () => press('Save activity')?.props.onPress());
  expect(base.onExecute).toHaveBeenCalledWith({
    type: 'edit-activity',
    expected: activity,
    startedAt: '2026-10-15T08:30:00.000Z',
    diaperType: 'dirty',
  });
});
it('preserves unrestricted medicine text and sends it through the care command rather than a transport payload', async () => {
  await render({ type: 'care', kind: 'medicine', at: now.toISOString() });
  const note = '  Synthetic note: 5% & + / 💛\nfree text  ';
  await act(async () => renderer.root.findByType('TextInput' as never).props.onChangeText(note));
  await act(async () => press('Save activity')?.props.onPress());
  expect(base.onExecute).toHaveBeenCalledWith({
    type: 'record-past',
    activity: { kind: 'medicine', startedAt: now.toISOString(), note },
  });
});
it('requires explicit Last for past Nursing and updates the split while dragging', async () => {
  await render({ type: 'past', at: '2026-10-15T11:00:00.000Z' });
  await act(async () => textButton('Nursing')?.props.onPress());
  expect(press('Save activity')?.props.disabled).toBe(true);
  await act(async () => renderer.root.findByType('Slider' as never).props.onValueChange(120));
  expect(renderer.root.findByType('Slider' as never).props.value).toBe(120);
  await act(async () => press('Last breast RIGHT')?.props.onPress());
  expect(press('Save activity')?.props.disabled).toBe(false);
  await act(async () => press('Save activity')?.props.onPress());
  expect(base.onExecute).toHaveBeenCalledWith({
    type: 'record-past',
    activity: {
      kind: 'nursing',
      startedAt: '2026-10-15T11:00:00.000Z',
      endedAt: '2026-10-15T11:30:00.000Z',
      leftSeconds: 120,
      lastBreast: 'RIGHT',
    },
  });
});
it('continues an accidentally stopped Nap and dismisses the drawer without an implicit mutation', async () => {
  const activity: SleepActivity = {
    id: 'nap',
    revision: 'nap-v1',
    kind: 'nap',
    startedAt: '2026-10-15T11:00:00.000Z',
    endedAt: '2026-10-15T11:45:00.000Z',
    status: 'completed',
    pauseSeconds: 0,
  };
  await render({ type: 'edit', activity });
  await act(async () => press('Continue Nap')?.props.onPress());
  expect(base.onExecute).toHaveBeenCalledWith({
    type: 'continue-nap',
    expected: activity,
    at: now.toISOString(),
  });
  base.onExecute.mockClear();
  await act(async () => renderer.root.findByType(SheetBoundary).props.onDidDismiss());
  expect(base.onClose).toHaveBeenCalledOnce();
  expect(base.onExecute).not.toHaveBeenCalled();
});
it('edits an active Nursing start without silently adopting a newer remote revision', async () => {
  const log: NursingActivity = {
    id: 'feed',
    revision: 'feed-v1',
    kind: 'nursing',
    measuredAt: '2026-10-15T11:00:00.000Z',
    startedAt: '2026-10-15T11:00:00.000Z',
    endedAt: null,
    status: 'active',
    leftSeconds: 0,
    rightSeconds: 0,
    lastBreast: 'LEFT',
    pauseSeconds: 0,
  };
  const props = {
    ...base,
    log,
    last: null,
    onStart: vi.fn(),
    onChange: vi.fn(),
    onCorrect: vi.fn(),
    onAdjustStart: vi.fn(),
  };
  await act(async () => {
    renderer = create(<NursingSheet {...props} />);
  });
  await act(async () =>
    renderer.root.findByType(SheetBoundary).props.onDetentChange({ nativeEvent: { index: 1 } }),
  );
  await act(async () => press('Start time')?.props.onPress());
  await act(async () =>
    renderer.root
      .findByType('DateTimePicker' as never)
      .props.onChange({ type: 'set' }, new Date('2026-10-15T10:55:00Z')),
  );
  await act(async () =>
    renderer.update(
      <NursingSheet
        {...props}
        log={{ ...log, revision: 'feed-v2' }}
        now={new Date(now.getTime() + 1000)}
      />,
    ),
  );
  await act(async () => press('Save Nursing start time')?.props.onPress());
  expect(props.onAdjustStart).toHaveBeenCalledWith(new Date('2026-10-15T10:55:00Z'), {
    id: 'feed',
    revision: 'feed-v1',
  });
});
