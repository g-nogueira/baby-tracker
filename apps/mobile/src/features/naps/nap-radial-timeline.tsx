import { elapsedMilliseconds, formatDuration, type NapSession } from '@baby-tracker/domain';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { pointOn24HourClock } from './nap-clock';

const palette = {
  surface: '#FFFFFF',
  ink: '#292724',
  muted: '#746F68',
  nap: '#7367B9',
  napSoft: '#E8E4F7',
  border: '#E7E0D7',
};

const clockTicks = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  key: `clock-hour-${hour}`,
}));

interface NapRadialTimelineProps {
  activeNap: NapSession | null;
  disabled: boolean;
  isToday: boolean;
  latestCompletedEnd: string | null;
  naps: NapSession[];
  now: Date;
  onPressNap: () => void;
}

export function NapRadialTimeline({
  activeNap,
  disabled,
  isToday,
  latestCompletedEnd,
  naps,
  now,
  onPressNap,
}: NapRadialTimelineProps) {
  const { width } = useWindowDimensions();
  const size = Math.min(324, width - 48);
  const center = size / 2;
  const markerRadius = center - 30;
  const status = !isToday
    ? `${naps.length}\n${naps.length === 1 ? 'nap' : 'naps'}`
    : activeNap
      ? `Asleep for\n${formatDuration(elapsedMilliseconds(activeNap.startedAt, now))}`
      : latestCompletedEnd === null
        ? 'Awake'
        : `Awake for\n${formatDuration(elapsedMilliseconds(latestCompletedEnd, now))}`;

  return (
    <View style={styles.card}>
      <View
        accessibilityLabel={`24-hour nap timeline. ${status.replace('\n', ' ')}.`}
        accessibilityRole="summary"
        style={[styles.clock, { height: size, width: size }]}
      >
        <View style={styles.ring} />
        {clockTicks.map(({ hour, key }) => {
          const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
          const tickRadius = center - 12;
          const x = center + Math.cos(angle) * tickRadius;
          const y = center + Math.sin(angle) * tickRadius;
          const major = hour % 6 === 0;
          return (
            <View
              key={key}
              style={[
                styles.tick,
                major && styles.majorTick,
                { left: x - (major ? 3 : 2), top: y - (major ? 3 : 2) },
              ]}
            />
          );
        })}

        <ClockLabel label="00" left={center - 11} top={5} />
        <ClockLabel label="06" left={size - 31} top={center - 9} />
        <ClockLabel label="12" left={center - 11} top={size - 23} />
        <ClockLabel label="18" left={8} top={center - 9} />

        {naps.map((nap, index) => {
          const point = pointOn24HourClock(
            new Date(nap.startedAt),
            LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
            markerRadius,
          );
          const isLatest = index === 0;
          return (
            <View
              accessibilityLabel={`Nap started at ${formatClock(nap.startedAt)}`}
              key={nap.id}
              style={[
                styles.eventMarker,
                isLatest && styles.latestEventMarker,
                {
                  left: center + point.x - (isLatest ? 17 : 11),
                  top: center + point.y - (isLatest ? 17 : 11),
                },
              ]}
            >
              <Text style={[styles.eventMarkerText, !isLatest && styles.smallMarkerText]}>z</Text>
            </View>
          );
        })}

        <View pointerEvents="none" style={styles.centerStatus}>
          <Text style={styles.status}>{status}</Text>
          <Text style={styles.statusHint}>
            {!isToday
              ? 'Recorded on this day'
              : activeNap
                ? `Since ${formatClock(activeNap.startedAt)}`
                : latestCompletedEnd === null
                  ? 'No naps yet today'
                  : `Last nap ended ${formatClock(latestCompletedEnd)}`}
          </Text>
        </View>
      </View>

      {isToday ? (
        <Pressable
          accessibilityHint={
            activeNap ? 'Opens controls for the current nap' : 'Opens nap controls'
          }
          accessibilityLabel={activeNap ? 'Current nap' : 'Nap'}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPressNap}
          style={({ pressed }) => [
            styles.action,
            activeNap && styles.activeAction,
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.actionCircle}>
            <Text style={styles.actionIcon}>z</Text>
          </View>
          <Text style={styles.actionLabel}>Nap</Text>
          <Text style={styles.actionMeta}>{activeNap ? 'Running' : latestNapMeta(naps, now)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ClockLabel({ label, left, top }: { label: string; left: number; top: number }) {
  return <Text style={[styles.clockLabel, { left, top }]}>{label}</Text>;
}

function latestNapMeta(naps: NapSession[], now: Date): string {
  const latest = naps[0];
  if (latest === undefined) return 'Add';
  const boundary = latest.endedAt ?? latest.startedAt;
  return `${formatDuration(elapsedMilliseconds(boundary, now))} ago`;
}

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
});

function formatClock(instant: string): string {
  return clockFormatter.format(new Date(instant));
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 12 },
  clock: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    inset: 17,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  tick: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CFC7BC',
  },
  majorTick: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.muted },
  clockLabel: {
    position: 'absolute',
    color: palette.muted,
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  centerStatus: {
    width: '61%',
    minHeight: 128,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: '#F9F7F3',
  },
  status: {
    color: palette.ink,
    fontSize: 25,
    fontWeight: '700',
    lineHeight: 31,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  statusHint: { color: palette.muted, fontSize: 12, textAlign: 'center' },
  eventMarker: {
    position: 'absolute',
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: 2,
    borderColor: palette.surface,
    backgroundColor: palette.nap,
  },
  latestEventMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    shadowColor: '#40377C',
    shadowOpacity: 0.26,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  eventMarkerText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  smallMarkerText: { fontSize: 11 },
  action: { minWidth: 72, alignItems: 'center', gap: 3, padding: 5, borderRadius: 18 },
  activeAction: { backgroundColor: palette.napSoft },
  actionCircle: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 27,
    backgroundColor: palette.nap,
    shadowColor: '#40377C',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  actionIcon: { color: '#FFFFFF', fontSize: 25, fontWeight: '900' },
  actionLabel: { color: palette.ink, fontSize: 13, fontWeight: '800' },
  actionMeta: { color: palette.muted, fontSize: 11 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
});
