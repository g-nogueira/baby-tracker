import { minimumLiveControllerStackHeight } from '@/features/shared/live-controller/activity-live-controller-layout';
import { liveControllerReservedSpace } from '@/features/shared/live-controller/activity-live-controller-stack-state';
import {
  ActivityThemeContext,
  dayTheme,
  nightTheme,
  type ActivityTheme,
} from '@/features/shared/activity-theme';
import { ProfileSheet } from './profile-sheet';
import Svg, { Circle } from 'react-native-svg';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatLiveDuration } from '@/features/naps/nap-clock';
import { instantForZonedDateTime, shiftCalendarDay } from '@/features/naps/calendar-day';
import {
  HomeQuickActions,
  type HomeQuickAction,
} from '@/features/shared/home-actions/home-quick-actions';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { ActivityLiveController } from '@/features/shared/live-controller/activity-live-controller';
import { ActivityLiveControllerStack } from '@/features/shared/live-controller/activity-live-controller-stack';
import {
  RadialCycle,
  RadialCycleSelector,
  type RadialCycleSelection,
} from '@/features/timeline/radial-cycle';
import { AccountScreen } from './account-screen';
import {
  ActivitySheet,
  activityColors,
  nightActivityColors,
  activityIcons,
  activityLabels,
  type ActivitySheetIntent,
} from './activity-sheet';
import type { CareActivity, CareCommand, CareKind, NursingActivity } from './contracts';
import { careCycleViews } from './cycle-view';
import { nursingTimes } from './nursing';
import { NursingSheet } from './nursing-sheet';
import { activityDuration, byStart, sleepContext } from './sleep-state';
import { useCareTracker, type CareProviderFactory } from './use-care-tracker';

type Drawer =
  | { type: 'nursing'; id: string | null; snapshot?: NursingActivity }
  | { type: 'activity'; intent: ActivitySheetIntent }
  | { type: 'profile' };
// Keep this pure formatter outside the component: React Compiler memoizes nested
// declarations at their source position, after action recency has already called it.
function focusDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m` : `${seconds}s`;
}

export function CareScreen({ createProvider }: { createProvider: CareProviderFactory }) {
  const model = useCareTracker(createProvider);
  if (model.stage !== 'ready' || !model.baby)
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <AccountScreen model={model} />
        </ScrollView>
      </SafeAreaView>
    );
  return <CareHome key={model.baby.id} model={model} />;
}

/** The connected home depends exclusively on care ports/read models; no provider payloads. */
export function CareHome({ model }: { model: ReturnType<typeof useCareTracker> }) {
  const scroll = useRef<ScrollView>(null);
  const logOffset = useRef(0);
  const insets = useSafeAreaInsets();
  const viewport = useWindowDimensions();
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const now = new Date(Math.max(clock.getTime(), Date.now()));
  const current = model.current.activities;
  const history = model.history.activities;
  const state = sleepContext(current);
  const [selection, setSelection] = useState<RadialCycleSelection>(state.night ? 'night' : 'day');
  const theme = selection === 'night' ? nightTheme : dayTheme;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [selectedManually, setSelectedManually] = useState(false);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [reserved, setReserved] = useState(0);
  const activeFeeds = current.filter(
    (a): a is NursingActivity => a.kind === 'nursing' && a.status !== 'completed',
  );
  const nursing = activeFeeds.length === 1 ? activeFeeds[0] : null;
  const latestFeed = current
    .filter((a): a is NursingActivity => a.kind === 'nursing' && a.status === 'completed')
    .sort(byStart)
    .at(-1);
  const blockingIssue = model.current.issues.find((i) => i.blocksWrites);
  const reviewIssues = [
    ...new Map(
      [...model.current.issues, ...model.history.issues]
        .filter((issue) => !issue.blocksWrites)
        .map((issue) => [issue.id, issue]),
    ).values(),
  ];
  const blocked =
    model.busy ||
    model.needsRefresh ||
    !model.updatedAt ||
    Boolean(blockingIssue || state.problem) ||
    activeFeeds.length > 1;
  useEffect(() => {
    if (!selectedManually && model.date === model.today)
      setSelection(state.night ? 'night' : 'day');
  }, [model.date, model.today, selectedManually, state.night]);
  useEffect(() => {
    if (drawer?.type === 'nursing' && !drawer.snapshot) {
      if (drawer.id === null && nursing) setDrawer({ type: 'nursing', id: nursing.id });
      else if (drawer.id !== null && !activeFeeds.some((feed) => feed.id === drawer.id))
        setDrawer(null);
    }
  }, [drawer, nursing, activeFeeds]);
  const show = (next: Drawer) => {
    model.clearError();
    setDrawer(next);
  };
  const open = (activity: CareActivity) =>
    show(
      activity.kind === 'nursing'
        ? activity.status === 'completed'
          ? { type: 'nursing', id: activity.id, snapshot: activity }
          : { type: 'nursing', id: activity.id }
        : { type: 'activity', intent: { type: 'edit', activity } },
    );
  const execute = async (command: CareCommand, close = true) => {
    if (await model.execute(command)) {
      if (close) setDrawer(null);
    }
  };
  let views: ReturnType<typeof careCycleViews> | null = null;
  try {
    views = careCycleViews(history, model.date, model.timezone, now, model.date === model.today);
  } catch {
    /* Valid controls remain accessible if a legacy timeline cannot project. */
  }
  const view = views?.[selection] ?? null;
  const duration = (ms: number) => formatLiveDuration(Math.max(0, ms));
  const last = (kind: CareKind) =>
    [...current]
      .filter((a) => a.kind === kind)
      .sort(byStart)
      .at(-1);
  const recency = (kind: CareKind) => {
    const a = last(kind);
    return focusElapsed(a?.endedAt ?? a?.startedAt ?? null);
  };
  const transition = (
    command: Extract<ActivitySheetIntent, { type: 'transition' }>['command'],
    expected?: CareActivity,
  ) => show({ type: 'activity', intent: { type: 'transition', command, expected } });
  const actions: HomeQuickAction[] = [
    {
      id: 'night',
      label: state.night ? 'Wake up' : 'Night sleep',
      meta: state.night ? focusElapsed(state.night.startedAt) : recency('bedtime'),
      icon: state.night ? 'wake' : 'night',
      color: '#5B4C94',
      disabled: blocked || Boolean(state.nap),
      disabledReason: state.nap ? 'Stop the nap before starting Night sleep.' : null,
      active: Boolean(state.night),
      onPress: () => (state.night ? transition('wake-up', state.night) : transition('bedtime')),
    },
    {
      id: 'sleep',
      label: state.night ? (state.waking ? 'Fell asleep again' : 'Night waking') : 'Nap',
      meta: state.waking
        ? focusElapsed(state.waking.startedAt)
        : recency(state.night ? 'night-waking' : 'nap'),
      icon: state.night ? (state.waking ? 'night' : 'night-waking') : 'nap',
      color: state.night ? '#52728A' : '#7367B9',
      disabled: blocked,
      disabledReason: null,
      active: Boolean(state.nap || state.waking),
      onPress: () =>
        state.nap
          ? open(state.nap)
          : state.waking
            ? open(state.waking)
            : state.night
              ? transition('start-night-waking', state.night)
              : transition('start-nap'),
    },
    {
      id: 'nursing',
      label: 'Nursing',
      meta: nursing ? focusElapsed(nursing.startedAt) : recency('nursing'),
      icon: 'nursing',
      color: '#B35D7D',
      disabled: blocked,
      disabledReason: null,
      active: Boolean(nursing),
      onPress: () => show({ type: 'nursing', id: nursing?.id ?? null }),
    },
    ...(['medicine', 'diaper'] as const).map((kind) => ({
      id: kind,
      label: activityLabels[kind],
      meta: recency(kind),
      icon: kind,
      color: activityColors[kind],
      disabled: blocked,
      disabledReason: null,
      onPress: () =>
        show({ type: 'activity', intent: { type: 'care', kind, at: now.toISOString() } }),
    })),
  ];
  function focusElapsed(at: string | null) {
    return at ? focusDuration(now.getTime() - Date.parse(at)) : '—';
  }
  const projection = view?.projection;
  const projectedIds = new Set([
    ...(view?.records.map((r) => r.id) ?? []),
    ...(projection?.anchors.flatMap((a) => (a.recordId ? [a.recordId] : [])) ?? []),
  ]);
  const rows = history.filter((a) => projectedIds.has(a.id)).sort(byStart);
  let center = {
    label: selection === 'night' ? 'Night sleep' : 'Day sleep',
    value: focusDuration(
      rows
        .filter((a) => a.kind === 'nap')
        .reduce((sum, a) => sum + (a.kind === 'nap' ? activityDuration(a, now) : 0), 0),
    ),
    hint: model.date === model.today ? 'Today' : model.date,
  };
  if (selection === 'night' && projection) {
    const length = Date.parse(projection.observedEndedAt) - Date.parse(projection.cycle.startedAt);
    const awake = rows.reduce(
      (sum, a) => sum + (a.kind === 'night-waking' ? activityDuration(a, now) : 0),
      0,
    );
    center = {
      label: 'Night sleep',
      value: focusDuration(length - awake),
      hint: projection.cycle.endedAt ? 'Recorded sleep' : 'Night in progress',
    };
  }
  if (model.date === model.today) {
    if (selection === 'night' && state.night)
      center = {
        label: state.waking ? 'Awake tonight' : 'Asleep for',
        value: focusElapsed(state.phaseStartedAt),
        hint: state.waking ? 'Night waking' : 'Night sleep',
      };
    else if (selection === 'day' && !state.night)
      center = {
        label: state.nap ? 'Asleep for' : 'Awake for',
        value: state.nap
          ? focusDuration(activityDuration(state.nap, now))
          : focusElapsed(state.latestEnd),
        hint: state.nap ? 'Nap' : state.latestEnd ? 'Since the last sleep' : 'No sleep logged yet',
      };
  }
  const format = (at: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: model.timezone,
    }).format(new Date(at));
  const pastAt = () => {
    if (selection === 'night' && projection)
      return new Date(
        (Date.parse(projection.cycle.startedAt) +
          Math.min(now.getTime(), Date.parse(projection.observedEndedAt))) /
          2,
      ).toISOString();
    const [year, month, day] = model.date.split('-').map(Number);
    return new Date(
      Math.min(
        now.getTime(),
        instantForZonedDateTime(
          { year, month, day, hour: 12, minute: 0, second: 0 },
          model.timezone,
        ).getTime(),
      ),
    ).toISOString();
  };
  const sheetFeed =
    drawer?.type === 'nursing'
      ? (drawer.snapshot ?? activeFeeds.find((f) => f.id === drawer.id) ?? null)
      : null;
  const liveSleep = state.nap ?? state.waking;
  const hasControllers = Boolean(liveSleep || nursing);
  const controllerCount = Number(Boolean(liveSleep)) + Number(Boolean(nursing));
  const bottomSpace = hasControllers
    ? liveControllerReservedSpace(
        insets.bottom,
        true,
        minimumLiveControllerStackHeight(controllerCount),
      )
    : Math.max(8, insets.bottom) + 84;
  const dialMaxSize = Math.max(240, viewport.height - (insets.top ?? 0) - bottomSpace - 274);
  return (
    <ActivityThemeContext.Provider value={theme}>
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle={theme.night ? 'light-content' : 'dark-content'} />
        {theme.night ? <NightSky /> : null}
        <ScrollView
          ref={scroll}
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom: hasControllers
                ? Math.max(
                    reserved,
                    (Number(Boolean(liveSleep)) + Number(Boolean(nursing))) * 88 + 94,
                  )
                : 100,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>
                {model.date === model.today ? 'TODAY' : model.date}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose baby profile"
                disabled={model.babies.length < 2 || model.busy}
                onPress={() => model.showProfiles()}
              >
                <Text accessibilityRole="header" style={styles.title}>
                  {model.baby?.name}
                </Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Profile and sync"
              disabled={model.busy}
              onPress={() => setDrawer({ type: 'profile' })}
              style={styles.profileButton}
            >
              <ActivityIcon name="settings" color={theme.muted} size={22} />
            </Pressable>
          </View>

          <RadialCycleSelector
            selection={selection}
            onChange={(next) => {
              setSelectedManually(true);
              setSelection(next);
            }}
          />
          <View style={styles.dates}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous day"
              disabled={model.busy}
              onPress={() => model.setDate(shiftCalendarDay(model.date, -1))}
              style={styles.dateButton}
            >
              <Text style={styles.arrow}>‹</Text>
            </Pressable>
            <Text style={styles.muted}>{model.date === model.today ? 'Today' : model.date}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next day"
              disabled={model.busy || model.date >= model.today}
              onPress={() => model.setDate(shiftCalendarDay(model.date, 1))}
              style={styles.dateButton}
            >
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          </View>
          {view ? (
            <RadialCycle
              view={view}
              maxSize={dialMaxSize}
              centerStatus={center}
              disabled={blocked}
              onPressRecord={(record) => {
                const a = history.find((a) => a.id === record.id);
                if (a) open(a);
              }}
              onPressAnchor={(id) => {
                const a = history.find((a) => a.id === id);
                if (a) open(a);
              }}
            />
          ) : (
            <Text accessibilityRole="alert" style={styles.error}>
              The timeline could not be displayed. Valid activity controls remain available.
            </Text>
          )}
          <HomeQuickActions
            actions={actions.map((action) => ({
              ...action,
              color: theme.night
                ? nightActivityColors[
                    action.id === 'night'
                      ? state.night
                        ? 'wake-up'
                        : 'bedtime'
                      : action.id === 'sleep'
                        ? state.night
                          ? 'night-waking'
                          : 'nap'
                        : (action.id as CareKind)
                  ]
                : action.color,
            }))}
          />
          {state.problem || activeFeeds.length > 1 || blockingIssue ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {state.problem ??
                (activeFeeds.length > 1
                  ? 'More than one feed is running. Review the shared records before changing Nursing.'
                  : blockingIssue?.message)}
            </Text>
          ) : null}
          {model.needsRefresh ? (
            <Text accessibilityRole="alert" style={styles.error}>
              Refresh and review the last save before making another change.
            </Text>
          ) : null}
          {model.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {model.error}
            </Text>
          ) : null}
          {reviewIssues.map((issue) => (
            <Text key={issue.id} accessibilityRole="alert" style={styles.error}>
              {issue.message}
            </Text>
          ))}
          <View
            style={styles.logHeader}
            onLayout={(event) => {
              logOffset.current = event.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.sectionTitle}>
              {selection === 'night' ? 'Night log' : 'Day log'}
            </Text>
            <Text style={styles.muted}>{rows.length} records</Text>
          </View>
          {!rows.length && !model.refreshing ? (
            <Text style={styles.empty}>No activity in this cycle.</Text>
          ) : null}
          {rows.map((a) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${activityLabels[a.kind]} at ${format(a.startedAt)}`}
              key={a.id}
              disabled={blocked}
              onPress={() => open(a)}
              style={styles.row}
            >
              <ActivityIcon name={activityIcons[a.kind]} color={activityColors[a.kind]} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>
                  {activityLabels[a.kind]} · {format(a.startedAt)}
                  {a.status !== 'completed' ? ' · Running' : ''}
                </Text>
                <Text style={styles.muted}>
                  {a.kind === 'nursing'
                    ? (() => {
                        const t = nursingTimes(a, now);
                        return `${duration(t.total * 1000)} · L ${duration(t.left * 1000)} · R ${duration(t.right * 1000)}`;
                      })()
                    : a.kind === 'nap' || a.kind === 'night-waking'
                      ? duration(activityDuration(a, now))
                      : a.kind === 'diaper'
                        ? a.diaperType
                        : a.kind === 'medicine'
                          ? a.note || 'No note'
                          : 'Tap to edit time'}
                </Text>
              </View>
            </Pressable>
          ))}
          <View style={styles.sync}>
            <Text style={styles.source}>
              {model.updatedAt
                ? `Updated ${format(model.updatedAt.toISOString())}`
                : 'Loading shared records…'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh shared records"
              disabled={model.refreshing || model.busy}
              onPress={() => void model.refresh()}
              style={styles.link}
            >
              <Text style={styles.pastText}>{model.refreshing ? 'Refreshing…' : 'Refresh'}</Text>
            </Pressable>
          </View>
        </ScrollView>
        <View style={[styles.dockHost, { bottom: Math.max(8, insets.bottom) }]}>
          <View style={styles.dock}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scroll to timeline"
              onPress={() => scroll.current?.scrollTo({ y: 0, animated: false })}
              style={styles.dockTarget}
            >
              <ActivityIcon name="home" color={theme.muted} size={24} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add past activity"
              disabled={blocked || model.refreshing}
              onPress={() =>
                show({
                  type: 'activity',
                  intent: {
                    type: 'past',
                    at: pastAt(),
                    kind: selection === 'night' ? 'night-waking' : 'nap',
                  },
                })
              }
              style={styles.pastButton}
            >
              <ActivityIcon name="plus" color={theme.accent} size={28} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scroll to activity log"
              onPress={() => scroll.current?.scrollTo({ y: logOffset.current, animated: false })}
              style={styles.dockTarget}
            >
              <ActivityIcon name="log" color={theme.muted} size={24} />
            </Pressable>
          </View>
        </View>
        {hasControllers ? (
          <ActivityLiveControllerStack raised onReservedSpaceChange={setReserved}>
            {liveSleep ? (
              <ActivityLiveController
                accentColor={(theme.night ? nightActivityColors : activityColors)[liveSleep.kind]}
                accessibilityLabel={`Open running ${activityLabels[liveSleep.kind]}`}
                activityLabel={`${activityLabels[liveSleep.kind]}${liveSleep.status === 'paused' ? ' paused' : ''}`}
                disabled={blocked}
                elapsedLabel={duration(activityDuration(liveSleep, now))}
                icon={activityIcons[liveSleep.kind]}
                onOpen={() => open(liveSleep)}
                onStop={() =>
                  void execute({
                    type: liveSleep.kind === 'nap' ? 'stop-nap' : 'fall-asleep',
                    expected: liveSleep,
                    at: new Date().toISOString(),
                  })
                }
                stopAccessibilityLabel={
                  liveSleep.kind === 'nap' ? 'Stop running Nap' : 'Fell asleep again'
                }
              />
            ) : null}
            {nursing ? (
              <ActivityLiveController
                accentColor={theme.night ? '#9DD7BC' : '#B35D7D'}
                accessibilityLabel="Open running Nursing"
                activityLabel={nursing.status === 'paused' ? 'Nursing paused' : 'Nursing'}
                disabled={blocked}
                elapsedLabel={duration(nursingTimes(nursing, now).total * 1000)}
                icon="nursing"
                onOpen={() => open(nursing)}
                onStop={() =>
                  void execute({
                    type: 'change-nursing',
                    expected: nursing,
                    command: { kind: 'stop' },
                  })
                }
                stopAccessibilityLabel="Stop running Nursing"
              />
            ) : null}
          </ActivityLiveControllerStack>
        ) : null}
        {drawer?.type === 'profile' ? (
          <ProfileSheet model={model} onClose={() => setDrawer(null)} />
        ) : null}
        {drawer?.type === 'activity' ? (
          <ActivitySheet
            intent={drawer.intent}
            now={now}
            timezone={
              drawer.intent.type === 'edit'
                ? (drawer.intent.activity.originTimezone ?? model.timezone)
                : model.timezone
            }
            busy={blocked}
            error={model.error}
            onClose={() => setDrawer(null)}
            onExecute={(command) => void execute(command)}
          />
        ) : null}
        {drawer?.type === 'nursing' && (!drawer.id || sheetFeed) ? (
          <NursingSheet
            key={drawer.id ?? 'create'}
            log={sheetFeed}
            last={latestFeed?.lastBreast ?? null}
            timezone={sheetFeed?.originTimezone ?? model.timezone}
            now={now}
            busy={blocked}
            error={model.error}
            onClose={() => setDrawer(null)}
            onStart={(side, at) =>
              void execute({ type: 'start-nursing', side, at: at.toISOString() }, false)
            }
            onChange={(command) => {
              if (sheetFeed)
                void execute(
                  { type: 'change-nursing', expected: sheetFeed, command },
                  command.kind === 'stop',
                );
            }}
            onCorrect={(start, end, leftSeconds, lastBreast) => {
              if (sheetFeed)
                void execute({
                  type: 'correct-nursing',
                  expected: sheetFeed,
                  startedAt: start.toISOString(),
                  endedAt: end.toISOString(),
                  leftSeconds,
                  lastBreast,
                });
            }}
            onRemove={(expected) => void execute({ type: 'remove-activity', expected })}
            onAdjustStart={(start, expected) =>
              void execute({ type: 'edit-activity', expected, startedAt: start.toISOString() })
            }
          />
        ) : null}
      </SafeAreaView>
    </ActivityThemeContext.Provider>
  );
}
function NightSky() {
  return (
    <View pointerEvents="none" style={skyStyle}>
      <Svg width="100%" height="100%" viewBox="0 0 400 900" preserveAspectRatio="none">
        {nightStars.map((star) => (
          <Circle
            key={star.id}
            cx={star.x}
            cy={star.y}
            r={star.radius}
            fill="#EAE4FF"
            opacity={star.opacity}
          />
        ))}
      </Svg>
    </View>
  );
}
const nightStars = Array.from({ length: 36 }, (_, i) => ({
  id: `star-${i}`,
  x: (i * 127 + 19) % 400,
  y: (i * 197 + 31) % 900,
  radius: i % 4 === 0 ? 1.1 : 0.6,
  opacity: 0.12 + (i % 3) * 0.07,
}));
const skyStyle = { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 };
const createStyles = (theme: ActivityTheme) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    content: {
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 10,
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    eyebrow: { color: theme.muted, fontSize: 10, fontWeight: '600', letterSpacing: 2 },
    profileButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.raised,
    },
    title: { fontSize: 24, fontWeight: '500', color: theme.text },
    source: { color: theme.muted, fontSize: 11 },
    muted: { color: theme.muted, fontSize: 13 },
    dates: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    dateButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    arrow: { fontSize: 26, color: theme.muted },
    link: { minHeight: 44, paddingVertical: 12 },
    dockHost: { position: 'absolute', left: 16, right: 16, zIndex: 30, elevation: 10 },
    dock: {
      height: 68,
      maxWidth: 448,
      width: '100%',
      alignSelf: 'center',
      borderRadius: 34,
      backgroundColor: theme.night ? theme.raised : theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
    },
    dockTarget: { minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
    pastButton: {
      alignSelf: 'center',
      width: 58,
      height: 58,
      borderRadius: 29,
      backgroundColor: theme.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 0,
    },
    pastText: { color: theme.accent, fontSize: 14, fontWeight: '700' },
    logHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 24,
      marginBottom: 6,
    },
    sectionTitle: { color: theme.text, fontSize: 18, fontWeight: '500' },
    row: {
      minHeight: 68,
      padding: 14,
      borderRadius: 22,
      backgroundColor: theme.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    rowText: { flex: 1, gap: 5 },
    rowTitle: { fontSize: 14, fontWeight: '600', color: theme.text },
    empty: { padding: 24, textAlign: 'center', color: theme.muted },
    error: { color: theme.error, fontSize: 14 },
    sync: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    local: { minHeight: 44, paddingVertical: 12, fontSize: 12, color: theme.muted },
  });

const styles = createStyles(dayTheme);
