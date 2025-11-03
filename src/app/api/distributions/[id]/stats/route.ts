import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { D1Database } from '@cloudflare/workers-types';
import { fetchDistributionById } from '@/lib/distribution';

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

  const startBucketMinute = Math.floor(fromDate.getTime() / 60000);
  const endBucketMinute = Math.floor(toDate.getTime() / 60000);

  const alignedStart = alignTimestamp(startBucketMinute * 60000, frequency, minuteInterval);
  const alignedEnd = alignTimestamp(endBucketMinute * 60000, frequency, minuteInterval);

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

  type Row = { bucket_minute: number | string; platform: string | null; count: number | string | null };
  let rows: Row[] = [];
  try {
    const result = await DB.prepare(
      `SELECT bucket_minute, platform, COUNT(*) as count
       FROM point_ledger
       WHERE link_id=? AND reason='download' AND bucket_minute BETWEEN ? AND ?
       GROUP BY bucket_minute, platform
       ORDER BY bucket_minute ASC`
    )
      .bind(linkId, startBucketMinute, endBucketMinute)
      .all<Row>();
    rows = (result.results as Row[] | undefined) ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table/i.test(message)) {
      return jsonError(message || 'QUERY_FAILED', 500);
    }
    rows = [];
  }

  const bucketMap = new Map<number, { apk: number; ipa: number }>();
  for (const row of rows) {
    const minuteValue = Number(row.bucket_minute ?? 0);
    if (!Number.isFinite(minuteValue)) continue;
    const platform = (row.platform ?? '').toLowerCase() === 'ipa' ? 'ipa' : 'apk';
    const count = Number(row.count ?? 0);
    if (!Number.isFinite(count)) continue;
    const bucketKey = alignTimestamp(minuteValue * 60000, frequency, minuteInterval);
    const entry = bucketMap.get(bucketKey) ?? { apk: 0, ipa: 0 };
    if (platform === 'ipa') {
      entry.ipa += count;
    } else {
      entry.apk += count;
    }
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
