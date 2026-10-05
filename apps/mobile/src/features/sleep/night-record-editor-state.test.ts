import {
  editNightSleep,
  endNightSleep,
  resumeNightSleep,
  startNightSleep,
  startNightWaking,
} from '@baby-tracker/domain';
import { describe, expect, it } from 'vitest';
import {
  createNightRecordEditorState,
  nightRecordBoundariesForSave,
  nightRecordEditorChanged,
  nightRecordEditorError,
} from './night-record-editor-state';

let sequence = 0;
const context = (at: string) => ({
  childId: 'child',
  caregiverId: 'parent',
  deviceId: 'device',
  householdId: 'household',
  timezone: 'Europe/Lisbon',
  now: new Date(at),
  newId: () => `id-${++sequence}`,
});
const bedtime = startNightSleep(context('2026-08-15T20:00:00.123Z')).session;
const waking = startNightWaking(bedtime, context('2026-08-16T01:00:00.456Z')).session;
const asleepAgain = resumeNightSleep(waking, context('2026-08-16T01:20:00.789Z')).session;
const complete = endNightSleep(asleepAgain, context('2026-08-16T06:00:00.987Z')).session;
const now = new Date('2026-08-16T07:00:00Z');

describe('Night record editing', () => {
  it('opens active Night controls without proposing an end or a mutation', () => {
    const editor = createNightRecordEditorState(bedtime, null, 'active');
    expect(editor.mode).toBe('active');
    expect(editor.endedAt).toBeNull();
    expect(nightRecordEditorChanged(editor)).toBe(false);
    expect(nightRecordEditorError(editor, now)).toBeNull();
  });

  it('corrects active Bedtime while preserving the open phase and original snapshot', () => {
    const editor = {
      ...createNightRecordEditorState(waking),
      startedAt: new Date('2026-08-15T19:50:00Z'),
    };
    expect(nightRecordEditorChanged(editor)).toBe(true);
    expect(nightRecordEditorError(editor, now)).toBeNull();
    const result = editNightSleep(
      waking,
      nightRecordBoundariesForSave(editor),
      context(now.toISOString()),
    );
    expect(result.session.startedAt).toBe('2026-08-15T19:50:00.000Z');
    expect(result.session.status).toBe('active');
    expect(result.session.phases.at(-1)?.endedAt).toBeNull();
    expect(result.operation.baseVersion).toBe(waking.version);
    expect(waking.startedAt).toBe('2026-08-15T20:00:00.123Z');
  });

  it('edits the exact historical waking even when a later waking is active', () => {
    const nextWaking = startNightWaking(asleepAgain, context('2026-08-16T03:00:00Z')).session;
    const editor = {
      ...createNightRecordEditorState(nextWaking, waking.phases[1].id),
      startedAt: new Date('2026-08-16T00:55:00Z'),
      endedAt: new Date('2026-08-16T01:25:00Z'),
    };
    expect(editor.mode).toBe('edit');
    expect(nightRecordEditorError(editor, now)).toBeNull();
    const result = editNightSleep(
      nextWaking,
      nightRecordBoundariesForSave(editor),
      context(now.toISOString()),
    ).session;
    expect(result.phases[0].endedAt).toBe(result.phases[1].startedAt);
    expect(result.phases[1].endedAt).toBe(result.phases[2].startedAt);
    expect(result.phases[1].startedAt).toBe('2026-08-16T00:55:00.000Z');
    expect(result.phases.at(-1)?.startedAt).toBe('2026-08-16T03:00:00.000Z');
    expect(result.phases.at(-1)?.endedAt).toBeNull();
    expect(result.phases.map((phase) => phase.id)).toEqual(
      nextWaking.phases.map((phase) => phase.id),
    );
  });

  it('corrects an active waking start without ending it', () => {
    const editor = {
      ...createNightRecordEditorState(waking, waking.phases[1].id, 'active'),
      startedAt: new Date('2026-08-16T00:50:00Z'),
    };
    expect(nightRecordEditorError(editor, now)).toBeNull();
    const boundaries = nightRecordBoundariesForSave(editor);
    expect(boundaries[0].endedAt).toEqual(editor.startedAt);
    expect(boundaries[1].endedAt).toBeNull();
  });

  it('accepts normal millisecond timestamps when correcting just one outer bound', () => {
    const editor = {
      ...createNightRecordEditorState(complete),
      startedAt: new Date('2026-08-15T19:45:00Z'),
    };
    expect(nightRecordEditorError(editor, now)).toBeNull();
    const boundaries = nightRecordBoundariesForSave(editor);
    expect(boundaries.at(-1)?.endedAt).toEqual(new Date(complete.endedAt ?? ''));
    expect(boundaries[1].startedAt).toEqual(new Date(complete.phases[1].startedAt));
  });

  it.each([
    { startedAt: new Date('2026-08-16T01:10:00Z') },
    { endedAt: new Date('2026-08-16T01:10:00Z') },
    { endedAt: new Date('2026-08-17T06:00:00Z') },
    { startedAt: new Date(Number.NaN) },
  ])('rejects crossed phases, future and invalid bounds: %j', (change) => {
    expect(
      nightRecordEditorError({ ...createNightRecordEditorState(complete), ...change }, now),
    ).not.toBeNull();
  });

  it('rejects crossed neighbours on waking edits', () => {
    const editor = createNightRecordEditorState(complete, complete.phases[1].id);
    expect(
      nightRecordEditorError({ ...editor, startedAt: new Date('2026-08-15T19:00:00Z') }, now),
    ).not.toBeNull();
    expect(
      nightRecordEditorError({ ...editor, endedAt: new Date('2026-08-16T06:10:00Z') }, now),
    ).not.toBeNull();
  });

  it('rejects deleted, missing, and asleep-phase targets instead of opening another record', () => {
    expect(() =>
      createNightRecordEditorState({ ...complete, deletedAt: now.toISOString() }),
    ).toThrow();
    expect(() => createNightRecordEditorState(complete, 'missing')).toThrow('could not be found');
    expect(() => createNightRecordEditorState(complete, complete.phases[0].id)).toThrow(
      'could not be found',
    );
  });
});
