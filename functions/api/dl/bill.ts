// POST /api/dl/bill  body: { account_id, link_id, platform }
// 規則：apk 扣 3 點、ipa 扣 5 點；同 (account_id, link_id, platform, 當前分鐘) 去重
import { json, text } from "../../_lib/respond";

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { DB } = ctx.env;
  const { account_id, link_id, platform } = await ctx.request.json().catch(() => ({}));

  if (!account_id || !link_id || !platform) return text("bad request", 400);

  const now = Math.floor(Date.now() / 1000);
  const bucket_minute = Math.floor(now / 60);
  const cost = platform === "ipa" ? 5 : 3;

  try {
    // 以交易確保一致性
    await DB.exec("BEGIN");

    // 1) 去重檢查
    const exist = await DB.prepare(
      `SELECT 1 FROM point_dedupe WHERE account_id=? AND link_id=? AND platform=? AND bucket_minute=? LIMIT 1`
    ).bind(account_id, link_id, platform, bucket_minute).first();
    if (exist) {
      await DB.exec("COMMIT");
      return json({ ok: true, deduped: true });
    }

    // 2) 餘額檢查
    const acct = await DB.prepare(
      `SELECT balance FROM point_accounts WHERE id=? LIMIT 1`
    ).bind(account_id).first<{ balance: number }>();
    const bal = Number(acct?.balance ?? 0);
    if (bal < cost) {
      await DB.exec("ROLLBACK");
      return json({ ok: false, error: "INSUFFICIENT_POINTS" }, 402);
    }

    // 3) 記帳（point_ledger）
    const id = crypto.randomUUID();
    await DB.prepare(
      `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
       VALUES (?, ?, ?, 'download', ?, NULL, ?, ?, ?)`
    ).bind(id, account_id, -cost, link_id, bucket_minute, platform, now).run();

    // 4) 扣款（point_accounts）
    await DB.prepare(
      `UPDATE point_accounts SET balance = balance - ?, updated_at=? WHERE id=?`
    ).bind(cost, now, account_id).run();

    // 5) 去重寫入
    await DB.prepare(
      `INSERT INTO point_dedupe (account_id, link_id, bucket_minute, platform) VALUES (?, ?, ?, ?)`
    ).bind(account_id, link_id, bucket_minute, platform).run();

    await DB.exec("COMMIT");
    return json({ ok: true, cost });
  } catch (e) {
    await DB.exec("ROLLBACK");
    return json({ ok: false, error: String(e) }, 500);
  }
};
