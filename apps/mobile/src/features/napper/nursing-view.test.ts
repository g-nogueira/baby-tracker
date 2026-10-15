import { expect, it } from 'vitest';
import type { WireLog } from './contracts';
import { inspectNursingLogs, nursingCycle } from './nursing-view';
const log: WireLog = {
  id: 'synthetic-feed',
  category: 'NURSING',
  start: '2026-10-15T02:22:00+01:00',
  end: '2026-10-15T02:22:00+01:00',
  isOpen: true,
  activeBreast: 'RIGHT',
  breastLeftMinutes: 0,
  breastRightMinutes: 0,
};
const now = new Date('2026-10-15T01:25:23.000Z');
it('provides a fixed read failure reason without leaking response contents', () => {
  const malformed = { ...log, breastLeftMinutes: 'private-response-marker' };
  const result = inspectNursingLogs([malformed], now);
  expect(result.issues).toEqual([{ id: log.id, reason: 'A breast duration is invalid.' }]);
  expect(JSON.stringify(result)).not.toContain('private-response-marker');
});
it('projects Napper offset-bearing timestamps without mutating the shared record', () => {
  const original = structuredClone(log);
  const view = nursingCycle([log], 'synthetic-baby', '2026-10-15', 'Europe/Lisbon', now);
  expect(view.records).toHaveLength(1);
  expect(view.records[0].occurredAt).toBe('2026-10-15T01:22:00.000Z');
  expect(view.records[0].projection.arc?.actualDurationMs).toBe(203000);
  expect(log).toEqual(original);
});
it('projects a zero-length completed feed as a point when different strings denote the same instant', () => {
  const view = nursingCycle(
    [{ ...log, isOpen: false, end: '2026-10-15T01:22:00.000Z' }],
    'synthetic-baby',
    '2026-10-15',
    'Europe/Lisbon',
    now,
  );
  expect(view.records[0].projection.type).toBe('point');
});
it('preserves cross-midnight ownership when normalizing offset timestamps for history', () => {
  const view = nursingCycle(
    [
      {
        ...log,
        start: '2026-10-14T23:55:00+01:00',
        end: '2026-10-15T00:05:00+01:00',
        isOpen: false,
        breastRightMinutes: 600,
      },
    ],
    'synthetic-baby',
    '2026-10-15',
    'Europe/Lisbon',
    now,
  );
  expect(view.records[0].projection.ownership).toBe('continuation');
  expect(view.records[0].projection.arc?.visibleDurationMs).toBe(300000);
});
