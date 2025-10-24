import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { applyRecharge, RechargeError } from '@/lib/recharge';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{
    account_id: unknown;
    amount: unknown;
    memo: unknown;
  }>;
  const accountId = typeof body.account_id === 'string' ? body.account_id : undefined;
  const amountValue = typeof body.amount === 'number' ? body.amount : Number(body.amount);
  const memo = typeof body.memo === 'string' ? body.memo : undefined;

  const n = Number(amountValue);
  if (!accountId || !Number.isFinite(n) || n <= 0) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }

  try {
    const { amount, balance, ledgerId } = await applyRecharge(DB, accountId, n, memo ? `recharge:${memo}` : 'recharge');
    return NextResponse.json({
      ok: true,
      amount,
      balance,
      ledger_id: ledgerId,
    });
  } catch (error: unknown) {
    if (error instanceof RechargeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
