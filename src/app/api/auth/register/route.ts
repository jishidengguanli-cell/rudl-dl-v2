import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { encodePasswordRecord, hashPassword, randomSaltHex } from '@/lib/pw';

export const runtime = 'edge';

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const DB: D1Database = env.DB;

  const body = (await req.json().catch(() => ({}))) as Partial<{ email: unknown; password: unknown }>;
  const email = typeof body.email === 'string' ? body.email : undefined;
  const password = typeof body.password === 'string' ? body.password : undefined;
  if (!email || !password) return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });

  const exists = await DB.prepare('SELECT id FROM users WHERE email=? LIMIT 1').bind(email).first<{ id: string }>();
  if (exists) return NextResponse.json({ ok: false, error: 'EMAIL_IN_USE' }, { status: 409 });

  const id = crypto.randomUUID();
  const salt = randomSaltHex();
  const hash = await hashPassword(password, salt);
  const record = encodePasswordRecord(salt, hash);
  const now = Math.floor(Date.now() / 1000);

  await DB.prepare('INSERT INTO users (id, email, pw_hash, role, balance, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, email, record, 'user', 0, now)
    .run();

  return NextResponse.json({ ok: true, user_id: id });
}
