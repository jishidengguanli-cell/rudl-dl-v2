import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const DB: D1Database = env.DB;

  const { account_id, amount, memo } = await req.json().catch(() => ({}));
  const n = Number(amount);
  if (!account_id || !Number.isFinite(n) || n <= 0) {
    return NextResponse.json({ ok:false, error:'bad request' }, { status: 400 });
  }

  const now = Math.floor(Date.now()/1000);
  const lid = crypto.randomUUID();

  try {
    await DB.exec('BEGIN');
    await DB.prepare(
      `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
    ).bind(lid, account_id, n, `recharge:${memo ?? ''}`, now).run();

    await DB.prepare('UPDATE point_accounts SET balance = balance + ?, updated_at=? WHERE id=?')
      .bind(n, now, account_id).run();

    await DB.exec('COMMIT');
    return NextResponse.json({ ok:true, amount:n, ledger_id: lid });
  } catch (error: unknown) {
    await DB.exec('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok:false, error: message }, { status: 500 });
  }
}
