import { CYCLE_START_ANGLE_DEGREES, CYCLE_SWEEP_ANGLE_DEGREES } from '@baby-tracker/domain';
import type { ProjectedRadialActivity, RadialCycleView } from './radial-cycle-state';

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
export function historyDialGroups(view: RadialCycleView, size: number): HistoryDialTarget[][] {
  const targets: HistoryDialTarget[] = view.records
    .filter((record) => record.kind !== 'night')
    .flatMap((record) => {
      const arc = record.projection.arc;
      const angle =
        record.kind === 'nap' && arc
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
  const minimumAngle = (2 * Math.asin(Math.min(1, 17 / ((139 * size) / 320))) * 180) / Math.PI;
  const groups: HistoryDialTarget[][] = [];
  for (const target of targets) {
    const previous = groups.at(-1);
    if (previous && target.angle - previous[0].angle < minimumAngle) previous.push(target);
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
        diaper: '#DA91C6',
        medicine: '#E0E78F',
        'night-waking': '#F09C8C',
      } as Record<string, string>
    )[kind] ?? '#EDAE76'
  );
}
export function historyTargetIcon(target: HistoryDialTarget): string {
  return target.record?.kind ?? (target.anchor?.kind === 'bedtime' ? 'bedtime' : 'wake');
}
