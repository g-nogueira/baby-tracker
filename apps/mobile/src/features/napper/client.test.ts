import { describe, expect, it, vi } from 'vitest';
import { NapperClient } from './client';
import type { CredentialStore, NapperCredentials } from './contracts';
const now = () => new Date('2026-10-13T10:00:00Z');
const credentials = (id = 'old'): NapperCredentials => ({
  idToken: id,
  refreshToken: `refresh-${id}`,
  accountId: 'test-parent',
  expiresAt: null,
  babyId: 'test-baby',
});
function memory(value: NapperCredentials | null = credentials()) {
  const store: CredentialStore = {
    load: vi.fn(async () => value),
    save: vi.fn(async (next) => {
      value = next;
    }),
  };
  return { store, get: () => value };
}
const auth = (id = 'new') => ({
  item: {
    idToken: { token: id, payload: { sub: 'test-parent', exp: 9999999999 } },
    refreshToken: { token: `refresh-${id}`, payload: {} },
  },
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
describe('Napper client', () => {
  it('uses captured OTP/login bodies and persists the token pair before accepting login', async () => {
    const mem = memory(null);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(auth()));
    const client = new NapperClient(mem.store, 'device-test', fetcher, now);
    await client.sendOtp('parent@example.test');
    await client.login('parent@example.test', '000000');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      email: 'parent@example.test',
      useDeviceId: false,
      source: 'APP',
      language: 'en',
    });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      email: 'parent@example.test',
      otp: '000000',
      useDeviceId: false,
    });
    expect(mem.get()?.idToken).toBe('new');
    expect(client.accountId).toBe('test-parent');
  });
  it('serializes one refresh across concurrent rejected reads and rotates both tokens', async () => {
    const mem = memory();
    const response = deferred<Response>();
    let refreshes = 0;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/auth/refresh-token')) {
        refreshes++;
        return response.promise;
      }
      return (init?.headers as Record<string, string> | undefined)?.Authorization === 'Bearer old'
        ? json({}, 401)
        : json({ items: [] });
    });
    const client = new NapperClient(mem.store, 'device', fetcher, now);
    await client.restore();
    const first = client.babies();
    const second = client.babies();
    await vi.waitFor(() => expect(refreshes).toBe(1));
    response.resolve(json(auth()));
    await Promise.all([first, second]);
    expect(refreshes).toBe(1);
    expect(mem.get()).toMatchObject({
      idToken: 'new',
      refreshToken: 'refresh-new',
      babyId: 'test-baby',
    });
  });
  it('does not revive credentials when sign-out races token refresh', async () => {
    const mem = memory();
    const response = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/auth/refresh-token') ? response.promise : json({}, 401),
    );
    const client = new NapperClient(mem.store, 'device', fetcher, now);
    await client.restore();
    const pending = client.babies();
    const rejection = expect(pending).rejects.toMatchObject({ code: 'auth' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await client.signOut();
    response.resolve(json(auth()));
    await rejection;
    expect(mem.get()).toBeNull();
    expect(client.accountId).toBeNull();
  });
  it('handles expiry on restore, profile choice, logout and a second app instance', async () => {
    const mem = memory({ ...credentials(), expiresAt: 1 });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(auth()))
      .mockResolvedValueOnce(
        json({
          items: [
            { type: 'BABY', id: 'test-baby', name: 'Example' },
            { type: 'PARENT', id: 'test-parent' },
          ],
        }),
      );
    const first = new NapperClient(mem.store, 'device', fetcher, now);
    await first.restore();
    expect(await first.babies()).toEqual([{ id: 'test-baby', name: 'Example' }]);
    await first.selectBaby('test-baby');
    const restarted = new NapperClient(mem.store, 'device', fetcher, now);
    expect(await restarted.restore()).toBe(true);
    expect(restarted.babyId).toBe('test-baby');
    await restarted.signOut();
    expect(mem.get()).toBeNull();
  });
  it('does not retry ambiguous writes or expose backend response bodies', async () => {
    const mem = memory();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ token: 'private', email: 'private' }, 500));
    const client = new NapperClient(mem.store, 'device', fetcher, now);
    await client.restore();
    await expect(client.put('test-baby', { id: 'LOG_test_NURSING' })).rejects.toMatchObject({
      code: 'uncertain',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(json({ message: 'private' }, 429));
    await expect(client.babies()).rejects.toMatchObject({ code: 'rate-limit' });
  });
  it('rejects invalid JSON, incomplete credentials and an unavailable credential store', async () => {
    const mem = memory(null);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not-json'))
      .mockResolvedValueOnce(json({ item: { idToken: 'private' } }))
      .mockResolvedValueOnce(json(auth()));
    const client = new NapperClient(mem.store, 'device', fetcher, now);
    await expect(client.login('x@example.test', '000000')).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(client.login('x@example.test', '000000')).rejects.toMatchObject({
      code: 'invalid',
    });
    vi.mocked(mem.store.save).mockRejectedValueOnce(new Error('Keychain failed'));
    await expect(client.login('x@example.test', '000000')).rejects.toThrow();
    expect(client.accountId).toBeNull();
  });
  it('cancels a hung request without returning a fake success', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const mem = memory();
    const client = new NapperClient(mem.store, 'device', fetcher, now);
    await client.restore();
    const request = client.babies();
    const rejection = expect(request).rejects.toMatchObject({ code: 'network' });
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    vi.useRealTimers();
  });
});

it('rejects a failed JSON envelope even when HTTP status is successful', async () => {
  const { store } = memory();
  const fetcher = vi.fn<typeof fetch>(async () =>
    json({ success: false, error: 'private server detail' }),
  );
  const client = new NapperClient(store, 'synthetic', fetcher, now);
  await client.restore();
  await expect(client.sendOtp('test@example.invalid')).rejects.toMatchObject({ code: 'invalid' });
  await expect(client.put('test-baby', { id: 'synthetic' })).rejects.toMatchObject({
    code: 'invalid',
  });
  await expect(client.today('test-baby')).rejects.toThrow('Napper could not complete the request.');
});
it('treats an unreadable write acknowledgment as uncertain rather than allowing a blind retry', async () => {
  const { store } = memory();
  const client = new NapperClient(store, 'synthetic', async () => new Response('not-json'), now);
  await client.restore();
  await expect(client.put('test-baby', { id: 'synthetic' })).rejects.toMatchObject({
    code: 'uncertain',
  });
});
