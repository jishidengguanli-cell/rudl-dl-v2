import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { D1Database } from '@cloudflare/workers-types';
import { fetchDistributionById } from '@/lib/distribution';
import { getStatsTableName } from '@/lib/downloads';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type Frequency = 'year' | 'month' | 'day' | 'hour' | 'minute';

type StatsPoint = { bucket: string; apk: number; ipa: number; total: number };

const jsonError = (error: string, status = 400) =>
  NextResponse.json({ ok: false, error }, { status });

const parseUid = (req: Request): string | null => {
  const cookie = req.headers.get('cookie') ?? '';
  const entry = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='));
  if (!entry) return null;
  return entry.slice(4);
};

const clampInterval = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(240, Math.max(1, Math.floor(value)));
};

const startOfDayUTC = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const formatDayKey = (date: Date) => startOfDayUTC(date).toISOString().slice(0, 10);

const alignTimestamp = (ms: number, frequency: Frequency, minuteInterval: number) => {
  const date = new Date(ms);
  switch (frequency) {
    case 'year': {
      date.setUTCMonth(0, 1);
      date.setUTCHours(0, 0, 0, 0);
      break;
    }
    case 'month': {
      date.setUTCDate(1);
      date.setUTCHours(0, 0, 0, 0);
      break;
    }
    case 'day': {
      date.setUTCHours(0, 0, 0, 0);
      break;
    }
    case 'hour': {
      date.setUTCMinutes(0, 0, 0);
      break;
    }
    case 'minute': {
      const step = clampInterval(minuteInterval);
      const minutes = date.getUTCMinutes();
      const floored = Math.floor(minutes / step) * step;
      date.setUTCMinutes(floored, 0, 0);
      break;
    }
    default: {
      date.setUTCHours(0, 0, 0, 0);
    }
  }
  return date.getTime();
};

const incrementTimestamp = (ms: number, frequency: Frequency, minuteInterval: number) => {
  const date = new Date(ms);
  switch (frequency) {
    case 'year': {
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      break;
    }
    case 'month': {
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    }
    case 'day': {
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    }
    case 'hour': {
      date.setUTCHours(date.getUTCHours() + 1);
      break;
    }
    case 'minute': {
      const step = clampInterval(minuteInterval);
      date.setUTCMinutes(date.getUTCMinutes() + step);
      break;
    }
    default: {
      date.setUTCDate(date.getUTCDate() + 1);
    }
  }
  return date.getTime();
};

const MAX_BUCKETS = 2000;

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const linkId = String(params?.id ?? '').trim();
  if (!linkId) {
    return jsonError('INVALID_LINK_ID', 400);
  }

  const uid = parseUid(req);
  if (!uid) {
    return jsonError('UNAUTHENTICATED', 401);
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return jsonError('Missing DB binding', 500);
  }

  const link = await fetchDistributionById(DB, linkId);
  if (!link) {
    return jsonError('NOT_FOUND', 404);
  }
  if (link.ownerId && link.ownerId !== uid) {
    return jsonError('FORBIDDEN', 403);
  }

  const url = new URL(req.url);
  const frequencyParam = (url.searchParams.get('frequency') as Frequency | null) ?? 'day';
  const frequency: Frequency = ['year', 'month', 'day', 'hour', 'minute'].includes(frequencyParam)
    ? frequencyParam
    : 'day';
  const minuteInterval = clampInterval(Number(url.searchParams.get('minuteInterval') ?? '15'));

  const toParam = url.searchParams.get('to');
  const fromParam = url.searchParams.get('from');

  const defaultTo = new Date();
  const defaultFrom = new Date(defaultTo.getTime() - 7 * 24 * 60 * 60 * 1000);

  const toDate = toParam ? new Date(toParam) : defaultTo;
  const fromDate = fromParam ? new Date(fromParam) : defaultFrom;

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return jsonError('INVALID_RANGE', 400);
  }

  if (fromDate.getTime() > toDate.getTime()) {
    return jsonError('INVALID_RANGE', 400);
  }

  const alignedFromDay = startOfDayUTC(fromDate);
  const alignedToDay = startOfDayUTC(toDate);

  const alignedStart = alignTimestamp(alignedFromDay.getTime(), frequency, minuteInterval);
  const alignedEnd = alignTimestamp(alignedToDay.getTime(), frequency, minuteInterval);

  const bucketTimes: number[] = [];
  let cursor = alignedStart;
  while (cursor <= alignedEnd) {
    bucketTimes.push(cursor);
    cursor = incrementTimestamp(cursor, frequency, minuteInterval);
    if (bucketTimes.length > MAX_BUCKETS) {
      return jsonError('RANGE_TOO_LARGE', 400);
    }
  }
  if (!bucketTimes.length) {
    bucketTimes.push(alignedStart);
  }

  const statsTable = getStatsTableName(linkId);
  type StatsRow = { date: string; apk_dl: number | string | null; ipa_dl: number | string | null };
  let rows: StatsRow[] = [];
  try {
    const result = await DB.prepare(
      `SELECT date, apk_dl, ipa_dl FROM "${statsTable}" WHERE date BETWEEN ? AND ? ORDER BY date ASC`
    )
      .bind(formatDayKey(alignedFromDay), formatDayKey(alignedToDay))
      .all<StatsRow>();
    rows = (result?.results as StatsRow[] | undefined) ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table/i.test(message)) {
      return jsonError(message || 'QUERY_FAILED', 500);
    }
    rows = [];
  }

  const toNumber = (value: number | string | null | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  };

  const bucketMap = new Map<number, { apk: number; ipa: number }>();
  for (const row of rows) {
    const dateValue = row.date ? new Date(`${row.date}T00:00:00Z`).getTime() : NaN;
    if (!Number.isFinite(dateValue)) continue;
    const bucketKey = alignTimestamp(dateValue, frequency, minuteInterval);
    const entry = bucketMap.get(bucketKey) ?? { apk: 0, ipa: 0 };
    entry.apk += toNumber(row.apk_dl);
    entry.ipa += toNumber(row.ipa_dl);
    bucketMap.set(bucketKey, entry);
  }

  const points: StatsPoint[] = bucketTimes.map((time) => {
    const entry = bucketMap.get(time) ?? { apk: 0, ipa: 0 };
    const apk = entry.apk;
    const ipa = entry.ipa;
    return {
      bucket: new Date(time).toISOString(),
      apk,
      ipa,
      total: apk + ipa,
    };
  });

  const totalApk = points.reduce((acc, point) => acc + point.apk, 0);
  const totalIpa = points.reduce((acc, point) => acc + point.ipa, 0);
  const summary = {
    totalApk,
    totalIpa,
    total: totalApk + totalIpa,
    from: points.length ? points[0].bucket : fromDate.toISOString(),
    to: points.length ? points[points.length - 1].bucket : toDate.toISOString(),
    bucketCount: points.length,
  };

  return NextResponse.json({ ok: true, points, summary });
}
