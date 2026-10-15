import { describe, expect, it, vi } from 'vitest';
import { NapperClient } from './client';
import type { CredentialStore, NapperCredentials, WireLog } from './contracts';
import { NapperTracker } from './tracker';
const at = (time: string) => new Date(`2026-10-13T${time}Z`);
const credentials: NapperCredentials = {
  idToken: 'synthetic',
  refreshToken: 'synthetic-refresh',
  accountId: 'test-parent',
  expiresAt: null,
  babyId: 'test-baby',
};
const seed = (): WireLog => ({
  id: 'LOG_test_NURSING',
  category: 'NURSING',
  start: at('10:00:00').toISOString(),
  end: at('10:00:00').toISOString(),
  isOpen: true,
  breastLeftMinutes: 0,
  breastRightMinutes: 0,
  activeBreast: 'LEFT',
  comment: 'existing%20note',
  createdByUserId: 'test-parent',
  updatedAt: at('10:00:00').toISOString(),
});
async function harness(initial: WireLog[] = [], clock = at('10:00:00')) {
  let rows = initial;
  let now = clock;
  let failWrite = false;
  let staleAfterWrite = false;
  let gate: Promise<void> | null = null;
  let afterWrite = false;
  const sent: WireLog[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === 'PUT') {
      const request = JSON.parse(String(init.body));
      sent.push(request);
      if (gate) await gate;
      if (failWrite) throw new Error('lost acknowledgment');
      if (!staleAfterWrite)
        rows = [
          ...rows.filter((log) => log.id !== request.id),
          { ...request, updatedAt: now.toISOString() },
        ];
      afterWrite = true;
      return new Response(null, { status: 200 });
    }
    if (afterWrite && staleAfterWrite)
      return new Response(JSON.stringify({ item: { logs: rows } }));
    if (path.startsWith('/logs-by-day/')) {
      const date = path.split('/').at(-1);
      return new Response(
        JSON.stringify({
          item: {
            allLogs: rows.filter(
              (log) => new Date(String(log.start)).toISOString().slice(0, 10) === date,
            ),
          },
        }),
      );
    }
    return new Response(JSON.stringify({ item: { logs: rows } }));
  });
  const store: CredentialStore = { load: async () => credentials, save: async () => undefined };
  const client = new NapperClient(store, 'test-device', fetcher, () => now);
  await client.restore();
  const tracker = new NapperTracker(
    client,
    () => `guid-${sent.length}`,
    'UTC',
    () => now,
  );
  return {
    tracker,
    fetcher,
    sent,
    rows: () => rows,
    setRows: (next: WireLog[]) => {
      rows = next;
    },
    time: (next: Date) => {
      now = next;
    },
    fail: () => {
      failWrite = true;
    },
    stale: () => {
      staleAfterWrite = true;
    },
    hold: (promise: Promise<void>) => {
      gate = promise;
    },
  };
}
describe('Napper-backed Nursing application', () => {
  it('rereads an externally reopened stopped feed and confirms subsequent writes to the same record', async () => {
    const h = await harness([seed()], at('10:01:00'));
    const stopped = (await h.tracker.change('test-baby', seed(), { kind: 'stop' })).logs[0];
    // The remote pause editor can retain subsecond breast totals. Resume uses the
    // same log and adds the stopped interval as a pause rather than creating a log.
    const reopened = {
      ...stopped,
      end: stopped.start,
      isOpen: true,
      activeBreast: 'RIGHT',
      breastLeftMinutes: 12.75,
      breastRightMinutes: 47.25,
      updatedAt: at('10:03:00').toISOString(),
      pauses: [
        {
          start: Date.parse(String(stopped.end)),
          end: at('10:03:00').getTime(),
          breast: 'RIGHT',
        },
      ],
    };
    h.setRows([reopened]);
    h.time(at('10:03:23'));
    const current = await h.tracker.current('test-baby');
    expect(current).toEqual([reopened]);
    const paused = (await h.tracker.change('test-baby', current[0], { kind: 'pause' })).logs[0];
    h.time(at('10:04:00'));
    const resumed = (await h.tracker.change('test-baby', paused, { kind: 'resume', side: 'RIGHT' }))
      .logs[0];
    h.time(at('10:04:10'));
    const ended = (await h.tracker.change('test-baby', resumed, { kind: 'stop' })).logs[0];
    expect(ended).toMatchObject({
      id: stopped.id,
      isOpen: false,
      breastLeftMinutes: 12.75,
      breastRightMinutes: 80,
      comment: stopped.comment,
    });
    expect((ended.pauses as unknown[])[0]).toEqual(reopened.pauses[0]);
    expect(h.rows()).toEqual([ended]);
    expect(h.tracker.writeNeedsRefresh).toBe(false);
    expect(h.sent).toHaveLength(4);
  });
  it('runs start → switch → pause → resume → stop → edit against a synthetic server', async () => {
    const h = await harness();
    let result = await h.tracker.start('test-baby', 'LEFT');
    let log = result.logs.find((log) => log.category === 'NURSING');
    if (!log) throw new Error('Missing feed');
    expect(log.id).toBe('LOG_guid-0_NURSING');
    h.time(at('10:02:00'));
    result = await h.tracker.change('test-baby', log, { kind: 'switch', side: 'RIGHT' });
    log = result.logs[0];
    h.time(at('10:03:00'));
    result = await h.tracker.change('test-baby', log, { kind: 'pause' });
    log = result.logs[0];
    h.time(at('10:05:00'));
    result = await h.tracker.change('test-baby', log, { kind: 'resume', side: 'RIGHT' });
    log = result.logs[0];
    h.time(at('10:06:00'));
    result = await h.tracker.change('test-baby', log, { kind: 'stop' });
    log = result.logs[0];
    expect(log).toMatchObject({
      isOpen: false,
      breastLeftMinutes: 120,
      breastRightMinutes: 120,
      activeBreast: 'RIGHT',
    });
    h.time(at('12:00:00'));
    result = await h.tracker.correct(
      'test-baby',
      log,
      at('09:59:00'),
      at('10:07:00'),
      180,
      'RIGHT',
    );
    expect(result.logs[0]).toMatchObject({
      id: log.id,
      breastLeftMinutes: 180,
      breastRightMinutes: 180,
      activeBreast: 'RIGHT',
      createdByUserId: 'test-parent',
    });
    expect(h.sent).toHaveLength(6);
    const restarted = new NapperTracker(
      h.tracker.client,
      () => 'unused',
      'UTC',
      () => at('12:00:00'),
    );
    expect((await restarted.current('test-baby'))[0]).toEqual(result.logs[0]);
  });
  it('rejects another caregiver’s update before sending a write and retains their record', async () => {
    const expected = seed();
    const h = await harness(
      [{ ...expected, comment: 'changed%20elsewhere', updatedAt: at('10:01:00').toISOString() }],
      at('10:02:00'),
    );
    await expect(h.tracker.change('test-baby', expected, { kind: 'stop' })).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(h.sent).toHaveLength(0);
  });
  it('blocks double taps and a second open feed', async () => {
    const h = await harness();
    let resolve: () => void = () => undefined;
    h.hold(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    const first = h.tracker.start('test-baby', 'LEFT');
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    await expect(h.tracker.start('test-baby', 'RIGHT')).rejects.toMatchObject({ code: 'conflict' });
    resolve();
    await first;
    await expect(h.tracker.start('test-baby', 'RIGHT')).rejects.toThrow('already running');
    expect(h.sent).toHaveLength(1);
  });
  it('holds writes after lost acknowledgment, makes no blind retry, and requires a successful refresh', async () => {
    const log = seed();
    const h = await harness([log], at('10:02:00'));
    h.fail();
    await expect(h.tracker.change('test-baby', log, { kind: 'stop' })).rejects.toMatchObject({
      code: 'uncertain',
    });
    expect(h.tracker.writeNeedsRefresh).toBe(true);
    await expect(h.tracker.change('test-baby', log, { kind: 'pause' })).rejects.toMatchObject({
      code: 'uncertain',
    });
    expect(h.sent).toHaveLength(1);
    await h.tracker.reconcile('test-baby');
    expect(h.tracker.writeNeedsRefresh).toBe(false);
  });
  it('does not announce success when the server reread still has the old record', async () => {
    const log = seed();
    const h = await harness([log], at('10:02:00'));
    h.stale();
    await expect(h.tracker.change('test-baby', log, { kind: 'stop' })).rejects.toMatchObject({
      code: 'uncertain',
    });
    expect(h.tracker.writeNeedsRefresh).toBe(true);
    expect(h.sent).toHaveLength(1);
  });
  it('reads yesterday’s cross-midnight feed and updates the new history day after a correction', async () => {
    const log: WireLog = {
      ...seed(),
      start: '2026-10-12T23:55:00Z',
      end: '2026-10-13T00:05:00Z',
      isOpen: false,
      breastLeftMinutes: 600,
      breastRightMinutes: 0,
    };
    const h = await harness([log], at('10:00:00'));
    const result = await h.tracker.correct(
      'test-baby',
      log,
      at('00:01:00'),
      at('00:11:00'),
      600,
      'LEFT',
    );
    expect(result.date).toBe('2026-10-13');
    expect(result.logs[0].id).toBe(log.id);
    expect(await h.tracker.history('test-baby', '2026-10-12')).toEqual([]);
  });
});
