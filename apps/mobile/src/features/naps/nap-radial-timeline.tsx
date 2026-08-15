import { elapsedMilliseconds, formatDuration, type NapSession } from '@baby-tracker/domain';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { LOCAL_DEVELOPMENT_IDENTITY } from '@/constants/identity';
import { zonedDayBounds } from './calendar-day';
import { pointAtClockFraction, projectNapOnCalendarDay, type NapDayProjection } from './nap-clock';

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
  calendarDay: string;
  disabled: boolean;
  isToday: boolean;
  latestCompletedEnd: string | null;
  naps: NapSession[];
  now: Date;
  onPressNap: () => void;
  onPressNapRecord: (napId: string) => void;
}

/**
 * Renders naps on a responsive 24-hour radial timeline and provides controls for the current day's nap state.
 *
 * @param activeNap - The currently active nap, if one exists.
 * @param calendarDay - The calendar day represented by the timeline.
 * @param disabled - Whether nap controls and record targets are disabled.
 * @param isToday - Whether the timeline represents the current day.
 * @param latestCompletedEnd - The end time of the latest completed nap, if available.
 * @param naps - Naps to display on the timeline.
 * @param now - The current time used for elapsed-duration calculations.
 * @param onPressNap - Handles presses on the current day's nap control.
 * @param onPressNapRecord - Handles presses on an individual nap record.
 */
export function NapRadialTimeline({
  activeNap,
  calendarDay,
  disabled,
  isToday,
  latestCompletedEnd,
  naps,
  now,
  onPressNap,
  onPressNapRecord,
}: NapRadialTimelineProps) {
  const { width } = useWindowDimensions();
  const size = Math.min(324, width - 48);
  const center = size / 2;
  const markerRadius = center - 30;
  const [dayStartedAt, nextDayStartedAt] = zonedDayBounds(
    calendarDay,
    LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
  );
  const projectedNaps = naps.flatMap((nap, index) => {
    const projection = projectNapOnCalendarDay(
      nap,
      dayStartedAt,
      nextDayStartedAt,
      now,
      LOCAL_DEVELOPMENT_IDENTITY.dayTimezone,
    );
    return projection === null ? [] : [{ index, nap, projection }];
  });
  const status = !isToday
    ? `${naps.length}\n${naps.length === 1 ? 'nap' : 'naps'}`
    : activeNap
      ? `Asleep for\n${formatDuration(elapsedMilliseconds(activeNap.startedAt, now))}`
      : latestCompletedEnd === null
        ? 'Awake'
        : `Awake for\n${formatDuration(elapsedMilliseconds(latestCompletedEnd, now))}`;

  return (
    <View style={styles.card}>
      <View style={[styles.clock, { height: size, width: size }]}>
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

        {projectedNaps.map(({ nap, projection }) => (
          <NapDurationArc
            center={center}
            disabled={disabled}
            isActive={nap.status === 'active'}
            key={`arc-${nap.id}`}
            markerRadius={markerRadius}
            nap={nap}
            onPress={() => onPressNapRecord(nap.id)}
            projection={projection}
          />
        ))}

        {projectedNaps.map(({ index, nap, projection }) => {
          if (!projection.showsStartIcon) return null;
          const point = pointAtClockFraction(projection.startFraction, markerRadius);
          const isLatest = index === 0;
          const durationEnd = nap.endedAt === null ? now : new Date(nap.endedAt);
          const duration = formatDuration(elapsedMilliseconds(nap.startedAt, durationEnd));
          return (
            <Pressable
              accessibilityHint="Opens this exact nap record for editing"
              accessibilityLabel={`${nap.status === 'active' ? 'Edit active nap' : 'Edit nap'} started at ${formatClock(nap.startedAt)}, ${duration}`}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              key={nap.id}
              onPress={() => onPressNapRecord(nap.id)}
              style={[
                styles.eventTarget,
                {
                  left: center + point.x - 22,
                  top: center + point.y - 22,
                },
              ]}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[styles.eventMarker, isLatest && styles.latestEventMarker]}
              >
                <Text style={[styles.eventMarkerText, !isLatest && styles.smallMarkerText]}>z</Text>
              </View>
            </Pressable>
          );
        })}

        <View
          accessible
          accessibilityLabel={`24-hour nap timeline. ${status.replace('\n', ' ')}.`}
          accessibilityRole="summary"
          pointerEvents="none"
          style={styles.centerStatus}
        >
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

/**
 * Renders a nap duration arc as radial dashes and adds an accessible edit target at its midpoint.
 *
 * @param center - The center coordinate of the radial timeline.
 * @param disabled - Whether the arc target is disabled.
 * @param isActive - Whether to apply active nap styling.
 * @param markerRadius - The radius of the nap arc.
 * @param nap - The nap session represented by the arc.
 * @param onPress - Handles presses on the arc target.
 * @param projection - The nap's position and visible duration on the selected day.
 */
function NapDurationArc({
  center,
  disabled,
  isActive,
  markerRadius,
  nap,
  onPress,
  projection,
}: {
  center: number;
  disabled: boolean;
  isActive: boolean;
  markerRadius: number;
  nap: NapSession;
  onPress: () => void;
  projection: NapDayProjection;
}) {
  const arcLength = Math.PI * 2 * markerRadius * projection.sweepFraction;
  const dashCount = Math.max(1, Math.ceil(arcLength / 7));
  const dashLength = Math.max(3, Math.min(9, arcLength / dashCount + 1));

  return (
    <>
      {Array.from({ length: dashCount }, (_, index) => {
        const progress = (index + 0.5) / dashCount;
        const fraction = projection.startFraction + projection.sweepFraction * progress;
        const point = pointAtClockFraction(fraction, markerRadius);
        return (
          <View
            key={`${nap.id}-dash-${fraction.toFixed(8)}`}
            pointerEvents="none"
            style={[
              styles.arcDash,
              isActive && styles.activeArcDash,
              {
                left: center + point.x - dashLength / 2,
                top: center + point.y - 3,
                transform: [{ rotate: `${fraction * 360}deg` }],
                width: dashLength,
              },
            ]}
          />
        );
      })}

      <NapArcTarget
        center={center}
        disabled={disabled}
        markerRadius={markerRadius}
        nap={nap}
        onPress={onPress}
        projection={projection}
      />
    </>
  );
}

/**
 * Renders an accessible 44dp press target for editing a nap from its duration arc.
 *
 * @param center - The clock center used to position the target.
 * @param disabled - Whether the target is disabled.
 * @param markerRadius - The radial distance from the clock center.
 * @param nap - The nap represented by the duration arc.
 * @param onPress - Called when the target is pressed.
 * @param projection - The projected nap segment displayed on the current day.
 */
function NapArcTarget({
  center,
  disabled,
  markerRadius,
  nap,
  onPress,
  projection,
}: {
  center: number;
  disabled: boolean;
  markerRadius: number;
  nap: NapSession;
  onPress: () => void;
  projection: NapDayProjection;
}) {
  const middleFraction = projection.startFraction + projection.sweepFraction / 2;
  const point = pointAtClockFraction(middleFraction, markerRadius);
  const visibleDuration = formatDuration(
    elapsedMilliseconds(projection.segmentStartedAt, new Date(projection.segmentEndedAt)),
  );

  return (
    <Pressable
      accessibilityHint="Opens this exact nap record for editing"
      accessibilityLabel={
        projection.isContinuation
          ? `Edit nap continued from the previous day, ${visibleDuration} shown on this day`
          : `Edit nap duration started at ${formatClock(nap.startedAt)}, ${visibleDuration}`
      }
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.arcTarget, { left: center + point.x - 22, top: center + point.y - 22 }]}
    >
      {projection.isContinuation ? <View style={styles.continuationHandle} /> : null}
    </Pressable>
  );
}

/**
 * Renders a positioned clock label on the radial timeline.
 *
 * @param label - The text displayed as the clock label
 * @param left - The horizontal position of the label
 * @param top - The vertical position of the label
 */
function ClockLabel({ label, left, top }: { label: string; left: number; top: number }) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.clockLabel, { left, top }]}
    >
      {label}
    </Text>
  );
}

/**
 * Summarizes the most recent nap relative to the current time.
 *
 * @param naps - Naps ordered with the most recent nap first
 * @param now - Reference time used to calculate elapsed duration
 * @returns `Add` when no naps are available; otherwise, the elapsed time since the latest nap ended or started
 */
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

/**
 * Formats an instant as a clock time in the configured day timezone.
 *
 * @param instant - The timestamp to format
 * @returns The localized clock-time representation of the timestamp
 */
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
  arcDash: {
    position: 'absolute',
    zIndex: 2,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#B8AFE1',
  },
  activeArcDash: { backgroundColor: palette.nap },
  eventTarget: {
    position: 'absolute',
    zIndex: 4,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventMarker: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
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
  arcTarget: {
    position: 'absolute',
    zIndex: 3,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continuationHandle: {
    width: 22,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: palette.surface,
    backgroundColor: '#B8AFE1',
  },
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
