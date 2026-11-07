import {
  defaultDiagnosticsSettings,
  type DiagnosticsPreferences,
  type DiagnosticsSettings,
  normalizeCollectorUrl,
} from './diagnostics-settings';
import { createOtlpSyncTelemetry } from './otlp-sync-telemetry';
import type { SyncTelemetry } from './sync-telemetry';

type Storage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
};

/** Owns the current destination; changing it does not recreate the care provider. */
export function createMobileDiagnostics(
  storage: Storage,
  options: Omit<Parameters<typeof createOtlpSyncTelemetry>[0], keyof DiagnosticsSettings>,
): DiagnosticsPreferences & { telemetry: SyncTelemetry } {
  let settings = defaultDiagnosticsSettings;
  let exporter: ReturnType<typeof createOtlpSyncTelemetry>;
  let loading: Promise<void> | undefined;
  let writes = Promise.resolve();
  const apply = (next: DiagnosticsSettings) => {
    if (next.endpoint === settings.endpoint && next.verbose === settings.verbose) return;
    exporter?.dispose();
    exporter = createOtlpSyncTelemetry({ ...options, ...next });
    settings = next;
  };
  const initialize = () => {
    loading ??= storage
      .read()
      .then((raw) => {
        if (!raw) return;
        const stored = JSON.parse(raw);
        const endpoint =
          typeof stored?.endpoint === 'string' ? normalizeCollectorUrl(stored.endpoint) : null;
        if (endpoint === null) return;
        apply({ endpoint, verbose: stored.verbose === true });
      })
      .catch((error) => {
        loading = undefined;
        throw error;
      });
    return loading;
  };
  return {
    telemetry: { start: (operation) => exporter?.start(operation) ?? (() => undefined) },
    async load() {
      await initialize();
      return { ...settings };
    },
    async save(next) {
      const endpoint = normalizeCollectorUrl(next.endpoint);
      if (endpoint === null) throw new Error('Invalid Collector URL');
      const normalized = { endpoint, verbose: next.verbose };
      const write = writes.then(async () => {
        // A successful save can also recover from unreadable settings.
        await initialize().catch(() => undefined);
        await storage.write(JSON.stringify(normalized));
        apply(normalized);
        loading = Promise.resolve();
      });
      writes = write.catch(() => undefined);
      await write;
    },
  };
}
