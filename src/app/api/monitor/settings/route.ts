import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import {
  insertMonitorRecord,
  listMonitorSummaries,
  parseDownloadMetric,
  type MonitorSummary,
  type DownloadMetric,
  type MonitorRecordInsert,
  updateMonitorRecord,
  deleteMonitorRecord,
} from '@/lib/monitor';

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
  id?: unknown;
};

type MonitorSummaryData =
  | {
      type: 'points';
      threshold: number;
      target: string;
      message: string;
      isActive: boolean;
    }
  | {
      type: 'downloads';
      threshold: number;
      metric: DownloadMetric;
      linkCode: string;
      target: string;
      message: string;
      isActive: boolean;
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

const parseRowId = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

async function resolveLinkCode(DB: D1Database, userId: string, linkId: string): Promise<string | null> {
  const row = await DB.prepare('SELECT code FROM links WHERE id=? AND owner_id=? LIMIT 1')
    .bind(linkId, userId)
    .first<{ code: string }>()
    .catch(() => null);
  return row?.code ?? null;
}

type BuildMonitorResult =
  | {
      ok: true;
      record: MonitorRecordInsert;
      summary: MonitorSummaryData;
    }
  | { ok: false; status: number; error: string };

async function buildMonitorRecord(
  DB: D1Database,
  uid: string,
  body: BasePayload
): Promise<BuildMonitorResult> {
  const type = typeof body.type === 'string' ? body.type : null;
  const message = parseNonEmptyString(body.message);
  const targetChatId = parseNonEmptyString(body.targetChatId);
  const threshold = parsePositiveNumber(body.threshold);

  if (!type || !message || !targetChatId || !threshold) {
    return { ok: false, status: 400, error: 'INVALID_PAYLOAD' };
  }

  if (type === 'points') {
    return {
      ok: true,
      record: {
        monOption: 'pb',
        monDetail: { point: threshold },
        notiMethod: 'tg',
        notiDetail: { content: message, target: targetChatId },
        isActive: 1,
      },
      summary: {
        type: 'points',
        threshold,
        target: targetChatId,
        message,
        isActive: true,
      },
    };
  }

  if (type === 'downloads') {
    const linkId = parseNonEmptyString(body.linkId);
    const metric = parseDownloadMetric(typeof body.metric === 'string' ? body.metric : null);
    if (!linkId || !metric) {
      return { ok: false, status: 400, error: 'INVALID_DOWNLOAD_MONITOR' };
    }
    const linkCode = await resolveLinkCode(DB, uid, linkId);
    if (!linkCode) {
      return { ok: false, status: 404, error: 'LINK_NOT_FOUND' };
    }
    return {
      ok: true,
      record: {
        monOption: 'dc',
        monDetail: { link: linkCode, metric, num: threshold },
        notiMethod: 'tg',
        notiDetail: { content: message, target: targetChatId },
        isActive: 1,
      },
      summary: {
        type: 'downloads',
        threshold,
        metric,
        linkCode,
        target: targetChatId,
        message,
        isActive: true,
      },
    };
  }

  return { ok: false, status: 400, error: 'UNSUPPORTED_MONITOR_TYPE' };
}

export async function GET(req: Request) {
  const uid = parseUid(req);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const DB = resolveDB();
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  try {
    const monitors = await listMonitorSummaries(DB, uid);
    return NextResponse.json({ ok: true, monitors });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
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

  try {
    const parsed = await buildMonitorRecord(DB, uid, body);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
    }

    const insertId = await insertMonitorRecord(DB, uid, parsed.record);
    const id = insertId ? String(insertId) : crypto.randomUUID();

    return NextResponse.json({
      ok: true,
      monitor: {
        id,
        ...parsed.summary,
      } satisfies MonitorSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const uid = parseUid(req);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const DB = resolveDB();
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as BasePayload;
  const rowId = parseRowId(body.id);
  if (!rowId) {
    return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });
  }

  try {
    const parsed = await buildMonitorRecord(DB, uid, body);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
    }

    const updated = await updateMonitorRecord(DB, uid, rowId, parsed.record);
    if (!updated) {
      return NextResponse.json({ ok: false, error: 'MONITOR_NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      monitor: {
        id: rowId,
        ...parsed.summary,
      } satisfies MonitorSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const uid = parseUid(req);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const DB = resolveDB();
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as BasePayload;
  const rowId = parseRowId(body.id);
  if (!rowId) {
    return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });
  }

  try {
    const deleted = await deleteMonitorRecord(DB, uid, rowId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: 'MONITOR_NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
