import { type ComponentProps, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { NursingSheet } from '@/features/care-service/nursing-sheet';
import { toNursingActivity } from './care-records';
import type { WireLog } from './contracts';

// Integrate the observed Nursing wire fixture through the adapter into the actual generic drawer.
type FixtureProps = Omit<ComponentProps<typeof NursingSheet>, 'log'> & { log: WireLog | null };
function NapperNursingSheet(props: FixtureProps) {
  return (
    <NursingSheet
      {...props}
      log={props.log ? toNursingActivity(props.log, 'fixture-v1', props.now) : null}
    />
  );
}

const native = vi.hoisted(() => ({ resize: vi.fn().mockResolvedValue(undefined) }));
// Native boundaries only. These checks cannot verify real phone gesture arbitration.
vi.mock('react-native', () => ({
  View: 'View',
  ScrollView: 'ScrollView',
  Text: 'Text',
  Pressable: 'Pressable',
  Platform: { OS: 'android' },
  StyleSheet: { create: (value: unknown) => value },
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
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.clearAllMocks();
});
const now = new Date('2026-10-13T12:00:00Z');
const base = {
  last: 'RIGHT' as const,
  timezone: 'UTC',
  now,
  busy: false,
  error: null,
  onClose: vi.fn(),
  onStart: vi.fn(),
  onChange: vi.fn(),
  onCorrect: vi.fn(),
};
const press = (label: string) =>
  renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => String(node.props.accessibilityLabel).startsWith(label));
it('opens the proposed time, keeps the picker stable across ticks, and starts at the chosen time', async () => {
  const onStart = vi.fn();
  await act(async () => {
    renderer = create(<NapperNursingSheet {...base} log={null} onStart={onStart} />);
  });
  await act(async () => press('Set Nursing start time')?.props.onPress());
  expect(native.resize).toHaveBeenCalledWith(1);
  const picker = renderer.root.findByType('DateTimePicker' as never);
  const callback = picker.props.onChange;
  await act(async () =>
    renderer.update(
      <NapperNursingSheet
        {...base}
        now={new Date(now.getTime() + 1000)}
        log={null}
        onStart={onStart}
      />,
    ),
  );
  expect(renderer.root.findByType('DateTimePicker' as never).props.onChange).toBe(callback);
  const selected = new Date('2026-10-13T11:45:00Z');
  await act(async () => callback({ type: 'set' }, selected));
  await act(async () => press('Start Nursing on Left')?.props.onPress());
  expect(onStart).toHaveBeenCalledWith('LEFT', selected);
  const sheet = renderer.root.findByType(SheetBoundary);
  expect(sheet.props.initialDetentIndex).toBe(0);
  expect(sheet.props.dismissible).toBe(true);
  expect(sheet.props.draggable).toBe(true);
  expect(sheet.props.scrollable).toBe(true);
  expect(sheet.props.detents[0]).toBeGreaterThan(0.5);
  expect(sheet.props.detents[1]).toBeGreaterThan(sheet.props.detents[0]);
  expect(sheet.props.detents[1]).toBeLessThan(1);
  expect(renderer.root.findByType('ScrollView' as never).props.nestedScrollEnabled).toBe(true);
});
it('updates the split before finger release and preserves an edit through remote/timer rerenders', async () => {
  const log: WireLog = {
    id: 'synthetic',
    category: 'NURSING',
    start: '2026-10-13T10:00:00Z',
    end: '2026-10-13T10:10:00Z',
    isOpen: false,
    breastLeftMinutes: 300,
    breastRightMinutes: 300,
    activeBreast: 'RIGHT',
  };
  const onCorrect = vi.fn();
  await act(async () => {
    renderer = create(<NapperNursingSheet {...base} log={log} onCorrect={onCorrect} />);
  });
  await act(async () =>
    renderer.root.findByType(SheetBoundary).props.onDetentChange({ nativeEvent: { index: 1 } }),
  );
  await act(async () => renderer.root.findByType('Slider' as never).props.onValueChange(120));
  expect(renderer.root.findByType('Slider' as never).props.value).toBe(120);
  await act(async () =>
    renderer.update(
      <NapperNursingSheet
        {...base}
        now={new Date(now.getTime() + 1000)}
        log={{ ...log, breastLeftMinutes: 450 }}
        onCorrect={onCorrect}
      />,
    ),
  );
  expect(renderer.root.findByType('Slider' as never).props.value).toBe(120);
  await act(async () => press('Save Nursing changes')?.props.onPress());
  expect(onCorrect).toHaveBeenCalledWith(
    new Date(String(log.start)),
    new Date(String(log.end)),
    120,
    'RIGHT',
  );
});
it('opens a fractional completed split as a whole-second edit draft without changing the source', async () => {
  const log: WireLog = {
    id: 'synthetic-fractional',
    category: 'NURSING',
    start: '2026-10-13T10:00:00Z',
    end: '2026-10-13T10:01:00Z',
    isOpen: false,
    breastLeftMinutes: 12.75,
    breastRightMinutes: 47.25,
    activeBreast: 'RIGHT',
  };
  const onCorrect = vi.fn();
  await act(async () => {
    renderer = create(<NapperNursingSheet {...base} log={log} onCorrect={onCorrect} />);
  });
  await act(async () =>
    renderer.root.findByType(SheetBoundary).props.onDetentChange({ nativeEvent: { index: 1 } }),
  );
  expect(renderer.root.findByType('Slider' as never).props.value).toBe(13);
  expect(onCorrect).not.toHaveBeenCalled();
  expect(log.breastLeftMinutes).toBe(12.75);
  await act(async () => press('Save Nursing changes')?.props.onPress());
  expect(onCorrect).toHaveBeenCalledWith(
    new Date(String(log.start)),
    new Date(String(log.end)),
    13,
    'RIGHT',
  );
});
it('routes breast controls to pause, resume, switch and the single stop action', async () => {
  const log: WireLog = {
    id: 'synthetic',
    category: 'NURSING',
    start: '2026-10-13T11:50:00Z',
    end: '2026-10-13T11:50:00Z',
    isOpen: true,
    breastLeftMinutes: 0,
    breastRightMinutes: 0,
    activeBreast: 'LEFT',
  };
  const onChange = vi.fn();
  await act(async () => {
    renderer = create(<NapperNursingSheet {...base} log={log} onChange={onChange} />);
  });
  await act(async () => press('Pause Left')?.props.onPress());
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'pause' });
  await act(async () => press('Switch to Right')?.props.onPress());
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'switch', side: 'RIGHT' });
  await act(async () =>
    renderer.update(
      <NapperNursingSheet
        {...base}
        log={{ ...log, pauses: [{ breast: 'LEFT', start: now.getTime(), end: null }] }}
        onChange={onChange}
      />,
    ),
  );
  await act(async () => press('Resume Right')?.props.onPress());
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'resume', side: 'RIGHT' });
  await act(async () => press('Stop Nursing')?.props.onPress());
  expect(onChange).toHaveBeenLastCalledWith({ kind: 'stop' });
});
it('follows native detent changes and dismisses without creating or stopping a feed', async () => {
  const onClose = vi.fn();
  const onStart = vi.fn();
  const onChange = vi.fn();
  await act(async () => {
    renderer = create(
      <NapperNursingSheet
        {...base}
        log={null}
        onClose={onClose}
        onStart={onStart}
        onChange={onChange}
      />,
    );
  });
  expect(press('Set Nursing start time')).toBeDefined();
  await act(async () =>
    renderer.root.findByType(SheetBoundary).props.onDetentChange({ nativeEvent: { index: 1 } }),
  );
  expect(press('Set Nursing start time')).toBeUndefined();
  expect(press('Start time')).toBeDefined();
  await act(async () =>
    renderer.root.findByType(SheetBoundary).props.onDetentChange({ nativeEvent: { index: 0 } }),
  );
  expect(press('Set Nursing start time')).toBeDefined();
  await act(async () =>
    renderer.root.findByType(SheetBoundary).props.onDidDismiss({ nativeEvent: null }),
  );
  expect(onClose).toHaveBeenCalledOnce();
  expect(onStart).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});
it('reports native expansion failures and leaves the time picker closed', async () => {
  native.resize.mockRejectedValueOnce(new Error('native failure'));
  await act(async () => {
    renderer = create(<NapperNursingSheet {...base} log={null} />);
  });
  await act(async () => press('Set Nursing start time')?.props.onPress());
  expect(renderer.root.findAllByType('DateTimePicker' as never)).toHaveLength(0);
  expect(renderer.root.findByProps({ accessibilityRole: 'alert' }).children.join('')).toContain(
    'Close and reopen Nursing',
  );
});
it('waits for native expansion and ignores repeated time taps during that transition', async () => {
  let finish: () => void = () => undefined;
  native.resize.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    renderer = create(<NapperNursingSheet {...base} log={null} />);
  });
  await act(async () => {
    press('Set Nursing start time')?.props.onPress();
    press('Set Nursing start time')?.props.onPress();
  });
  expect(native.resize).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType('DateTimePicker' as never)).toHaveLength(0);
  await act(async () => finish());
  expect(renderer.root.findAllByType('DateTimePicker' as never)).toHaveLength(1);
});
