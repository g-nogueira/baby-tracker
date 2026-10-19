import {
  CareServiceError,
  type ActivityReference,
  type CareCommand,
  type CareProvider,
  type CareService,
  type CareSnapshot,
} from '@/features/care-service/contracts';
import { calendarDayForInstant } from '@/features/naps/calendar-day';
import type { NapperClient } from './client';
import { fingerprint, NapperError, type WireLog } from './contracts';
import { prepareCareWrites, validateCareSleep } from './care-commands';
import { sleepConflicts } from '@/features/care-service/sleep-conflicts';
import { instant, kindForCategory, readCareRecord } from './care-records';
import { NapperTracker } from './tracker';

interface Cached {
  profileId: string;
  wire: WireLog;
  fingerprint: string;
  revision: string;
}
/** Anti-corruption adapter: raw records/fingerprints never leave this provider implementation. */
export class NapperCareService implements CareService {
  private readonly revisions = new Map<string, Cached>();
  private readonly latest = new Map<string, Cached>();
  private writing = false;
  private generation = 0;
  constructor(
    private readonly tracker: NapperTracker,
    private readonly newId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}
  get needsRefresh() {
    return this.tracker.writeNeedsRefresh;
  }
  clear() {
    this.generation++;
    this.revisions.clear();
    this.latest.clear();
  }
  private async boundary<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof CareServiceError) throw error;
      if (error instanceof NapperError) throw new CareServiceError(error.code, error.message);
      throw new CareServiceError('network', 'The shared service could not be reached. Try again.');
    }
  }
  private snapshot(profileId: string, logs: WireLog[]): CareSnapshot {
    const result: CareSnapshot = { activities: [], issues: [] };
    for (const wire of logs) {
      const kind = kindForCategory(wire.category);
      if (!kind || wire.skipped === true) continue;
      const key = `${profileId}:${wire.id}`;
      const stamp = fingerprint(wire);
      let cached = this.latest.get(key);
      if (!cached || cached.fingerprint !== stamp || !this.revisions.has(cached.revision)) {
        cached = {
          profileId,
          wire: JSON.parse(JSON.stringify(wire)) as WireLog,
          fingerprint: stamp,
          revision: this.newId(),
        };
        this.latest.set(key, cached);
        this.revisions.set(cached.revision, cached);
      }
      try {
        const activity = readCareRecord(wire, cached.revision, this.now());
        if (activity) result.activities.push(activity);
      } catch (error) {
        result.issues.push({
          id: String(wire.id),
          message:
            error instanceof CareServiceError ? error.message : 'This activity could not be read.',
          blocksWrites: wire.isOpen !== false || kind === 'bedtime' || kind === 'wake-up',
        });
      }
    }
    for (const conflict of sleepConflicts(result.activities)) {
      // A missing anchor at the left edge of the window is not evidence of a collision.
      if (conflict.rule === 'waking-start' && conflict.ids.length === 1) continue;
      result.issues.push({
        id: conflict.key,
        message: conflict.message,
        // Keep records editable so a caregiver can repair a known, completed conflict.
        blocksWrites: false,
      });
    }
    // Retain bounded old revisions so an open draft cannot silently adopt a remote edit.
    while (this.revisions.size > 2048)
      this.revisions.delete(this.revisions.keys().next().value as string);
    while (this.latest.size > 2048) this.latest.delete(this.latest.keys().next().value as string);
    return result;
  }
  private expected(profileId: string, reference: ActivityReference): WireLog {
    const cached = this.revisions.get(reference.revision);
    if (!cached || cached.profileId !== profileId || cached.wire.id !== reference.id)
      throw new CareServiceError(
        'conflict',
        'This activity is no longer available for editing. Refresh its record.',
      );
    return cached.wire;
  }
  current(profileId: string) {
    return this.history(profileId, calendarDayForInstant(this.now(), this.tracker.timezone));
  }
  history(profileId: string, date: string) {
    return this.boundary(async () => {
      const generation = this.generation;
      const rows = await this.tracker.window(profileId, date);
      if (generation !== this.generation)
        throw new CareServiceError(
          'conflict',
          'The signed-in session changed. Refresh the selected profile.',
        );
      return this.snapshot(profileId, rows);
    });
  }
  reconcile(profileId: string) {
    return this.boundary(async () => {
      if (this.tracker.client.babyId !== profileId)
        throw new CareServiceError(
          'conflict',
          'The selected profile changed. Refresh before saving.',
        );
      await this.tracker.reconcile(profileId);
      return this.current(profileId);
    });
  }
  execute(profileId: string, command: CareCommand): Promise<void> {
    return this.boundary(async () => {
      if (this.tracker.client.babyId !== profileId)
        throw new CareServiceError(
          'conflict',
          'The selected profile changed. Refresh before saving.',
        );
      if (this.writing) throw new CareServiceError('conflict', 'A change is already being saved.');
      this.writing = true;
      try {
        const expected = 'expected' in command ? this.expected(profileId, command.expected) : null;
        if (command.type === 'remove-activity' && expected) {
          if (expected.category === 'BED_TIME')
            throw new CareServiceError(
              'invalid',
              'Bedtime cannot be removed separately. Edit its times instead.',
            );
          await this.tracker.remove(profileId, expected, (before, after) => {
            if (
              expected.category === 'NAP' ||
              expected.category === 'NIGHT_WAKING' ||
              expected.category === 'WOKE_UP'
            )
              validateCareSleep(before, after, [expected], this.now());
          });
        } else if (command.type === 'start-nursing') {
          await this.tracker.start(profileId, command.side, new Date(command.at));
        } else if (command.type === 'change-nursing' && expected) {
          await this.tracker.change(profileId, expected, command.command);
        } else if (command.type === 'correct-nursing' && expected) {
          await this.tracker.correct(
            profileId,
            expected,
            new Date(command.startedAt),
            new Date(command.endedAt),
            command.leftSeconds,
            command.lastBreast,
          );
        } else {
          const user = this.tracker.client.accountId;
          if (!user) throw new CareServiceError('auth', 'Sign in again.');
          const day = (value: string) =>
            calendarDayForInstant(new Date(instant(value)), this.tracker.timezone);
          const date =
            command.type === 'record-past'
              ? day(command.activity.startedAt)
              : command.type === 'edit-activity' && expected
                ? calendarDayForInstant(new Date(String(expected.start)), this.tracker.timezone)
                : calendarDayForInstant(this.now(), this.tracker.timezone);
          const additional =
            command.type === 'edit-activity'
              ? [day(command.startedAt), ...(command.endedAt ? [day(command.endedAt)] : [])]
              : command.type === 'record-past' &&
                  'endedAt' in command.activity &&
                  command.activity.endedAt !== undefined
                ? [day(command.activity.endedAt)]
                : [];
          // The tracker may replan the remaining steps after confirming a dependent write.
          const ids: string[] = [];
          await this.tracker.apply(
            profileId,
            date,
            (logs) => {
              let index = 0;
              return prepareCareWrites(
                logs,
                command,
                expected,
                this.now(),
                () => {
                  const id = ids[index] ?? this.newId();
                  ids[index++] = id;
                  return id;
                },
                user,
                this.tracker.timezone,
              );
            },
            additional,
            (before, saved, requests) => {
              if (
                requests.some((r) =>
                  ['BED_TIME', 'WOKE_UP', 'NAP', 'NIGHT_WAKING'].includes(String(r.category)),
                )
              )
                validateCareSleep(before, saved, requests, this.now());
            },
          );
        }
      } finally {
        this.writing = false;
      }
    });
  }
}

/** Session operations and data operations implement separate replaceable ports. */
export function napperProvider(
  client: NapperClient,
  newId: () => string,
  timezone: string,
  now: () => Date = () => new Date(),
): CareProvider {
  const care = new NapperCareService(new NapperTracker(client, newId, timezone, now), newId, now);
  const wrap = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      if (error instanceof NapperError) throw new CareServiceError(error.code, error.message);
      throw new CareServiceError('network', 'The sign-in service could not be reached. Try again.');
    }
  };
  return {
    name: 'Napper',
    care,
    session: {
      get selectedProfileId() {
        return client.babyId;
      },
      restore: () => wrap(() => client.restore()),
      sendCode: (email) => wrap(() => client.sendOtp(email)),
      login: (email, code) =>
        wrap(async () => {
          care.clear();
          await client.login(email, code);
        }),
      profiles: () => wrap(() => client.babies()),
      selectProfile: (id) =>
        wrap(async () => {
          if (client.babyId !== id) care.clear();
          await client.selectBaby(id);
        }),
      signOut: () =>
        wrap(async () => {
          care.clear();
          await client.signOut();
        }),
    },
  };
}
