import {
  CYCLE_START_ANGLE_DEGREES,
  CYCLE_SWEEP_ANGLE_DEGREES,
  formatDuration,
} from '@baby-tracker/domain';
import { type ReactNode, useState } from 'react';
import { ActivityDrawer } from '@/features/shared/activity-drawer/activity-drawer';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import {
  clusterRadialTargets,
  type ProjectedRadialActivity,
  type RadialActivityKind,
  type RadialCycleView,
} from './radial-cycle-state';

export type RadialCycleSelection = 'day' | 'night';

interface RadialCycleProps {
  centerStatus: { hint: string; label: string; value: string | null };
  disabled: boolean;
  onPressAnchor?: (recordId: string) => void;
  onPressRecord: (record: ProjectedRadialActivity) => void;
  view: RadialCycleView;
}

const VIEWBOX_SIZE = 320;
const CENTER = VIEWBOX_SIZE / 2;
const LANE_RADIUS = { outer: 126, inner: 101, point: 76 } as const;

/** Selects Day or Night without changing the selected calendar day. */
export function RadialCycleSelector({
  onChange,
  selection,
}: {
  onChange: (selection: RadialCycleSelection) => void;
  selection: RadialCycleSelection;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.selector}>
      {(['day', 'night'] as const).map((option) => {
        const selected = selection === option;
        const label = option === 'day' ? 'Day' : 'Night';
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option}
            onPress={() => onChange(option)}
            style={[styles.selectorOption, selected && styles.selectorOptionSelected]}
          >
            <Text style={[styles.selectorText, selected && styles.selectorTextSelected]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Renders time-faithful arcs with bounded, selectable clusters for crowded records. */
export function RadialCycle({
  centerStatus,
  disabled,
  onPressRecord,
  onPressAnchor,
  view,
}: RadialCycleProps) {
  const [cluster, setCluster] = useState<readonly ProjectedRadialActivity[] | null>(null);
  const { width } = useWindowDimensions();
  const size = Math.min(340, width - 32);
  const scale = size / VIEWBOX_SIZE;
  const projection = view.projection;
  const status =
    centerStatus.value === null
      ? centerStatus.label
      : `${centerStatus.label}\n${centerStatus.value}`;

  if (projection === null) {
    return (
      <View style={[styles.emptyCard, { minHeight: size }]}>
        <Text accessibilityRole="header" style={styles.emptyTitle}>
          {view.emptyLabel}
        </Text>
        <Text style={styles.emptyText}>Start Night sleep to create a real Bedtime anchor.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { height: size, width: size }]}>
      <Svg
        accessibilityElementsHidden
        height={size}
        importantForAccessibility="no-hide-descendants"
        viewBox="0 0 320 320"
        width={size}
      >
        <Path
          d={arcPath(
            CYCLE_START_ANGLE_DEGREES,
            CYCLE_START_ANGLE_DEGREES + CYCLE_SWEEP_ANGLE_DEGREES,
            139,
          )}
          fill="none"
          stroke="#E7E0D7"
          strokeLinecap="round"
          strokeWidth={2}
        />
        {view.ticks.map((tick) => {
          const inner = polarPoint(tick.angleDegrees, 136);
          const outer = polarPoint(tick.angleDegrees, 143);
          const label = polarPoint(tick.angleDegrees, 151);
          return (
            <G key={tick.offsetMs}>
              <Line
                stroke="#BFB6AA"
                strokeWidth={1.5}
                x1={inner.x}
                x2={outer.x}
                y1={inner.y}
                y2={outer.y}
              />
              <SvgText
                fill="#746F68"
                fontSize={8.5}
                fontWeight="700"
                textAnchor="middle"
                x={label.x}
                y={label.y + 3}
              >
                {tick.label}
              </SvgText>
            </G>
          );
        })}
        {view.records.map((record) => {
          const arc = record.projection.arc;
          if (arc === null || arc.visibleDurationMs <= 0) return null;
          const radius = laneRadius(record.projection.lane);
          const start = arc.start.angleDegrees;
          const actualSweep = Math.max(0, arc.end.angleDegrees - start);
          const visualSweep = Math.max(0.8, actualSweep);
          return (
            <Path
              d={arcPath(start, start + visualSweep, radius)}
              fill="none"
              key={`arc:${record.id}`}
              opacity={arc.active ? 1 : 0.82}
              stroke={radialActivityColor(record.kind)}
              strokeLinecap="round"
              strokeWidth={record.projection.lane === 'outer' ? 9 : 7}
            />
          );
        })}
        {projection.anchors.map((anchor) => {
          const point = polarPoint(anchor.projection.angleDegrees, 139);
          const label = polarPoint(anchor.projection.angleDegrees, 119);
          return (
            <G key={`${anchor.boundary}:${anchor.kind}:${anchor.at}`}>
              <Circle
                cx={point.x}
                cy={point.y}
                fill="#FFFFFF"
                r={5}
                stroke="#5B4C94"
                strokeWidth={2}
              />
              <SvgText
                fill="#5B4C94"
                fontSize={9}
                fontWeight="800"
                textAnchor="middle"
                x={label.x}
                y={label.y + 3}
              >
                {anchorLabel(anchor.kind)}
              </SvgText>
            </G>
          );
        })}
      </Svg>

      {clusterRadialTargets(view.records, (2 * Math.asin(22 / (102 * scale)) * 180) / Math.PI).map(
        (group) => {
          const first = group[0];
          const token = first.projection.token;
          const arc = first.projection.arc;
          const angle =
            token?.projection.angleDegrees ??
            (arc ? (arc.start.angleDegrees + arc.end.angleDegrees) / 2 : 0);
          const point = polarPoint(angle, 102);
          return (
            <RecordTarget
              disabled={disabled}
              key={`token:${first.id}`}
              label={
                group.length === 1
                  ? activityAccessibilityLabel(first, projection.cycle.timezone)
                  : `${group.length} activities near ${formatClock(first.occurredAt, projection.cycle.timezone)}. Choose a record`
              }
              left={point.x * scale - 22}
              top={point.y * scale - 22}
              onPress={() => (group.length === 1 ? onPressRecord(first) : setCluster(group))}
            >
              <View style={[styles.token, { backgroundColor: radialActivityColor(first.kind) }]}>
                {group.length === 1 ? (
                  <ActivityIcon name={first.kind} size={18} />
                ) : (
                  <Text style={styles.tokenText}>{group.length}</Text>
                )}
              </View>
            </RecordTarget>
          );
        },
      )}
      {projection.anchors
        .filter((anchor) => anchor.recordId !== null)
        .map((anchor) => {
          const point = polarPoint(anchor.projection.angleDegrees, 139);
          return (
            <RecordTarget
              key={`anchor:${anchor.boundary}:${anchor.at}`}
              disabled={disabled}
              label={`Edit ${anchorLabel(anchor.kind)}, ${formatClock(anchor.at, projection.cycle.timezone)}`}
              left={point.x * scale - 22}
              top={point.y * scale - 22}
              onPress={() => {
                if (anchor.recordId) onPressAnchor?.(anchor.recordId);
              }}
            >
              <View style={styles.anchorTarget} />
            </RecordTarget>
          );
        })}
      {cluster ? (
        <ActivityDrawer
          activityLabel="Nearby activities"
          mode="edit"
          scrollContent
          onDismiss={() => setCluster(null)}
        >
          {() => (
            <>
              <Text accessibilityRole="header" style={styles.clusterTitle}>
                Nearby activities
              </Text>
              {cluster.map((record) => (
                <Pressable
                  accessibilityRole="button"
                  key={record.id}
                  disabled={disabled}
                  onPress={() => {
                    setCluster(null);
                    onPressRecord(record);
                  }}
                  style={styles.clusterRow}
                >
                  <ActivityIcon name={record.kind} color={radialActivityColor(record.kind)} />
                  <Text style={styles.clusterText}>
                    {activityAccessibilityLabel(record, projection.cycle.timezone)}
                  </Text>
                </Pressable>
              ))}
            </>
          )}
        </ActivityDrawer>
      ) : null}

      <View
        accessible
        accessibilityLabel={`${view.kind} cycle. ${status.replace('\n', ' ')}.`}
        accessibilityRole="summary"
        pointerEvents="none"
        style={styles.centerStatus}
      >
        <Text style={styles.statusLabel}>{centerStatus.label}</Text>
        {centerStatus.value ? <Text style={styles.status}>{centerStatus.value}</Text> : null}
        <Text style={styles.statusHint}>{centerStatus.hint}</Text>
        {projection.overflow.hasOverflow ? (
          <Text style={styles.overflow}>Cycle exceeds 24 hours</Text>
        ) : null}
      </View>
    </View>
  );
}

function RecordTarget({
  children,
  disabled,
  label,
  left,
  onPress,
  top,
}: {
  children: ReactNode;
  disabled: boolean;
  label: string;
  left: number;
  onPress: () => void;
  top: number;
}) {
  return (
    <Pressable
      accessibilityHint="Opens this exact record for editing"
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.target, { left, top }]}
    >
      {children}
    </Pressable>
  );
}

function laneRadius(lane: string): number {
  return lane === 'outer'
    ? LANE_RADIUS.outer
    : lane === 'inner'
      ? LANE_RADIUS.inner
      : LANE_RADIUS.point;
}

function polarPoint(angleDegrees: number, radius: number): { x: number; y: number } {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return { x: CENTER + Math.cos(radians) * radius, y: CENTER + Math.sin(radians) * radius };
}

function arcPath(startAngle: number, endAngle: number, radius: number): string {
  const start = polarPoint(startAngle, radius);
  const end = polarPoint(endAngle, radius);
  const sweep = Math.max(0, endAngle - startAngle);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
}

function activityAccessibilityLabel(record: ProjectedRadialActivity, timezone: string): string {
  const start = formatClock(record.occurredAt, timezone);
  const name = activityName(record.kind);
  if (record.kind === 'diaper') return `${name}, ${record.diaperType ?? 'unknown'} at ${start}`;
  if (record.kind === 'medicine') return `${name} at ${start}`;
  const durationMs = record.projection.arc?.actualDurationMs ?? 0;
  const duration = formatDuration(durationMs);
  const status =
    record.status === 'paused'
      ? `paused, elapsed ${duration}`
      : record.endedAt === null
        ? `active for ${duration}`
        : duration;
  return `${name} started at ${start}, ${status}`;
}

function activityName(kind: RadialActivityKind): string {
  if (kind === 'night') return 'Night sleep';
  if (kind === 'night-waking') return 'Night waking';
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

function formatClock(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(instant));
}

export function radialActivityColor(kind: RadialActivityKind): string {
  switch (kind) {
    case 'nap':
      return '#7367B9';
    case 'night':
      return '#5B4C94';
    case 'night-waking':
      return '#52728A';
    case 'nursing':
      return '#B35D7D';
    case 'diaper':
      return '#47735A';
    case 'medicine':
      return '#A65F35';
  }
}

function anchorLabel(kind: 'bedtime' | 'local_midnight' | 'wake_up'): string {
  if (kind === 'bedtime') return 'Bedtime';
  if (kind === 'wake_up') return 'Wake up';
  return 'Unanchored';
}

const styles = StyleSheet.create({
  selector: {
    flexDirection: 'row',
    alignSelf: 'center',
    padding: 3,
    borderRadius: 18,
    backgroundColor: '#EDE8E1',
  },
  selectorOption: {
    minWidth: 92,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
  },
  selectorOptionSelected: { backgroundColor: '#FFFFFF' },
  selectorText: { color: '#746F68', fontSize: 14, fontWeight: '700' },
  selectorTextSelected: { color: '#292724' },
  card: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 28,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
  },
  emptyTitle: { color: '#292724', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: '#746F68', fontSize: 13, textAlign: 'center' },
  target: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  token: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 14,
  },
  tokenText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  continuation: { width: 20, height: 6, borderRadius: 3 },
  centerStatus: {
    position: 'absolute',
    width: '36%',
    minHeight: '30%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#F9F7F3',
  },
  statusLabel: { color: '#746F68', fontSize: 12, textAlign: 'center' },
  anchorTarget: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#5B4C94',
    backgroundColor: '#FFFFFF',
  },
  clusterTitle: { fontSize: 18, fontWeight: '700', color: '#292724' },
  clusterRow: {
    minHeight: 52,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E7E0D7',
  },
  clusterText: { flex: 1, fontSize: 14, color: '#292724' },
  status: {
    color: '#292724',
    fontSize: 29,
    fontWeight: '700',
    lineHeight: 35,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  statusHint: { color: '#746F68', fontSize: 11, textAlign: 'center' },
  overflow: { color: '#A64444', fontSize: 10, fontWeight: '800', textAlign: 'center' },
});
