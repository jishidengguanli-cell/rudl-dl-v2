import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { decodePasswordRecord, hashPassword } from '@/lib/pw';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{ email: unknown; password: unknown }>;
  const email = typeof body.email === 'string' ? body.email : undefined;
  const password = typeof body.password === 'string' ? body.password : undefined;
  if (!email || !password) return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });

  try {
    const user = await DB.prepare('SELECT id, pw_hash FROM users WHERE email=? LIMIT 1')
      .bind(email)
      .first<{ id: string; pw_hash: string }>();

    if (!user) return NextResponse.json({ ok: false, error: 'INVALID_CREDENTIALS' }, { status: 401 });

    const parsed = decodePasswordRecord(user.pw_hash);
    if (!parsed?.saltHex) return NextResponse.json({ ok: false, error: 'INVALID_CREDENTIALS' }, { status: 401 });

    const derived = await hashPassword(password, parsed.saltHex);
    if (derived !== parsed.hashHex) return NextResponse.json({ ok: false, error: 'INVALID_CREDENTIALS' }, { status: 401 });

    const res = NextResponse.json({ ok: true, user_id: user.id });
    res.cookies.set('uid', user.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
