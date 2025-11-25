import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { createRuTestFile } from '@/lib/ru-server';

export const runtime = 'edge';

type Env = {
  RU_SERVER_API_BASE?: string;
  RU_SERVER_API_TOKEN?: string;
};

export async function POST(req: Request) {
  const ctx = getRequestContext();
  const bindings = ctx.env as Env;

  let fileName: string | undefined;
  try {
    const payload = (await req.json()) as { fileName?: string } | null;
    const rawName = typeof payload?.fileName === 'string' ? payload.fileName : '';
    fileName = rawName ? rawName.trim() : undefined;
  } catch {
    fileName = undefined;
  }

  try {
    const result = await createRuTestFile(bindings, fileName);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
