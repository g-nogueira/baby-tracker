import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createOtlpSyncTelemetry } from './otlp-sync-telemetry';
import type { SyncOutcome } from './sync-telemetry';

const setup = (verbose = false, endpoint = 'https://collector.example.test:4320') => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
  const telemetry = createOtlpSyncTelemetry({
    endpoint,
    verbose,
    platform: 'android',
    version: '0.1.0',
    randomId: randomUUID,
    fetcher,
  });
  return { fetcher, telemetry };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T09:00:00Z'));
});
afterEach(() => vi.useRealTimers());

it.each([
  '',
  'http://collector.local',
  'https://user:secret@collector.local',
  'https://collector.local?token=secret',
  'https://collector.local/v1/logs/',
  'https://collector.local:65536',
])('disables export for an empty or unsafe endpoint', (endpoint) => {
  const { telemetry, fetcher } = setup(true, endpoint);
  expect(telemetry).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
});

it('exports a correlated OTLP log and span with only allowed fields', async () => {
  const { telemetry, fetcher } = setup(true);
  telemetry?.start('sync.save')('private error text' as SyncOutcome);
  const finish = telemetry?.start('http.read');
  vi.setSystemTime(new Date('2026-11-07T09:00:00.015Z'));
  finish?.('rate-limit', 429);
  finish?.('ok', 200);
  expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [[logsUrl, logsRequest], [tracesUrl, tracesRequest]] = fetcher.mock.calls;
  expect(logsUrl).toBe('https://collector.example.test:4320/v1/logs');
  expect(tracesUrl).toBe('https://collector.example.test:4320/v1/traces');
  expect(logsRequest?.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(logsRequest?.credentials).toBe('omit');
  const logEnvelope = JSON.parse(String(logsRequest?.body));
  const logs = logEnvelope.resourceLogs[0].scopeLogs[0].logRecords;
  const spans = JSON.parse(String(tracesRequest?.body)).resourceSpans[0].scopeSpans[0].spans;
  expect(logs).toHaveLength(1);
  expect(spans).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
    spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
    body: { stringValue: 'http.read' },
    severityNumber: 17,
    timeUnixNano: '1794042000015000000',
    attributes: [
      { key: 'sync.outcome', value: { stringValue: 'rate-limit' } },
      { key: 'sync.duration_ms', value: { intValue: '15' } },
      { key: 'http.response.status_code', value: { intValue: '429' } },
    ],
  });
  expect(spans[0]).toMatchObject({
    traceId: logs[0].traceId,
    spanId: logs[0].spanId,
    endTimeUnixNano: logs[0].timeUnixNano,
    status: { code: 2 },
  });
  expect(logEnvelope.resourceLogs[0].resource.attributes).toContainEqual({
    key: 'service.name',
    value: { stringValue: 'baby-tracker-mobile' },
  });
  expect(String(logsRequest?.body)).not.toContain('private error text');
});

it('only adds routine successful reads when verbose export is enabled', async () => {
  const { telemetry, fetcher } = setup();
  telemetry?.start('http.read')('ok', 200);
  telemetry?.start('sync.read')('ok');
  telemetry?.start('http.read')('network');
  telemetry?.start('sync.save')('ok');
  await vi.advanceTimersByTimeAsync(2_000);
  const request = fetcher.mock.calls[0][1];
  const logs = JSON.parse(String(request?.body)).resourceLogs[0].scopeLogs[0].logRecords;
  expect(logs.map((log: { body: { stringValue: string } }) => log.body.stringValue)).toEqual([
    'http.read',
    'sync.save',
  ]);
});

it('backs off a failed LAN export and drops old queued observations without replaying the failed batch', async () => {
  const { telemetry, fetcher } = setup(true);
  fetcher.mockRejectedValueOnce(new Error('LAN unavailable'));
  telemetry?.start('sync.save')('ok');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 200; i++) telemetry?.start('sync.verify')('pending');
  await vi.advanceTimersByTimeAsync(59_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(15_000);
  const retriedLogs = fetcher.mock.calls
    .slice(2)
    .filter(([url]) => String(url).endsWith('/v1/logs'))
    .flatMap(
      ([, request]) => JSON.parse(String(request?.body)).resourceLogs[0].scopeLogs[0].logRecords,
    );
  expect(retriedLogs).toHaveLength(128);
  expect(retriedLogs.every((record) => record.body.stringValue === 'sync.verify')).toBe(true);
});
