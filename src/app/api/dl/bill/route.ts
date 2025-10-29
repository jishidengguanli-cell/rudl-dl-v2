import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { ensurePointTables, hasPointAccountsUpdatedAt, hasUsersBalanceColumn } from '@/lib/schema';

export const runtime = 'edge';

type Env = {
  DB: D1Database;
  ['rudl-app']?: D1Database;
};
type DeductRequestBody = {
  account_id?: string;
  link_id?: string;
  platform?: string;
};

export async function POST(req: Request) {
  const { env } = getRequestContext<Env>();
  const legacyDB = (env as unknown as { ['rudl-app']?: D1Database })['rudl-app'];
  const DB = env.DB ?? legacyDB;
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as DeductRequestBody;
  const { account_id, link_id, platform } = body;
  if (!account_id || !link_id || !platform) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const bucket_minute = Math.floor(now / 60);
  const cost = platform === 'ipa' ? 5 : 3;

  try {
    await ensurePointTables(DB);
    const hasBalance = await hasUsersBalanceColumn(DB);

    const exists = await DB.prepare(
      `SELECT 1 FROM point_dedupe WHERE account_id=? AND link_id=? AND platform=? AND bucket_minute=? LIMIT 1`
    ).bind(account_id, link_id, platform, bucket_minute).first();
    if (exists) {
      return NextResponse.json({ ok: true, deduped: true });
    }

    const balanceQuery = hasBalance
      ? 'SELECT balance FROM users WHERE id=? LIMIT 1'
      : 'SELECT balance FROM point_accounts WHERE id=? LIMIT 1';

    const acct = await DB.prepare(balanceQuery).bind(account_id).first<{ balance: number }>();
    if (!acct) {
      return NextResponse.json({ ok: false, error: 'ACCOUNT_NOT_FOUND' }, { status: 404 });
    }
    const bal = Number(acct.balance ?? 0);
    if (bal < cost) {
      return NextResponse.json({ ok: false, error: 'INSUFFICIENT_POINTS' }, { status: 402 });
    }

    const id = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [];

    statements.push(
      DB.prepare(
        `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
         VALUES (?, ?, ?, 'download', ?, NULL, ?, ?, ?)`
      ).bind(id, account_id, -cost, link_id, bucket_minute, platform, now)
    );

    if (hasBalance) {
      statements.push(
        DB.prepare(`UPDATE users SET balance = balance - ? WHERE id=?`).bind(cost, account_id)
      );
    } else {
      const hasUpdatedAt = await hasPointAccountsUpdatedAt(DB);
      if (hasUpdatedAt) {
        statements.push(
          DB.prepare(`UPDATE point_accounts SET balance = balance - ?, updated_at=? WHERE id=?`).bind(
            cost,
            now,
            account_id
          )
        );
      } else {
        statements.push(
          DB.prepare(`UPDATE point_accounts SET balance = balance - ? WHERE id=?`).bind(cost, account_id)
        );
      }
    }

    statements.push(
      DB.prepare(
        `INSERT INTO point_dedupe (account_id, link_id, bucket_minute, platform) VALUES (?, ?, ?, ?)`
      ).bind(account_id, link_id, bucket_minute, platform)
    );

    await DB.batch(statements);

    return NextResponse.json({ ok: true, cost });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    if (/\bpoint_dedupe\b/.test(error) && /constraint/i.test(error)) {
      return NextResponse.json({ ok: true, deduped: true });
    }

    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
