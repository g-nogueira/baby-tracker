import type { NapMutation, NapSession } from '@baby-tracker/domain';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  SleepOverlapError,
  SleepWriteConflictError,
  SQLiteSleepRepository,
} from '../sleep/sqlite-sleep-repository';

export class SQLiteNapRepository {
  private readonly sleepRepository: SQLiteSleepRepository;

  public constructor(database: SQLiteDatabase) {
    this.sleepRepository = new SQLiteSleepRepository(database);
  }

  public async listVisible(
    childId: string,
    dayStartedAt: string,
    nextDayStartedAt: string,
  ): Promise<NapSession[]> {
    const sessions = await this.sleepRepository.listVisible(
      childId,
      dayStartedAt,
      nextDayStartedAt,
      'nap',
    );
    return sessions.filter((session): session is NapSession => session.kind === 'nap');
  }

  public latestCompletedEnd(childId: string): Promise<string | null> {
    return this.sleepRepository.latestCompletedEnd(childId, 'nap');
  }

  public async active(childId: string): Promise<NapSession | null> {
    const session = await this.sleepRepository.active(childId);
    return session?.kind === 'nap' ? session : null;
  }

  public save(mutation: NapMutation): Promise<void> {
    return this.sleepRepository.save(mutation);
  }

  public pendingOperationCount(): Promise<number> {
    return this.sleepRepository.pendingOperationCount();
  }
}

export { SleepOverlapError as NapOverlapError, SleepWriteConflictError as NapWriteConflictError };
