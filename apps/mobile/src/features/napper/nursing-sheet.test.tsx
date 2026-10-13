import { forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { NapperNursingSheet } from './nursing-sheet';
import type { WireLog } from './contracts';
const native = vi.hoisted(() => ({ present: vi.fn(), snapToIndex: vi.fn() }));
// Native boundaries only. These checks cannot verify real phone gesture arbitration.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Platform: { OS: 'android' },
  StyleSheet: { create: (value: unknown) => value },
  useWindowDimensions: () => ({ height: 800, width: 360 }),
}));
vi.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetScrollView: 'BottomSheetScrollView',
  BottomSheetModal: forwardRef((props: Record<string, unknown>, ref) => {
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
  expect(native.snapToIndex).toHaveBeenCalledWith(1);
  await act(async () => renderer.root.findByType(SheetBoundary).props.onChange(1));
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
  expect(sheet.props.enablePanDownToClose).toBe(true);
  expect(sheet.props.enableDynamicSizing).toBe(false);
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
