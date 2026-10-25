import { CYCLE_START_ANGLE_DEGREES, CYCLE_SWEEP_ANGLE_DEGREES } from '@baby-tracker/domain';
import type { ProjectedRadialActivity, RadialCycleView } from './radial-cycle-state';

export const DIAL_MARKER_RADIUS = 135;
export const HISTORY_START_ANGLE = 217;
export const HISTORY_SWEEP_ANGLE = 286;
type Anchor = NonNullable<RadialCycleView['projection']>['anchors'][number];
export type HistoryDialTarget =
  | { id: string; angle: number; record: ProjectedRadialActivity; anchor: null }
  | { id: string; angle: number; record: null; anchor: Anchor };

/** Change only the display geometry; instants, durations, IDs and editor references stay canonical. */
export function historyDialView(view: RadialCycleView): RadialCycleView {
  if (!view.projection) return view;
  const angle = (value: number) =>
    HISTORY_START_ANGLE +
    ((value - CYCLE_START_ANGLE_DEGREES) / CYCLE_SWEEP_ANGLE_DEGREES) * HISTORY_SWEEP_ANGLE;
  const position = <T extends { angleDegrees: number }>(p: T): T => ({
    ...p,
    angleDegrees: angle(p.angleDegrees),
  });
  const records = view.records.map((record) => ({
    ...record,
    projection: {
      ...record.projection,
      token: record.projection.token
        ? { ...record.projection.token, projection: position(record.projection.token.projection) }
        : null,
      arc: record.projection.arc
        ? {
            ...record.projection.arc,
            start: position(record.projection.arc.start),
            end: position(record.projection.arc.end),
          }
        : null,
    },
  }));
  return {
    ...view,
    records,
    ticks: view.ticks.map(position),
    projection: {
      ...view.projection,
      records: records.map((r) => r.projection),
      anchors: view.projection.anchors.map((a) => ({ ...a, projection: position(a.projection) })),
    },
  };
}

/** One visible rail, including boundaries. Every member remains individually selectable. */
export function historyDialGroups(
  view: RadialCycleView,
  size: number,
  napPosition: 'start' | 'middle' = 'middle',
): HistoryDialTarget[][] {
  const targets: HistoryDialTarget[] = view.records
    .filter((record) => record.kind !== 'night')
    .flatMap((record) => {
      const arc = record.projection.arc;
      const angle =
        napPosition === 'middle' && record.kind === 'nap' && arc
          ? (arc.start.angleDegrees + arc.end.angleDegrees) / 2
          : (record.projection.token?.projection.angleDegrees ?? arc?.start.angleDegrees);
      return angle === undefined ? [] : [{ id: record.id, angle, record, anchor: null }];
    });
  for (const anchor of view.projection?.anchors ?? []) {
    if (anchor.recordId)
      targets.push({
        id: `anchor:${anchor.boundary}:${anchor.recordId}`,
        angle: anchor.projection.angleDegrees,
        record: null,
        anchor,
      });
  }
  targets.sort((a, b) => a.angle - b.angle || a.id.localeCompare(b.id));
  // Allow partially overlapping badges like Napper; group only centers too close to select.
  // Join touching neighbors transitively so a third nearby record cannot overlap a group.
  // Neither grouping nor overlap changes the authoritative timestamp/angle.
  const minimumAngle =
    (2 * Math.asin(Math.min(1, 9 / ((DIAL_MARKER_RADIUS * size) / 320))) * 180) / Math.PI;
  const groups: HistoryDialTarget[][] = [];
  for (const target of targets) {
    const previous = groups.at(-1);
    if (previous && target.angle - previous[previous.length - 1].angle < minimumAngle)
      previous.push(target);
    else groups.push([target]);
  }
  return groups;
}
export function historyActivityColor(kind: string): string {
  return (
    (
      {
        nap: '#A19CFF',
        nursing: '#A0EBCF',
        diaper: '#F1A0DB',
        medicine: '#E0E78F',
        'night-waking': '#F09C8C',
      } as Record<string, string>
    )[kind] ?? '#EDAE76'
  );
}
export function historyTargetIcon(target: HistoryDialTarget): string {
  return target.record?.kind ?? (target.anchor?.kind === 'bedtime' ? 'bedtime' : 'wake');
}

/** The final marker sits on its actual rail angle, with one quiet backing ring. */
export function historyDialGroupBadge(targets: readonly HistoryDialTarget[]) {
  const front = targets[targets.length - 1];
  return {
    front,
    back: targets.length > 1 ? targets[targets.length - 2] : null,
    angle: front.angle,
  };
}

/** Compact chooser metadata retains full, unclipped intervals and measured active time. */
export function historyTargetDetails(target: HistoryDialTarget, view: RadialCycleView) {
  const record = target.record;
  const napIndex =
    record?.kind === 'nap'
      ? [...view.records]
          .filter((item) => item.kind === 'nap')
          .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))
          .findIndex((item) => item.id === record.id)
      : -1;
  const title =
    record?.kind === 'nap'
      ? (['First nap', 'Second nap', 'Third nap', 'Fourth nap'][napIndex] ?? `Nap ${napIndex + 1}`)
      : record?.kind === 'nursing'
        ? 'Nursing'
        : record?.kind === 'diaper'
          ? 'Diaper change'
          : record?.kind === 'medicine'
            ? 'Medicine'
            : record?.kind === 'night-waking'
              ? 'Night waking'
              : target.anchor?.kind === 'bedtime'
                ? 'Bedtime'
                : 'Wake-up';
  const durationMs = record?.durationMs ?? record?.projection.arc?.actualDurationMs;
  const seconds = durationMs === undefined ? null : Math.max(0, Math.floor(durationMs / 1000));
  const duration =
    seconds === null
      ? null
      : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  const subtitle =
    duration ??
    (record?.diaperType ? record.diaperType[0].toUpperCase() + record.diaperType.slice(1) : null);
  return {
    title,
    subtitle,
    start: target.record ? target.record.occurredAt : target.anchor.at,
    end: record?.endedAt ?? null,
    running: record?.status === 'active',
    paused: record?.status === 'paused',
  };
}
