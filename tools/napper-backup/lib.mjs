import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const API_BASE = 'https://api.napper.app';
export const DEFAULT_FROM = '2000-01-01';

const RANGE_SPLIT_STATUSES = new Set([400, 413, 414, 422]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_IN_TEXT_PATTERN = /\d{4}-\d{2}-\d{2}/g;

export class NapperHttpError extends Error {
  constructor(status, method, pathname, body) {
    super(`${method} ${pathname} failed with HTTP ${status}`);
    this.name = 'NapperHttpError';
    this.status = status;
    this.method = method;
    this.pathname = pathname;
    this.body = body;
  }
}

export function normalizeDate(value, name = 'date') {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`${name} must use YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} is not a valid calendar date`);
  }

  return value;
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(date, amount) {
  const parsed = new Date(`${normalizeDate(date)}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(from, to) {
  const start = new Date(`${normalizeDate(from, 'from')}T00:00:00Z`);
  const end = new Date(`${normalizeDate(to, 'to')}T00:00:00Z`);
  return Math.floor((end.valueOf() - start.valueOf()) / 86_400_000) + 1;
}

export function midpointDate(from, to) {
  const span = daysBetweenInclusive(from, to);
  return addDays(from, Math.floor((span - 1) / 2));
}

export function collectIsoDates(value, result = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(DATE_IN_TEXT_PATTERN)) {
      try {
        result.add(normalizeDate(match[0]));
      } catch {
        // Ignore date-looking strings that are not real dates.
      }
    }
    return result;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectIsoDates(entry, result);
    }
    return result;
  }

  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      collectIsoDates(key, result);
      collectIsoDates(entry, result);
    }
  }

  return result;
}

export function extractLogs(value) {
  const arrays = [];

  function visit(node) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }

    for (const [key, entry] of Object.entries(node)) {
      if (key.toLowerCase() === 'logs' && Array.isArray(entry)) {
        arrays.push(entry);
      } else {
        visit(entry);
      }
    }
  }

  visit(value);

  if (arrays.length === 0 && Array.isArray(value?.item)) {
    return value.item;
  }

  return arrays.flat();
}

export function extractLogIds(value) {
  const ids = new Set();
  for (const log of extractLogs(value)) {
    if (!log || typeof log !== 'object') continue;
    const candidate = log.id ?? log.logId ?? log.uuid;
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      ids.add(String(candidate));
    }
  }
  return ids;
}

export function extractAuthTokens(value) {
  const root = value?.item ?? value;
  const rawIdToken = root?.idToken;
  const rawRefreshToken = root?.refreshToken;
  const idToken =
    typeof rawIdToken === 'string'
      ? rawIdToken
      : typeof rawIdToken?.token === 'string'
        ? rawIdToken.token
        : null;
  const refreshToken =
    typeof rawRefreshToken === 'string'
      ? rawRefreshToken
      : typeof rawRefreshToken?.token === 'string'
        ? rawRefreshToken.token
        : null;

  return { idToken, refreshToken };
}

export function findBabyCandidates(value) {
  const candidates = [];
  const seen = new Set();

  function visit(node) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }

    const id = node.id ?? node.babyId;
    const name = node.name ?? node.firstName ?? node.displayName;
    if (typeof id === 'string' && (typeof name === 'string' || 'birthDate' in node)) {
      const key = `${id}:${String(name ?? '')}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ id, name: typeof name === 'string' ? name : null });
      }
    }

    for (const entry of Object.values(node)) {
      visit(entry);
    }
  }

  visit(value);
  return candidates;
}

export function groupDatesByMonth(dates) {
  const groups = new Map();
  for (const date of [...dates].sort()) {
    normalizeDate(date);
    const month = date.slice(0, 7);
    const current = groups.get(month) ?? [];
    current.push(date);
    groups.set(month, current);
  }
  return groups;
}

export function resolveBabyId(babiesResponse, { babyId, babyName } = {}) {
  if (babyId) return babyId;

  const candidates = findBabyCandidates(babiesResponse);
  if (babyName) {
    const wanted = babyName.trim().toLocaleLowerCase();
    const exact = candidates.filter(
      (candidate) => candidate.name?.trim().toLocaleLowerCase() === wanted,
    );
    if (exact.length === 1) return exact[0].id;

    const partial = candidates.filter((candidate) =>
      candidate.name?.toLocaleLowerCase().includes(wanted),
    );
    if (partial.length === 1) return partial[0].id;

    throw new Error(
      `Could not uniquely resolve baby name '${babyName}'. Set --baby-id or NAPPER_BABY_ID.`,
    );
  }

  if (candidates.length === 1) return candidates[0].id;

  throw new Error('Could not uniquely resolve the baby. Set --baby-id or NAPPER_BABY_ID.');
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function loadAuthFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    return extractAuthTokens(JSON.parse(content));
  } catch (error) {
    if (error?.code === 'ENOENT') return { idToken: null, refreshToken: null };
    throw error;
  }
}

export async function saveAuthFile(filePath, tokens) {
  if (!tokens.idToken) throw new Error('Refusing to save auth without an ID token');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeJson(filePath, {
    idToken: tokens.idToken,
    refreshToken: tokens.refreshToken ?? null,
  });
  await chmod(filePath, 0o600);
}

export class NapperClient {
  constructor({
    idToken,
    refreshToken,
    authFile,
    apiBase = API_BASE,
    fetchImpl = fetch,
    device = process.env.NAPPER_DEVICE ?? 'NapperBackup',
    version = process.env.NAPPER_VERSION ?? '6.71.0',
    language = process.env.NAPPER_LANGUAGE ?? 'en',
    locale = process.env.NAPPER_LOCALE ?? 'en-GB',
  } = {}) {
    this.idToken = idToken ?? null;
    this.refreshToken = refreshToken ?? null;
    this.authFile = authFile ?? null;
    this.apiBase = apiBase.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.device = device;
    this.version = version;
    this.language = language;
    this.locale = locale;
  }

  headers({ authenticated = true, json = false } = {}) {
    const headers = {
      Accept: 'application/json',
      Source: 'APP',
      Version: this.version,
      Device: this.device,
      Language: this.language,
      Locale: this.locale,
      'Local-Timestamp': new Date().toISOString(),
    };

    if (json) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      if (!this.idToken) throw new Error('No Napper ID token is available');
      headers.Authorization = `Bearer ${this.idToken}`;
    }

    return headers;
  }

  async rawRequest(pathname, init = {}, authenticated = true) {
    const method = init.method ?? 'GET';
    const response = await this.fetchImpl(`${this.apiBase}${pathname}`, {
      ...init,
      headers: {
        ...this.headers({
          authenticated,
          json: typeof init.body === 'string',
        }),
        ...(init.headers ?? {}),
      },
    });

    const bodyText = await response.text();
    let body = null;
    if (bodyText.length > 0) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText;
      }
    }

    if (!response.ok) {
      throw new NapperHttpError(response.status, method, pathname, body);
    }

    return body;
  }

  async request(pathname, init = {}) {
    try {
      return await this.rawRequest(pathname, init, true);
    } catch (error) {
      if (error instanceof NapperHttpError && error.status === 401 && this.refreshToken) {
        await this.refresh();
        return this.rawRequest(pathname, init, true);
      }
      throw error;
    }
  }

  get(pathname) {
    return this.request(pathname);
  }

  async login(email, otp) {
    const response = await this.rawRequest(
      '/auth/email-login',
      {
        method: 'POST',
        body: JSON.stringify({ email, otp, useDeviceId: false }),
      },
      false,
    );
    await this.acceptAuthResponse(response);
    return response;
  }

  async refresh() {
    if (!this.idToken || !this.refreshToken) {
      throw new Error('Both ID token and refresh token are required to refresh');
    }

    const response = await this.rawRequest('/auth/refresh-token', {
      method: 'POST',
      body: JSON.stringify({
        idToken: this.idToken,
        refreshToken: this.refreshToken,
      }),
    });
    await this.acceptAuthResponse(response);
    return response;
  }

  async acceptAuthResponse(response) {
    const tokens = extractAuthTokens(response);
    if (!tokens.idToken) {
      throw new Error('Napper auth response did not contain item.idToken.token');
    }

    this.idToken = tokens.idToken;
    this.refreshToken = tokens.refreshToken ?? this.refreshToken;

    if (this.authFile) {
      await saveAuthFile(this.authFile, {
        idToken: this.idToken,
        refreshToken: this.refreshToken,
      });
    }
  }
}

export async function discoverLogDates(client, babyId, from, to, outputDirectory) {
  normalizeDate(from, 'from');
  normalizeDate(to, 'to');
  if (from > to) throw new Error('from must not be later than to');

  const discovered = new Set();

  async function fetchRange(rangeFrom, rangeTo) {
    const query = new URLSearchParams({ from: rangeFrom, to: rangeTo });
    const pathname = `/days-with-logs/${encodeURIComponent(babyId)}?${query.toString()}`;

    try {
      const response = await client.get(pathname);
      await writeJson(path.join(outputDirectory, `${rangeFrom}_${rangeTo}.json`), response);
      for (const date of collectIsoDates(response)) {
        if (date >= rangeFrom && date <= rangeTo) discovered.add(date);
      }
    } catch (error) {
      if (
        error instanceof NapperHttpError &&
        RANGE_SPLIT_STATUSES.has(error.status) &&
        daysBetweenInclusive(rangeFrom, rangeTo) > 31
      ) {
        const middle = midpointDate(rangeFrom, rangeTo);
        await fetchRange(rangeFrom, middle);
        await fetchRange(addDays(middle, 1), rangeTo);
        return;
      }
      throw error;
    }
  }

  await fetchRange(from, to);
  return [...discovered].sort();
}

export async function mapLimit(values, limit, action) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be >= 1');

  const result = new Array(values.length);
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await action(values[index], index);
    }
  }

  const workerCount = Math.min(limit, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
}

export async function fileInventory(rootDirectory, excludedBasenames = new Set(['manifest.json'])) {
  const files = [];

  async function visit(directory) {
    for (const name of await readdir(directory)) {
      const fullPath = path.join(directory, name);
      const metadata = await stat(fullPath);
      if (metadata.isDirectory()) {
        await visit(fullPath);
      } else if (!excludedBasenames.has(name)) {
        const bytes = await readFile(fullPath);
        files.push({
          path: path.relative(rootDirectory, fullPath).split(path.sep).join('/'),
          bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
  }

  await visit(rootDirectory);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
