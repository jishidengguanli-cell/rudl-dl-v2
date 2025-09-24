import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import type { D1Database } from "@cloudflare/workers-types";

type Platform = "apk" | "ipa";

export interface Env {
  APP_DB: D1Database;
  APP_KV: KVNamespace;
  R2_BUCKET: R2Bucket;
  PointAccountDO: DurableObjectNamespace;
  R2_PUBLIC_HOST: string; // cdn.dataruapp.com
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

app.get("/dl/:code", async (c) => {
  const code = c.req.param("code");
  const url = new URL(c.req.url);
  const p: Platform = (url.searchParams.get("p") as Platform) || "apk";

  const country = c.req.raw.headers.get("cf-ipcountry") || "";
  const ua = c.req.header("user-agent") || "";
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "";

  // 1) 找 link + file
  const row = await c.env.APP_DB.prepare(
    "SELECT l.id as link_id, f.id as file_id, f.owner_id, f.platform as file_platform, f.r2_key, f.version FROM links l JOIN files f ON l.file_id=f.id WHERE l.code=?1 AND l.is_active=1"
  ).bind(code).first<{
    link_id: string; file_id: string; owner_id: string; file_platform: Platform; r2_key: string; version: string | null;
  }>();
  if (!row) return c.text("Not Found", 404);

  const platform: Platform = url.searchParams.has("p") ? p : row.file_platform;

  // 2) 記錄下載（billed 先為 0）
  const dlId = uuidv4();
  await c.env.APP_DB.prepare(
    "INSERT INTO downloads (id, link_id, user_id, ip, country, ua, platform, billed, created_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, 0, ?7)"
  ).bind(dlId, row.link_id, ip, country, ua, platform, Date.now()).run();

  // 3) 扣點（同分鐘冪等；對 link 擁有者）
  const cost = platform === "apk" ? 3 : 5;
  const accountId = row.owner_id;
  const stubId = c.env.PointAccountDO.idFromName(accountId);
  const stub = c.env.PointAccountDO.get(stubId);

  const doRes = await stub.fetch("https://do/charge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, linkId: row.link_id, platform, cost, reason: "download" })
  });
  if (!doRes.ok) return c.text(await doRes.text(), doRes.status);

  await c.env.APP_DB.prepare("UPDATE downloads SET billed=1, billed_at=?1 WHERE id=?2")
    .bind(Date.now(), dlId).run();

  // 4) 302 轉到 R2 自訂網域
  const redirectUrl = `https://${c.env.R2_PUBLIC_HOST}/${encodeURI(row.r2_key)}`;
  return c.redirect(redirectUrl, 302);
});

export default app;
export { PointAccountDO } from "./do_point_account";
