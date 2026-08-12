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
import { calendarDayForInstant } from './calendar-day';
import { NapEditorSheet } from './nap-editor-sheet';
import type { NapEditorState } from './nap-editor-state';
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
  const now = useMinuteClock();
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

  const status = activeNap
    ? `Napping · ${formatDuration(elapsedMilliseconds(activeNap.startedAt, now))}`
    : latestAwakeStatus(latestCompletedEnd, now);
  const activeUndoPending = undo?.deletedNap.status === 'active';

  const saveEditor = async () => {
    if (editor === null) return;
    const saved =
      editor.mode === 'start'
        ? await start(editor.startedAt)
        : editor.mode === 'stop'
          ? await stop(editor.endedAt)
          : await edit(editor.nap, editor.startedAt, editor.endedAt);
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
      <ScrollView contentContainerStyle={styles.content}>
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

        <View accessibilityRole="summary" style={styles.statusCard}>
          <View style={styles.napBadge}>
            <Text style={styles.napBadgeText}>NAP STATUS</Text>
          </View>
          <Text style={styles.status}>{status}</Text>
          <Text style={styles.statusHint}>
            {activeNap
              ? `Started at ${formatClock(activeNap.startedAt)}`
              : latestCompletedEnd === null
                ? 'No naps recorded yet'
                : `Last nap ended at ${formatClock(latestCompletedEnd)}`}
          </Text>
        </View>

        {error ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={clearError} style={styles.dismissError}>
              <Text style={styles.dismissErrorText}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.actions}>
          {isToday ? (
            <>
              <Pressable
                accessibilityHint={activeNap ? 'Stops the current nap now' : 'Starts a nap now'}
                accessibilityLabel={activeNap ? 'Stop nap' : 'Start nap'}
                accessibilityRole="button"
                accessibilityState={{ busy: isMutating, disabled: isMutating || activeUndoPending }}
                disabled={isMutating || activeUndoPending}
                onPress={() => void (activeNap ? stop() : start())}
                style={({ pressed }) => [
                  styles.primaryAction,
                  (isMutating || activeUndoPending) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text accessibilityElementsHidden style={styles.primaryActionIcon}>
                  {activeNap ? '■' : '▶'}
                </Text>
                <Text style={styles.primaryActionLabel}>
                  {activeNap ? 'Stop nap' : 'Start nap'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: isMutating || activeUndoPending }}
                disabled={isMutating || activeUndoPending}
                onPress={() => {
                  clearError();
                  setEditor(
                    activeNap === null
                      ? { mode: 'start', startedAt: new Date() }
                      : { mode: 'stop', nap: activeNap, endedAt: new Date() },
                  );
                }}
                style={styles.correctTimeButton}
              >
                <Text style={styles.correctTimeText}>
                  {activeNap ? 'Stop at another time' : 'Start at another time'}
                </Text>
              </Pressable>
            </>
          ) : (
            <Pressable accessibilityRole="button" onPress={goToToday} style={styles.primaryAction}>
              <Text style={styles.primaryActionLabel}>Go to today</Text>
            </Pressable>
          )}
        </View>

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
                  ? `Tap Start nap when ${LOCAL_DEVELOPMENT_IDENTITY.childDisplayName} falls asleep.`
                  : 'Use the arrows to review another day.'}
              </Text>
            </View>
          ) : (
            naps.map((nap) => (
              <NapRow
                key={nap.id}
                nap={nap}
                now={now}
                onEdit={() => {
                  clearError();
                  setEditor({
                    mode: 'edit',
                    nap,
                    startedAt: new Date(nap.startedAt),
                    endedAt: nap.endedAt === null ? null : new Date(nap.endedAt),
                  });
                }}
              />
            ))
          )}
        </View>
      </ScrollView>

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
          onSave={() => void saveEditor()}
        />
      ) : null}
    </SafeAreaView>
  );
}

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

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const delay = 60_000 - (Date.now() % 60_000);
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, delay);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });

    return () => {
      clearTimeout(timeout);
      if (interval !== null) clearInterval(interval);
      subscription.remove();
    };
  }, []);

  return now;
}

function latestAwakeStatus(latestEndedAt: string | null, now: Date): string {
  if (latestEndedAt === null) return 'Awake';
  return `Awake · ${formatDuration(elapsedMilliseconds(latestEndedAt, now))}`;
}

function formatClock(instant: string): string {
  return clockFormatter.format(new Date(instant));
}

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
  content: { paddingHorizontal: 20, paddingBottom: 96, gap: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
  },
  eyebrow: { color: palette.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.6 },
  title: { color: palette.ink, fontSize: 30, fontWeight: '700', letterSpacing: -0.7 },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: palette.surface,
  },
  syncDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#CB8A3A' },
  syncText: { color: palette.muted, fontSize: 12, fontWeight: '600' },
  statusCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 154,
    gap: 8,
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  napBadge: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: palette.napSoft,
  },
  napBadgeText: { color: palette.nap, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  status: { color: palette.ink, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  statusHint: { color: palette.muted, fontSize: 14, textAlign: 'center' },
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
  actions: { alignItems: 'center', gap: 4 },
  primaryAction: {
    minWidth: 180,
    minHeight: 58,
    paddingHorizontal: 24,
    borderRadius: 29,
    backgroundColor: palette.nap,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#40377C',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  primaryActionIcon: { color: '#FFFFFF', fontSize: 16 },
  primaryActionLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  correctTimeButton: {
    minHeight: 44,
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  correctTimeText: { color: palette.nap, fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
  dateNavigation: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
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
  sectionTitle: { color: palette.ink, fontSize: 20, fontWeight: '700' },
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
  timelineRow: { minHeight: 78, flexDirection: 'row', alignItems: 'stretch', paddingLeft: 18 },
  rowPressed: { backgroundColor: '#FAF8F5' },
  timelineMarker: { width: 4, borderRadius: 2, backgroundColor: palette.nap, marginVertical: 16 },
  timelineBody: {
    flex: 1,
    minHeight: 78,
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
