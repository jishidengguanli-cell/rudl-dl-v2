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
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const now = Date.now();
      const body = (await req.json()) as {
        accountId: string;
        linkId: string;
        platform: Platform;
        cost: number;
        reason?: string;
      };

      const bucketMinute = Math.floor(now / 60000);

      // 1) 冪等去重：同帳戶+同link+同分鐘+同平台 僅扣一次
      const dedupe = await this.env.APP_DB.prepare(
        "INSERT OR IGNORE INTO point_dedupe (account_id, link_id, bucket_minute, platform) VALUES (?1, ?2, ?3, ?4)"
      )
        .bind(body.accountId, body.linkId, bucketMinute, body.platform)
        .run();

      if (dedupe.meta.changes === 0) {
        return Response.json({ ok: true, deduped: true });
      }

      // 2) 條件扣點（無需交易；DO 串行處理可避免競態）
      const upd = await this.env.APP_DB.prepare(
        "UPDATE point_accounts SET balance = balance - ?1, updated_at = ?2 WHERE id = ?3 AND balance >= ?1"
      )
        .bind(body.cost, now, body.accountId)
        .run();

      if (upd.meta.changes === 0) {
        // 扣點失敗：把剛插入的去重記錄撤回，方便之後重試
        await this.env.APP_DB.prepare(
          "DELETE FROM point_dedupe WHERE account_id=?1 AND link_id=?2 AND bucket_minute=?3 AND platform=?4"
        )
          .bind(body.accountId, body.linkId, bucketMinute, body.platform)
          .run();

        const exists = await this.env.APP_DB.prepare(
          "SELECT 1 FROM point_accounts WHERE id=?1"
        )
          .bind(body.accountId)
          .first();

        if (!exists) return new Response("Account Not Found", { status: 404 });
        return new Response("Insufficient points", { status: 402 });
      }

      // 3) 記流水
      const ledgerId = uuidv4();
      await this.env.APP_DB.prepare(
        "INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)"
      )
        .bind(
          ledgerId,
          body.accountId,
          -body.cost,
          body.reason || "download",
          body.linkId,
          bucketMinute,
          body.platform,
          now
        )
        .run();

      return Response.json({ ok: true, ledgerId });
    } catch (e) {
      return new Response("DO Error: " + (e as Error).message, { status: 500 });
    }
  }
}
