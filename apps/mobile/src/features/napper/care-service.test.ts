import { describe, expect, it, vi } from 'vitest';
import {
  CareServiceError,
  type CareActivity,
  type CareCommand,
  type CareKind,
} from '@/features/care-service/contracts';
import { activityDuration, sleepContext } from '@/features/care-service/sleep-state';
import { nursingTimes } from '@/features/care-service/nursing';
import { NapperClient } from './client';
import { napperProvider } from './care-service';
import {
  bedtimeFields,
  bedtimeInstant,
  categories,
  readCareRecord,
  zonedTimestamp,
} from './care-records';
import type { NapperCredentials, WireLog } from './contracts';

const stamp = (time: string) => `2026-10-15T${time}Z`;
const credentials: NapperCredentials = {
  idToken: 'synthetic',
  refreshToken: 'synthetic-refresh',
  accountId: 'test-parent',
  babyId: 'test-baby',
  expiresAt: null,
};
const point = (kind: 'bedtime' | 'wake-up', at: string): WireLog => ({
  id: `LOG_${kind}_test`,
  category: categories[kind],
  start: at,
  end: at,
  isOpen: false,
  createdByUserId: 'test-parent',
  comment: '',
});
export async function careHarness(
  initial: WireLog[] = [],
  at = stamp('08:00:00'),
  todayOnly = false,
) {
  let now = new Date(at);
  let rows = structuredClone(initial);
  let counter = 0;
  let failAt = -1;
  let gate: Promise<void> | null = null;
  let afterPut: (() => void) | null = null;
  const sent: WireLog[] = [];
  const removed: string[] = [];
  let removalMode: 'normal' | 'stale' | 'lost' = 'normal';
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === 'DELETE') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      removed.push(id);
      if (gate) await gate;
      if (removalMode !== 'stale') rows = rows.filter((r) => r.id !== id);
      if (removalMode === 'lost') throw new Error('synthetic lost delete acknowledgment');
      return new Response(null, { status: 204 });
    }
    if (init?.method === 'PUT') {
      const request = JSON.parse(String(init.body)) as WireLog;
      sent.push(request);
      if (gate) await gate;
      if (sent.length === failAt) throw new Error('synthetic lost connection');
      rows = [
        ...rows.filter((r) => r.id !== request.id),
        { ...request, updatedAt: now.toISOString() },
      ];
      afterPut?.();
      return new Response(null, { status: 200 });
    }
    if (path.startsWith('/logs-by-day/')) {
      const date = path.split('/').at(-1);
      // Exercise the storage date of evening bedtimes, not their decoded civil date.
      return new Response(
        JSON.stringify({
          item: { allLogs: rows.filter((r) => String(r.start).slice(0, 10) === date) },
        }),
      );
    }
    return new Response(
      JSON.stringify({
        item: {
          logs: todayOnly
            ? rows.filter((r) => String(r.start).slice(0, 10) === now.toISOString().slice(0, 10))
            : rows,
        },
      }),
    );
  });
  const client = new NapperClient(
    { load: async () => credentials, save: async () => undefined },
    'synthetic-device',
    fetcher,
    () => now,
  );
  await client.restore();
  const provider = napperProvider(
    client,
    () => `synthetic-${++counter}`,
    'Europe/Lisbon',
    () => now,
  );
  const care = provider.care;
  const find = async (kind: CareKind): Promise<CareActivity> => {
    const record = (await care.current('test-baby')).activities.find((r) => r.kind === kind);
    if (!record) throw new Error(`Missing synthetic ${kind}`);
    return record;
  };
  return {
    provider,
    care,
    client,
    sent,
    removed,
    removalMode: (mode: 'normal' | 'stale' | 'lost') => {
      removalMode = mode;
    },
    fetcher,
    find,
    now: () => now,
    time: (at: string) => {
      now = new Date(at);
    },
    rows: () => rows,
    setRows: (next: WireLog[]) => {
      rows = next;
    },
    fail: (n: number) => {
      failAt = n;
    },
    hold: (p: Promise<void>) => {
      gate = p;
    },
    afterPut: (fn: () => void) => {
      afterPut = fn;
    },
  };
}
describe('provider-neutral care port backed by the observed Napper contracts', () => {
  it('keeps the chosen morning mood on Wake up while confirming closure of a concurrent waking', async () => {
    const waking: WireLog = {
      id: 'synthetic-waking',
      category: 'NIGHT_WAKING',
      start: stamp('07:00:00'),
      end: stamp('07:00:00'),
      isOpen: true,
      babyMoodOnWakeUp: 'BAD',
      comment: '',
    };
    const h = await careHarness([point('bedtime', stamp('06:00:00')), waking]);
    await h.care.execute('test-baby', {
      type: 'wake-up',
      expected: await h.find('bedtime'),
      at: stamp('07:30:00'),
      details: { wakeMood: 'good', comment: 'Morning note' },
    });
    expect(h.sent.map((row) => [row.category, row.babyMoodOnWakeUp])).toEqual([
      ['NIGHT_WAKING', 'BAD'],
      ['WOKE_UP', 'GOOD'],
    ]);
    expect((await h.find('wake-up')).details).toEqual({
      wakeMood: 'good',
      comment: 'Morning note',
    });
  });
  it('saves sleep annotations with the initial write and reads the confirmed provider-neutral values', async () => {
    const h = await careHarness();
    const details = {
      settling: ['took-long' as const, 'upset' as const],
      sleepMethod: 'held' as const,
      comment: 'Synthetic 5% & / 🌙',
    };
    await h.provider.care.execute('test-baby', { type: 'bedtime', at: stamp('07:00:00'), details });
    expect((await h.find('bedtime')).details).toEqual(details);
    expect(h.sent.at(-1)).toMatchObject({
      babyMoodOnSleep: ['LONG_TIME_TO_FALL_ASLEEP', 'UPSET'],
      howBabySlept: 'WORN_OR_HELD',
      comment: encodeURIComponent(details.comment),
    });
  });
  it('merges only edited annotation fields and rejects a stale reviewed revision', async () => {
    const log = {
      ...point('bedtime', stamp('06:00:00')),
      howBabySlept: 'UNKNOWN_FUTURE_METHOD',
      babyMoodOnSleep: ['PROVIDER_ONLY'],
      timeToFallAsleep: 'TOOK_A_WHILE',
    };
    const h = await careHarness([log]);
    const reviewed = await h.find('bedtime');
    await h.provider.care.execute('test-baby', {
      type: 'edit-activity',
      expected: reviewed,
      startedAt: reviewed.startedAt,
      details: { comment: 'Edited note' },
    });
    expect(h.sent.at(-1)).toMatchObject({
      howBabySlept: 'UNKNOWN_FUTURE_METHOD',
      babyMoodOnSleep: ['PROVIDER_ONLY'],
      timeToFallAsleep: 'TOOK_A_WHILE',
      comment: 'Edited%20note',
    });
    const count = h.sent.length;
    await expect(
      h.provider.care.execute('test-baby', {
        type: 'edit-activity',
        expected: reviewed,
        startedAt: reviewed.startedAt,
        details: { comment: 'Stale note' },
      }),
    ).rejects.toBeInstanceOf(CareServiceError);
    expect(h.sent).toHaveLength(count);
  });
  it.each(['nap', 'night-waking', 'nursing', 'diaper', 'medicine'] as const)(
    'removes the exact shared %s record and confirms its absence',
    async (kind) => {
      const log: WireLog = {
        id: 'remove-me',
        category: categories[kind],
        start: stamp('07:00:00'),
        end: stamp('07:05:00'),
        isOpen: false,
        ...(kind === 'nursing'
          ? { activeBreast: 'RIGHT', breastLeftMinutes: 0, breastRightMinutes: 300 }
          : {}),
        ...(kind === 'diaper' ? { diaperContent: 'WET' } : {}),
        ...(kind === 'medicine' ? { comment: 'synthetic%20note' } : {}),
      };
      const h = await careHarness([log]);
      await h.care.execute('test-baby', { type: 'remove-activity', expected: await h.find(kind) });
      expect(h.removed).toEqual([log.id]);
      expect(h.sent).toEqual([]);
      expect((await h.care.current('test-baby')).activities).toEqual([]);
      expect(h.care.needsRefresh).toBe(false);
      const call = h.fetcher.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(String(call?.[0])).toBe('https://api.napper.app/logs/test-baby/remove-me');
      expect(call?.[1]?.body).toBeUndefined();
    },
  );
  it('rejects stale removal, separate night-boundary removal, and repeated removal taps', async () => {
    const log: WireLog = {
      id: 'nap',
      category: 'NAP',
      start: stamp('07:00:00'),
      end: stamp('07:10:00'),
      isOpen: false,
    };
    const h = await careHarness([log]);
    const stale = await h.find('nap');
    h.setRows([{ ...log, comment: 'remote edit' }]);
    await expect(
      h.care.execute('test-baby', { type: 'remove-activity', expected: stale }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(h.removed).toEqual([]);
    const fresh = await h.find('nap');
    let release = () => {};
    h.hold(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const first = h.care.execute('test-baby', { type: 'remove-activity', expected: fresh });
    await expect(
      h.care.execute('test-baby', { type: 'remove-activity', expected: fresh }),
    ).rejects.toMatchObject({ code: 'conflict' });
    release();
    await first;
    expect(h.removed).toHaveLength(1);
    const boundary = await careHarness([point('wake-up', stamp('06:00:00'))]);
    await expect(
      boundary.care.execute('test-baby', {
        type: 'remove-activity',
        expected: await boundary.find('wake-up'),
      }),
    ).rejects.toThrow('cannot be removed separately');
    expect(boundary.removed).toEqual([]);
  });
  it.each(['lost', 'stale'] as const)(
    'blocks retries after %s removal confirmation until manual reconciliation',
    async (mode) => {
      const h = await careHarness([
        {
          id: 'nap',
          category: 'NAP',
          start: stamp('07:00:00'),
          end: stamp('07:10:00'),
          isOpen: false,
        },
      ]);
      const command: CareCommand = { type: 'remove-activity', expected: await h.find('nap') };
      h.removalMode(mode);
      await expect(h.care.execute('test-baby', command)).rejects.toMatchObject({
        code: 'uncertain',
      });
      expect(h.care.needsRefresh).toBe(true);
      await expect(h.care.execute('test-baby', command)).rejects.toMatchObject({
        code: 'uncertain',
      });
      expect(h.removed).toHaveLength(1);
      await h.care.reconcile('test-baby');
      expect(h.care.needsRefresh).toBe(false);
      expect(h.removed).toHaveLength(1);
    },
  );
  it('starts, stops, edits and continues a Nap when the fetched history begins mid-night', async () => {
    const oldBed: WireLog = {
      ...point('bedtime', '2026-10-13T19:00:00Z'),
      ...bedtimeFields(new Date('2026-10-13T19:00:00Z'), 'Europe/Lisbon'),
    };
    const oldWaking: WireLog = {
      id: 'old-waking',
      category: 'NIGHT_WAKING',
      isOpen: false,
      start: '2026-10-14T01:00:00Z',
      end: '2026-10-14T01:05:00Z',
    };
    const oldWake = point('wake-up', '2026-10-14T06:00:00Z');
    const wake = { ...point('wake-up', '2026-10-16T06:00:00Z'), id: 'today-wake' };
    const recentBed = {
      ...point('bedtime', '2026-10-15T19:00:00Z'),
      ...bedtimeFields(new Date('2026-10-15T19:00:00Z'), 'Europe/Lisbon'),
      id: 'recent-bed',
    };
    const original = [oldBed, oldWaking, oldWake, recentBed, wake];
    const h = await careHarness(original, '2026-10-16T14:00:00Z', true);
    const initial = await h.care.current('test-baby');
    expect(initial.activities.some((a) => a.id === oldBed.id)).toBe(false);
    expect(initial.activities.some((a) => a.id === oldWaking.id)).toBe(true);
    await h.care.execute('test-baby', { type: 'start-nap', at: h.now().toISOString() });
    h.time('2026-10-16T14:10:00Z');
    await h.care.execute('test-baby', {
      type: 'stop-nap',
      expected: await h.find('nap'),
      at: h.now().toISOString(),
    });
    await h.care.execute('test-baby', {
      type: 'edit-activity',
      expected: await h.find('nap'),
      startedAt: '2026-10-16T13:59:00Z',
      endedAt: h.now().toISOString(),
    });
    h.time('2026-10-16T14:15:00Z');
    await h.care.execute('test-baby', {
      type: 'continue-nap',
      expected: await h.find('nap'),
      at: h.now().toISOString(),
    });
    h.time('2026-10-16T14:20:00Z');
    const nap = await h.find('nap');
    expect(nap.kind === 'nap' && activityDuration(nap, h.now())).toBe(16 * 60000);
    expect(h.sent).toHaveLength(4);
    expect(h.rows().filter((r) => r.category !== 'NAP')).toEqual(original);
    const count = h.sent.length;
    await expect(
      h.care.execute('test-baby', {
        type: 'record-past',
        activity: {
          kind: 'nap',
          startedAt: '2026-10-16T14:05:00Z',
          endedAt: '2026-10-16T14:06:00Z',
        },
      }),
    ).rejects.toThrow('overlaps');
    await expect(
      h.care.execute('test-baby', {
        type: 'record-past',
        activity: {
          kind: 'night-waking',
          startedAt: '2026-10-16T12:05:00Z',
          endedAt: '2026-10-16T12:06:00Z',
        },
      }),
    ).rejects.toThrow('after its bedtime');
    expect(h.sent).toHaveLength(count);
  });
  it('reads a Napper-paused Nap, freezes its clock, resumes it, and trims an open pause when stopping', async () => {
    const pauseStart = Date.parse(stamp('09:20:00'));
    const nap: WireLog = {
      id: 'paused-nap',
      category: 'NAP',
      start: stamp('09:00:00'),
      end: stamp('09:00:00'),
      isOpen: true,
      pauses: [{ start: pauseStart, end: null, metadata: 'retain' }],
      howBabySlept: 'synthetic',
    };
    const h = await careHarness([point('wake-up', stamp('06:00:00')), nap], stamp('09:25:00'));
    const snapshot = await h.care.current('test-baby');
    expect(snapshot.issues).toEqual([]);
    const paused = await h.find('nap');
    expect(paused.status).toBe('paused');
    expect(paused).not.toHaveProperty('pauses');
    expect(paused.kind === 'nap' && activityDuration(paused, new Date(stamp('09:30:00')))).toBe(
      20 * 60000,
    );
    await h.care.execute('test-baby', {
      type: 'edit-activity',
      expected: paused,
      startedAt: stamp('08:59:00'),
    });
    expect(h.rows().find((r) => r.id === nap.id)?.pauses).toEqual(nap.pauses);
    await h.care.execute('test-baby', {
      type: 'resume-nap',
      expected: await h.find('nap'),
      at: h.now().toISOString(),
    });
    expect(h.rows().find((r) => r.id === nap.id)?.pauses).toEqual([
      { start: pauseStart, end: Date.parse(stamp('09:25:00')), metadata: 'retain' },
    ]);
    h.time(stamp('09:30:00'));
    const active = await h.find('nap');
    expect(active.kind === 'nap' && activityDuration(active, h.now())).toBe(26 * 60000);
    await h.care.execute('test-baby', {
      type: 'pause-nap',
      expected: active,
      at: h.now().toISOString(),
    });
    h.time(stamp('09:35:00'));
    await h.care.execute('test-baby', {
      type: 'stop-nap',
      expected: await h.find('nap'),
      at: h.now().toISOString(),
    });
    const stopped = await h.find('nap');
    expect(stopped).toMatchObject({ status: 'completed', endedAt: '2026-10-15T09:30:00.000Z' });
    expect(stopped.kind === 'nap' && activityDuration(stopped, h.now())).toBe(26 * 60000);
    expect(h.rows().find((r) => r.id === nap.id)).toMatchObject({
      howBabySlept: 'synthetic',
      pauses: [{ start: pauseStart, end: Date.parse(stamp('09:25:00')), metadata: 'retain' }],
    });
    expect((await h.care.current('test-baby')).issues).toEqual([]);
    h.time(stamp('09:36:00'));
    await h.care.execute('test-baby', {
      type: 'continue-nap',
      expected: stopped,
      at: h.now().toISOString(),
    });
    expect((await h.find('nap')).status).toBe('active');
  });
  it('still rejects moving a night boundary across a waking or duplicating boundaries despite unrelated orphan history', async () => {
    const bed = point('bedtime', '2026-10-14T19:00:00Z');
    const wake = point('wake-up', stamp('06:00:00'));
    const waking: WireLog = {
      id: 'waking',
      category: 'NIGHT_WAKING',
      start: stamp('05:30:00'),
      end: stamp('05:45:00'),
      isOpen: false,
    };
    const orphan = {
      ...waking,
      id: 'orphan',
      start: '2026-10-13T01:00:00Z',
      end: '2026-10-13T01:05:00Z',
    };
    const h = await careHarness([orphan, bed, waking, wake]);
    await expect(
      h.care.execute('test-baby', {
        type: 'edit-activity',
        expected: await h.find('wake-up'),
        startedAt: stamp('05:40:00'),
      }),
    ).rejects.toThrow('finish by');
    await expect(
      h.care.execute('test-baby', {
        type: 'edit-activity',
        expected: await h.find('bedtime'),
        startedAt: stamp('05:35:00'),
      }),
    ).rejects.toThrow('after its bedtime');
    await expect(
      h.care.execute('test-baby', {
        type: 'record-past',
        activity: { kind: 'wake-up', startedAt: stamp('07:00:00') },
      }),
    ).rejects.toThrow('alternate');
    expect(h.sent).toEqual([]);
  });
  it.each([
    [
      { start: stamp('09:10:00'), end: null },
      { start: stamp('09:15:00'), end: stamp('09:16:00') },
    ],
    [
      { start: stamp('09:10:00'), end: stamp('09:20:00') },
      { start: stamp('09:15:00'), end: stamp('09:25:00') },
    ],
    [{ start: stamp('08:59:00'), end: stamp('09:10:00') }],
    [{ start: stamp('09:31:00'), end: null }],
    [{ start: stamp('09:10:00'), end: stamp('09:31:00') }],
  ])('rejects malformed or out-of-range sleep pauses: %j', (...pauses) => {
    expect(() =>
      readCareRecord(
        {
          id: 'nap',
          category: 'NAP',
          start: stamp('09:00:00'),
          end: stamp('09:00:00'),
          isOpen: true,
          pauses,
        },
        'test',
        new Date(stamp('09:30:00')),
      ),
    ).toThrow('sleep pause');
  });
  it('rejects an open pause in a completed Nap and a stale resume after a remote change', async () => {
    const nap: WireLog = {
      id: 'nap',
      category: 'NAP',
      start: stamp('09:00:00'),
      end: stamp('09:00:00'),
      isOpen: true,
      pauses: [{ start: Date.parse(stamp('09:10:00')), end: null }],
    };
    expect(() =>
      readCareRecord(
        { ...nap, end: stamp('09:20:00'), isOpen: false },
        'test',
        new Date(stamp('09:30:00')),
      ),
    ).toThrow('sleep pause');
    const h = await careHarness([nap], stamp('09:30:00'));
    const stale = await h.find('nap');
    h.setRows([
      {
        ...nap,
        pauses: [{ start: Date.parse(stamp('09:10:00')), end: Date.parse(stamp('09:25:00')) }],
      },
    ]);
    await expect(
      h.care.execute('test-baby', {
        type: 'resume-nap',
        expected: stale,
        at: h.now().toISOString(),
      }),
    ).rejects.toThrow('changed');
    expect(h.sent).toEqual([]);
  });
  it('adjusts an active Nursing start while preserving sides/pauses and rejects impossible or stale corrections', async () => {
    const h = await careHarness([], stamp('09:00:00'));
    await h.care.execute('test-baby', {
      type: 'start-nursing',
      side: 'LEFT',
      at: h.now().toISOString(),
    });
    h.time(stamp('09:05:00'));
    await h.care.execute('test-baby', {
      type: 'change-nursing',
      expected: await h.find('nursing'),
      command: { kind: 'switch', side: 'RIGHT' },
    });
    h.time(stamp('09:06:00'));
    await h.care.execute('test-baby', {
      type: 'change-nursing',
      expected: await h.find('nursing'),
      command: { kind: 'pause' },
    });
    h.time(stamp('09:07:00'));
    await h.care.execute('test-baby', {
      type: 'change-nursing',
      expected: await h.find('nursing'),
      command: { kind: 'resume', side: 'RIGHT' },
    });
    h.time(stamp('09:08:00'));
    const expected = await h.find('nursing');
    const pauses = structuredClone(h.rows()[0].pauses);
    await h.care.execute('test-baby', {
      type: 'edit-activity',
      expected,
      startedAt: stamp('08:59:00'),
    });
    const updated = await h.find('nursing');
    expect(updated.kind === 'nursing' && nursingTimes(updated, h.now())).toMatchObject({
      left: 300,
      right: 180,
      total: 480,
    });
    expect(h.rows()[0].pauses).toEqual(pauses);
    expect(updated).not.toHaveProperty('pauses');
    await expect(
      h.care.execute('test-baby', {
        type: 'edit-activity',
        expected,
        startedAt: stamp('08:58:00'),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      h.care.execute('test-baby', {
        type: 'edit-activity',
        expected: updated,
        startedAt: stamp('09:04:00'),
      }),
    ).rejects.toThrow('breast duration');
  });
  it('runs a complete night, concurrent Nursing, night waking and morning wake-up against the shared store', async () => {
    const h = await careHarness([], '2026-10-14T19:05:27.500Z');
    await h.care.execute('test-baby', { type: 'bedtime', at: h.now().toISOString() });
    const bedtime = await h.find('bedtime');
    expect(bedtime.startedAt).toBe('2026-10-14T19:05:00.000Z');
    expect(h.sent[0]).toMatchObject({
      category: 'BED_TIME',
      isOpen: false,
      startMinutesAfterMidnight: 1205,
    });
    expect(String(h.sent[0].start)).toBe('2026-10-13T23:59:59.999+01:00');
    h.time(stamp('00:10:00'));
    expect(sleepContext((await h.care.current('test-baby')).activities).night?.id).toBe(bedtime.id);
    await h.care.execute('test-baby', {
      type: 'start-night-waking',
      expected: bedtime,
      at: h.now().toISOString(),
    });
    const waking = await h.find('night-waking');
    await h.care.execute('test-baby', {
      type: 'start-nursing',
      side: 'RIGHT',
      at: h.now().toISOString(),
    });
    h.time(stamp('00:15:00'));
    const nursing = await h.find('nursing');
    expect(nursing.kind === 'nursing' && nursingTimes(nursing, h.now()).right).toBe(300);
    await h.care.execute('test-baby', {
      type: 'fall-asleep',
      expected: waking,
      at: h.now().toISOString(),
    });
    let state = sleepContext((await h.care.current('test-baby')).activities);
    expect(state.night?.id).toBe(bedtime.id);
    expect(state.waking).toBeNull();
    expect(state.phaseStartedAt).toBe(stamp('00:15:00').replace('Z', '.000Z'));
    await h.care.execute('test-baby', {
      type: 'change-nursing',
      expected: nursing,
      command: { kind: 'stop' },
    });
    h.time(stamp('06:30:00'));
    await h.care.execute('test-baby', {
      type: 'wake-up',
      expected: bedtime,
      at: h.now().toISOString(),
    });
    state = sleepContext((await h.care.current('test-baby')).activities);
    expect(state.night).toBeNull();
    expect(state.boundary?.kind).toBe('wake-up');
    expect(h.rows()).toHaveLength(4);
    expect(h.sent.filter((r) => r.category === 'NIGHT_WAKING').at(-1)?.isOpen).toBe(false);
    expect((await h.find('nursing')).status).toBe('completed');
  });
  it('confirms the two-step morning transition while another caregiver changes concurrent Nursing', async () => {
    const bed = point('bedtime', '2026-10-14T19:00:00Z');
    const waking: WireLog = {
      id: 'waking',
      category: 'NIGHT_WAKING',
      start: stamp('04:41:00'),
      end: stamp('04:41:00'),
      isOpen: true,
    };
    const feed: WireLog = {
      id: 'feed',
      category: 'NURSING',
      start: stamp('05:50:00'),
      end: stamp('05:50:00'),
      isOpen: true,
      activeBreast: 'RIGHT',
      breastLeftMinutes: 0,
      breastRightMinutes: 0,
    };
    const h = await careHarness([bed, waking, feed], stamp('05:57:00'));
    h.afterPut(() => {
      if (h.sent.length === 1)
        h.setRows(
          h
            .rows()
            .map((r) =>
              r.id === feed.id ? { ...r, activeBreast: 'LEFT', breastRightMinutes: 420 } : r,
            ),
        );
    });
    await h.care.execute('test-baby', {
      type: 'wake-up',
      expected: await h.find('bedtime'),
      at: h.now().toISOString(),
    });
    expect(h.sent.map((r) => r.category)).toEqual(['NIGHT_WAKING', 'WOKE_UP']);
    expect(h.rows().find((r) => r.id === waking.id)).toMatchObject({
      isOpen: false,
      end: '2026-10-15T06:57:00.000+01:00',
    });
    expect(h.rows().find((r) => r.id === feed.id)).toMatchObject({
      isOpen: true,
      activeBreast: 'LEFT',
      breastRightMinutes: 420,
    });
    expect((await h.care.current('test-baby')).issues).toEqual([]);
    expect(h.care.needsRefresh).toBe(false);
  });
  it('does not send Wake up when the preceding night-waking closure is acknowledged but unconfirmed', async () => {
    const bed = point('bedtime', '2026-10-14T19:00:00Z');
    const waking: WireLog = {
      id: 'waking',
      category: 'NIGHT_WAKING',
      start: stamp('04:41:00'),
      end: stamp('04:41:00'),
      isOpen: true,
    };
    const h = await careHarness([bed, waking], stamp('05:57:00'));
    const command: CareCommand = {
      type: 'wake-up',
      expected: await h.find('bedtime'),
      at: h.now().toISOString(),
    };
    // A stale read or ignored closure must not be followed by the dependent boundary write.
    h.afterPut(() => h.setRows([bed, waking]));
    await expect(h.care.execute('test-baby', command)).rejects.toMatchObject({ code: 'uncertain' });
    expect(h.sent.map((r) => r.category)).toEqual(['NIGHT_WAKING']);
    expect(h.rows().some((r) => r.category === 'WOKE_UP')).toBe(false);
    await expect(h.care.execute('test-baby', command)).rejects.toMatchObject({ code: 'uncertain' });
    expect(h.sent).toHaveLength(1);
    h.afterPut(() => undefined);
    await h.care.reconcile('test-baby');
    await h.care.execute('test-baby', { ...command, expected: await h.find('bedtime') });
    expect(h.sent.map((r) => r.category)).toEqual(['NIGHT_WAKING', 'NIGHT_WAKING', 'WOKE_UP']);
    expect((await h.care.current('test-baby')).issues).toEqual([]);
  });
  it('rechecks the reviewed bedtime between closing a waking and adding Wake up', async () => {
    const bed = point('bedtime', '2026-10-14T19:00:00Z');
    const waking: WireLog = {
      id: 'waking',
      category: 'NIGHT_WAKING',
      start: stamp('04:41:00'),
      end: stamp('04:41:00'),
      isOpen: true,
    };
    const h = await careHarness([bed, waking], stamp('05:57:00'));
    const expected = await h.find('bedtime');
    h.afterPut(() =>
      h.setRows(
        h
          .rows()
          .map((r) =>
            r.id === bed.id ? { ...r, comment: 'another caregiver edited bedtime' } : r,
          ),
      ),
    );
    await expect(
      h.care.execute('test-baby', { type: 'wake-up', expected, at: h.now().toISOString() }),
    ).rejects.toMatchObject({ code: 'uncertain' });
    expect(h.sent.map((r) => r.category)).toEqual(['NIGHT_WAKING']);
    expect(h.rows().some((r) => r.category === 'WOKE_UP')).toBe(false);
  });
  it('stops a transition if another waking appears before the dependent Wake up write', async () => {
    const bed = point('bedtime', '2026-10-14T19:00:00Z');
    const waking: WireLog = {
      id: 'waking',
      category: 'NIGHT_WAKING',
      start: stamp('04:41:00'),
      end: stamp('04:41:00'),
      isOpen: true,
    };
    const h = await careHarness([bed, waking], stamp('06:00:00'));
    const expected = await h.find('bedtime');
    h.afterPut(() =>
      h.setRows([
        ...h.rows(),
        { ...waking, id: 'other-waking', start: stamp('05:58:00'), end: stamp('05:58:00') },
      ]),
    );
    await expect(
      h.care.execute('test-baby', { type: 'wake-up', expected, at: stamp('05:57:00') }),
    ).rejects.toMatchObject({ code: 'uncertain' });
    expect(h.sent.map((r) => r.category)).toEqual(['NIGHT_WAKING']);
  });
  it('reports a remotely introduced collision after the boundary PUT even when both requested records match', async () => {
    const bed = point('bedtime', '2026-10-14T19:00:00Z');
    const waking: WireLog = {
      id: 'waking',
      category: 'NIGHT_WAKING',
      start: stamp('04:41:00'),
      end: stamp('04:41:00'),
      isOpen: true,
    };
    const h = await careHarness([bed, waking], stamp('06:03:00'));
    const expected = await h.find('bedtime');
    h.afterPut(() => {
      if (h.sent.length === 2)
        h.setRows([
          ...h.rows(),
          {
            ...waking,
            id: 'remote-waking',
            start: stamp('05:58:00'),
            end: stamp('06:03:00'),
            isOpen: false,
          },
        ]);
    });
    await expect(
      h.care.execute('test-baby', { type: 'wake-up', expected, at: stamp('05:57:00') }),
    ).rejects.toMatchObject({ code: 'uncertain' });
    expect(h.sent).toHaveLength(2);
    expect(h.care.needsRefresh).toBe(true);
    const snapshot = await h.care.reconcile('test-baby');
    expect(snapshot.issues.some((i) => i.message.includes('after its bedtime'))).toBe(true);
    expect(h.care.needsRefresh).toBe(false);
    expect(h.sent).toHaveLength(2);
  });
  it('shows a waking crossing Wake up on reads and allows an explicit correction without touching concurrent Nursing', async () => {
    const bed = point('bedtime', '2026-10-14T19:00:00Z');
    const wake = point('wake-up', stamp('05:57:00'));
    const waking: WireLog = {
      id: 'waking',
      category: 'NIGHT_WAKING',
      start: stamp('04:41:00'),
      end: stamp('06:03:00'),
      isOpen: false,
    };
    const feed: WireLog = {
      id: 'feed',
      category: 'NURSING',
      start: stamp('05:57:00'),
      end: stamp('05:57:00'),
      isOpen: true,
      activeBreast: 'RIGHT',
      breastLeftMinutes: 0,
      breastRightMinutes: 0,
    };
    const h = await careHarness([bed, wake, waking, feed], stamp('06:04:00'));
    const snapshot = await h.care.current('test-baby');
    expect(snapshot.issues).toEqual([
      expect.objectContaining({
        message: 'A night waking must finish by the morning Wake up.',
        blocksWrites: false,
      }),
    ]);
    await expect(
      h.care.execute('test-baby', {
        type: 'edit-activity',
        expected: await h.find('night-waking'),
        startedAt: stamp('04:41:00'),
        endedAt: stamp('06:02:00'),
      }),
    ).rejects.toThrow('finish by');
    expect(h.sent).toEqual([]);
    await h.care.execute('test-baby', {
      type: 'edit-activity',
      expected: await h.find('night-waking'),
      startedAt: stamp('04:41:00'),
      endedAt: stamp('05:57:00'),
    });
    expect((await h.care.current('test-baby')).issues).toEqual([]);
    expect(h.rows().find((r) => r.id === feed.id)).toEqual(feed);
    expect(h.sent).toHaveLength(1);
  });
  it('does not mistake an unanchored historical waking for a known collision or allow a Nap to overlap it', async () => {
    const waking: WireLog = {
      id: 'old-waking',
      category: 'NIGHT_WAKING',
      start: '2026-10-13T01:00:00Z',
      end: '2026-10-13T01:10:00Z',
      isOpen: false,
    };
    const h = await careHarness([waking]);
    expect((await h.care.current('test-baby')).issues).toEqual([]);
    await expect(
      h.care.execute('test-baby', {
        type: 'record-past',
        activity: {
          kind: 'nap',
          startedAt: '2026-10-13T01:05:00Z',
          endedAt: '2026-10-13T01:15:00Z',
        },
      }),
    ).rejects.toThrow('overlap a night waking');
    expect(h.sent).toEqual([]);
  });
  it('closes an active night waking before morning Wake up, and blocks retry after a partial transition', async () => {
    const bed = point('bedtime', '2026-10-14T19:00:00Z');
    const waking: WireLog = {
      id: 'LOG_waking',
      category: 'NIGHT_WAKING',
      start: stamp('06:00:00'),
      end: stamp('06:00:00'),
      isOpen: true,
      comment: 'retain%20note',
    };
    const h = await careHarness([bed, waking], stamp('06:30:00'));
    const expected = await h.find('bedtime');
    h.fail(2);
    const command: CareCommand = { type: 'wake-up', expected, at: h.now().toISOString() };
    await expect(h.care.execute('test-baby', command)).rejects.toMatchObject({ code: 'uncertain' });
    expect(h.rows().find((r) => r.id === waking.id)).toMatchObject({
      isOpen: false,
      comment: waking.comment,
    });
    expect(h.care.needsRefresh).toBe(true);
    await expect(h.care.execute('test-baby', command)).rejects.toMatchObject({ code: 'uncertain' });
    expect(h.sent).toHaveLength(2);
    await h.care.reconcile('test-baby');
    const fresh = await h.find('bedtime');
    await h.care.execute('test-baby', { ...command, expected: fresh });
    expect(h.sent).toHaveLength(3);
    expect((await h.find('wake-up')).startedAt).toBe('2026-10-15T06:30:00.000Z');
  });
  it('rejects stale revisions, forged revisions, wrong profiles and overlapping taps before extra writes', async () => {
    const h = await careHarness([point('bedtime', '2026-10-14T19:00:00Z')], stamp('01:00:00'));
    const expected = await h.find('bedtime');
    expect(expected.revision).not.toContain('comment');
    h.setRows(h.rows().map((r) => ({ ...r, comment: 'private%20remote%20edit' })));
    const command: CareCommand = {
      type: 'start-night-waking',
      expected,
      at: h.now().toISOString(),
    };
    await expect(h.care.execute('test-baby', command)).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      h.care.execute('test-baby', { ...command, expected: { ...expected, revision: 'forged' } }),
    ).rejects.toBeInstanceOf(CareServiceError);
    await expect(h.care.execute('another-baby', command)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(h.sent).toHaveLength(0);
    const fresh = await h.find('bedtime');
    let release: () => void = () => undefined;
    h.hold(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const first = h.care.execute('test-baby', { ...command, expected: fresh });
    await expect(
      h.care.execute('test-baby', { ...command, expected: fresh }),
    ).rejects.toMatchObject({ code: 'conflict' });
    release();
    await first;
    expect(h.sent).toHaveLength(1);
  });
  it('continues an accidentally stopped nap without counting the stopped gap, then edits its completed times', async () => {
    const h = await careHarness([point('wake-up', stamp('06:00:00'))], stamp('09:00:00'));
    await h.care.execute('test-baby', { type: 'start-nap', at: h.now().toISOString() });
    h.time(stamp('09:30:00'));
    await h.care.execute('test-baby', {
      type: 'stop-nap',
      expected: await h.find('nap'),
      at: h.now().toISOString(),
    });
    h.time(stamp('09:35:00'));
    await h.care.execute('test-baby', {
      type: 'continue-nap',
      expected: await h.find('nap'),
      at: h.now().toISOString(),
    });
    h.time(stamp('09:45:00'));
    const resumed = await h.find('nap');
    expect(resumed.kind === 'nap' && activityDuration(resumed, h.now())).toBe(40 * 60000);
    await h.care.execute('test-baby', {
      type: 'stop-nap',
      expected: resumed,
      at: h.now().toISOString(),
    });
    const closed = await h.find('nap');
    await h.care.execute('test-baby', {
      type: 'edit-activity',
      expected: closed,
      startedAt: stamp('08:55:00'),
      endedAt: stamp('09:45:00'),
    });
    expect((await h.find('nap')).startedAt).toBe('2026-10-15T08:55:00.000Z');
    expect(h.rows().filter((r) => r.category === 'NAP')).toHaveLength(1);
    h.time(stamp('11:00:00'));
    await expect(
      h.care.execute('test-baby', {
        type: 'continue-nap',
        expected: await h.find('nap'),
        at: h.now().toISOString(),
      }),
    ).rejects.toThrow('within one hour');
  });
  it('adds past-night activities, preserves other metadata, and edits the actual morning boundary', async () => {
    const bed: WireLog = {
      ...point('bedtime', '2026-10-13T19:00:00Z'),
      ...bedtimeFields(new Date('2026-10-13T19:00:00Z'), 'Europe/Lisbon'),
      overallHappiness: 'HAPPY',
    };
    const wake = point('wake-up', '2026-10-14T06:00:00Z');
    const h = await careHarness([bed, wake]);
    await h.care.execute('test-baby', {
      type: 'record-past',
      activity: {
        kind: 'night-waking',
        startedAt: '2026-10-14T01:00:00Z',
        endedAt: '2026-10-14T01:05:00Z',
      },
    });
    await h.care.execute('test-baby', {
      type: 'record-past',
      activity: { kind: 'diaper', startedAt: '2026-10-14T01:02:00Z', diaperType: 'mixed' },
    });
    await h.care.execute('test-baby', {
      type: 'record-past',
      activity: {
        kind: 'medicine',
        startedAt: '2026-10-14T01:03:00Z',
        note: 'Synthetic note: 5% & + / 💛',
      },
    });
    let history = await h.care.history('test-baby', '2026-10-13');
    expect(history.activities.some((a) => a.kind === 'night-waking')).toBe(true);
    expect(history.activities.find((a) => a.kind === 'medicine')).toMatchObject({
      note: 'Synthetic note: 5% & + / 💛',
    });
    const expected = history.activities.find((a) => a.kind === 'wake-up');
    if (!expected) throw new Error('Missing wake-up');
    await h.care.execute('test-baby', {
      type: 'edit-activity',
      expected,
      startedAt: '2026-10-14T06:15:00Z',
    });
    history = await h.care.history('test-baby', '2026-10-13');
    expect(history.activities.find((a) => a.id === expected.id)?.startedAt).toBe(
      '2026-10-14T06:15:00.000Z',
    );
    expect(h.rows().find((r) => r.id === bed.id)?.overallHappiness).toBe('HAPPY');
    expect(h.sent.every((r) => !('revision' in r) && !('activities' in r))).toBe(true);
    const freshWake = history.activities.find((a) => a.id === expected.id);
    if (!freshWake) throw new Error('Missing wake-up');
    await expect(
      h.care.execute('test-baby', {
        type: 'edit-activity',
        expected: freshWake,
        startedAt: '2026-10-14T01:03:00Z',
      }),
    ).rejects.toThrow('finish by');
  });
  it('rejects duplicate night boundaries, out-of-night wakings, naps during nights and future writes', async () => {
    const h = await careHarness([point('bedtime', '2026-10-14T19:00:00Z')], stamp('01:00:00'));
    await expect(
      h.care.execute('test-baby', { type: 'start-nap', at: h.now().toISOString() }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      h.care.execute('test-baby', { type: 'bedtime', at: h.now().toISOString() }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      h.care.execute('test-baby', {
        type: 'record-past',
        activity: {
          kind: 'night-waking',
          startedAt: '2026-10-14T12:00:00Z',
          endedAt: '2026-10-14T12:05:00Z',
        },
      }),
    ).rejects.toThrow('after its bedtime');
    await expect(
      h.care.execute('test-baby', {
        type: 'record-past',
        activity: { kind: 'diaper', startedAt: stamp('02:00:00'), diaperType: 'wet' },
      }),
    ).rejects.toThrow('past');
    expect(h.sent).toHaveLength(0);
  });
});
describe('bedtime and timezone wire conversion', () => {
  it.each([
    '2026-10-24T19:05:00Z',
    '2026-10-25T19:05:00Z',
    '2026-03-28T20:05:00Z',
    '2026-03-29T19:05:00Z',
    '2026-10-15T00:30:00Z',
  ])('round trips the observed minute anchor across midnight and DST: %s', (at) => {
    const fields = bedtimeFields(new Date(at), 'Europe/Lisbon');
    expect(bedtimeInstant(fields)).toBe(new Date(at).toISOString());
    expect(Date.parse(zonedTimestamp(new Date(at), 'Europe/Lisbon'))).toBe(Date.parse(at));
  });
});
