import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import {
  createAnalyticsWatcher,
  deleteAnalyticsWatcher,
  listAnalyticsWatchersByOwner,
  updateAnalyticsWatcher,
  type AnalyticsWatcher,
  type AnalyticsWatcherSettings,
  AnalyticsWatcherError,
  DEFAULT_ANALYTICS_WATCHER_SETTINGS,
} from '@/lib/analytics-watchers';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type Payload = {
  id?: unknown;
  linkId?: unknown;
  chatId?: unknown;
  httpErrors?: unknown;
  buttonErrors?: unknown;
  lcp?: unknown;
  inp?: unknown;
  isActive?: unknown;
  testMode?: unknown;
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

const resolveDB = (): D1Database | null => {
  const { env } = getRequestContext();
  const bindings = env as Env;
  return bindings.DB ?? bindings['rudl-app'] ?? null;
};

const toClientWatcher = (watcher: AnalyticsWatcher) => ({
  id: watcher.id,
  linkId: watcher.linkId,
  linkCode: watcher.linkCode,
  linkTitle: watcher.linkTitle,
  linkNetworkArea: watcher.linkNetworkArea,
  linkIsActive: watcher.linkIsActive,
  chatId: watcher.chatId,
  isActive: watcher.isActive,
  settings: watcher.settings,
});

const parseBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) return numeric !== 0;
  }
  return undefined;
};

const buildRequiredSettings = (payload: Payload): AnalyticsWatcherSettings => ({
  httpErrors: parseBoolean(payload.httpErrors) ?? DEFAULT_ANALYTICS_WATCHER_SETTINGS.httpErrors,
  buttonErrors: parseBoolean(payload.buttonErrors) ?? DEFAULT_ANALYTICS_WATCHER_SETTINGS.buttonErrors,
  lcp: parseBoolean(payload.lcp) ?? DEFAULT_ANALYTICS_WATCHER_SETTINGS.lcp,
  inp: parseBoolean(payload.inp) ?? DEFAULT_ANALYTICS_WATCHER_SETTINGS.inp,
  testMode: parseBoolean(payload.testMode) ?? DEFAULT_ANALYTICS_WATCHER_SETTINGS.testMode,
});

const buildOptionalSettings = (
  payload: Payload
): Partial<AnalyticsWatcherSettings> | undefined => {
  const patch: Partial<AnalyticsWatcherSettings> = {};
  const httpFlag = parseBoolean(payload.httpErrors);
  if (typeof httpFlag === 'boolean') patch.httpErrors = httpFlag;
  const buttonFlag = parseBoolean(payload.buttonErrors);
  if (typeof buttonFlag === 'boolean') patch.buttonErrors = buttonFlag;
  const lcpFlag = parseBoolean(payload.lcp);
  if (typeof lcpFlag === 'boolean') patch.lcp = lcpFlag;
  const inpFlag = parseBoolean(payload.inp);
  if (typeof inpFlag === 'boolean') patch.inp = inpFlag;
  const testFlag = parseBoolean(payload.testMode);
  if (typeof testFlag === 'boolean') patch.testMode = testFlag;
  return Object.keys(patch).length ? patch : undefined;
};

const mapErrorStatus = (error: AnalyticsWatcherError): [number, string] => {
  switch (error.code) {
    case 'INVALID_CHAT_ID':
      return [400, 'INVALID_CHAT_ID'];
    case 'LINK_NOT_FOUND':
      return [404, 'LINK_NOT_FOUND'];
    case 'LINK_NOT_OWNED':
      return [403, 'LINK_NOT_OWNED'];
    case 'LINK_UNSUPPORTED_CN':
      return [400, 'CN_LINK_UNSUPPORTED'];
    case 'WATCHER_NOT_FOUND':
      return [404, 'WATCHER_NOT_FOUND'];
    default:
      return [400, error.code ?? 'INVALID_REQUEST'];
  }
};

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
    const watchers = await listAnalyticsWatchersByOwner(DB, uid);
    return NextResponse.json({ ok: true, watchers: watchers.map(toClientWatcher) });
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

  const body = (await req.json().catch(() => ({}))) as Payload;
  const linkId = typeof body.linkId === 'string' ? body.linkId : null;
  const chatId = typeof body.chatId === 'string' ? body.chatId : null;
  if (!linkId || !chatId) {
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  try {
    const watcher = await createAnalyticsWatcher(DB, uid, {
      linkId,
      chatId,
      settings: buildRequiredSettings(body),
      isActive: parseBoolean(body.isActive) ?? true,
    });
    return NextResponse.json({ ok: true, watcher: toClientWatcher(watcher) });
  } catch (error) {
    if (error instanceof AnalyticsWatcherError) {
      const [status, code] = mapErrorStatus(error);
      return NextResponse.json({ ok: false, error: code }, { status });
    }
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

  const body = (await req.json().catch(() => ({}))) as Payload;
  const watcherId = typeof body.id === 'string' ? body.id.trim() : null;
  if (!watcherId) {
    return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });
  }

  try {
    const watcher = await updateAnalyticsWatcher(DB, uid, watcherId, {
      chatId: typeof body.chatId === 'string' ? body.chatId : undefined,
      settings: buildOptionalSettings(body),
      isActive: (() => {
        const flag = parseBoolean(body.isActive);
        return typeof flag === 'boolean' ? flag : undefined;
      })(),
    });
    return NextResponse.json({ ok: true, watcher: toClientWatcher(watcher) });
  } catch (error) {
    if (error instanceof AnalyticsWatcherError) {
      const [status, code] = mapErrorStatus(error);
      return NextResponse.json({ ok: false, error: code }, { status });
    }
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

  const body = (await req.json().catch(() => ({}))) as Payload;
  const watcherId = typeof body.id === 'string' ? body.id.trim() : null;
  if (!watcherId) {
    return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });
  }

  try {
    const deleted = await deleteAnalyticsWatcher(DB, uid, watcherId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: 'WATCHER_NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AnalyticsWatcherError) {
      const [status, code] = mapErrorStatus(error);
      return NextResponse.json({ ok: false, error: code }, { status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
