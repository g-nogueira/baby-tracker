import type { NapperClient } from './client';
import { type Breast, fingerprint, NapperError, type WireLog } from './contracts';
import {
  changeNapperNursing,
  correctNapperNursing,
  type NursingCommand,
  nursingRequest,
  readNursing,
  startNapperNursing,
} from './nursing';
import { calendarDayForInstant, shiftCalendarDay } from '@/features/naps/calendar-day';

interface PendingSave {
  babyId: string;
  accountId: string | null;
  dates: readonly string[];
  confirm: (logs: WireLog[]) => void;
}

/** Application boundary: remote truth is reread before/after every mutation; no local outbox. */
export class NapperTracker {
  private mutationInFlight = false;
  private uncertain: PendingSave | null = null;
  private verification: { save: PendingSave; result: Promise<boolean> } | null = null;
  constructor(
    public readonly client: NapperClient,
    private readonly newId: () => string,
    public readonly timezone: string,
    private readonly now: () => Date = () => new Date(),
  ) {}
  get writeNeedsRefresh() {
    return this.pendingSave(this.client.babyId) !== null;
  }
  private pendingSave(babyId: string | null) {
    const save = this.uncertain;
    return save?.babyId === babyId &&
      babyId === this.client.babyId &&
      save.accountId === this.client.accountId
      ? save
      : null;
  }
  async current(babyId: string): Promise<WireLog[]> {
    const date = calendarDayForInstant(this.now(), this.timezone);
    const [today, previous] = await Promise.all([
      this.client.today(babyId),
      this.client.day(babyId, shiftCalendarDay(date, -1)),
    ]);
    return mergeLogs(previous, today);
  }
  async history(babyId: string, date: string) {
    return this.client.day(babyId, date);
  }
  /** Bedtime's storage date can precede its real evening; include complete adjacent cycles. */
  async window(babyId: string, date: string): Promise<WireLog[]> {
    return this.windows(babyId, [date]);
  }
  private async windows(babyId: string, dates: readonly string[]): Promise<WireLog[]> {
    const today = calendarDayForInstant(this.now(), this.timezone);
    const days = new Set(
      dates
        .flatMap((date) => [-2, -1, 0, 1].map((offset) => shiftCalendarDay(date, offset)))
        .filter((day) => day <= today),
    );
    const reads = [...days].map((day) => this.history(babyId, day));
    if (dates.includes(today)) reads.push(this.client.today(babyId));
    const rows = await Promise.all(reads);
    return rows.reduce((all, logs) => mergeLogs(all, logs), []);
  }
  async reconcile(babyId: string) {
    const save = this.pendingSave(babyId);
    const logs = await this.current(babyId);
    if (save) {
      await this.windows(babyId, save.dates);
      if (this.pendingSave(babyId) === save) this.uncertain = null;
    }
    return logs;
  }
  /** Read-only recovery. A successful GET alone cannot establish that a save succeeded. */
  async verifyPendingSave(babyId: string): Promise<boolean> {
    const save = this.pendingSave(babyId);
    if (!save || this.mutationInFlight) return false;
    if (this.verification?.save === save) return this.verification.result;
    const result = (async () => {
      const logs = await this.windows(babyId, save.dates);
      if (this.pendingSave(babyId) !== save) return false;
      try {
        save.confirm(logs);
      } catch {
        return false;
      }
      this.uncertain = null;
      return true;
    })();
    this.verification = { save, result };
    try {
      return await result;
    } finally {
      if (this.verification?.save === save) this.verification = null;
    }
  }
  /** Ordered provider writes share the Nursing lock. No batch/atomic API contract was observed. */
  async apply(
    babyId: string,
    date: string,
    prepare: (logs: WireLog[]) => WireLog[],
    additionalDates: string[] = [],
    validateSaved?: (before: WireLog[], saved: WireLog[], requests: WireLog[]) => void,
  ) {
    if (this.mutationInFlight)
      throw new NapperError('conflict', 'A change is already being saved.');
    if (this.writeNeedsRefresh)
      throw new NapperError(
        'uncertain',
        'Refresh to check the previous save before making another change.',
      );
    this.mutationInFlight = true;
    const accountId = this.client.accountId;
    let before: WireLog[] = [];
    let requests: WireLog[] = [];
    const days = new Set([date, ...additionalDates]);
    let accepted = 0;
    const confirm = (saved: WireLog[], expected: WireLog[]) => {
      for (const request of expected) {
        const actual = saved.find((log) => log.id === request.id);
        if (!actual || !matchesCareWrite(actual, request))
          throw new NapperError('uncertain', 'The saved activity could not be confirmed.');
      }
    };
    const confirmAll = (saved: WireLog[]) => {
      confirm(saved, requests);
      validateSaved?.(before, saved, requests);
    };
    try {
      before = await this.windows(babyId, [...days]);
      requests = prepare(before).map(nursingRequest);
      if (requests.length === 0)
        throw new NapperError('invalid', 'No activity change was prepared.');
      for (const request of requests)
        days.add(calendarDayForInstant(new Date(String(request.start)), this.timezone));
      for (const request of requests) {
        await this.client.put(babyId, request);
        accepted++;
        if (accepted < requests.length) {
          const current = await this.windows(babyId, [...days]);
          confirm(current, requests.slice(0, accepted));
          // Recheck dependencies (including the reviewed bedtime) before the next PUT.
          // Preparation must retain IDs across calls; accepted steps must not be repeated.
          const pending = prepare(current).map(nursingRequest);
          if (fingerprint(pending) !== fingerprint(requests.slice(accepted)))
            throw new NapperError('conflict', 'The shared transition changed before completion.');
        }
      }
      const saved = await this.windows(babyId, [...days]);
      confirmAll(saved);
    } catch (error) {
      if (
        requests.length &&
        (accepted > 0 || (error instanceof NapperError && error.code === 'uncertain'))
      ) {
        this.uncertain = {
          babyId,
          accountId,
          dates: [...days],
          confirm: confirmAll,
        };
        throw new NapperError(
          'uncertain',
          accepted > 0 && accepted < requests.length
            ? 'The transition stopped before completion. Refresh and review the shared activities before continuing.'
            : 'The saved activity could not be confirmed. Refresh before making another change.',
        );
      }
      throw error;
    } finally {
      this.mutationInFlight = false;
    }
  }
  /** Confirmed single-record removal; no implicit night cascade or compensating recreation. */
  async remove(
    babyId: string,
    expected: WireLog,
    validate: (before: WireLog[], after: WireLog[]) => void,
  ) {
    if (this.mutationInFlight)
      throw new NapperError('conflict', 'A change is already being saved.');
    if (this.writeNeedsRefresh)
      throw new NapperError(
        'uncertain',
        'Refresh to check the previous save before making another change.',
      );
    this.mutationInFlight = true;
    const accountId = this.client.accountId;
    let before: WireLog[] = [];
    let accepted = false;
    const date = calendarDayForInstant(new Date(String(expected.start)), this.timezone);
    const confirm = (after: WireLog[]) => {
      if (after.some((r) => r.id === expected.id))
        throw new NapperError('uncertain', 'Removal could not be confirmed.');
      validate(before, after);
    };
    try {
      before = await this.windows(babyId, [date]);
      const actual = before.find((r) => r.id === expected.id);
      if (!actual || fingerprint(actual) !== fingerprint(expected))
        throw new NapperError(
          'conflict',
          'This activity changed in Napper. Refresh before removing it.',
        );
      validate(
        before,
        before.filter((r) => r.id !== expected.id),
      );
      await this.client.remove(babyId, String(expected.id));
      accepted = true;
      const after = await this.windows(babyId, [date]);
      confirm(after);
    } catch (error) {
      if (accepted || (error instanceof NapperError && error.code === 'uncertain')) {
        this.uncertain = { babyId, accountId, dates: [date], confirm };
        throw new NapperError(
          'uncertain',
          'Removal could not be confirmed. Refresh and review before making another change.',
        );
      }
      throw error;
    } finally {
      this.mutationInFlight = false;
    }
  }
  async start(babyId: string, side: Breast, at: Date = this.now()) {
    return this.mutate(babyId, async (logs) => {
      if (logs.some((log) => log.category === 'NURSING' && typeof log.isOpen !== 'boolean'))
        throw new NapperError(
          'conflict',
          'A feed has an unknown running state. Review it before starting another.',
        );
      if (logs.some((log) => log.category === 'NURSING' && log.isOpen === true))
        throw new NapperError('conflict', 'A feed is already running. Open it instead.');
      const earliest = shiftCalendarDay(calendarDayForInstant(this.now(), this.timezone), -1);
      if (calendarDayForInstant(at, this.timezone) < earliest)
        throw new NapperError('invalid', 'A running feed must start today or yesterday.');
      const user = this.client.accountId;
      if (!user) throw new NapperError('auth', 'Sign in again.');
      return startNapperNursing(`LOG_${this.newId()}_NURSING`, side, user, at, this.now());
    });
  }
  async change(babyId: string, expected: WireLog, command: NursingCommand) {
    const at = this.now();
    return this.mutate(babyId, async (logs) =>
      changeNapperNursing(this.checked(logs, expected), command, at),
    );
  }
  async correct(
    babyId: string,
    expected: WireLog,
    start: Date,
    end: Date,
    left: number,
    last: Breast,
  ) {
    return this.mutate(
      babyId,
      async (logs) =>
        correctNapperNursing(this.checked(logs, expected), start, end, left, last, this.now()),
      calendarDayForInstant(new Date(String(expected.start)), this.timezone),
    );
  }
  private checked(logs: WireLog[], expected: WireLog) {
    const actual = logs.find((log) => log.id === expected.id);
    if (!actual || fingerprint(actual) !== fingerprint(expected))
      throw new NapperError(
        'conflict',
        'This feed changed in Napper. Refresh and review its current record.',
      );
    return readNursing(actual);
  }
  private async mutate(
    babyId: string,
    create: (logs: WireLog[]) => Promise<WireLog>,
    date?: string,
  ): Promise<MutationResult> {
    if (this.mutationInFlight)
      throw new NapperError('conflict', 'A change is already being saved.');
    if (this.uncertain?.babyId === babyId && this.uncertain.accountId === this.client.accountId)
      throw new NapperError(
        'uncertain',
        'Refresh to check the previous save before making another change.',
      );
    this.mutationInFlight = true;
    const accountId = this.client.accountId;
    try {
      const logs = date ? await this.history(babyId, date) : await this.current(babyId);
      const request = nursingRequest(await create(logs));
      const resultDate = calendarDayForInstant(new Date(String(request.start)), this.timezone);
      const confirm = (saved: WireLog[]) => {
        const actual = saved.find((log) => log.id === request.id);
        if (!actual || !matchesNursingWrite(actual, request))
          throw new NapperError('uncertain', 'The updated feed is not yet confirmed.');
      };
      const pending = {
        babyId,
        accountId,
        dates: date ? [date, resultDate] : [resultDate],
        confirm,
      };
      try {
        await this.client.put(babyId, request);
      } catch (error) {
        if (error instanceof NapperError && error.code === 'uncertain') this.uncertain = pending;
        throw error;
      }
      try {
        const saved = date ? await this.history(babyId, resultDate) : await this.current(babyId);
        confirm(saved);
        const current = date ? await this.current(babyId) : saved;
        return { logs: saved, current, source: date ? 'day' : 'current', date: resultDate };
      } catch {
        this.uncertain = pending;
        throw new NapperError(
          'uncertain',
          'Napper accepted the change, but its updated record could not be loaded. Refresh to check it.',
        );
      }
    } finally {
      this.mutationInFlight = false;
    }
  }
}
export function mergeLogs(previous: WireLog[], today: WireLog[]): WireLog[] {
  const merged = new Map<string, WireLog>();
  for (const log of [...previous, ...today]) {
    const id = String(log.id);
    const stored = merged.get(id);
    const old = Date.parse(String(stored?.updatedAt));
    const latest = Date.parse(String(log.updatedAt));
    if (!stored || !Number.isFinite(old) || !Number.isFinite(latest) || latest >= old)
      merged.set(id, log);
  }
  return [...merged.values()].sort(
    (a, b) => Date.parse(String(a.start)) - Date.parse(String(b.start)),
  );
}

export interface MutationResult {
  logs: WireLog[];
  current: WireLog[];
  source: 'day' | 'current';
  date: string;
}
export function matchesNursingWrite(actual: WireLog, request: WireLog): boolean {
  const timestamp = (value: unknown) =>
    typeof value === 'number' ? value : Date.parse(String(value));
  const pauses = (log: WireLog) =>
    readNursing(log).pauses.map((p) => ({
      start: p.start,
      end: p.end,
      breast: p.wire.breast ?? null,
    }));
  try {
    return (
      actual.id === request.id &&
      timestamp(actual.start) === timestamp(request.start) &&
      timestamp(actual.end) === timestamp(request.end) &&
      actual.isOpen === request.isOpen &&
      actual.activeBreast === request.activeBreast &&
      (actual.breastLeftMinutes ?? 0) === (request.breastLeftMinutes ?? 0) &&
      (actual.breastRightMinutes ?? 0) === (request.breastRightMinutes ?? 0) &&
      fingerprint(pauses(actual)) === fingerprint(pauses(request))
    );
  } catch {
    return false;
  }
}
/** Verify requested writable fields, allowing the server to add unrelated read metadata. */
export function matchesCareWrite(actual: WireLog, request: WireLog): boolean {
  if (request.category === 'NURSING') return matchesNursingWrite(actual, request);
  return Object.keys(request).every((key) => {
    if (key === 'start' || key === 'end')
      return Date.parse(String(actual[key])) === Date.parse(String(request[key]));
    return fingerprint(actual[key] ?? null) === fingerprint(request[key] ?? null);
  });
}
