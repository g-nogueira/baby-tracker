import { elapsedMilliseconds, formatDuration, type NapSession } from '@baby-tracker/domain';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { ActivityLiveController } from '@/features/shared/live-controller/activity-live-controller';
import { calendarDayForInstant } from './calendar-day';
import { formatLiveDuration } from './nap-clock';
import { NapEditorSheet } from './nap-editor-sheet';
import type { NapEditorState } from './nap-editor-state';
import { NapRadialTimeline } from './nap-radial-timeline';
import { useNaps } from './use-naps';

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
});
const dayFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDayFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
});

const palette = {
  background: '#F7F4EF',
  surface: '#FFFFFF',
  ink: '#292724',
  muted: '#746F68',
  nap: '#7367B9',
  napSoft: '#E8E4F7',
  danger: '#A64444',
  border: '#E7E0D7',
};

interface UndoState {
  deletedNap: NapSession;
}

/**
 * Displays the nap timeline for the selected day and provides controls for navigating, creating, editing, deleting, and restoring naps.
 */
export function TodayScreen() {
  const {
    activeNap,
    clearError,
    edit,
    error,
    isLoading,
    isMutating,
    isToday,
    latestCompletedEnd,
    naps,
    nextDay,
    pendingOperationCount,
    previousDay,
    goToToday,
    remove,
    restore,
    selectedDay,
    start,
    stop,
  } = useNaps();
  const now = useAdaptiveClock(activeNap !== null);
  const [editor, setEditor] = useState<NapEditorState | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (undo === null) return;
    let cancelled = false;
    AccessibilityInfo.announceForAccessibility('Nap deleted. Undo available.');
    AccessibilityInfo.getRecommendedTimeoutMillis(5_000)
      .catch(() => 5_000)
      .then((timeout) => {
        if (!cancelled) undoTimer.current = setTimeout(() => setUndo(null), timeout);
      });
    return () => {
      cancelled = true;
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    };
  }, [undo]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={palette.nap} size="large" />
      </SafeAreaView>
    );
  }

  const activeUndoPending = undo?.deletedNap.status === 'active';

  const openNapControls = () => {
    clearError();
    setEditor(
      activeNap === null
        ? { mode: 'start', startedAt: new Date() }
        : { mode: 'stop', nap: activeNap, endedAt: new Date() },
    );
  };

  const openNapRecord = (napId: string) => {
    const nap = naps.find((candidate) => candidate.id === napId);
    if (nap === undefined) return;
    clearError();
    setEditor({
      mode: 'edit',
      nap,
      startedAt: new Date(nap.startedAt),
      endedAt: nap.endedAt === null ? null : new Date(nap.endedAt),
    });
  };

  const saveEditor = async (candidate: NapEditorState) => {
    const saved =
      candidate.mode === 'start'
        ? await start(candidate.startedAt)
        : candidate.mode === 'stop'
          ? await stop(candidate.endedAt)
          : await edit(candidate.nap, candidate.startedAt, candidate.endedAt);
    if (saved !== null) setEditor(null);
  };

  const deleteFromEditor = async () => {
    if (editor === null || editor.mode === 'start') return;
    const deletedNap = await remove(editor.nap);
    if (deletedNap === null) return;
    setEditor(null);
    setUndo({ deletedNap });
  };

  const undoDelete = async () => {
    if (undo === null) return;
    const restored = await restore(undo.deletedNap);
    if (restored !== null) setUndo(null);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          activeNap !== null && styles.contentWithTimer,
          undo !== null && styles.contentWithUndo,
        ]}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>{isToday ? 'TODAY' : 'HISTORY'}</Text>
            <Text style={styles.title}>{LOCAL_DEVELOPMENT_IDENTITY.childDisplayName}</Text>
          </View>
          {pendingOperationCount > 0 ? (
            <View
              accessibilityLabel={`${pendingOperationCount} changes waiting to sync`}
              style={styles.syncPill}
            >
              <View style={styles.syncDot} />
              <Text style={styles.syncText}>On device · {pendingOperationCount} to sync</Text>
            </View>
          ) : null}
        </View>

        {error ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={clearError} style={styles.dismissError}>
              <Text style={styles.dismissErrorText}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        <NapRadialTimeline
          activeNap={isToday ? activeNap : null}
          calendarDay={selectedDay}
          disabled={isMutating || activeUndoPending}
          isToday={isToday}
          latestCompletedEnd={latestCompletedEnd}
          naps={naps}
          now={now}
          onPressNap={openNapControls}
          onPressNapRecord={openNapRecord}
        />

        {!isToday ? (
          <Pressable accessibilityRole="button" onPress={goToToday} style={styles.todayButton}>
            <Text style={styles.todayButtonText}>Return to today</Text>
          </Pressable>
        ) : null}

        <View style={styles.dateNavigation}>
          <Pressable
            accessibilityLabel="Show previous day"
            accessibilityRole="button"
            onPress={previousDay}
            style={styles.dateButton}
          >
            <Text style={styles.dateButtonText}>‹</Text>
          </Pressable>
          <View style={styles.dateLabel}>
            <Text style={styles.sectionTitle}>{isToday ? 'Today’s naps' : 'Naps'}</Text>
            <Text style={styles.sectionMeta}>
              {isToday ? 'Today' : dayFormatter.format(new Date(`${selectedDay}T12:00:00.000Z`))}
              {' · '}
              {naps.length} {naps.length === 1 ? 'nap' : 'naps'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Show next day"
            accessibilityRole="button"
            accessibilityState={{ disabled: isToday }}
            disabled={isToday}
            onPress={nextDay}
            style={[styles.dateButton, isToday && styles.disabled]}
          >
            <Text style={styles.dateButtonText}>›</Text>
          </Pressable>
        </View>

        <View style={styles.timeline}>
          {naps.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No naps on this day</Text>
              <Text style={styles.emptyText}>
                {isToday
                  ? `Tap the Nap circle when ${LOCAL_DEVELOPMENT_IDENTITY.childDisplayName} falls asleep.`
                  : 'Use the arrows to review another day.'}
              </Text>
            </View>
          ) : (
            naps.map((nap) => (
              <NapRow key={nap.id} nap={nap} now={now} onEdit={() => openNapRecord(nap.id)} />
            ))
          )}
        </View>
      </ScrollView>

      {activeNap !== null && isToday ? (
        <ActiveNapTimer
          isMutating={isMutating}
          nap={activeNap}
          now={now}
          onOpen={openNapControls}
          onStop={() => void stop()}
          raised={undo !== null}
        />
      ) : null}

      {undo !== null ? (
        <View accessibilityLiveRegion="polite" style={styles.undoBanner}>
          <Text style={styles.undoText}>Nap deleted</Text>
          <Pressable
            accessibilityHint="Restores the deleted nap with the same identifier"
            accessibilityRole="button"
            disabled={isMutating}
            onPress={() => void undoDelete()}
            style={styles.undoButton}
          >
            <Text style={styles.undoButtonText}>Undo</Text>
          </Pressable>
        </View>
      ) : null}

      {editor !== null ? (
        <NapEditorSheet
          editor={editor}
          isMutating={isMutating}
          mutationError={error}
          onCancel={() => setEditor(null)}
          onChange={(nextEditor) => {
            clearError();
            setEditor(nextEditor);
          }}
          onDelete={editor.mode === 'start' ? null : () => void deleteFromEditor()}
          onSave={(candidate) => void saveEditor(candidate)}
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * Displays the currently active nap with its elapsed duration and controls for editing or stopping it.
 *
 * @param isMutating - Whether nap controls should be disabled during a mutation.
 * @param nap - The active nap session.
 * @param now - The current time used to calculate elapsed duration.
 * @param onOpen - Called when the nap editor is opened.
 * @param onStop - Called when the active nap is stopped.
 * @param raised - Whether to raise the timer above the undo banner.
 */
function ActiveNapTimer({
  isMutating,
  nap,
  now,
  onOpen,
  onStop,
  raised,
}: {
  isMutating: boolean;
  nap: NapSession;
  now: Date;
  onOpen: () => void;
  onStop: () => void;
  raised: boolean;
}) {
  const liveDuration = formatLiveDuration(elapsedMilliseconds(nap.startedAt, now));
  return (
    <View style={[styles.activeTimerPosition, raised && styles.activeTimerRaised]}>
      <ActivityLiveController
        accentColor={palette.nap}
        accessibilityLabel={`Nap running for ${liveDuration}`}
        activityLabel="Nap"
        disabled={isMutating}
        elapsedLabel={liveDuration}
        icon="z"
        onOpen={onOpen}
        onStop={onStop}
        stopAccessibilityLabel="Stop nap now"
      />
    </View>
  );
}

/**
 * Renders an editable timeline row for a nap session.
 *
 * @param nap - The nap session to display
 * @param now - The current time used to calculate the duration of an active nap
 * @param onEdit - Callback invoked when the row is pressed
 */
function NapRow({ nap, now, onEdit }: { nap: NapSession; now: Date; onEdit: () => void }) {
  const end = nap.endedAt ? new Date(nap.endedAt) : now;
  const duration = elapsedMilliseconds(nap.startedAt, end);
  const timeRange = formatTimeRange(nap);

  return (
    <Pressable
      accessibilityLabel={`Edit ${nap.status === 'active' ? 'active ' : ''}nap, ${timeRange}, ${formatDuration(duration)}`}
      accessibilityRole="button"
      onPress={onEdit}
      style={({ pressed }) => [styles.timelineRow, pressed && styles.rowPressed]}
    >
      <View style={styles.timelineMarker} />
      <View style={styles.timelineBody}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{nap.status === 'active' ? 'Nap · active' : 'Nap'}</Text>
          <Text style={styles.rowTime}>
            {timeRange} · {formatDuration(duration)}
          </Text>
        </View>
        <Text style={styles.editText}>Edit</Text>
      </View>
    </Pressable>
  );
}

/**
 * Tracks the current time with an update interval suited to the display precision.
 *
 * @param showSeconds - Whether to update every second instead of every minute
 * @returns The current date and time
 */
function useAdaptiveClock(showSeconds: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), showSeconds ? 1_000 : 60_000);
    setNow(new Date());
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [showSeconds]);

  return now;
}

/**
 * Formats a nap's start and end times, including calendar dates when they occur on different local days.
 *
 * @param nap - The nap session to format
 * @returns The formatted time range, using “now” for an active nap
 */
function formatTimeRange(nap: NapSession): string {
  const start = new Date(nap.startedAt);
  if (nap.endedAt === null) return `${clockFormatter.format(start)} – now`;

  const end = new Date(nap.endedAt);
  const startDay = calendarDayForInstant(start, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone);
  const endDay = calendarDayForInstant(end, LOCAL_DEVELOPMENT_IDENTITY.dayTimezone);
  if (startDay === endDay) return `${clockFormatter.format(start)} – ${clockFormatter.format(end)}`;

  return `${shortDayFormatter.format(start)}, ${clockFormatter.format(start)} – ${shortDayFormatter.format(end)}, ${clockFormatter.format(end)}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.background,
  },
  content: { paddingHorizontal: 20, paddingBottom: 80, gap: 18 },
  contentWithTimer: { paddingBottom: 126 },
  contentWithUndo: { paddingBottom: 194 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 54,
  },
  eyebrow: { color: palette.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: palette.ink, fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    minHeight: 34,
    borderRadius: 17,
    backgroundColor: palette.surface,
  },
  syncDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#CB8A3A' },
  syncText: { color: palette.muted, fontSize: 11, fontWeight: '600' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: '#F9E5E2',
    borderRadius: 14,
  },
  errorText: { flex: 1, color: palette.danger, fontSize: 14 },
  dismissError: { minHeight: 44, justifyContent: 'center' },
  dismissErrorText: { color: palette.danger, fontSize: 13, fontWeight: '700' },
  todayButton: {
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: palette.napSoft,
  },
  todayButtonText: { color: palette.nap, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  dateNavigation: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  dateButtonText: { color: palette.nap, fontSize: 28, lineHeight: 31 },
  dateLabel: { flex: 1, alignItems: 'center' },
  sectionTitle: { color: palette.ink, fontSize: 19, fontWeight: '700' },
  sectionMeta: { color: palette.muted, fontSize: 13, marginTop: 2 },
  timeline: {
    borderRadius: 20,
    backgroundColor: palette.surface,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.border,
  },
  emptyState: { padding: 24, alignItems: 'center' },
  emptyTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  emptyText: { color: palette.muted, fontSize: 14, marginTop: 5, textAlign: 'center' },
  timelineRow: { minHeight: 76, flexDirection: 'row', alignItems: 'stretch', paddingLeft: 18 },
  rowPressed: { backgroundColor: '#FAF8F5' },
  timelineMarker: { width: 4, borderRadius: 2, backgroundColor: palette.nap, marginVertical: 16 },
  timelineBody: {
    flex: 1,
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  rowCopy: { flex: 1 },
  rowTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  rowTime: { color: palette.muted, fontSize: 13, marginTop: 4 },
  editText: { color: palette.nap, fontSize: 13, fontWeight: '700' },
  activeTimerPosition: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
  },
  activeTimerRaised: { bottom: 86 },
  undoBanner: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 18,
    minHeight: 58,
    paddingLeft: 18,
    paddingRight: 8,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.ink,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  undoText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  undoButton: { minWidth: 70, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  undoButtonText: { color: '#C9C0F1', fontSize: 15, fontWeight: '800' },
});
