import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMobileDiagnostics } from './mobile-diagnostics';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('switches the live sink, drops old observations and restores the saved setting on restart', async () => {
  let stored: string | null = null;
  const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
  const openApp = () =>
    createMobileDiagnostics(
      {
        read: async () => stored,
        write: async (value) => {
          stored = value;
        },
      },
      { platform: 'android', randomId: randomUUID, fetcher },
    );
  const app = openApp();
  const client = app.telemetry;
  await app.load();
  client.start('sync.save')('ok');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fetcher).not.toHaveBeenCalled();

  await app.save({ endpoint: 'https://old.example.test:4320', verbose: false });
  client.start('sync.save')('ok');
  const oldOperation = client.start('sync.verify');
  await app.save({ endpoint: ' https://new.example.test:4320/ ', verbose: true });
  oldOperation('ok');
  client.start('sync.read')('ok');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://new.example.test:4320/v1/logs',
    'https://new.example.test:4320/v1/traces',
  ]);
  const logs = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(
    logs.resourceLogs[0].scopeLogs[0].logRecords.map(
      (record: { body: { stringValue: string } }) => record.body.stringValue,
    ),
  ).toEqual(['sync.read']);

  const restarted = openApp();
  expect(await restarted.load()).toEqual({
    endpoint: 'https://new.example.test:4320',
    verbose: true,
  });
  restarted.telemetry.start('sync.save')('ok');
  await restarted.save({ endpoint: '', verbose: true });
  restarted.telemetry.start('sync.save')('ok');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await openApp().load()).endpoint).toBe('');
});
