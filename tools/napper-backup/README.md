# Napper raw history backup

This tool creates a local, lossless archive of the Napper API data for one baby. It is intentionally separate from the Baby Tracker import path: backup first, validate it, and only then transform or import anything.

## What it archives

- `GET /babies`
- `GET /logs-summary/{babyId}`
- `GET /babies/{babyId}/routines`
- `GET /days-with-logs/{babyId}?from=...&to=...`
- `GET /logs-by-day/{babyId}/{YYYY-MM-DD}` for every discovered day
- `GET /babies/{babyId}/sleep-stats/{YYYY-MM-DD}` for every discovered day
- `GET /logs-between-days/{babyId}/{from}/{to}` once per month containing logs, for cross-checking

Every successful API response is written as raw JSON. The validator never replaces or normalizes the archived response.

The final `manifest.json` contains:

- requested and discovered date ranges;
- file counts;
- extracted log/event counts where the response shape can be recognized;
- SHA-256 for every archived file;
- hard validation errors and non-fatal warnings.

## Authentication

Do not commit Napper credentials or backup output.

The tool accepts an existing ID token and refresh token:

```bash
NAPPER_ID_TOKEN='...' \
NAPPER_REFRESH_TOKEN='...' \
NAPPER_BABY_ID='...' \
node tools/napper-backup/index.mjs
```

Alternatively, use an email plus an OTP already requested through Napper:

```bash
NAPPER_EMAIL='you@example.com' \
NAPPER_OTP='123456' \
NAPPER_BABY_ID='...' \
node tools/napper-backup/index.mjs
```

A successful email/OTP login writes the returned ID/refresh tokens to
`tools/napper-backup/.napper-auth.json` with mode `0600`. Future runs read that file and automatically call `/auth/refresh-token` after a `401`.

Environment variables override the auth file.

## Baby selection

Prefer the stable Napper baby ID:

```bash
NAPPER_BABY_ID='...' node tools/napper-backup/index.mjs
```

If the account has a uniquely named baby, name resolution can be used instead:

```bash
node tools/napper-backup/index.mjs --baby-name 'Example'
```

The tool deliberately does not contain any real child ID or credentials.

## Full backup

By default discovery starts at `2000-01-01` and ends today. This is intentionally much wider than Napper's likely data lifetime. The first request tries the whole range. If the API rejects a large range with a range-like `4xx`, the tool recursively splits it and archives each successful discovery response.

```bash
node tools/napper-backup/index.mjs \
  --baby-id '...' \
  --output /safe/path/napper-backup
```

For a known range:

```bash
node tools/napper-backup/index.mjs \
  --baby-id '...' \
  --from 2025-01-01 \
  --to 2026-10-07
```

Optional flags:

```text
--concurrency <n>          default 4
--no-sleep-stats          skip derived sleep-stat snapshots
--no-range-verification   skip monthly logs-between-days cross-checks
--auth-file <path>        use another ignored credential file
```

Request headers can be overridden with `NAPPER_DEVICE`, `NAPPER_VERSION`,
`NAPPER_LANGUAGE`, and `NAPPER_LOCALE`. The defaults mirror the API headers observed while reverse engineering Napper; the app version default is `6.71.0`.

## Output

Example layout:

```text
backup-output/<timestamp>/
├── manifest.json
├── metadata/
│   ├── babies.json
│   ├── logs-summary.json
│   ├── routines.json
│   └── days-with-logs/
│       └── <from>_<to>.json
├── logs/
│   └── YYYY-MM-DD.json
├── sleep-stats/
│   └── YYYY-MM-DD.json
└── ranges/
    └── YYYY-MM.json
```

`logs/*.json` is the canonical raw historical archive. `ranges/*.json` is a second API view used only to detect inconsistencies.

## Validation semantics

The command exits with:

- `0` when all discovered daily log responses were archived;
- `2` when the archive exists but completeness validation failed;
- `1` for authentication, request, configuration, or unexpected failures.

Sleep stats and monthly range verification are derived/secondary data. Their failures become warnings rather than making the primary log archive invalid.

A day reported by `days-with-logs` but missing from `logs-by-day` is a hard error.

## Tests

```bash
pnpm exec vitest run tools/napper-backup/lib.test.mjs
```

The repository-wide `pnpm check` also discovers the test.
