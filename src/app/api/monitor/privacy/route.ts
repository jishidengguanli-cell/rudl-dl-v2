import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { fetchTelegramSettings, updateTelegramSettings, type TelegramSettings } from '@/lib/monitor';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const parseNullableString = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  return null;
};

const normalizePayload = (payload: TelegramSettings): TelegramSettings => ({
  telegramApiId: payload.telegramApiId ?? null,
  telegramApiHash: payload.telegramApiHash ?? null,
  telegramBotToken: payload.telegramBotToken ?? null,
});

const parseUid = (request: Request): string | null => {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const pair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='));
  if (!pair) return null;
  const value = pair.slice(4);
  return value || null;
};

const resolveDB = () => {
  const { env } = getRequestContext();
  const bindings = env as Env;
  return bindings.DB ?? bindings['rudl-app'];
};

export async function GET(request: Request) {
  const uid = parseUid(request);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const DB = resolveDB();
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }
  try {
    const data = await fetchTelegramSettings(DB, uid);
    return NextResponse.json({ ok: true, data: normalizePayload(data) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const uid = parseUid(request);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const DB = resolveDB();
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<{
    telegramApiId: unknown;
    telegramApiHash: unknown;
    telegramBotToken: unknown;
  }>;

  const payload: TelegramSettings = {
    telegramApiId: parseNullableString(body.telegramApiId),
    telegramApiHash: parseNullableString(body.telegramApiHash),
    telegramBotToken: parseNullableString(body.telegramBotToken),
  };

  try {
    const data = await updateTelegramSettings(DB, uid, payload);
    return NextResponse.json({ ok: true, data: normalizePayload(data) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
