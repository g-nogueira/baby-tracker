import { renderToString } from 'react-dom/server';
import { AppRegistry, Dimensions, View } from 'react-native';
import regular from '../assets/napper/Saans-Regular.ttf';
import medium from '../assets/napper/Saans-Medium.ttf';
import italic from '../assets/napper/Saans-RegularItalic.ttf';
import { TrackingFontsContext } from '../src/features/shared/tracking-text';
import { NearbyActivitiesSheet } from '../src/features/timeline/nearby-activities-sheet';
import { careCycleViews } from '../src/features/care-service/cycle-view';
import { homeCycleView } from '../src/features/timeline/home-cycle-view';
import { historyDialGroups } from '../src/features/timeline/history-dial-state';
import { Preview, overlapActivities } from './scenarios';
import { ActivityThemeContext, nightTheme } from '../src/features/shared/activity-theme';
import { ActivitySheet } from '../src/features/care-service/activity-sheet';
import { NursingSheet } from '../src/features/care-service/nursing-sheet';
import type { NursingActivity, SleepActivity } from '../src/features/care-service/contracts';

/** A static layout review; this does not exercise a browser or native gestures. */
export function renderPreview(scenario: string, width = 390, height = 844) {
  Dimensions.set({
    window: { width, height, scale: 1, fontScale: 1 },
    screen: { width, height, scale: 1, fontScale: 1 },
  });
  const frozen = ['overlapping-dial', 'nearby-activities', 'diaper'].includes(scenario)
    ? '2026-10-19T09:57:00.000Z'
    : scenario === 'feeding-dial'
      ? '2026-10-19T08:26:00.000Z'
      : scenario === 'night-forecast'
        ? '2026-10-19T00:20:00.000Z'
        : scenario === 'day-markers' || scenario === 'wake-up'
          ? '2026-10-19T06:15:00.000Z'
          : null;
  const now = frozen ? new Date(frozen) : new Date();
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60000).toISOString();
  const nap: SleepActivity = {
    id: 'preview-nap',
    revision: 'v1',
    kind: 'nap',
    startedAt: at(-80),
    endedAt: at(-30),
    status: 'completed',
    pauseSeconds: 0,
    measuredAt: at(0),
  };
  const feed: NursingActivity = {
    id: 'preview-feed',
    revision: 'v1',
    kind: 'nursing',
    startedAt: at(-12),
    endedAt: null,
    status: 'active',
    leftSeconds: 300,
    rightSeconds: 420,
    lastBreast: 'RIGHT',
    pauseSeconds: 0,
    measuredAt: at(0),
  };
  const dark = scenario.startsWith('night') || scenario === 'nursing';
  const theme = nightTheme;
  const callbacks = { onClose: () => {}, busy: false, error: null, now, timezone: 'Europe/Lisbon' };
  const overlap = homeCycleView(
    careCycleViews(overlapActivities(now.getTime()), '2026-10-19', 'Europe/Lisbon', now, true).day,
  );
  const cluster =
    historyDialGroups(overlap, width - 32, 'start').find((targets) => targets.length > 1) ?? [];
  function Screen() {
    return (
      <TrackingFontsContext.Provider value={true}>
        <View style={{ width, height, overflow: 'hidden' }}>
          <Preview
            scenario={
              [
                'feeding-dial',
                'overlapping-dial',
                'nearby-activities',
                'diaper',
                'history',
                'night-asleep',
                'bedtime-range',
                'night-forecast',
                'day-markers',
                'wake-up',
              ].includes(scenario)
                ? scenario
                : dark
                  ? 'night'
                  : scenario === 'first-nursing'
                    ? 'first-nursing'
                    : 'day'
            }
            now={now.getTime()}
          />
          <ActivityThemeContext.Provider value={theme}>
            {scenario === 'nearby-activities' ? (
              <NearbyActivitiesSheet
                targets={cluster}
                view={overlap}
                disabled={false}
                onSelect={() => {}}
                onDismiss={() => {}}
              />
            ) : null}
            {scenario === 'diaper' ? (
              <ActivitySheet
                {...callbacks}
                intent={{
                  type: 'edit',
                  activity: {
                    id: 'diaper-0',
                    revision: 'v1',
                    kind: 'diaper',
                    status: 'completed',
                    diaperType: 'wet',
                    startedAt: '2026-10-19T06:15:00.000Z',
                    endedAt: '2026-10-19T06:15:00.000Z',
                  },
                }}
                onExecute={() => {}}
              />
            ) : null}
            {scenario === 'bedtime' || scenario === 'new-nap' ? (
              <ActivitySheet
                {...callbacks}
                intent={{
                  type: 'transition',
                  command: scenario === 'bedtime' ? 'bedtime' : 'start-nap',
                }}
                onExecute={() => {}}
              />
            ) : null}
            {scenario === 'bedtime-range' ? (
              <ActivitySheet
                {...callbacks}
                intent={{
                  type: 'edit',
                  activity: {
                    id: 'routine',
                    revision: 'v1',
                    kind: 'bedtime',
                    startedAt: at(-119),
                    endedAt: at(-109),
                    status: 'completed',
                  },
                }}
                onExecute={() => {}}
              />
            ) : null}
            {scenario === 'wake-up' ? (
              <ActivitySheet
                {...callbacks}
                intent={{
                  type: 'edit',
                  activity: {
                    id: 'wake',
                    revision: 'v1',
                    kind: 'wake-up',
                    startedAt: '2026-10-19T04:30:00.000Z',
                    endedAt: '2026-10-19T04:30:00.000Z',
                    status: 'completed',
                  },
                }}
                onExecute={() => {}}
              />
            ) : null}
            {scenario === 'nap-drawer' ? (
              <ActivitySheet
                {...callbacks}
                intent={{ type: 'edit', activity: nap }}
                onExecute={() => {}}
              />
            ) : null}
            {scenario === 'nursing' || scenario === 'first-nursing' ? (
              <NursingSheet
                {...callbacks}
                log={scenario === 'first-nursing' ? null : feed}
                last={null}
                onStart={() => {}}
                onChange={() => {}}
                onCorrect={() => {}}
                onRemove={() => {}}
              />
            ) : null}
          </ActivityThemeContext.Provider>
        </View>
      </TrackingFontsContext.Provider>
    );
  }
  AppRegistry.registerComponent('Review', () => Screen);
  const { element, getStyleElement } = AppRegistry.getApplication('Review');
  // Freeze only this synchronous static render; production clocks and browser previews are unchanged.
  const systemDate = globalThis.Date;
  if (frozen)
    globalThis.Date = new Proxy(systemDate, {
      construct(target, args) {
        return Reflect.construct(target, args.length ? args : [now.getTime()]);
      },
      get(target, key, receiver) {
        return key === 'now' ? () => now.getTime() : Reflect.get(target, key, receiver);
      },
    });
  let body: string;
  try {
    body = renderToString(element);
  } finally {
    globalThis.Date = systemDate;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${renderToString(getStyleElement())}<style>@font-face{font-family:Saans-Regular;src:url('${regular}')}@font-face{font-family:Saans-Medium;src:url('${medium}')}@font-face{font-family:Saans-RegularItalic;src:url('${italic}')}@page{size:${width}px ${height}px;margin:0}html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden}body{font-family:Saans-Regular,sans-serif;background:${theme.background}}#react-root{height:${height}px}[role=dialog]{position:fixed;top:0;left:0;bottom:0;right:0}[role=dialog]>div{height:${scenario === 'nearby-activities' ? Math.min(height * 0.8, 80 + cluster.length * 96 + Math.max(0, cluster.length - 1) * 10 + 16) : scenario === 'diaper' ? Math.min(height * 0.8, 510) : scenario === 'bedtime' ? height * 0.74 : scenario === 'nursing' ? Math.min(height * 0.78, 600) : scenario === 'first-nursing' ? Math.min(height * 0.78, 540) : Math.min(height * 0.62, 450)}px!important;top:auto!important;bottom:0!important;left:0!important;transform:none!important}[role=dialog]>button{top:0;left:0;bottom:0;right:0}</style></head><body>${body}</body></html>`;
}
