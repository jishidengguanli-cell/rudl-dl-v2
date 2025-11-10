import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { R2Bucket } from '@cloudflare/workers-types';
import { encodePasswordRecord, hashPassword, randomSaltHex } from '@/lib/pw';
import { ensurePointTables, hasPointAccountsUpdatedAt, hasUsersBalanceColumn } from '@/lib/schema';
import {
  createEmailVerificationToken,
  sendVerificationEmail,
  EMAIL_VERIFICATION_TTL_SECONDS,
} from '@/lib/email-verification';

export const runtime = 'edge';
// 0
type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  R2_BUCKET?: R2Bucket;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  APP_BASE_URL?: string;
  APP_NAME?: string;
  MAILCHANNELS_API_KEY?: string;
  MAILCHANNELS_API_BASE?: string;
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
  const emailInput = typeof body.email === 'string' ? body.email : undefined;
  const password = typeof body.password === 'string' ? body.password : undefined;
  if (!emailInput || !password) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(emailInput);
  if (!normalizedEmail) {
    return NextResponse.json({ ok: false, error: 'INVALID_EMAIL' }, { status: 400 });
  }

  let newUserId: string | null = null;
  let shouldRollback = false;

  try {
    const exists = await DB.prepare('SELECT id FROM users WHERE email=? LIMIT 1')
      .bind(normalizedEmail)
      .first<{ id: string }>();
    if (exists) return NextResponse.json({ ok: false, error: 'EMAIL_IN_USE' }, { status: 409 });

    const id = crypto.randomUUID();
    newUserId = id;
    const salt = randomSaltHex();
    const hash = await hashPassword(password, salt);
    const record = encodePasswordRecord(salt, hash);
    const now = Math.floor(Date.now() / 1000);
    await ensurePointTables(DB);
    const hasBalance = await hasUsersBalanceColumn(DB);

    if (hasBalance) {
      await DB.prepare('INSERT INTO users (id, email, pw_hash, role, balance, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, normalizedEmail, record, 'user', 0, now)
        .run();
    } else {
      await DB.prepare('INSERT INTO users (id, email, pw_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, normalizedEmail, record, 'user', now)
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

    shouldRollback = true;

    const { token, expiresAt, nextAllowedAt } = await createEmailVerificationToken(DB, id);
    const url = new URL(req.url);
    const baseUrl = (bindings.APP_BASE_URL ?? `${url.protocol}//${url.host}`).replace(/\/+$/, '');
    const verificationUrl = `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

    await sendVerificationEmail({
      env: bindings,
      to: normalizedEmail,
      verificationUrl,
      subject: `${bindings.APP_NAME ?? 'DataruApp'} - Email verification`,
      appName: bindings.APP_NAME ?? 'DataruApp',
    });

    await ensureUserBucketFolder(R2, id);
    shouldRollback = false;

    const response = NextResponse.json({
      ok: true,
      user_id: id,
      verification: {
        expiresAt,
        ttl: EMAIL_VERIFICATION_TTL_SECONDS,
        nextAllowedAt,
      },
    });
    response.cookies.set('uid', id, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (error: unknown) {
    if (shouldRollback && DB && newUserId) {
      await DB.prepare('DELETE FROM users WHERE id=?')
        .bind(newUserId)
        .run()
        .catch(() => undefined);
      await DB.prepare('DELETE FROM point_accounts WHERE id=?')
        .bind(newUserId)
        .run()
        .catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const normalizeEmail = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 254) return null;
  if (!EMAIL_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
};
