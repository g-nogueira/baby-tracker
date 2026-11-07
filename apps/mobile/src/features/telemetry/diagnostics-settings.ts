export type DiagnosticsSettings = {
  endpoint: string;
  verbose: boolean;
};

export const defaultDiagnosticsSettings: DiagnosticsSettings = { endpoint: '', verbose: false };

export interface DiagnosticsPreferences {
  load(): Promise<DiagnosticsSettings>;
  save(settings: DiagnosticsSettings): Promise<void>;
}

/** Keep credentials and signal paths out of the user-configured OTLP base URL. */
export function normalizeCollectorUrl(value: string): string | null {
  const endpoint = value.trim().replace(/\/+$/, '');
  if (!value.trim()) return '';
  const match = /^https:\/\/[a-z0-9][a-z0-9.-]*(?::([0-9]{1,5}))?(?:\/[a-z0-9_-]+)*$/i.exec(
    endpoint,
  );
  if (
    endpoint.length > 512 ||
    !match ||
    (match[1] !== undefined && (Number(match[1]) < 1 || Number(match[1]) > 65535)) ||
    /\/v1\/(logs|traces)$/i.test(endpoint)
  )
    return null;
  return endpoint;
}
