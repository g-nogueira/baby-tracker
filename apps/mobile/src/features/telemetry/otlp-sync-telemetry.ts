import {
  type SyncOperation,
  type SyncOutcome,
  type SyncTelemetry,
  syncOperations,
  syncOutcomes,
} from './sync-telemetry';

const flushDelayMs = 2_000;
const backoffMs = 60_000;
const requestTimeoutMs = 5_000;
const queueLimit = 128;
const batchLimit = 24;
const noop = () => undefined;

interface Options {
  endpoint: string | undefined;
  verbose: boolean;
  platform: 'android' | 'ios';
  version?: string;
  randomId: () => string;
  fetcher?: typeof fetch;
  now?: () => number;
}

interface Observation {
  operation: SyncOperation;
  outcome: SyncOutcome;
  startedAt: number;
  endedAt: number;
  traceId: string;
  spanId: string;
  httpStatus?: number;
}

const attribute = (key: string, value: string | number) => ({
  key,
  value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
});
const nano = (milliseconds: number) => `${Math.trunc(milliseconds)}000000`;
const attributes = (event: Observation) => [
  attribute('sync.outcome', event.outcome),
  attribute('sync.duration_ms', event.endedAt - event.startedAt),
  ...(event.httpStatus === undefined
    ? []
    : [attribute('http.response.status_code', event.httpStatus)]),
];

/** A small best-effort OTLP/HTTP JSON sink for the LAN Collector. No record payloads. */
export function createOtlpSyncTelemetry(options: Options): SyncTelemetry | undefined {
  const endpoint = options.endpoint?.trim().replace(/\/+$/, '');
  // Require HTTPS and a base URL without user info, query parameters or fragments.
  if (
    !endpoint ||
    !/^https:\/\/[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?(?:\/[a-z0-9_-]+)*$/i.test(endpoint)
  )
    return undefined;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const resource = {
    attributes: [
      attribute('service.name', 'baby-tracker-mobile'),
      attribute('os.type', options.platform),
      ...(options.version && /^\d{1,4}(\.\d{1,4}){1,3}$/.test(options.version)
        ? [attribute('service.version', options.version)]
        : []),
    ],
  };
  const scope = { name: 'baby-tracker.sync' };
  const queue: Observation[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing = false;
  let nextAttempt = 0;

  const post = async (signal: 'logs' | 'traces', body: unknown) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetcher(`${endpoint}/v1/${signal}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };
  function schedule() {
    if (timer !== undefined || flushing || !queue.length) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        void flush();
      },
      Math.max(flushDelayMs, nextAttempt - now()),
    );
  }
  async function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    try {
      const batch = queue.splice(0, batchLimit);
      const logs = batch.map((event) => ({
        timeUnixNano: nano(event.endedAt),
        severityNumber: event.outcome === 'ok' ? 9 : event.outcome === 'pending' ? 13 : 17,
        body: { stringValue: event.operation },
        traceId: event.traceId,
        spanId: event.spanId,
        attributes: attributes(event),
      }));
      const spans = batch.map((event) => ({
        name: event.operation,
        traceId: event.traceId,
        spanId: event.spanId,
        kind: event.operation.startsWith('http.') ? 3 : 1,
        startTimeUnixNano: nano(event.startedAt),
        endTimeUnixNano: nano(event.endedAt),
        status: { code: event.outcome === 'ok' ? 1 : event.outcome === 'pending' ? 0 : 2 },
        attributes: attributes(event),
      }));
      const delivered = await Promise.all([
        post('logs', { resourceLogs: [{ resource, scopeLogs: [{ scope, logRecords: logs }] }] }),
        post('traces', { resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }] }),
      ]);
      if (!delivered.every(Boolean)) nextAttempt = now() + backoffMs;
    } catch {
      nextAttempt = now() + backoffMs;
    } finally {
      flushing = false;
      schedule();
    }
  }

  return {
    start(operation) {
      if (!syncOperations.includes(operation)) return noop;
      const startedAt = now();
      let finished = false;
      return (outcome, httpStatus) => {
        if (finished || !syncOutcomes.includes(outcome)) return;
        finished = true;
        if (
          !options.verbose &&
          outcome === 'ok' &&
          (operation === 'http.read' || operation === 'sync.read')
        )
          return;
        try {
          const traceId = options.randomId().replaceAll('-', '').toLowerCase();
          const spanId = options.randomId().replaceAll('-', '').slice(0, 16).toLowerCase();
          if (!/^[0-9a-f]{32}$/.test(traceId) || !/^[0-9a-f]{16}$/.test(spanId)) return;
          if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return;
          if (queue.length >= queueLimit) queue.shift();
          queue.push({
            operation,
            outcome,
            startedAt,
            endedAt: Math.max(startedAt, now()),
            traceId,
            spanId,
            httpStatus:
              httpStatus !== undefined &&
              Number.isInteger(httpStatus) &&
              httpStatus >= 100 &&
              httpStatus <= 599
                ? httpStatus
                : undefined,
          });
          schedule();
        } catch {
          // Diagnostics must not interrupt care sync, including when random IDs are unavailable.
        }
      };
    },
  };
}
