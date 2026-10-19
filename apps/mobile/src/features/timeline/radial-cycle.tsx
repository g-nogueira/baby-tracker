import { homeCycleView } from './home-cycle-view';
import { HistoryDialMarkers } from './history-dial-markers';
import {
  historyDialView,
  historyDialGroups,
  historyActivityColor,
  DIAL_MARKER_RADIUS,
  HISTORY_START_ANGLE,
  HISTORY_SWEEP_ANGLE,
} from './history-dial-state';
import { Text } from '@/features/shared/tracking-text';
import { ActivityBadge } from '@/features/shared/icons/activity-badge';
import { useActivityTheme, type ActivityTheme } from '@/features/shared/activity-theme';
import {
  CYCLE_START_ANGLE_DEGREES,
  CYCLE_SWEEP_ANGLE_DEGREES,
  formatDuration,
} from '@baby-tracker/domain';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import {
  clusterRadialTargets,
  type ProjectedRadialActivity,
  type RadialActivityKind,
  type RadialCycleView,
} from './radial-cycle-state';

export type RadialCycleSelection = 'day' | 'night';

interface RadialCycleProps {
  controls?: ReactNode;
  centerStatus: { hint: string; label: string; value: string | null };
  disabled: boolean;
  maxSize?: number;
  presentation?: 'home' | 'history';
  onNextCycle?: () => void;
  nextCycleDisabled?: boolean;
  onPressAnchor?: (recordId: string) => void;
  onPressRecord: (record: ProjectedRadialActivity) => void;
  view: RadialCycleView;
}

const VIEWBOX_SIZE = 320;
const CENTER = VIEWBOX_SIZE / 2;
const LANE_RADIUS = { outer: 135, inner: 126, point: 135 } as const;

/** Selects Day or Night without changing the selected calendar day. */
export function RadialCycleSelector({
  onChange,
  selection,
  compact = false,
}: {
  onChange: (selection: RadialCycleSelection) => void;
  selection: RadialCycleSelection;
  compact?: boolean;
}) {
  const theme = useActivityTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View accessibilityRole="tablist" style={styles.selector}>
      {(compact ? (['night', 'day'] as const) : (['day', 'night'] as const)).map((option) => {
        const selected = selection === option;
        const label = option === 'day' ? 'Day' : 'Night';
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            key={option}
            onPress={() => onChange(option)}
            style={[
              styles.selectorOption,
              compact && { minWidth: 34, minHeight: 38, borderRadius: 19 },
              selected && styles.selectorOptionSelected,
            ]}
          >
            <ActivityIcon
              name={option === 'night' ? 'moon' : 'sun'}
              color={selected ? theme.text : theme.muted}
              size={22}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Renders time-faithful arcs with bounded, selectable clusters for crowded records. */
export function RadialCycle({
  centerStatus,
  controls,
  disabled,
  onPressRecord,
  onPressAnchor,
  maxSize = 440,
  presentation = 'home',
  onNextCycle,
  nextCycleDisabled = false,
  view,
}: RadialCycleProps) {
  const theme = useActivityTheme();
  const history = presentation === 'history';
  const connected = theme.night;
  if (connected) view = history ? historyDialView(view) : homeCycleView(view);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const clusterSheet = useRef<TrueSheet>(null);
  const pendingRecord = useRef<ProjectedRadialActivity | null>(null);
  const [cluster, setCluster] = useState<readonly ProjectedRadialActivity[] | null>(null);
  const { width } = useWindowDimensions();
  const size = Math.min(maxSize, width - 32);
  const scale = size / VIEWBOX_SIZE;
  const projection = view.projection;
  const groupedIds = new Set(
    connected
      ? historyDialGroups(view, size, history ? 'middle' : 'start')
          .filter((targets) => targets.length > 1)
          .flatMap((targets) =>
            targets.flatMap((target) => (target.record ? [target.record.id] : [])),
          )
      : [],
  );
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
        {controls}
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
            connected ? HISTORY_START_ANGLE : CYCLE_START_ANGLE_DEGREES,
            connected
              ? HISTORY_START_ANGLE + HISTORY_SWEEP_ANGLE
              : CYCLE_START_ANGLE_DEGREES + CYCLE_SWEEP_ANGLE_DEGREES,
            theme.night ? 135 : 126,
          )}
          fill="none"
          stroke={history ? '#2B294A' : connected ? '#191830' : theme.track}
          strokeLinecap="round"
          strokeWidth={theme.night ? 30 : 12}
        />
        {!history &&
        view.nightProgress &&
        view.nightProgress.endAngle > view.nightProgress.startAngle ? (
          <Path
            d={arcPath(view.nightProgress.startAngle, view.nightProgress.endAngle, 135)}
            fill="none"
            stroke="#252341"
            strokeWidth={30}
            strokeLinecap="round"
          />
        ) : null}
        {view.ticks
          .filter(
            (tick) =>
              (!theme.night || tick.label === 'Midnight') &&
              (tick.label === 'Midnight' ||
                !projection.anchors.some(
                  (anchor) =>
                    anchor.recordId !== null &&
                    Math.abs(anchor.projection.angleDegrees - tick.angleDegrees) < 8,
                )),
          )
          .map((tick) => {
            const inner = polarPoint(tick.angleDegrees, 136);
            const outer = polarPoint(tick.angleDegrees, 143);
            const label = polarPoint(tick.angleDegrees, 151);
            return (
              <G key={tick.offsetMs}>
                <Line
                  stroke={theme.border}
                  strokeWidth={1.5}
                  x1={inner.x}
                  x2={outer.x}
                  y1={inner.y}
                  y2={outer.y}
                />
                <SvgText
                  fill={theme.muted}
                  fontSize={tick.label === 'Midnight' ? 8 : 7}
                  fontWeight={theme.night ? 'normal' : '500'}
                  fontFamily={theme.night ? 'Saans-Medium' : undefined}
                  textAnchor="middle"
                  x={theme.night ? Math.min(299, Math.max(21, label.x)) : label.x}
                  y={label.y + 3}
                >
                  {tick.label}
                </SvgText>
              </G>
            );
          })}
        {view.records.map((record) => {
          const arc = record.projection.arc;
          if (
            arc === null ||
            arc.visibleDurationMs <= 0 ||
            (theme.night && record.kind === 'night')
          )
            return null;
          const radius = connected ? DIAL_MARKER_RADIUS : laneRadius(record.projection.lane);
          const start = arc.start.angleDegrees;
          const actualSweep = Math.max(0, arc.end.angleDegrees - start);
          const visualSweep = Math.max(0.8, actualSweep);
          // A short grouped interval is represented by its cluster badge and chooser range.
          if (connected && actualSweep < 18 && (record.kind !== 'nap' || groupedIds.has(record.id)))
            return null;
          if (theme.night)
            return (
              <Path
                key={`arc:${record.id}`}
                d={bandPath(start, start + Math.max(0.8, actualSweep), radius, history ? 28 : 22)}
                fill={
                  history
                    ? historyActivityColor(record.kind)
                    : radialActivityColor(record.kind, true)
                }
                fillOpacity={0.12}
                stroke={
                  history
                    ? historyActivityColor(record.kind)
                    : radialActivityColor(record.kind, true)
                }
                strokeWidth={history ? 1.8 : 1.2}
                strokeOpacity={history ? 1 : 0.65}
                strokeDasharray={arc.active ? '2 3' : undefined}
              />
            );
          return (
            <Path
              d={arcPath(start, start + visualSweep, radius)}
              fill="none"
              key={`arc:${record.id}`}
              opacity={arc.active ? 1 : 0.82}
              stroke={radialActivityColor(record.kind, theme.night)}
              strokeLinecap="round"
              strokeWidth={theme.night ? (record.projection.lane === 'outer' ? 24 : 16) : 7}
            />
          );
        })}
        {projection.anchors.map((anchor) => {
          const point = polarPoint(anchor.projection.angleDegrees, 139);
          const label = polarPoint(anchor.projection.angleDegrees, 155);
          return (
            <G key={`${anchor.boundary}:${anchor.kind}:${anchor.at}`}>
              {anchor.recordId === null ? (
                <Circle
                  cx={point.x}
                  cy={point.y}
                  fill={theme.surface}
                  r={5}
                  stroke={theme.accent}
                  strokeWidth={2}
                />
              ) : null}
              {anchor.recordId === null ? (
                <SvgText
                  fill={theme.muted}
                  fontSize={9}
                  fontWeight={theme.night ? 'normal' : '800'}
                  fontFamily={theme.night ? 'Saans-Medium' : undefined}
                  textAnchor="middle"
                  x={label.x}
                  y={label.y + 3}
                >
                  {anchorLabel(anchor.kind)}
                </SvgText>
              ) : null}
            </G>
          );
        })}
      </Svg>

      {connected ? (
        <HistoryDialMarkers
          view={view}
          napPosition={history ? 'middle' : 'start'}
          size={size}
          disabled={disabled}
          onPressRecord={onPressRecord}
          onPressAnchor={onPressAnchor}
        />
      ) : null}
      {!connected
        ? clusterRadialTargets(
            view.records,
            (2 * Math.asin(22 / ((theme.night ? 93 : 135) * scale)) * 180) / Math.PI,
          ).map((group) => {
            const first = group[0];
            const token = first.projection.token;
            const arc = first.projection.arc;
            const angle = token?.projection.angleDegrees ?? (arc ? arc.start.angleDegrees : 0);
            const nearAnchor =
              theme.night &&
              projection.anchors.some(
                (anchor) =>
                  anchor.recordId !== null && Math.abs(anchor.projection.angleDegrees - angle) < 28,
              );
            // Keep the true time angle. A second radial rail separates nearby anchors and care records.
            const point = polarPoint(angle, nearAnchor ? 93 : laneRadius(first.projection.lane));
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
                {group.length === 1 ? (
                  <ActivityBadge
                    icon={first.kind}
                    color={radialActivityColor(first.kind, theme.night)}
                    size={36}
                    active={first.status === 'active'}
                  />
                ) : (
                  <View style={styles.groupTarget}>
                    <ActivityBadge
                      icon={first.kind}
                      color={radialActivityColor(first.kind, theme.night)}
                      size={36}
                      active={group.some((record) => record.status === 'active')}
                    />
                    {group.some((record) => record.kind !== first.kind) ? (
                      <View style={styles.groupSecondary}>
                        <ActivityIcon
                          name={
                            group.find((record) => record.kind !== first.kind)?.kind ?? first.kind
                          }
                          color={theme.text}
                          size={19}
                        />
                      </View>
                    ) : null}
                    <View style={styles.groupCount}>
                      <Text style={styles.tokenText}>{group.length}</Text>
                    </View>
                  </View>
                )}
              </RecordTarget>
            );
          })
        : null}
      {!connected
        ? projection.anchors
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
                  <View style={[styles.anchorTarget, { borderColor: '#D9A36C' }]}>
                    <ActivityIcon
                      name={anchor.kind === 'bedtime' ? 'bedtime' : 'wake'}
                      color="#D9A36C"
                      size={theme.night ? 30 : 19}
                    />
                  </View>
                  <Text numberOfLines={1} style={styles.anchorTime}>
                    {formatClock(anchor.at, projection.cycle.timezone)}
                  </Text>
                </RecordTarget>
              );
            })
        : null}
      {!history && view.estimatedWakeUp
        ? (() => {
            const estimate = view.estimatedWakeUp;
            const point = polarPoint(estimate.angleDegrees, DIAL_MARKER_RADIUS);
            const clock = formatClock(estimate.at, projection.cycle.timezone);
            return (
              <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={`Estimated wake-up, ${clock}`}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: point.x * scale - 22,
                  top: point.y * scale - 22,
                  zIndex: 2,
                  width: 44,
                  height: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ActivityBadge icon="wake" color="#EBC16F" size={36} active />
                <Text
                  style={{
                    position: 'absolute',
                    top: 50,
                    left: -38,
                    width: 120,
                    color: '#EBC16F',
                    fontSize: 14,
                    textAlign: 'center',
                  }}
                >
                  {clock}
                </Text>
              </View>
            );
          })()
        : null}
      {cluster ? (
        <TrueSheet
          ref={clusterSheet}
          initialDetentIndex={0}
          detents={['auto', 0.8]}
          scrollable
          draggable
          dismissible
          backgroundColor={theme.surface}
          onDidDismiss={() => {
            setCluster(null);
            const record = pendingRecord.current;
            pendingRecord.current = null;
            if (record) onPressRecord(record);
          }}
          accessibilityOptions={{ paneTitle: 'Nearby activities' }}
        >
          <ScrollView nestedScrollEnabled contentContainerStyle={{ padding: 24 }}>
            <Text accessibilityRole="header" style={styles.clusterTitle}>
              Nearby activities
            </Text>
            {cluster.map((record) => (
              <Pressable
                accessibilityRole="button"
                key={record.id}
                disabled={disabled}
                onPress={() => {
                  if (pendingRecord.current) return;
                  pendingRecord.current = record;
                  void clusterSheet.current?.dismiss().catch(() => {
                    pendingRecord.current = null;
                  });
                }}
                style={styles.clusterRow}
              >
                <ActivityIcon
                  name={record.kind}
                  color={radialActivityColor(record.kind, theme.night)}
                />
                <Text style={styles.clusterText}>
                  {activityAccessibilityLabel(record, projection.cycle.timezone)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </TrueSheet>
      ) : null}

      {controls ? (
        <View style={[styles.cycleControls, history && { top: '60%' }]}>{controls}</View>
      ) : null}
      {history && onNextCycle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next day in history"
          disabled={disabled || nextCycleDisabled}
          onPress={onNextCycle}
          style={{
            position: 'absolute',
            top: '78%',
            left: '50%',
            marginLeft: -22,
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: nextCycleDisabled ? 0.4 : 1,
          }}
        >
          <ActivityIcon name="chevron-right" color={theme.muted} size={22} />
        </Pressable>
      ) : null}
      <View
        accessible
        accessibilityLabel={`${view.kind} cycle. ${status.replace('\n', ' ')}.`}
        accessibilityRole="summary"
        pointerEvents="none"
        style={[styles.centerStatus, history ? { top: '27%' } : connected && { top: '33%' }]}
      >
        <Text style={styles.statusLabel}>{centerStatus.label}</Text>
        {centerStatus.value ? (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[
              styles.status,
              history
                ? { fontSize: 34, lineHeight: 44, letterSpacing: -0.8 }
                : connected && { fontSize: 48, lineHeight: 56 },
            ]}
          >
            {centerStatus.value}
          </Text>
        ) : null}
        {!history || centerStatus.hint ? (
          <Text style={styles.statusHint}>{centerStatus.hint}</Text>
        ) : null}
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
  const theme = useActivityTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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

/** Closed annular band keeps duration exact while outlining a quiet capsule, rather than filling the dial. */
function bandPath(startAngle: number, endAngle: number, radius: number, width: number): string {
  const outer = radius + width / 2,
    inner = radius - width / 2;
  const a = polarPoint(startAngle, outer),
    b = polarPoint(endAngle, outer),
    c = polarPoint(endAngle, inner),
    d = polarPoint(startAngle, inner);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} A ${width / 2} ${width / 2} 0 0 1 ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} A ${width / 2} ${width / 2} 0 0 1 ${a.x} ${a.y} Z`;
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

export function radialActivityColor(kind: RadialActivityKind, night = false): string {
  if (night)
    return {
      nap: '#8587FF',
      night: '#7770B5',
      'night-waking': '#F09C8C',
      nursing: '#8EEBBE',
      diaper: '#A3CCB0',
      medicine: '#DDE876',
    }[kind];
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

const createStyles = (theme: ActivityTheme) =>
  StyleSheet.create({
    selector: {
      flexDirection: 'row',
      alignSelf: 'center',
      padding: 3,
      borderRadius: 26,
      backgroundColor: theme.raised,
    },
    selectorOption: {
      minWidth: 42,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 15,
    },
    selectorOptionSelected: { backgroundColor: theme.surface },
    selectorText: { color: theme.muted, fontSize: 14, fontWeight: '700' },
    selectorTextSelected: { color: theme.text },
    card: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
    emptyCard: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: 28,
      borderRadius: 28,
      backgroundColor: theme.surface,
    },
    emptyTitle: { color: theme.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: theme.muted, fontSize: 13, textAlign: 'center' },
    target: {
      zIndex: 2,
      position: 'absolute',
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    groupTarget: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    groupSecondary: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 23,
      height: 23,
      borderRadius: 12,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    groupCount: {
      position: 'absolute',
      right: -3,
      top: -3,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 3,
      borderRadius: 9,
      backgroundColor: theme.raised,
      borderWidth: 1,
      borderColor: theme.muted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tokenText: { color: theme.text, fontSize: 10, fontWeight: '500' },
    continuation: { width: 20, height: 6, borderRadius: 3 },
    cycleControls: {
      position: 'absolute',
      top: '70%',
      left: '36%',
      width: '28%',
      alignItems: 'center',
    },
    centerStatus: {
      position: 'absolute',
      left: '19%',
      top: '29%',
      width: '62%',
      height: '35%',
      minHeight: '30%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 999,
      backgroundColor: 'transparent',
    },
    statusLabel: { color: theme.muted, fontSize: 16, textAlign: 'center' },
    anchorTarget: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: theme.accent,
      backgroundColor: theme.surface,
    },
    anchorTime: {
      position: 'absolute',
      top: 42,
      left: -30,
      width: 104,
      textAlign: 'center',
      color: theme.muted,
      fontSize: 10,
      fontWeight: '500',
    },
    clusterTitle: { fontSize: 18, fontWeight: '700', color: theme.text },
    clusterRow: {
      minHeight: 52,
      flexDirection: 'row',
      gap: 12,
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    clusterText: { flex: 1, fontSize: 14, color: theme.text },
    status: {
      color: theme.text,
      fontSize: 54,
      fontWeight: '500',
      letterSpacing: -1.8,
      lineHeight: 62,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    statusHint: { color: theme.muted, fontSize: 11, textAlign: 'center', opacity: 0.72 },
    overflow: { color: theme.error, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  });
