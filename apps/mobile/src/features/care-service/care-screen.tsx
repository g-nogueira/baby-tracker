import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  | { type: 'activity'; intent: ActivitySheetIntent };
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
function CareHome({ model }: { model: ReturnType<typeof useCareTracker> }) {
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
  const elapsed = (at: string | null | undefined) =>
    at ? formatLiveDuration(Math.max(0, now.getTime() - Date.parse(at))) : '—';
  const duration = (ms: number) => formatLiveDuration(Math.max(0, ms));
  const last = (kind: CareKind) =>
    [...current]
      .filter((a) => a.kind === kind)
      .sort(byStart)
      .at(-1);
  const recency = (kind: CareKind) => {
    const a = last(kind);
    return elapsed(a?.endedAt ?? a?.startedAt);
  };
  const transition = (
    command: Extract<ActivitySheetIntent, { type: 'transition' }>['command'],
    expected?: CareActivity,
  ) => show({ type: 'activity', intent: { type: 'transition', command, expected } });
  const actions: HomeQuickAction[] = [
    {
      id: 'night',
      label: state.night ? 'Wake up' : 'Night sleep',
      meta: state.night ? elapsed(state.night.startedAt) : recency('bedtime'),
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
        ? elapsed(state.waking.startedAt)
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
      meta: nursing ? elapsed(nursing.startedAt) : recency('nursing'),
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
  const projection = view?.projection;
  const projectedIds = new Set([
    ...(view?.records.map((r) => r.id) ?? []),
    ...(projection?.anchors.flatMap((a) => (a.recordId ? [a.recordId] : [])) ?? []),
  ]);
  const rows = history.filter((a) => projectedIds.has(a.id)).sort(byStart);
  let center = {
    label: selection === 'night' ? 'Night sleep' : 'Day sleep',
    value: duration(
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
      value: duration(length - awake),
      hint: projection.cycle.endedAt ? 'Recorded sleep' : 'Night in progress',
    };
  }
  if (model.date === model.today) {
    if (selection === 'night' && state.night)
      center = {
        label: state.waking ? 'Awake tonight' : 'Asleep for',
        value: elapsed(state.phaseStartedAt),
        hint: state.waking ? 'Night waking' : 'Night sleep',
      };
    else if (selection === 'day' && !state.night)
      center = {
        label: state.nap ? 'Asleep for' : 'Awake for',
        value: state.nap ? duration(activityDuration(state.nap, now)) : elapsed(state.latestEnd),
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
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: hasControllers
              ? Math.max(
                  reserved,
                  (Number(Boolean(liveSleep)) + Number(Boolean(nursing))) * 88 + 24,
                )
              : 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>{model.date === model.today ? 'TODAY' : model.date}</Text>
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
            disabled={model.busy}
            onPress={() => void model.signOut()}
            style={styles.link}
          >
            <Text style={styles.muted}>Sign out</Text>
          </Pressable>
        </View>
        <Text style={styles.source}>Shared records · {model.providerName}</Text>
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
        <HomeQuickActions actions={actions} />
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
          <Text style={styles.pastText}>Add past activity</Text>
        </Pressable>
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
        <View style={styles.logHeader}>
          <Text style={styles.sectionTitle}>{selection === 'night' ? 'Night log' : 'Day log'}</Text>
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
        <Link href="/local" style={styles.local}>
          Separate on-device tracker
        </Link>
      </ScrollView>
      {hasControllers ? (
        <ActivityLiveControllerStack onReservedSpaceChange={setReserved}>
          {liveSleep ? (
            <ActivityLiveController
              accentColor={activityColors[liveSleep.kind]}
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
              accentColor="#B35D7D"
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
          onAdjustStart={(start, expected) =>
            void execute({ type: 'edit-activity', expected, startedAt: start.toISOString() })
          }
        />
      ) : null}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9F7F3' },
  content: { padding: 18, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: '#746F68', fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  title: { fontSize: 29, fontWeight: '700', color: '#292724' },
  source: { color: '#8C857D', fontSize: 11 },
  muted: { color: '#746F68', fontSize: 13 },
  dates: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  arrow: { fontSize: 26, color: '#746F68' },
  link: { minHeight: 44, paddingVertical: 12 },
  pastButton: {
    alignSelf: 'center',
    paddingHorizontal: 22,
    minHeight: 46,
    borderRadius: 24,
    backgroundColor: '#EAE4F8',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  pastText: { color: '#7367B9', fontSize: 14, fontWeight: '700' },
  logHeader: { alignItems: 'center', gap: 4, marginVertical: 8 },
  sectionTitle: { color: '#554F49', fontSize: 20, fontWeight: '700' },
  row: {
    minHeight: 68,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: { flex: 1, gap: 5 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#554F49' },
  empty: { padding: 24, textAlign: 'center', color: '#746F68' },
  error: { color: '#A64444', fontSize: 14 },
  sync: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  local: { minHeight: 44, paddingVertical: 12, fontSize: 12, color: '#8C857D' },
});
