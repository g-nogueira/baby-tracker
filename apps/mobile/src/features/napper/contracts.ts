/** Napper's observed wire schema; duration fields named Minutes actually contain seconds. */
export type Breast = 'LEFT' | 'RIGHT';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type WireLog = { [key: string]: Json };
export interface NapperBaby {
  id: string;
  name: string;
}
export interface NapperCredentials {
  idToken: string;
  refreshToken: string;
  accountId: string;
  expiresAt: number | null;
  babyId: string | null;
}
export interface CredentialStore {
  load(): Promise<NapperCredentials | null>;
  save(value: NapperCredentials | null): Promise<void>;
}
export class NapperError extends Error {
  constructor(
    public readonly code: 'auth' | 'network' | 'rate-limit' | 'invalid' | 'conflict' | 'uncertain',
    message: string,
  ) {
    super(message);
    this.name = 'NapperError';
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new NapperError('invalid', 'Napper returned an unsupported response.');
  return value as Record<string, unknown>;
}
export function parseCredentials(value: unknown): NapperCredentials {
  const root = object(value);
  const item = object(root.item ?? root);
  const id = object(item.idToken);
  const refresh = object(item.refreshToken);
  const payload = object(id.payload);
  if (
    typeof id.token !== 'string' ||
    !id.token ||
    typeof refresh.token !== 'string' ||
    !refresh.token ||
    typeof payload.sub !== 'string'
  )
    throw new NapperError('invalid', 'Napper returned an unsupported login response.');
  return {
    idToken: id.token,
    refreshToken: refresh.token,
    accountId: payload.sub,
    expiresAt: typeof payload.exp === 'number' ? payload.exp : null,
    babyId: null,
  };
}
export function parseBabies(value: unknown): NapperBaby[] {
  const items = object(value).items;
  if (!Array.isArray(items))
    throw new NapperError('invalid', 'Napper returned an unsupported profile list.');
  return items
    .filter((item) => object(item).type === 'BABY')
    .map((item) => {
      const baby = object(item);
      if (typeof baby.id !== 'string' || !baby.id)
        throw new NapperError('invalid', 'Napper returned an unsupported profile.');
      return { id: baby.id, name: typeof baby.name === 'string' ? baby.name : 'Baby' };
    });
}
export function parseLogs(value: unknown): WireLog[] {
  const root = object(value);
  const item = root.item;
  const entries = Array.isArray(item)
    ? item
    : item && typeof item === 'object'
      ? (object(item).logs ?? object(item).allLogs)
      : (root.logs ?? root.allLogs);
  if (!Array.isArray(entries))
    throw new NapperError('invalid', 'Napper returned an unsupported history response.');
  return entries.map((entry) => {
    const row = object(entry);
    if (
      typeof row.id !== 'string' ||
      typeof row.category !== 'string' ||
      typeof row.start !== 'string' ||
      !Number.isFinite(Date.parse(row.start))
    )
      throw new NapperError('invalid', 'Napper returned an unsupported activity.');
    return row as WireLog;
  });
}
/** Retains unknown read metadata when comparing edits; object key order is irrelevant. */
export function fingerprint(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${fingerprint(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
