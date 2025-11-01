import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { D1Database } from '@cloudflare/workers-types';
import { applyRecharge, RechargeError } from '@/lib/recharge';
import { ensurePointTables } from '@/lib/schema';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type RequestBody = {
  accountId?: string;
  points?: number;
  memo?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const accountId = body.accountId?.trim();
    const points = Number(body.points ?? 0);
    const memo = typeof body.memo === 'string' && body.memo.trim().length > 0 ? body.memo.trim() : undefined;

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'MISSING_ACCOUNT_ID' }, { status: 400 });
    }
    if (!Number.isFinite(points) || points <= 0) {
      return NextResponse.json({ ok: false, error: 'INVALID_POINTS' }, { status: 400 });
    }

    const { env } = getRequestContext();
    const bindings = env as Env;
    const DB = bindings.DB ?? bindings['rudl-app'];
    if (!DB) {
      return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
    }

    await ensurePointTables(DB);
    const result = await applyRecharge(DB, accountId, points, memo ?? 'debug-recharge-test');

    return NextResponse.json({ ok: true, result: { ...result, memo: memo ?? 'debug-recharge-test' } });
  } catch (error) {
    if (error instanceof RechargeError) {
      return NextResponse.json({ ok: false, error: error.message, status: error.status }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[debug] recharge test failed', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: {
      method: 'POST',
      body: { accountId: 'string', points: 100, memo: 'optional memo' },
      description: 'Test D1 recharge write path without running ECPay checkout.',
    },
  });
}

