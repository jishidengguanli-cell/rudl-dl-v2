import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { fetchDashboardPage } from '@/lib/dashboard';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

export async function GET(req: Request) {
  try {
    const cookieHeader = req.headers.get('cookie') ?? '';
    const uid =
      cookieHeader
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('uid='))?.split('=')[1] ?? null;
    if (!uid) {
      return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get('page') ?? '1');
    const pageSize = Number(searchParams.get('pageSize') ?? '10');

    const { env } = getRequestContext();
    const bindings = env as Env;
    const DB = bindings.DB ?? bindings['rudl-app'];
    if (!DB) {
      return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
    }

    const data = await fetchDashboardPage(DB, uid, page, pageSize);
    return NextResponse.json({ ok: true, ...data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
