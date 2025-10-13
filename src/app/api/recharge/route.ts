import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { hasUsersBalanceColumn } from '@/lib/schema';

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

  const now = Math.floor(Date.now() / 1000);
  const lid = crypto.randomUUID();

  try {
    const hasBalance = await hasUsersBalanceColumn(DB);
    await DB.exec('BEGIN');

    if (hasBalance) {
      const current = await DB.prepare('SELECT balance FROM users WHERE id=? LIMIT 1')
        .bind(accountId)
        .first<{ balance: number }>();
      if (!current) {
        await DB.exec('ROLLBACK');
        return NextResponse.json({ ok: false, error: 'ACCOUNT_NOT_FOUND' }, { status: 404 });
      }

      await DB.prepare(
        `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
      )
        .bind(lid, accountId, n, `recharge:${memo ?? ''}`, now)
        .run();

      await DB.prepare('UPDATE users SET balance = balance + ? WHERE id=?')
        .bind(n, accountId)
        .run();

      await DB.exec('COMMIT');

      const baseBalance = Number(current.balance ?? 0);
      return NextResponse.json({
        ok: true,
        amount: n,
        balance: baseBalance + n,
        ledger_id: lid,
      });
    }

    const currentLegacy = await DB.prepare('SELECT balance FROM point_accounts WHERE id=? LIMIT 1')
      .bind(accountId)
      .first<{ balance: number }>();
    if (!currentLegacy) {
      await DB.exec('ROLLBACK');
      return NextResponse.json({ ok: false, error: 'ACCOUNT_NOT_FOUND' }, { status: 404 });
    }

    await DB.prepare(
      `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
    )
      .bind(lid, accountId, n, `recharge:${memo ?? ''}`, now)
      .run();

    await DB.prepare('UPDATE point_accounts SET balance = balance + ?, updated_at=? WHERE id=?')
      .bind(n, now, accountId)
      .run();

    await DB.exec('COMMIT');

    return NextResponse.json({
      ok: true,
      amount: n,
      balance: Number(currentLegacy.balance ?? 0) + n,
      ledger_id: lid,
    });
  } catch (error: unknown) {
    await DB.exec('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
