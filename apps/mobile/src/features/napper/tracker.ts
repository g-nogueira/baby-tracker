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

/** Application boundary: remote truth is reread before/after every mutation; no local outbox. */
export class NapperTracker {
  private mutationInFlight = false;
  private uncertain: { babyId: string; accountId: string | null; request: WireLog } | null = null;
  constructor(
    public readonly client: NapperClient,
    private readonly newId: () => string,
    public readonly timezone: string,
    private readonly now: () => Date = () => new Date(),
  ) {}
  get writeNeedsRefresh() {
    return (
      this.uncertain?.accountId === this.client.accountId &&
      this.uncertain?.babyId === this.client.babyId
    );
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
  async reconcile(babyId: string) {
    const logs = await this.current(babyId);
    if (this.uncertain?.babyId === babyId && this.uncertain.accountId === this.client.accountId) {
      await this.history(
        babyId,
        calendarDayForInstant(new Date(String(this.uncertain.request.start)), this.timezone),
      );
      this.uncertain = null;
    }
    return logs;
  }
  async start(babyId: string, side: Breast, at: Date = this.now()) {
    return this.mutate(babyId, async (logs) => {
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
    try {
      const logs = date ? await this.history(babyId, date) : await this.current(babyId);
      const request = nursingRequest(await create(logs));
      try {
        await this.client.put(babyId, request);
      } catch (error) {
        if (error instanceof NapperError && error.code === 'uncertain')
          this.uncertain = { babyId, accountId: this.client.accountId, request };
        throw error;
      }
      try {
        const resultDate = calendarDayForInstant(new Date(String(request.start)), this.timezone);
        const saved = date ? await this.history(babyId, resultDate) : await this.current(babyId);
        const actual = saved.find((log) => log.id === request.id);
        if (!actual || !matchesNursingWrite(actual, request))
          throw new NapperError('uncertain', 'The updated feed is not yet confirmed.');
        const current = date ? await this.current(babyId) : saved;
        return { logs: saved, current, source: date ? 'day' : 'current', date: resultDate };
      } catch {
        this.uncertain = { babyId, accountId: this.client.accountId, request };
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
