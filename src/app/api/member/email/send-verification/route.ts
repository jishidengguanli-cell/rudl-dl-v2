import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import {
  createEmailVerificationToken,
  sendVerificationEmail,
  EMAIL_VERIFICATION_TTL_SECONDS,
} from '@/lib/email-verification';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  APP_BASE_URL?: string;
  APP_NAME?: string;
  MAILCHANNELS_API_KEY?: string;
  MAILCHANNELS_API_BASE?: string;
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

const toBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric !== 0;
    return value.toLowerCase() === 'true';
  }
  return false;
};

export async function POST(req: Request) {
  const uid = parseUid(req);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  try {
    const user = await DB.prepare('SELECT email, is_email_verified FROM users WHERE id=? LIMIT 1')
      .bind(uid)
      .first<{ email?: string | null; is_email_verified?: unknown }>();

    const email = user?.email?.trim();
    if (!email) {
      return NextResponse.json({ ok: false, error: 'EMAIL_NOT_SET' }, { status: 400 });
    }

    if (toBoolean(user?.is_email_verified)) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    const { token, expiresAt } = await createEmailVerificationToken(DB, uid);

    const url = new URL(req.url);
    const baseUrl = (bindings.APP_BASE_URL ?? `${url.protocol}//${url.host}`).replace(/\/+$/, '');
    const verificationUrl = `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

    await sendVerificationEmail({
      env: bindings,
      to: email,
      verificationUrl,
      subject: `${bindings.APP_NAME ?? 'DataruApp'} - Email verification`,
      appName: bindings.APP_NAME ?? 'DataruApp',
    });

    return NextResponse.json({
      ok: true,
      expiresAt,
      ttl: EMAIL_VERIFICATION_TTL_SECONDS,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
