import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { hashPassword } from '@/lib/pw';

export const runtime = 'edge';

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const DB: D1Database = env.DB;

  const body = (await req.json().catch(() => ({}))) as Partial<{ email: unknown; password: unknown }>;
  const email = typeof body.email === 'string' ? body.email : undefined;
  const password = typeof body.password === 'string' ? body.password : undefined;
  if (!email || !password) return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });

  const u = await DB.prepare('SELECT id, password_hash, password_salt FROM users WHERE email=? LIMIT 1')
    .bind(email).first<{ id:string; password_hash:string; password_salt:string }>();

  if (!u) return NextResponse.json({ ok:false, error:'INVALID_CREDENTIALS' }, { status: 401 });

  const hash = await hashPassword(password, u.password_salt);
  if (hash !== u.password_hash) return NextResponse.json({ ok:false, error:'INVALID_CREDENTIALS' }, { status: 401 });

  const res = NextResponse.json({ ok: true, user_id: u.id });
  // 極簡示範：設置 uid cookie（HttpOnly）。正式可換成簽名/加密 token。
  res.cookies.set('uid', u.id, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60*60*24*7 });
  return res;
}
