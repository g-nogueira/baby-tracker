import { toUtcInstant } from './time';
import type { MutationContext, UtcInstant } from './types';

export type DiaperType = 'dry' | 'wet' | 'dirty' | 'mixed';

export interface CareEventDataByKind {
  diaper: Readonly<{ diaperType: DiaperType }>;
  medicine: Readonly<{ note: string }>;
}

export type CareEventKind = keyof CareEventDataByKind;

interface CareEventBase<K extends CareEventKind> {
  id: string;
  childId: string;
  kind: K;
  occurredAt: UtcInstant;
  data: CareEventDataByKind[K];
  timezone: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  deletedAt: UtcInstant | null;
}

export type CareEventOfKind<K extends CareEventKind> = CareEventBase<K>;
export type DiaperCareEvent = CareEventOfKind<'diaper'>;
export type MedicineCareEvent = CareEventOfKind<'medicine'>;
export type CareEvent = {
  [K in CareEventKind]: CareEventOfKind<K>;
}[CareEventKind];

export type CareEventAction =
  | 'create_care_event'
  | 'edit_care_event'
  | 'delete_care_event'
  | 'restore_care_event';

interface CareEventOperationBase {
  operationId: string;
  entityId: string;
  entityType: 'care_event';
  baseVersion: number | null;
  clientOccurredAt: UtcInstant;
  clientTimezone: string;
}

type CareEventWritePayload<K extends CareEventKind> = Readonly<{
  kind: K;
  occurredAt: UtcInstant;
  data: CareEventDataByKind[K];
}>;

type CareEventWriteOperation<K extends CareEventKind> = CareEventOperationBase & {
  action: 'create_care_event' | 'edit_care_event';
  payload: CareEventWritePayload<K>;
};

type CareEventTombstoneOperation = CareEventOperationBase & {
  action: 'delete_care_event' | 'restore_care_event';
  payload: Readonly<Record<string, never>>;
};

export type CareEventOperationOfKind<K extends CareEventKind> =
  | CareEventWriteOperation<K>
  | CareEventTombstoneOperation;

export type CareEventOperation = {
  [K in CareEventKind]: CareEventOperationOfKind<K>;
}[CareEventKind];

export interface CareEventMutationOfKind<K extends CareEventKind> {
  event: CareEventOfKind<K>;
  operation: CareEventOperationOfKind<K>;
}

export type CareEventMutation = {
  [K in CareEventKind]: CareEventMutationOfKind<K>;
}[CareEventKind];

export interface CareEventEdit<K extends CareEventKind> {
  occurredAt: Date;
  data: CareEventDataByKind[K];
}

export type CareEventErrorCode =
  | 'deleted_event'
  | 'future_occurrence'
  | 'invalid_event'
  | 'invalid_transition';

export class CareEventError extends Error {
  public constructor(
    public readonly code: CareEventErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CareEventError';
  }
}

export function createDiaperEvent(
  diaperType: DiaperType,
  context: MutationContext,
  occurredAt: Date = context.now,
): CareEventMutationOfKind<'diaper'> {
  return createCareEvent('diaper', { diaperType }, context, occurredAt);
}

export function createMedicineEvent(
  note: string,
  context: MutationContext,
  occurredAt: Date = context.now,
): CareEventMutationOfKind<'medicine'> {
  return createCareEvent('medicine', { note }, context, occurredAt);
}

export function editCareEvent<K extends CareEventKind>(
  event: CareEventOfKind<K>,
  edit: CareEventEdit<K>,
  context: MutationContext,
): CareEventMutationOfKind<K> {
  assertValidCareEvent(event);
  assertNotDeleted(event);
  const clientOccurredAt = toUtcInstant(context.now);
  const correctedOccurredAt = toUtcInstant(edit.occurredAt);
  assertNotFuture(correctedOccurredAt, clientOccurredAt);

  const updated: CareEventOfKind<K> = {
    ...event,
    occurredAt: correctedOccurredAt,
    data: edit.data,
    updatedBy: context.caregiverId,
    version: event.version + 1,
  };
  assertValidCareEvent(updated);
  return writeMutation(updated, context, clientOccurredAt, 'edit_care_event', event.version, {
    kind: updated.kind,
    occurredAt: correctedOccurredAt,
    data: updated.data,
  });
}

export function deleteCareEvent<TEvent extends CareEvent>(
  event: TEvent,
  context: MutationContext,
): CareEventMutationOfKind<TEvent['kind']> {
  assertValidCareEvent(event);
  if (event.deletedAt !== null) {
    throw new CareEventError('deleted_event', 'This care event is already deleted.');
  }
  const clientOccurredAt = toUtcInstant(context.now);
  const deleted: TEvent = {
    ...event,
    updatedBy: context.caregiverId,
    version: event.version + 1,
    deletedAt: clientOccurredAt,
  };
  assertValidCareEvent(deleted);
  return tombstoneMutation(deleted, context, clientOccurredAt, 'delete_care_event', event.version);
}

export function restoreCareEvent<TEvent extends CareEvent>(
  event: TEvent,
  context: MutationContext,
): CareEventMutationOfKind<TEvent['kind']> {
  assertValidCareEvent(event);
  if (event.deletedAt === null) {
    throw new CareEventError('invalid_transition', 'Only a deleted care event can be restored.');
  }
  const clientOccurredAt = toUtcInstant(context.now);
  const restored: TEvent = {
    ...event,
    updatedBy: context.caregiverId,
    version: event.version + 1,
    deletedAt: null,
  };
  assertValidCareEvent(restored);
  return tombstoneMutation(
    restored,
    context,
    clientOccurredAt,
    'restore_care_event',
    event.version,
  );
}

export function assertValidCareEvent(value: unknown): asserts value is CareEvent {
  if (!isRecord(value)) throw invalidEvent('A valid care event is required.');
  assertNonEmptyString(value.id, 'A care event identifier is required.');
  assertNonEmptyString(value.childId, 'A child identifier is required.');
  assertInstant(value.occurredAt, 'A valid care event occurrence time is required.');
  assertTimezone(value.timezone);
  assertNonEmptyString(value.createdBy, 'A care event creator is required.');
  assertNonEmptyString(value.updatedBy, 'A care event updater is required.');
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
    throw invalidEvent('A care event version must be a positive whole number.');
  }
  if (value.deletedAt !== null) {
    assertInstant(value.deletedAt, 'A valid care event deletion time is required.');
    if (new Date(value.deletedAt).getTime() < new Date(value.occurredAt).getTime()) {
      throw invalidEvent('A care event deletion cannot precede its occurrence.');
    }
  }

  if (!isRecord(value.data)) throw invalidEvent('Valid care event data is required.');
  if (value.kind === 'diaper') {
    const keys = Object.keys(value.data);
    if (keys.length !== 1 || keys[0] !== 'diaperType' || !isDiaperType(value.data.diaperType)) {
      throw invalidEvent('A diaper event requires exactly one valid diaper type.');
    }
    return;
  }
  if (value.kind === 'medicine') {
    const keys = Object.keys(value.data);
    if (
      keys.length !== 1 ||
      keys[0] !== 'note' ||
      typeof value.data.note !== 'string' ||
      value.data.note.trim().length === 0
    ) {
      throw invalidEvent('A medicine event requires a non-empty note.');
    }
    return;
  }
  throw invalidEvent('The care event kind is not supported.');
}

function createCareEvent<K extends CareEventKind>(
  kind: K,
  data: CareEventDataByKind[K],
  context: MutationContext,
  occurredAt: Date,
): CareEventMutationOfKind<K> {
  const clientOccurredAt = toUtcInstant(context.now);
  const selectedOccurredAt = toUtcInstant(occurredAt);
  assertNotFuture(selectedOccurredAt, clientOccurredAt);
  const event: CareEventOfKind<K> = {
    id: context.newId(),
    childId: context.childId,
    kind,
    occurredAt: selectedOccurredAt,
    data,
    timezone: context.timezone,
    createdBy: context.caregiverId,
    updatedBy: context.caregiverId,
    version: 1,
    deletedAt: null,
  };
  assertValidCareEvent(event);
  return writeMutation(event, context, clientOccurredAt, 'create_care_event', null, {
    kind,
    occurredAt: selectedOccurredAt,
    data,
  });
}

function writeMutation<K extends CareEventKind>(
  event: CareEventOfKind<K>,
  context: MutationContext,
  clientOccurredAt: UtcInstant,
  action: 'create_care_event' | 'edit_care_event',
  baseVersion: number | null,
  payload: CareEventWritePayload<K>,
): CareEventMutationOfKind<K> {
  return {
    event,
    operation: {
      operationId: context.newId(),
      entityId: event.id,
      entityType: 'care_event',
      action,
      baseVersion,
      clientOccurredAt,
      clientTimezone: context.timezone,
      payload,
    },
  };
}

function tombstoneMutation<TEvent extends CareEvent>(
  event: TEvent,
  context: MutationContext,
  clientOccurredAt: UtcInstant,
  action: 'delete_care_event' | 'restore_care_event',
  baseVersion: number,
): CareEventMutationOfKind<TEvent['kind']> {
  return {
    event,
    operation: {
      operationId: context.newId(),
      entityId: event.id,
      entityType: 'care_event',
      action,
      baseVersion,
      clientOccurredAt,
      clientTimezone: context.timezone,
      payload: {},
    },
  };
}

function assertNotDeleted(event: CareEvent): void {
  if (event.deletedAt !== null) {
    throw new CareEventError('deleted_event', 'A deleted care event cannot be edited.');
  }
}

function assertNotFuture(occurredAt: UtcInstant, clientOccurredAt: UtcInstant): void {
  if (new Date(occurredAt).getTime() > new Date(clientOccurredAt).getTime()) {
    throw new CareEventError('future_occurrence', 'A care event cannot occur in the future.');
  }
}

function assertInstant(value: unknown, message: string): asserts value is UtcInstant {
  if (typeof value !== 'string') throw invalidEvent(message);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw invalidEvent(message);
}

function assertTimezone(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw invalidEvent('A valid IANA timezone is required.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
  } catch {
    throw invalidEvent('A valid IANA timezone is required.');
  }
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw invalidEvent(message);
}

function isDiaperType(value: unknown): value is DiaperType {
  return value === 'dry' || value === 'wet' || value === 'dirty' || value === 'mixed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidEvent(message: string): CareEventError {
  return new CareEventError('invalid_event', message);
}
