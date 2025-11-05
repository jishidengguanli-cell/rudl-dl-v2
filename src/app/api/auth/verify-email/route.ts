import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import {
  consumeEmailVerificationToken,
  markEmailVerified,
} from '@/lib/email-verification';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  APP_BASE_URL?: string;
};

const buildRedirect = (baseUrl: string, status: string) =>
  `${baseUrl.replace(/\/+$/, '')}/member/email-verification?status=${encodeURIComponent(status)}`;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token')?.trim();
  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  const baseUrl = (bindings.APP_BASE_URL ?? `${url.protocol}//${url.host}`).replace(/\/+$/, '');

  if (!token) {
    return NextResponse.redirect(buildRedirect(baseUrl, 'invalid'), 302);
  }

  if (!DB) {
    return NextResponse.redirect(buildRedirect(baseUrl, 'error'), 302);
  }

  try {
    const result = await consumeEmailVerificationToken(DB, token);

    if (result.status === 'success') {
      await markEmailVerified(DB, result.userId);
      return NextResponse.redirect(buildRedirect(baseUrl, 'success'), 302);
    }

    if (result.status === 'expired') {
      return NextResponse.redirect(buildRedirect(baseUrl, 'expired'), 302);
    }

    return NextResponse.redirect(buildRedirect(baseUrl, 'invalid'), 302);
  } catch {
    return NextResponse.redirect(buildRedirect(baseUrl, 'error'), 302);
  }
}
