import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { R2Bucket } from '@cloudflare/workers-types';
import { encodePasswordRecord, hashPassword, randomSaltHex } from '@/lib/pw';
import { ensurePointTables, hasPointAccountsUpdatedAt, hasUsersBalanceColumn } from '@/lib/schema';

export const runtime = 'edge';
// 0
type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  R2_BUCKET?: R2Bucket;
};

async function ensureUserBucketFolder(bucket: R2Bucket | undefined, userId: string) {
  if (!bucket) return;
  const key = `${userId}/.init`;
  try {
    await bucket.put(key, new Uint8Array(), {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { owner: userId, scope: 'user-root' },
    });
  } catch {
    // non-blocking
  }
}

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  const R2 = bindings.R2_BUCKET;
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{ email: unknown; password: unknown }>;
  const email = typeof body.email === 'string' ? body.email : undefined;
  const password = typeof body.password === 'string' ? body.password : undefined;
  if (!email || !password) return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });

  try {
    const exists = await DB.prepare('SELECT id FROM users WHERE email=? LIMIT 1').bind(email).first<{ id: string }>();
    if (exists) return NextResponse.json({ ok: false, error: 'EMAIL_IN_USE' }, { status: 409 });

    const id = crypto.randomUUID();
    const salt = randomSaltHex();
    const hash = await hashPassword(password, salt);
    const record = encodePasswordRecord(salt, hash);
    const now = Math.floor(Date.now() / 1000);
    await ensurePointTables(DB);
    const hasBalance = await hasUsersBalanceColumn(DB);

    if (hasBalance) {
      await DB.prepare('INSERT INTO users (id, email, pw_hash, role, balance, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, email, record, 'user', 0, now)
        .run();
    } else {
      await DB.prepare('INSERT INTO users (id, email, pw_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, email, record, 'user', now)
        .run();
      const hasUpdatedAt = await hasPointAccountsUpdatedAt(DB);
      if (hasUpdatedAt) {
        await DB.prepare('INSERT OR IGNORE INTO point_accounts (id, balance, updated_at) VALUES (?, 0, ?)')
          .bind(id, now)
          .run()
          .catch(() => undefined);
      } else {
        await DB.prepare('INSERT OR IGNORE INTO point_accounts (id, balance) VALUES (?, 0)')
          .bind(id)
          .run()
          .catch(() => undefined);
      }
    }

    await ensureUserBucketFolder(R2, id);

    return NextResponse.json({ ok: true, user_id: id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
