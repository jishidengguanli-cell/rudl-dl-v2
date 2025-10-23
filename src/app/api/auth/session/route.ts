import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const parseUid = (cookieHeader: string | null): string | null => {
  if (!cookieHeader) return null;
  const pair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='));
  if (!pair) return null;
  const value = pair.slice(4);
  return value || null;
};

export async function GET(request: Request) {
  const uid = parseUid(request.headers.get('cookie'));
  if (!uid) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const user = await DB.prepare('SELECT id, email, role FROM users WHERE id=? LIMIT 1')
    .bind(uid)
    .first<{ id: string; email?: string; role?: string }>()
    .catch(() => null);

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email ?? null,
      role: user.role ?? null,
    },
  });
}
