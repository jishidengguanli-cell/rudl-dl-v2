import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const DB: D1Database = env.DB;

  const { account_id, link_id, platform } = await req.json().catch(() => ({}));
  if (!account_id || !link_id || !platform) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const bucket_minute = Math.floor(now / 60);
  const cost = platform === 'ipa' ? 5 : 3;

  try {
    await DB.exec('BEGIN');

    const exists = await DB.prepare(
      `SELECT 1 FROM point_dedupe WHERE account_id=? AND link_id=? AND platform=? AND bucket_minute=? LIMIT 1`
    ).bind(account_id, link_id, platform, bucket_minute).first();
    if (exists) {
      await DB.exec('COMMIT');
      return NextResponse.json({ ok: true, deduped: true });
    }

    const acct = await DB.prepare(
      `SELECT balance FROM point_accounts WHERE id=? LIMIT 1`
    ).bind(account_id).first<{ balance:number }>();
    const bal = Number(acct?.balance ?? 0);
    if (bal < cost) {
      await DB.exec('ROLLBACK');
      return NextResponse.json({ ok:false, error:'INSUFFICIENT_POINTS' }, { status: 402 });
    }

    const id = crypto.randomUUID();
    await DB.prepare(
      `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
       VALUES (?, ?, ?, 'download', ?, NULL, ?, ?, ?)`
    ).bind(id, account_id, -cost, link_id, bucket_minute, platform, now).run();

    await DB.prepare(
      `UPDATE point_accounts SET balance = balance - ?, updated_at=? WHERE id=?`
    ).bind(cost, now, account_id).run();

    await DB.prepare(
      `INSERT INTO point_dedupe (account_id, link_id, bucket_minute, platform) VALUES (?, ?, ?, ?)`
    ).bind(account_id, link_id, bucket_minute, platform).run();

    await DB.exec('COMMIT');
    return NextResponse.json({ ok:true, cost });
  } catch (e:any) {
    await DB.exec('ROLLBACK');
    return NextResponse.json({ ok:false, error:String(e) }, { status: 500 });
  }
}
