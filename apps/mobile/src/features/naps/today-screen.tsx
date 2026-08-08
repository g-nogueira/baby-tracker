import { elapsedMilliseconds, formatDuration, type NapSession } from '@baby-tracker/domain';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { useNaps } from './use-naps';

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

const palette = {
  background: '#F7F4EF',
  surface: '#FFFFFF',
  ink: '#292724',
  muted: '#746F68',
  sleep: '#7367B9',
  sleepSoft: '#E8E4F7',
  danger: '#A64444',
  border: '#E7E0D7',
};

export function TodayScreen() {
  const {
    activeNap,
    error,
    isLoading,
    isMutating,
    naps,
    pendingOperationCount,
    remove,
    start,
    stop,
  } = useNaps();
  const now = useClock(activeNap !== null);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={palette.sleep} size="large" />
      </SafeAreaView>
    );
  }

  const status = activeNap
    ? `Sleeping · ${formatDuration(elapsedMilliseconds(activeNap.startedAt, now))}`
    : latestAwakeStatus(naps, now);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>TODAY</Text>
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
          <View style={styles.statusRing}>
            <Text style={styles.moon}>☾</Text>
            <Text style={styles.status}>{status}</Text>
            <Text style={styles.statusHint}>
              {activeNap ? 'Nap in progress' : 'Ready for the next activity'}
            </Text>
          </View>
        </View>

        {error ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityHint={activeNap ? 'Stops the current nap' : 'Starts a nap now'}
            accessibilityRole="button"
            disabled={isMutating}
            onPress={activeNap ? stop : start}
            style={({ pressed }) => [
              styles.primaryAction,
              isMutating && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryActionIcon}>{activeNap ? '■' : '☾'}</Text>
            <Text style={styles.primaryActionLabel}>{activeNap ? 'Stop nap' : 'Start nap'}</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today’s sleep</Text>
          <Text style={styles.sectionMeta}>{naps.length} activities</Text>
        </View>

        <View style={styles.timeline}>
          {naps.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No naps yet</Text>
              <Text style={styles.emptyText}>
                Tap Start nap when {LOCAL_DEVELOPMENT_IDENTITY.childDisplayName} falls asleep.
              </Text>
            </View>
          ) : (
            naps.map((nap) => (
              <NapRow
                key={nap.id}
                nap={nap}
                now={now}
                onDelete={() => confirmDelete(nap, remove)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function NapRow({ nap, now, onDelete }: { nap: NapSession; now: Date; onDelete: () => void }) {
  const end = nap.endedAt ? new Date(nap.endedAt) : now;
  const duration = elapsedMilliseconds(nap.startedAt, end);

  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineMarker} />
      <View style={styles.timelineBody}>
        <View>
          <Text style={styles.rowTitle}>{nap.status === 'active' ? 'Nap · active' : 'Nap'}</Text>
          <Text style={styles.rowTime}>
            {formatClock(nap.startedAt)} – {nap.endedAt ? formatClock(nap.endedAt) : 'now'} ·{' '}
            {formatDuration(duration)}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Delete nap"
          hitSlop={12}
          onPress={onDelete}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

function useClock(isRunning: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [isRunning]);

  return now;
}

function latestAwakeStatus(naps: NapSession[], now: Date): string {
  const latestEndedAt = naps.reduce<string | null>((latest, nap) => {
    if (nap.endedAt === null) return latest;
    return latest === null || nap.endedAt > latest ? nap.endedAt : latest;
  }, null);
  if (latestEndedAt === null) return 'Awake';
  return `Awake · ${formatDuration(elapsedMilliseconds(latestEndedAt, now))}`;
}

function formatClock(instant: string): string {
  return clockFormatter.format(new Date(instant));
}

function confirmDelete(nap: NapSession, remove: (nap: NapSession) => Promise<void>): void {
  Alert.alert('Delete this nap?', 'This removes the nap from the timeline.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => void remove(nap) },
  ]);
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.background,
  },
  content: { paddingHorizontal: 20, paddingBottom: 48, gap: 20 },
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
  statusCard: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  statusRing: {
    width: 238,
    height: 238,
    borderRadius: 119,
    borderWidth: 18,
    borderColor: palette.sleepSoft,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    paddingHorizontal: 28,
  },
  moon: { color: palette.sleep, fontSize: 42, marginBottom: 4 },
  status: { color: palette.ink, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  statusHint: { color: palette.muted, fontSize: 13, marginTop: 7, textAlign: 'center' },
  errorBanner: { padding: 14, backgroundColor: '#F9E5E2', borderRadius: 14 },
  errorText: { color: palette.danger, fontSize: 14 },
  actions: { alignItems: 'center' },
  primaryAction: {
    minWidth: 180,
    minHeight: 58,
    paddingHorizontal: 24,
    borderRadius: 29,
    backgroundColor: palette.sleep,
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
  primaryActionIcon: { color: '#FFFFFF', fontSize: 20 },
  primaryActionLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.55 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 4,
  },
  sectionTitle: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  sectionMeta: { color: palette.muted, fontSize: 13 },
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
  timelineMarker: { width: 4, borderRadius: 2, backgroundColor: palette.sleep, marginVertical: 16 },
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
  rowTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  rowTime: { color: palette.muted, fontSize: 13, marginTop: 4 },
  deleteButton: { minWidth: 52, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: palette.danger, fontSize: 13, fontWeight: '600' },
});
