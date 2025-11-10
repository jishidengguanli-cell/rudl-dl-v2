import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { insertMonitorRecord } from '@/lib/monitor';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type BasePayload = {
  type?: unknown;
  threshold?: unknown;
  message?: unknown;
  targetChatId?: unknown;
  linkId?: unknown;
  metric?: unknown;
};

type DownloadMetric = 'total' | 'apk' | 'ipa';

type MonitorSummary =
  | {
      id: string;
      type: 'points';
      threshold: number;
      target: string;
      message: string;
    }
  | {
      id: string;
      type: 'downloads';
      threshold: number;
      metric: DownloadMetric;
      linkCode: string;
      target: string;
      message: string;
    };

const parseUid = (req: Request): string | null => {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const entry = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='));
  if (!entry) return null;
  const value = entry.slice(4).trim();
  return value || null;
};

const resolveDB = () => {
  const { env } = getRequestContext();
  const bindings = env as Env;
  return bindings.DB ?? bindings['rudl-app'];
};

const parsePositiveNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
};

const parseNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const allowedMetrics: Record<string, DownloadMetric> = {
  total: 'total',
  apk: 'apk',
  ipa: 'ipa',
};

async function resolveLinkCode(DB: D1Database, userId: string, linkId: string): Promise<string | null> {
  const row = await DB.prepare('SELECT code FROM links WHERE id=? AND owner_id=? LIMIT 1')
    .bind(linkId, userId)
    .first<{ code: string }>()
    .catch(() => null);
  return row?.code ?? null;
}

export async function POST(req: Request) {
  const uid = parseUid(req);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const DB = resolveDB();
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as BasePayload;
  const type = typeof body.type === 'string' ? body.type : null;
  const message = parseNonEmptyString(body.message);
  const targetChatId = parseNonEmptyString(body.targetChatId);
  const threshold = parsePositiveNumber(body.threshold);

  if (!type || !message || !targetChatId || !threshold) {
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  try {
    if (type === 'points') {
      const insertId = await insertMonitorRecord(DB, uid, {
        monOption: 'pb',
        monDetail: { point: threshold },
        notiMethod: 'tg',
        notiDetail: { content: message, target: targetChatId },
        isActive: 1,
      });

      const summary: MonitorSummary = {
        id: insertId ? String(insertId) : crypto.randomUUID(),
        type: 'points',
        threshold,
        target: targetChatId,
        message,
      };

      return NextResponse.json({ ok: true, monitor: summary });
    }

    if (type === 'downloads') {
      const linkId = parseNonEmptyString(body.linkId);
      const metricRaw = typeof body.metric === 'string' ? body.metric : '';
      const metric = allowedMetrics[metricRaw];
      if (!linkId || !metric) {
        return NextResponse.json({ ok: false, error: 'INVALID_DOWNLOAD_MONITOR' }, { status: 400 });
      }
      const linkCode = await resolveLinkCode(DB, uid, linkId);
      if (!linkCode) {
        return NextResponse.json({ ok: false, error: 'LINK_NOT_FOUND' }, { status: 404 });
      }

      const insertId = await insertMonitorRecord(DB, uid, {
        monOption: 'dc',
        monDetail: { link: linkCode, metric, num: threshold },
        notiMethod: 'tg',
        notiDetail: { content: message, target: targetChatId },
        isActive: 1,
      });

      const summary: MonitorSummary = {
        id: insertId ? String(insertId) : crypto.randomUUID(),
        type: 'downloads',
        threshold,
        metric,
        linkCode,
        target: targetChatId,
        message,
      };

      return NextResponse.json({ ok: true, monitor: summary });
    }

    return NextResponse.json({ ok: false, error: 'UNSUPPORTED_MONITOR_TYPE' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
