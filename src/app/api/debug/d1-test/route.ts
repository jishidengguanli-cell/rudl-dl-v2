import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

export async function GET() {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  try {
    const result = await DB.prepare(
      "SELECT datetime('now') AS current_time, random() AS sample"
    ).all<{ current_time?: string; sample?: number }>();
    return NextResponse.json({
      ok: true,
      timestamp: Date.now(),
      data: result.results ?? [],
      meta: result.meta ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

