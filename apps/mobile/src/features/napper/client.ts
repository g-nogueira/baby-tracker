import {
  type CredentialStore,
  type NapperCredentials,
  NapperError,
  object,
  parseBabies,
  parseCredentials,
  parseLogs,
  type WireLog,
} from './contracts';

/** HTTP stays behind this adapter; credentials and response bodies never enter error messages. */
export class NapperClient {
  private credentials: NapperCredentials | null = null;
  private epoch = 0;
  private persistence: Promise<void> = Promise.resolve();
  private refreshInFlight: Promise<void> | null = null;
  constructor(
    private readonly store: CredentialStore,
    private readonly device: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async restore() {
    const epoch = this.epoch;
    const saved = await this.store.load();
    if (epoch === this.epoch) this.credentials = saved;
    return this.credentials !== null;
  }
  get accountId() {
    return this.credentials?.accountId ?? null;
  }
  get babyId() {
    return this.credentials?.babyId ?? null;
  }
  async selectBaby(babyId: string) {
    if (!this.credentials) throw this.authError();
    await this.accept({ ...this.credentials, babyId }, this.epoch);
  }
  async signOut() {
    this.epoch++;
    this.credentials = null;
    this.refreshInFlight = null;
    await this.persist(null);
  }
  async sendOtp(email: string) {
    await this.raw(
      '/auth/send-otp',
      'POST',
      { email, useDeviceId: false, source: 'APP', language: 'en' },
      null,
      false,
    );
  }
  async login(email: string, otp: string) {
    const epoch = ++this.epoch;
    this.refreshInFlight = null;
    const response = await this.raw(
      '/auth/email-login',
      'POST',
      { email, otp, useDeviceId: false },
      null,
      true,
    );
    await this.accept(parseCredentials(response), epoch);
  }
  async babies() {
    return parseBabies(await this.request('/babies'));
  }
  async today(babyId: string) {
    return parseLogs(
      await this.request(
        `/today/${encodeURIComponent(babyId)}/${encodeURIComponent(localTimestamp(this.now()))}`,
      ),
    );
  }
  async day(babyId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new NapperError('invalid', 'Choose a valid date.');
    return parseLogs(await this.request(`/logs-by-day/${encodeURIComponent(babyId)}/${date}`));
  }
  async put(babyId: string, log: WireLog) {
    await this.request(`/logs/${encodeURIComponent(babyId)}`, 'PUT', log);
  }
  private authError() {
    return new NapperError('auth', 'Sign in to Napper again.');
  }
  private async persist(value: NapperCredentials | null, epoch?: number) {
    const task = this.persistence.then(async () => {
      if (epoch === undefined || epoch === this.epoch) await this.store.save(value);
    });
    this.persistence = task.catch(() => undefined);
    await task;
  }
  private async accept(value: NapperCredentials, epoch: number) {
    if (epoch !== this.epoch) throw this.authError();
    await this.persist(value, epoch);
    if (epoch !== this.epoch) throw this.authError();
    this.credentials = value;
  }
  private async refresh(failedToken: string) {
    if (this.credentials?.idToken !== failedToken) return;
    if (this.refreshInFlight) return this.refreshInFlight;
    const epoch = this.epoch;
    const current = this.credentials;
    if (!current) throw this.authError();
    const task = (async () => {
      try {
        const response = await this.raw(
          '/auth/refresh-token',
          'POST',
          { idToken: current.idToken, refreshToken: current.refreshToken },
          current.idToken,
          true,
        );
        await this.accept({ ...parseCredentials(response), babyId: current.babyId }, epoch);
      } catch (error) {
        if (error instanceof NapperError && error.code === 'auth' && epoch === this.epoch)
          await this.signOut();
        throw error;
      }
    })();
    this.refreshInFlight = task;
    try {
      await task;
    } finally {
      if (this.refreshInFlight === task) this.refreshInFlight = null;
    }
  }
  private async request(path: string, method = 'GET', body?: WireLog) {
    let credentials = this.credentials;
    if (!credentials) throw this.authError();
    const epoch = this.epoch;
    if (
      credentials.expiresAt !== null &&
      credentials.expiresAt * 1000 - this.now().getTime() < 60000
    ) {
      await this.refresh(credentials.idToken);
      credentials = this.credentials;
      if (!credentials) throw this.authError();
    }
    try {
      const result = await this.raw(path, method, body, credentials.idToken, false);
      if (epoch !== this.epoch) throw this.authError();
      return result;
    } catch (error) {
      if (error instanceof NapperError && error.code === 'auth' && epoch === this.epoch) {
        await this.refresh(credentials.idToken);
        if (!this.credentials || epoch !== this.epoch) throw this.authError();
        const result = await this.raw(path, method, body, this.credentials.idToken, false);
        if (epoch !== this.epoch) throw this.authError();
        return result;
      }
      throw error;
    }
  }
  private async raw(
    path: string,
    method: string,
    body: object | undefined,
    token: string | null,
    authentication: boolean,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetcher(`https://api.napper.app${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Source: 'APP',
          Version: '6.71.0',
          Device: this.device,
          Language: 'en',
          Locale: 'en-GB',
          'Local-Timestamp': localTimestamp(this.now()),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (
        response.status === 401 ||
        response.status === 403 ||
        (authentication && response.status === 400)
      )
        throw this.authError();
      if (response.status === 429)
        throw new NapperError(
          'rate-limit',
          'Napper is receiving too many requests. Wait before refreshing.',
        );
      if (method === 'PUT' && response.status >= 500)
        throw new NapperError(
          'uncertain',
          'The save could not be confirmed. Refresh before trying another change.',
        );
      if (!response.ok)
        throw new NapperError(
          'invalid',
          'Napper could not complete the request. Refresh and try again.',
        );
      if (path === '/auth/send-otp') {
        // Sending a code is an acknowledgment, not a token/data response. A 2xx
        // may have plain text, a JSON scalar, or no body. Still honor explicit
        // JSON rejection envelopes without exposing their private error text.
        const text = await response.text();
        let acknowledgment: unknown;
        try {
          acknowledgment = JSON.parse(text);
        } catch {
          return null;
        }
        if (
          acknowledgment !== null &&
          typeof acknowledgment === 'object' &&
          !Array.isArray(acknowledgment) &&
          object(acknowledgment).success === false
        )
          throw new NapperError('invalid', 'Napper could not complete the request.');
        return null;
      }
      let result: unknown;
      try {
        const bodyText = await response.text();
        // Empty acknowledged writes are confirmed by the application's subsequent reread.
        if (!bodyText && method === 'PUT') return null;
        result = JSON.parse(bodyText);
        object(result);
      } catch {
        throw new NapperError(
          method === 'PUT' ? 'uncertain' : 'invalid',
          method === 'PUT'
            ? 'The save could not be confirmed. Refresh before trying another change.'
            : 'Napper returned an unsupported response.',
        );
      }
      if (object(result).success === false)
        throw new NapperError('invalid', 'Napper could not complete the request.');
      return result;
    } catch (error) {
      if (error instanceof NapperError) throw error;
      throw new NapperError(
        method === 'PUT' ? 'uncertain' : 'network',
        method === 'PUT'
          ? 'The save could not be confirmed. Refresh before trying another change.'
          : 'Could not reach Napper. Check your connection and try again.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
/** Matches Napper's offset-bearing date serialization rather than inventing a timezone field. */
export function localTimestamp(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const local = new Date(date.getTime() + offset * 60000).toISOString().slice(0, -1);
  const sign = offset >= 0 ? '+' : '-';
  const value = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
