import { v4 as uuidv4 } from "uuid";

type Platform = "apk" | "ipa";

export class PointAccountDO {
  state: DurableObjectState;
  env: { APP_DB: D1Database };

  constructor(state: DurableObjectState, env: { APP_DB: D1Database }) {
    this.state = state;
    this.env = env;
  }

  // POST { accountId, linkId, platform, cost, reason? }
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const now = Date.now();
    const body = await req.json() as {
      accountId: string;
      linkId: string;
      platform: Platform;
      cost: number;
      reason?: string;
    };

    const bucketMinute = Math.floor(now / 60000);

    try {
      await this.env.APP_DB.exec("BEGIN IMMEDIATE;");

      // 冪等：同帳戶+同link+同分鐘+同平台，僅扣一次
      const dedupe = await this.env.APP_DB.prepare(
        "INSERT OR IGNORE INTO point_dedupe (account_id, link_id, bucket_minute, platform) VALUES (?1, ?2, ?3, ?4)"
      ).bind(body.accountId, body.linkId, bucketMinute, body.platform).run();

      if (dedupe.meta.changes === 0) {
        await this.env.APP_DB.exec("COMMIT;");
        return Response.json({ ok: true, deduped: true });
      }

      // 餘額
      const acc = await this.env.APP_DB.prepare(
        "SELECT balance FROM point_accounts WHERE id=?1"
      ).bind(body.accountId).first<{ balance: number }>();

      if (!acc) { await this.env.APP_DB.exec("ROLLBACK;"); return new Response("Account Not Found", { status: 404 }); }
      if (acc.balance < body.cost) { await this.env.APP_DB.exec("ROLLBACK;"); return new Response("Insufficient points", { status: 402 }); }

      // 扣點
      await this.env.APP_DB.prepare(
        "UPDATE point_accounts SET balance = balance - ?1, updated_at = ?2 WHERE id=?3"
      ).bind(body.cost, now, body.accountId).run();

      // 流水
      const ledgerId = uuidv4();
      await this.env.APP_DB.prepare(
        "INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)"
      ).bind(ledgerId, body.accountId, -body.cost, body.reason || "download", body.linkId, bucketMinute, body.platform, now).run();

      await this.env.APP_DB.exec("COMMIT;");
      return Response.json({ ok: true, ledgerId });
    } catch (e) {
      await this.env.APP_DB.exec("ROLLBACK;");
      return new Response("DO Error: " + (e as Error).message, { status: 500 });
    }
  }
}
