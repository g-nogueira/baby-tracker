# Mobile sync diagnostics

Baby Tracker can send structured sync logs and matching OpenTelemetry spans to your LAN Collector. It is off until an HTTPS Collector URL is set in the mobile build. Saves, save verification, and failures are recorded when enabled; verbose mode also includes successful reads.

Events include the operation, outcome, duration, HTTP status when available, app version, and OS. Each log and its span share a random trace ID. They contain no care records, account or device IDs, request URLs, credentials, or raw error messages. The app batches diagnostics in memory, drops failed batches, and backs off for a minute after a failed export. Sync never waits for telemetry.

## Collector on the LAN

Copy [collector.baby-tracker.json](collector.baby-tracker.json) into the existing Collector Compose directory (`/data/services/otel-collector`). It adds a separate TLS listener and two pipelines, and uses the base configuration's `memory_limiter` processor. Add the following entries to the existing Collector service, keeping its current ports, mounts, environment, and command flags:

```yaml
# Append to command (keep the existing --config flag):
- --config=/etc/otelcol-contrib/baby-tracker.json

# Append to ports (substitute the Collector host's LAN IP if needed):
- "192.168.68.100:4320:4320/tcp"

# Append to volumes:
- ./collector.baby-tracker.json:/etc/otelcol-contrib/baby-tracker.json:ro
- ./baby-tracker-tls:/run/baby-tracker-otlp:ro
```

Put the certificate chain and key in `baby-tracker-tls/tls.crt` and `baby-tracker-tls/tls.key`. Use a LAN hostname that resolves to the host and matches a certificate trusted by the phones. Keep the key readable by the Collector and restrict access to it. Use the LAN firewall or Docker's forwarding firewall rules to allow TCP 4320 only from the phones or their trusted subnet. Keep the port out of public tunnels and router forwarding rules.

Set `BABY_TRACKER_OPENOBSERVE_OTLP_ENDPOINT` in the Collector container environment to the existing OpenObserve organization URL (e.g. `http://openobserve:5080/api/default`, without `/v1/logs` or `/v1/traces`). The fragment reuses the existing server-side `OPENOBSERVE_AUTH`. The phone only needs the Collector URL.

From the Collector Compose directory, run `docker compose config --services` if you need the service name. Validate the base config and fragment together before recreating the Collector. Substitute the service name and existing config path:

```sh
docker compose run --rm --no-deps <collector-service> validate \
  --config=<existing-config-path> \
  --config=/etc/otelcol-contrib/baby-tracker.json
docker compose up -d --no-deps <collector-service>
```

## Enable and verify on a phone

For local builds, set these variables in `apps/mobile/.env.local`. For EAS, set them as public variables in the `preview` environment (the preview build profile selects that environment). These values are embedded in the JS bundle.

```dotenv
EXPO_PUBLIC_BABY_TRACKER_OTLP_URL=https://collector.example.net:4320
EXPO_PUBLIC_BABY_TRACKER_TELEMETRY_VERBOSE=1
```

Use your Collector's LAN hostname. Rebuild with `npm run build:apk` for Android or your iOS build profile with the same variables. Allow local network access on iOS if prompted. On the same LAN, open the app and refresh history. In OpenObserve, look for `service.name` = `baby-tracker-mobile` in `baby_tracker_mobile_logs` and for its matching trace in `baby_tracker_mobile_traces`. With verbose mode off, refresh alone may not produce an event. Off the LAN, diagnostics may be dropped and care sync continues as usual.

To disable ingestion immediately, remove the dedicated port and config fragment from Compose and recreate the Collector. To stop mobile export attempts, remove `EXPO_PUBLIC_BABY_TRACKER_OTLP_URL` from the next build.

References: [OTLP/HTTP JSON](https://opentelemetry.io/docs/specs/otlp/), [OpenObserve OTLP ingestion](https://openobserve.ai/docs/ingestion/logs/otlp/), [EAS environment variables](https://docs.expo.dev/eas/environment-variables/usage/), [iOS local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).
