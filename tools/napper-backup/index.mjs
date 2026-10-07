#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FROM,
  NapperClient,
  NapperHttpError,
  discoverLogDates,
  extractLogIds,
  extractLogs,
  fileInventory,
  groupDatesByMonth,
  loadAuthFile,
  mapLimit,
  normalizeDate,
  resolveBabyId,
  todayDate,
  writeJson,
} from './lib.mjs';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  return `Napper history backup

Usage:
  node tools/napper-backup/index.mjs [options]

Authentication (environment or ignored auth file):
  NAPPER_ID_TOKEN
  NAPPER_REFRESH_TOKEN
  NAPPER_EMAIL + NAPPER_OTP      one-time login; tokens are then saved to the auth file

Baby selection:
  --baby-id <id>                 or NAPPER_BABY_ID
  --baby-name <name>             resolves a unique baby returned by GET /babies

Backup options:
  --from <YYYY-MM-DD>            default: ${DEFAULT_FROM}
  --to <YYYY-MM-DD>              default: today
  --output <directory>           default: tools/napper-backup/backup-output/<timestamp>
  --auth-file <file>             default: tools/napper-backup/.napper-auth.json
  --concurrency <n>              default: 4
  --no-sleep-stats               skip derived per-day sleep stats
  --no-range-verification        skip logs-between-days verification
  --help

Optional request header overrides:
  NAPPER_DEVICE
  NAPPER_VERSION
  NAPPER_LANGUAGE
  NAPPER_LOCALE
`;
}

function parseArgs(argv) {
  const options = {
    babyId: process.env.NAPPER_BABY_ID ?? null,
    babyName: null,
    from: DEFAULT_FROM,
    to: todayDate(),
    output: null,
    authFile: process.env.NAPPER_AUTH_FILE ?? path.join(toolDirectory, '.napper-auth.json'),
    concurrency: 4,
    includeSleepStats: true,
    verifyRanges: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--no-sleep-stats') {
      options.includeSleepStats = false;
      continue;
    }

    if (argument === '--no-range-verification') {
      options.verifyRanges = false;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value after ${argument}`);
    }

    switch (argument) {
      case '--baby-id':
        options.babyId = next;
        break;
      case '--baby-name':
        options.babyName = next;
        break;
      case '--from':
        options.from = next;
        break;
      case '--to':
        options.to = next;
        break;
      case '--output':
        options.output = path.resolve(next);
        break;
      case '--auth-file':
        options.authFile = path.resolve(next);
        break;
      case '--concurrency':
        options.concurrency = Number(next);
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }

    index += 1;
  }

  normalizeDate(options.from, 'from');
  normalizeDate(options.to, 'to');
  if (options.from > options.to) {
    throw new Error('--from must not be later than --to');
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive integer');
  }

  if (!options.output) {
    const timestamp = new Date()
      .toISOString()
      .replaceAll(':', '-')
      .replace(/\.\d{3}Z$/, 'Z');
    options.output = path.join(toolDirectory, 'backup-output', timestamp);
  }

  return options;
}

function errorSummary(error) {
  if (error instanceof NapperHttpError) {
    return {
      status: error.status,
      method: error.method,
      path: error.pathname,
      message: error.message,
    };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

async function safeMetadataGet(client, pathname, filePath, warnings, label) {
  try {
    const response = await client.get(pathname);
    await writeJson(filePath, response);
    return response;
  } catch (error) {
    warnings.push({
      kind: 'metadata-request-failed',
      label,
      ...errorSummary(error),
    });
    return null;
  }
}

function difference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

async function verifyMonthlyRanges({
  client,
  babyId,
  dates,
  outputDirectory,
  dailyResponses,
  warnings,
}) {
  const groups = groupDatesByMonth(dates);
  let successfulRanges = 0;

  for (const [month, monthDates] of groups) {
    const from = monthDates[0];
    const to = monthDates.at(-1);
    const pathname = `/logs-between-days/${encodeURIComponent(babyId)}/${from}/${to}`;

    try {
      const response = await client.get(pathname);
      successfulRanges += 1;
      await writeJson(path.join(outputDirectory, `${month}.json`), response);

      const rangeIds = extractLogIds(response);
      const dailyIds = new Set();
      let dailyLogCount = 0;
      for (const date of monthDates) {
        const daily = dailyResponses.get(date);
        if (!daily) continue;
        dailyLogCount += extractLogs(daily).length;
        for (const id of extractLogIds(daily)) dailyIds.add(id);
      }

      if (rangeIds.size > 0 && dailyIds.size > 0) {
        const missingFromRange = difference(dailyIds, rangeIds);
        const onlyInRange = difference(rangeIds, dailyIds);
        if (missingFromRange.length > 0 || onlyInRange.length > 0) {
          warnings.push({
            kind: 'range-id-mismatch',
            month,
            dailyIds: dailyIds.size,
            rangeIds: rangeIds.size,
            missingFromRange,
            onlyInRange,
          });
        }
      } else {
        const rangeLogCount = extractLogs(response).length;
        if (rangeLogCount > 0 && dailyLogCount > 0 && rangeLogCount !== dailyLogCount) {
          warnings.push({
            kind: 'range-count-mismatch',
            month,
            dailyLogCount,
            rangeLogCount,
          });
        }
      }
    } catch (error) {
      warnings.push({
        kind: 'range-verification-failed',
        month,
        ...errorSummary(error),
      });
    }
  }

  return successfulRanges;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const fileAuth = await loadAuthFile(options.authFile);
  const idToken = process.env.NAPPER_ID_TOKEN ?? fileAuth.idToken;
  const refreshToken = process.env.NAPPER_REFRESH_TOKEN ?? fileAuth.refreshToken;

  const client = new NapperClient({
    idToken,
    refreshToken,
    authFile: options.authFile,
  });

  if (!client.idToken) {
    const email = process.env.NAPPER_EMAIL;
    const otp = process.env.NAPPER_OTP;
    if (!email || !otp) {
      throw new Error(
        'No Napper credentials found. Set NAPPER_ID_TOKEN (and preferably NAPPER_REFRESH_TOKEN), ' +
          'or set NAPPER_EMAIL and NAPPER_OTP for a one-time login.',
      );
    }

    await client.login(email, otp);
  }

  const warnings = [];
  const errors = [];
  const createdAt = new Date().toISOString();

  const metadataDirectory = path.join(options.output, 'metadata');
  const discoveryDirectory = path.join(metadataDirectory, 'days-with-logs');
  const logsDirectory = path.join(options.output, 'logs');
  const sleepStatsDirectory = path.join(options.output, 'sleep-stats');
  const rangesDirectory = path.join(options.output, 'ranges');

  const babies = await client.get('/babies');
  await writeJson(path.join(metadataDirectory, 'babies.json'), babies);

  const babyId = resolveBabyId(babies, {
    babyId: options.babyId,
    babyName: options.babyName,
  });

  const logsSummary = await safeMetadataGet(
    client,
    `/logs-summary/${encodeURIComponent(babyId)}`,
    path.join(metadataDirectory, 'logs-summary.json'),
    warnings,
    'logs-summary',
  );

  await safeMetadataGet(
    client,
    `/babies/${encodeURIComponent(babyId)}/routines`,
    path.join(metadataDirectory, 'routines.json'),
    warnings,
    'routines',
  );

  const dates = await discoverLogDates(
    client,
    babyId,
    options.from,
    options.to,
    discoveryDirectory,
  );

  if (dates.length === 0) {
    errors.push({
      kind: 'no-log-dates-discovered',
      message:
        'days-with-logs returned no usable YYYY-MM-DD dates, so completeness cannot be proven.',
    });
  }

  const dailyResponses = new Map();
  let sleepStatsFiles = 0;

  await mapLimit(dates, options.concurrency, async (date) => {
    const logPathname = `/logs-by-day/${encodeURIComponent(babyId)}/${date}`;
    try {
      const response = await client.get(logPathname);
      dailyResponses.set(date, response);
      await writeJson(path.join(logsDirectory, `${date}.json`), response);

      if (extractLogs(response).length === 0) {
        warnings.push({
          kind: 'discovered-day-without-extracted-logs',
          date,
          message:
            'The raw response was saved, but the generic validator did not find a `logs` array.',
        });
      }
    } catch (error) {
      errors.push({
        kind: 'daily-log-request-failed',
        date,
        ...errorSummary(error),
      });
      return;
    }

    if (!options.includeSleepStats) return;

    const sleepPathname = `/babies/${encodeURIComponent(babyId)}/sleep-stats/${date}`;
    try {
      const response = await client.get(sleepPathname);
      await writeJson(path.join(sleepStatsDirectory, `${date}.json`), response);
      sleepStatsFiles += 1;
    } catch (error) {
      warnings.push({
        kind: 'sleep-stats-request-failed',
        date,
        ...errorSummary(error),
      });
    }
  });

  let rangeFiles = 0;
  if (options.verifyRanges && dates.length > 0) {
    rangeFiles = await verifyMonthlyRanges({
      client,
      babyId,
      dates,
      outputDirectory: rangesDirectory,
      dailyResponses,
      warnings,
    });
  }

  const missingDailyFiles = dates.filter((date) => !dailyResponses.has(date));
  if (missingDailyFiles.length > 0) {
    errors.push({
      kind: 'missing-daily-files',
      count: missingDailyFiles.length,
      dates: missingDailyFiles,
    });
  }

  const files = await fileInventory(options.output);
  const extractedLogCount = [...dailyResponses.values()].reduce(
    (total, response) => total + extractLogs(response).length,
    0,
  );
  const uniqueLogIds = new Set();
  for (const response of dailyResponses.values()) {
    for (const id of extractLogIds(response)) uniqueLogIds.add(id);
  }

  const manifest = {
    format: 'napper-raw-backup',
    formatVersion: 1,
    createdAt,
    completedAt: new Date().toISOString(),
    apiBase: 'https://api.napper.app',
    babyId,
    requestedRange: {
      from: options.from,
      to: options.to,
    },
    counts: {
      discoveredDays: dates.length,
      dailyLogFiles: dailyResponses.size,
      sleepStatsFiles,
      rangeVerificationFiles: rangeFiles,
      extractedLogs: extractedLogCount,
      uniqueExtractedLogIds: uniqueLogIds.size,
      archivedFilesExcludingManifest: files.length,
    },
    validation: {
      ok: errors.length === 0,
      errors,
      warnings,
    },
    discovery: {
      dates,
    },
    metadata: {
      logsSummaryArchived: logsSummary !== null,
    },
    files,
  };

  await writeJson(path.join(options.output, 'manifest.json'), manifest);

  process.stdout.write(
    [
      `Backup written to ${options.output}`,
      `Baby: ${babyId}`,
      `Days: ${dates.length}`,
      `Extracted logs: ${extractedLogCount}`,
      `Validation: ${manifest.validation.ok ? 'OK' : 'FAILED'}`,
      `Warnings: ${warnings.length}`,
      `Errors: ${errors.length}`,
      '',
    ].join('\n'),
  );

  if (!manifest.validation.ok) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
