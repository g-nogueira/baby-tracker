import { forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { RadialCycle } from './radial-cycle';
import { NearbyActivitiesSheet } from './nearby-activities-sheet';
import { careCycleViews } from '@/features/care-service/cycle-view';
import type { CareActivity } from '@/features/care-service/contracts';
import { ActivityThemeContext, nightTheme } from '@/features/shared/activity-theme';
const native = vi.hoisted(() => ({ dismiss: vi.fn().mockResolvedValue(undefined) }));
vi.mock('react-native', () => ({
  View: 'View',
  Image: 'Image',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 16 }) }));
vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
  G: 'G',
  Line: 'Line',
  Text: 'SvgText',
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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
it('keeps Home care markers on the same track as the Wake-up anchor at their actual time angle', async () => {
  const at = (hour: string) => `2026-10-18T${hour}:00:00.000Z`;
  const view = careCycleViews(
    [
      {
        id: 'wake',
        revision: 'v1',
        kind: 'wake-up',
        status: 'completed',
        startedAt: at('07'),
        endedAt: at('07'),
      },
      {
        id: 'diaper',
        revision: 'v1',
        kind: 'diaper',
        diaperType: 'wet',
        status: 'completed',
        startedAt: at('08'),
        endedAt: at('08'),
      },
    ],
    '2026-10-18',
    'UTC',
    new Date(at('09')),
    true,
  ).day;
  await act(async () => {
    renderer = create(
      <ActivityThemeContext.Provider value={nightTheme}>
        <RadialCycle
          view={view}
          centerStatus={{ label: 'Awake for', value: '2h', hint: '' }}
          disabled={false}
          onPressRecord={() => {}}
        />
      </ActivityThemeContext.Provider>,
    );
  });
  const targets = renderer.root.findAllByType('Pressable' as never);
  const care = targets.find((node) => String(node.props.accessibilityLabel).startsWith('Diaper at'))
    ?.props.style;
  const anchor = targets.find((node) =>
    String(node.props.accessibilityLabel).startsWith('Wake up at'),
  )?.props.style;
  expect(care).toBeDefined();
  expect(anchor).toBeDefined();
  const center = 358 / 2 - 18;
  for (const position of [care, anchor])
    expect(Math.hypot(position.left - center, position.top - center)).toBeCloseTo(
      (135 * 358) / 320,
    );
  expect(care.top).toBeLessThan(anchor.top);
  await act(async () => renderer.unmount());
});
it('keeps the activity marker at its start when only its duration changes', async () => {
  const wake: CareActivity = {
    id: 'wake',
    revision: 'v1',
    kind: 'wake-up',
    status: 'completed',
    startedAt: '2026-10-18T07:00:00.000Z',
    endedAt: '2026-10-18T07:00:00.000Z',
  };
  const nap = (endedAt: string): CareActivity => ({
    id: 'nap',
    revision: endedAt,
    kind: 'nap',
    status: 'completed',
    startedAt: '2026-10-18T08:00:00.000Z',
    endedAt,
    pauseSeconds: 0,
    measuredAt: '2026-10-18T12:00:00.000Z',
  });
  const screen = (endedAt: string) => (
    <RadialCycle
      view={
        careCycleViews(
          [wake, nap(endedAt)],
          '2026-10-18',
          'UTC',
          new Date('2026-10-18T12:00:00.000Z'),
          true,
        ).day
      }
      centerStatus={{ label: 'Awake for', value: '2h', hint: '' }}
      disabled={false}
      onPressRecord={() => {}}
    />
  );
  await act(async () => {
    renderer = create(screen('2026-10-18T09:00:00.000Z'));
  });
  const target = () =>
    renderer.root
      .findAllByType('Pressable' as never)
      .find((node) => String(node.props.accessibilityLabel).startsWith('Nap started'));
  expect(target()).toBeDefined();
  const initialPosition = target()?.props.style;
  await act(async () => renderer.update(screen('2026-10-18T11:00:00.000Z')));
  expect(target()?.props.style).toEqual(initialPosition);
  await act(async () => renderer.unmount());
});
it('waits for the nearby-record sheet to finish dismissing before opening the exact editor', async () => {
  const records: CareActivity[] = [
    {
      id: 'wake',
      revision: 'v1',
      kind: 'wake-up',
      status: 'completed',
      startedAt: '2026-10-18T07:00:00.000Z',
      endedAt: '2026-10-18T07:00:00.000Z',
    },
    {
      id: 'first',
      revision: 'v1',
      kind: 'diaper',
      diaperType: 'dry',
      status: 'completed',
      startedAt: '2026-10-18T08:00:00.000Z',
      endedAt: '2026-10-18T08:00:00.000Z',
    },
    {
      id: 'second',
      revision: 'v1',
      kind: 'diaper',
      diaperType: 'wet',
      status: 'completed',
      startedAt: '2026-10-18T08:02:00.000Z',
      endedAt: '2026-10-18T08:02:00.000Z',
    },
  ];
  const view = careCycleViews(
    records,
    '2026-10-18',
    'UTC',
    new Date('2026-10-18T09:00:00Z'),
    true,
  ).day;
  const onPressRecord = vi.fn();
  await act(async () => {
    renderer = create(
      <RadialCycle
        view={view}
        centerStatus={{ label: 'Awake for', value: '2h', hint: 'Today' }}
        disabled={false}
        onPressRecord={onPressRecord}
      />,
    );
  });
  const clusterButton = renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => String(node.props.accessibilityLabel).startsWith('2 activities'));
  expect(clusterButton).toBeDefined();
  await act(async () => clusterButton?.props.onPress());
  const sheet = renderer.root.findByType(SheetBoundary);
  const target = sheet
    .findAllByType('Pressable' as never)
    .find((node) =>
      node.findAllByType('Text' as never).some((text) => text.children.join('').includes('wet')),
    );
  await act(async () => target?.props.onPress());
  expect(native.dismiss).toHaveBeenCalledOnce();
  expect(onPressRecord).not.toHaveBeenCalled();
  await act(async () => sheet.props.onDidDismiss());
  expect(onPressRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'second' }));
  await act(async () => renderer.unmount());
});
it('lets a history group open its exact Wake-up boundary after the chooser dismisses', async () => {
  const at = '2026-10-18T07:00:00.000Z';
  const view = careCycleViews(
    [
      {
        id: 'wake',
        revision: 'v1',
        kind: 'wake-up',
        startedAt: at,
        endedAt: at,
        status: 'completed',
      },
      {
        id: 'diaper',
        revision: 'v1',
        kind: 'diaper',
        startedAt: at,
        endedAt: at,
        status: 'completed',
        diaperType: 'wet',
      },
    ],
    '2026-10-18',
    'UTC',
    new Date('2026-10-18T12:00:00Z'),
    false,
  ).day;
  const openAnchor = vi.fn(),
    openRecord = vi.fn();
  await act(async () => {
    renderer = create(
      <ActivityThemeContext.Provider value={nightTheme}>
        <RadialCycle
          presentation="history"
          view={view}
          centerStatus={{ label: 'Day of', value: 'Today', hint: '' }}
          disabled={false}
          onPressRecord={openRecord}
          onPressAnchor={openAnchor}
        />
      </ActivityThemeContext.Provider>,
    );
  });
  const button = (prefix: string) =>
    renderer.root
      .findAllByType('Pressable' as never)
      .find((n) => String(n.props.accessibilityLabel).startsWith(prefix));
  await act(async () => button('2 nearby activities')?.props.onPress());
  expect(button('Edit Diaper')).toBeDefined();
  await act(async () => button('Edit Wake up')?.props.onPress());
  expect(openAnchor).not.toHaveBeenCalled();
  await act(async () => renderer.root.findByType(SheetBoundary).props.onDidDismiss());
  expect(openAnchor).toHaveBeenCalledWith('wake');
  expect(openRecord).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});
it('opens a grouped Nap/Nursing card with measured duration and hands off the exact feed after dismissal', async () => {
  const at = (time: string) => `2026-10-19T${time}:00.000Z`;
  const view = careCycleViews(
    [
      {
        id: 'wake',
        revision: 'v1',
        kind: 'wake-up',
        startedAt: at('05:50'),
        endedAt: at('05:50'),
        status: 'completed',
      },
      {
        id: 'feeding',
        revision: 'feed-v1',
        kind: 'nursing',
        startedAt: at('09:16'),
        endedAt: '2026-10-19T09:51:37.000Z',
        status: 'completed',
        leftSeconds: 0,
        rightSeconds: 2137,
        lastBreast: 'RIGHT',
        pauseSeconds: 0,
        measuredAt: at('10:57'),
      },
      {
        id: 'nap',
        revision: 'nap-v1',
        kind: 'nap',
        startedAt: at('09:26'),
        endedAt: at('09:51'),
        status: 'completed',
        pauseSeconds: 0,
        measuredAt: at('10:57'),
      },
    ],
    '2026-10-19',
    'UTC',
    new Date(at('10:57')),
    true,
  ).day;
  const openRecord = vi.fn();
  await act(async () => {
    renderer = create(
      <ActivityThemeContext.Provider value={nightTheme}>
        <RadialCycle
          view={view}
          centerStatus={{ label: 'Awake for', value: '1h 6m', hint: '' }}
          disabled={false}
          onPressRecord={openRecord}
        />
      </ActivityThemeContext.Provider>,
    );
  });
  const button = (prefix: string) =>
    renderer.root
      .findAllByType('Pressable' as never)
      .find((node) => String(node.props.accessibilityLabel).startsWith(prefix));
  await act(async () => button('2 nearby activities')?.props.onPress());
  const text = renderer.root.findAllByType('Text' as never).map((node) => node.children.join(''));
  expect(text).toContain('First nap');
  expect(text).toContain('25m 00s');
  expect(text).toContain('35m 37s');
  await act(async () => button('Edit Nursing')?.props.onPress());
  expect(openRecord).not.toHaveBeenCalled();
  await act(async () => renderer.root.findByType(SheetBoundary).props.onDidDismiss());
  expect(openRecord).toHaveBeenCalledOnce();
  expect(openRecord).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'feeding', editorRecordId: 'feeding' }),
  );
  await act(async () => renderer.unmount());
});

it.each(['home', 'history'] as const)(
  'opens a long duration directly from its filled path in %s and blocks taps while disabled',
  async (presentation) => {
    const wake: CareActivity = {
      id: 'wake',
      revision: 'wake-v1',
      kind: 'wake-up',
      status: 'completed',
      startedAt: '2026-10-18T07:00:00.000Z',
      endedAt: '2026-10-18T07:00:00.000Z',
    };
    const nap: CareActivity = {
      id: 'long-nap',
      revision: 'nap-v1',
      kind: 'nap',
      status: 'completed',
      startedAt: '2026-10-18T10:00:00.000Z',
      endedAt: '2026-10-18T12:00:00.000Z',
      measuredAt: '2026-10-18T12:00:00.000Z',
      pauseSeconds: 0,
    };
    const view = careCycleViews(
      [wake, nap],
      '2026-10-18',
      'UTC',
      new Date('2026-10-18T16:00:00Z'),
      true,
    ).day;
    const onPressRecord = vi.fn();
    const screen = (disabled: boolean) => (
      <ActivityThemeContext.Provider value={nightTheme}>
        <RadialCycle
          view={view}
          presentation={presentation}
          centerStatus={{ label: 'Awake', value: '4h', hint: '' }}
          disabled={disabled}
          onPressRecord={onPressRecord}
        />
      </ActivityThemeContext.Provider>
    );
    await act(async () => {
      renderer = create(screen(false));
    });
    const path = () =>
      renderer.root
        .findAllByType('Path' as never)
        .find((n) => n.props.testID === 'duration:long-nap');
    expect(path()?.props.fill).not.toBe('none');
    expect(path()?.props.d).toMatch(/ Z$/);
    await act(async () => path()?.props.onPress());
    expect(onPressRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: nap.id, occurredAt: nap.startedAt, endedAt: nap.endedAt }),
    );
    onPressRecord.mockClear();
    await act(async () => renderer.update(screen(true)));
    await act(async () => path()?.props.onPress());
    expect(onPressRecord).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  },
);
it('opens the same nearby records from a grouped long arc and hands off its exact Nap after dismissal', async () => {
  const records: CareActivity[] = [
    {
      id: 'wake',
      revision: 'v1',
      kind: 'wake-up',
      status: 'completed',
      startedAt: '2026-10-18T07:00:00.000Z',
      endedAt: '2026-10-18T07:00:00.000Z',
    },
    {
      id: 'diaper',
      revision: 'v1',
      kind: 'diaper',
      diaperType: 'wet',
      status: 'completed',
      startedAt: '2026-10-18T10:00:00.000Z',
      endedAt: '2026-10-18T10:00:00.000Z',
    },
    {
      id: 'nap',
      revision: 'nap-v1',
      kind: 'nap',
      status: 'completed',
      startedAt: '2026-10-18T10:01:00.000Z',
      endedAt: '2026-10-18T12:00:00.000Z',
      measuredAt: '2026-10-18T12:00:00.000Z',
      pauseSeconds: 0,
    },
  ];
  const view = careCycleViews(
    records,
    '2026-10-18',
    'UTC',
    new Date('2026-10-18T16:00:00Z'),
    true,
  ).day;
  const onPressRecord = vi.fn();
  await act(async () => {
    renderer = create(
      <ActivityThemeContext.Provider value={nightTheme}>
        <RadialCycle
          view={view}
          centerStatus={{ label: 'Awake', value: '4h', hint: '' }}
          disabled={false}
          onPressRecord={onPressRecord}
        />
      </ActivityThemeContext.Provider>,
    );
  });
  await act(async () =>
    renderer.root
      .findAllByType('Path' as never)
      .find((n) => n.props.testID === 'duration:nap')
      ?.props.onPress(),
  );
  expect(onPressRecord).not.toHaveBeenCalled();
  const sheet = renderer.root.findByType(NearbyActivitiesSheet);
  expect(sheet.props.targets.map((t: { id: string }) => t.id).sort()).toEqual(['diaper', 'nap']);
  const napRow = renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => String(node.props.accessibilityLabel).startsWith('Edit Nap at'));
  expect(napRow).toBeDefined();
  await act(async () => napRow?.props.onPress());
  expect(onPressRecord).not.toHaveBeenCalled();
  const nativeSheet = renderer.root.findByType(SheetBoundary);
  await act(async () => nativeSheet.props.onDidDismiss());
  expect(onPressRecord).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'nap', occurredAt: records[2].startedAt }),
  );
  await act(async () => renderer.unmount());
});
