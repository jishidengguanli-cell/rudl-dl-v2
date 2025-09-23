// src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { D1Database } from '@cloudflare/workers-types';

// ---- Environment typings（簡化，避免型別阻擋部署）----
type D1 = any;

type Env = {
  ADMIN_TOKEN: string;
  APP_DB: D1;            // D1 Database
  // 如需使用 R2 / DO 再加：R2_BUCKET: R2Bucket; PointAccountDO: DurableObjectNamespace;
};

// ---- App & CORS ----
const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: [
      "http://localhost:3000",
      "https://admin.dataruapp.com",
      // 如你用 Pages 的暫時網域，記得加進來：
      // "https://<your-pages>.pages.dev",
    ],
    allowHeaders: ["Content-Type", "x-admin-token"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  })
);

// ---- Health ----
app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

// ---- 管理員授權：套用在 /admin/* 全路由 ----
app.use("/admin/*", async (c, next) => {
  const token = c.req.header("x-admin-token");
  if (!token || token !== c.env.ADMIN_TOKEN) {
    return c.text("Unauthorized", 401);
  }
  await next();
});

// 工具：安全取 JSON
async function readJSON<T = any>(c: any): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    c.status(400);
    throw new Error("Invalid JSON body");
  }
}

// ========= 1) Admin: 建使用者 =========
// body: { email: string, initialBalance?: number }
app.post("/admin/users", async (c) => {
  const { email, initialBalance = 0 } = await readJSON<{
    email: string;
    initialBalance?: number;
  }>(c);
  if (!email) return c.text("email required", 400);

  const id = crypto.randomUUID(); // 使用 UUID；你也可改成自定義 id
  const now = Date.now();

  const db = c.env.APP_DB;
  // 建 users
  await db
    .prepare(
      "INSERT INTO users (id, email, pw_hash, role, created_at) VALUES (?1, ?2, '', 'user', ?3)"
    )
    .bind(id, email, now)
    .run();

  // 建 point_accounts
  await db
    .prepare(
      "INSERT INTO point_accounts (id, user_id, balance, updated_at) VALUES (?1, ?2, ?3, ?4)"
    )
    .bind(id, id, initialBalance, now)
    .run();

  // 若有初始點數，寫 ledger
  if (initialBalance > 0) {
    await db
      .prepare(
        "INSERT INTO point_ledger (user_id, change, reason, created_at) VALUES (?1, ?2, ?3, ?4)"
      )
      .bind(id, initialBalance, "init credit", now)
      .run();
  }

  return c.json({ id, email, balance: initialBalance, created_at: now });
});

// ========= 2) Admin: 充值 =========
// body: { userId: string, packageId: 'P1'|'P2'|'P3'|'P5'|'P6'|'P7' }
app.post("/admin/recharge", async (c) => {
  const { userId, packageId } = await readJSON<{
    userId: string;
    packageId: string;
  }>(c);
  if (!userId || !packageId) return c.text("userId & packageId required", 400);

  // 你的包裝點數對照（可依你需求調整）
  const pkg: Record<string, { points: number; usd: number }> = {
    P1: { points: 500, usd: 1 },
    P2: { points: 3000, usd: 5 },
    P3: { points: 20000, usd: 15 },
    P5: { points: 50000, usd: 35 },
    P6: { points: 150000, usd: 100 },
    P7: { points: 500000, usd: 300 },
  };
  const sel = pkg[packageId];
  if (!sel) return c.text("invalid packageId", 400);

  const db = c.env.APP_DB;
  const now = Date.now();

  // 查餘額
  const acc = (await db
    .prepare("SELECT balance FROM point_accounts WHERE id=?1")
    .bind(userId)
    .first()) as { balance: number } | null;

  if (!acc) return c.text("User/Account Not Found", 404);
  const newBal = (acc.balance || 0) + sel.points;


  // 更新餘額
  await db
    .prepare("UPDATE point_accounts SET balance=?1, updated_at=?2 WHERE id=?3")
    .bind(newBal, now, userId)
    .run();

  // ledger
  await db
    .prepare(
      "INSERT INTO point_ledger (user_id, change, reason, created_at) VALUES (?1, ?2, ?3, ?4)"
    )
    .bind(userId, sel.points, `recharge ${packageId}`, now)
    .run();

  return c.json({ ok: true, balance: newBal, ledgerId: undefined });
});

// ========= 3) Admin: 建檔案 =========
// body: { ownerId, platform:'apk'|'ipa', package_name, version, size, r2_key, channel?, sha256? }
app.post("/admin/files", async (c) => {
  const body = await readJSON<{
    ownerId: string;
    platform: string;
    package_name: string;
    version: string;
    size?: number;
    r2_key: string;
    channel?: string | null;
    sha256?: string | null;
  }>(c);

  if (!body.ownerId || !body.platform || !body.package_name || !body.version || !body.r2_key) {
    return c.text("ownerId/platform/package_name/version/r2_key required", 400);
  }

  // 確認帳戶存在
  const acc = await c.env.APP_DB
    .prepare("SELECT 1 FROM point_accounts WHERE id=?1")
    .bind(body.ownerId)
    .first();
  if (!acc) return c.text("ownerId not found", 400);

  const id = crypto.randomUUID();
  const now = Date.now();

  await c.env.APP_DB
    .prepare(
      `INSERT INTO files (id, owner_id, platform, package_name, channel, version, size, sha256, r2_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    )
    .bind(
      id,
      body.ownerId,
      body.platform,
      body.package_name,
      body.channel ?? null,
      body.version,
      body.size ?? null,
      body.sha256 ?? null,
      body.r2_key,
      now
    )
    .run();

  return c.json({ id });
});

// ========= 4) Admin: 建連結 =========
// body: { fileId: string, title?: string, code: string, cn_direct?: number (0/1) }
app.post("/admin/links", async (c) => {
  const body = await readJSON<{
    fileId: string;
    title?: string;
    code: string;
    cn_direct?: number;
  }>(c);

  if (!body.fileId || !body.code) return c.text("fileId & code required", 400);

  // 檢查 code 唯一
  const dup = await c.env.APP_DB
    .prepare("SELECT 1 FROM links WHERE code=?1")
    .bind(body.code)
    .first();
  if (dup) {
    c.status(409);
    return c.text("code already exists");
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.APP_DB
    .prepare(
      `INSERT INTO links (id, code, file_id, title, is_active, cn_direct, created_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)`
    )
    .bind(id, body.code, body.fileId, body.title ?? "", body.cn_direct ? 1 : 0, now)
    .run();

  return c.json({ id, code: body.code });
});

// ========= 5) Admin: Users 列表（搜尋 + 分頁） =========
// GET /admin/users?q=&limit=20&offset=0
app.get("/admin/users", async (c) => {
  const url = new URL(c.req.url);
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const like = `%${q}%`;
  const { results } = await c.env.APP_DB
    .prepare(
      `SELECT u.id, u.email, pa.balance, u.created_at
       FROM users u
       LEFT JOIN point_accounts pa ON pa.id = u.id
       WHERE u.email LIKE ?1
       ORDER BY u.created_at DESC
       LIMIT ?2 OFFSET ?3`
    )
    .bind(like, limit, offset)
    .all();

  return c.json({
    items: results,
    nextOffset: results.length === limit ? offset + limit : null,
  });
});

// ========= 6) Admin: Files 列表 =========
// GET /admin/files?ownerId=&q=&limit=20&offset=0
app.get("/admin/files", async (c) => {
  const url = new URL(c.req.url);
  const ownerId = url.searchParams.get("ownerId");
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const like = `%${q}%`;
  let sql = `
    SELECT id, owner_id, platform, package_name, channel, version, size, sha256, r2_key, created_at
    FROM files
    WHERE 1=1
  `;
  const binds: any[] = [];
  if (ownerId) {
    sql += ` AND owner_id = ?`;
    binds.push(ownerId);
  }
  if (q) {
    sql += ` AND (package_name LIKE ? OR version LIKE ? OR r2_key LIKE ?)`;
    binds.push(like, like, like);
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const { results } = await c.env.APP_DB.prepare(sql).bind(...binds).all();
  return c.json({
    items: results,
    nextOffset: results.length === limit ? offset + limit : null,
  });
});

// ========= 7) Admin: Links 列表（新版，含搜尋 + 分頁） =========
// GET /admin/links?q=&limit=20&offset=0
app.get("/admin/links", async (c) => {
  const url = new URL(c.req.url);
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const like = `%${q}%`;
  const { results } = await c.env.APP_DB
    .prepare(
      `SELECT id, code, title, file_id, is_active, cn_direct, created_at
       FROM links
       WHERE (code LIKE ?1 OR title LIKE ?1)
       ORDER BY created_at DESC
       LIMIT ?2 OFFSET ?3`
    )
    .bind(like, limit, offset)
    .all();

  return c.json({
    items: results,
    nextOffset: results.length === limit ? offset + limit : null,
  });
});

// ========= 8) Admin: 編輯 File（保留功能完整版本） =========
// PATCH /admin/files/:id
// body 可帶：ownerId / r2_key / package_name / channel / version / size / sha256
app.patch("/admin/files/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJSON<any>(c);

  const fields: string[] = [];
  const binds: any[] = [];

  if (body.ownerId) {
    // 確認 owner 存在
    const ok = await c.env.APP_DB
      .prepare("SELECT 1 FROM point_accounts WHERE id=?1")
      .bind(body.ownerId)
      .first();
    if (!ok) return c.text("ownerId not found", 400);
    fields.push("owner_id=?");
    binds.push(body.ownerId);
  }
  if (typeof body.r2_key === "string") {
    fields.push("r2_key=?");
    binds.push(body.r2_key);
  }
  if (typeof body.package_name === "string") {
    fields.push("package_name=?");
    binds.push(body.package_name);
  }
  if (typeof body.channel === "string" || body.channel === null) {
    fields.push("channel=?");
    binds.push(body.channel);
  }
  if (typeof body.version === "string") {
    fields.push("version=?");
    binds.push(body.version);
  }
  if (Number.isFinite(body.size)) {
    fields.push("size=?");
    binds.push(Number(body.size));
  }
  if (typeof body.sha256 === "string" || body.sha256 === null) {
    fields.push("sha256=?");
    binds.push(body.sha256);
  }

  if (!fields.length) return c.text("no fields", 400);

  await c.env.APP_DB
    .prepare(`UPDATE files SET ${fields.join(", ")} WHERE id=?`)
    .bind(...binds, id)
    .run();

  const row = await c.env.APP_DB
    .prepare(
      "SELECT id, owner_id, platform, package_name, channel, version, size, sha256, r2_key, created_at FROM files WHERE id=?1"
    )
    .bind(id)
    .first();

  return c.json(row);
});

// ========= 9) Admin: 編輯 Link（新版，含 code/fileId） =========
// PATCH /admin/links/:id
// body 可帶：title / is_active(0|1) / cn_direct(0|1) / code / fileId
app.patch("/admin/links/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJSON<any>(c);

  const fields: string[] = [];
  const binds: any[] = [];

  if (typeof body.title === "string") {
    fields.push("title=?");
    binds.push(body.title);
  }
  if (typeof body.is_active !== "undefined") {
    fields.push("is_active=?");
    binds.push(body.is_active ? 1 : 0);
  }
  if (typeof body.cn_direct !== "undefined") {
    fields.push("cn_direct=?");
    binds.push(body.cn_direct ? 1 : 0);
  }
  if (typeof body.code === "string") {
    fields.push("code=?");
    binds.push(body.code);
  }
  if (typeof body.fileId === "string") {
    fields.push("file_id=?");
    binds.push(body.fileId);
  }

  if (!fields.length) return c.text("no fields", 400);

  try {
    await c.env.APP_DB
      .prepare(`UPDATE links SET ${fields.join(", ")} WHERE id=?`)
      .bind(...binds, id)
      .run();
  } catch (e: any) {
    if (String(e?.message || "").includes("UNIQUE")) {
      c.status(409);
      return c.text("code already exists");
    }
    throw e;
  }

  const row = await c.env.APP_DB
    .prepare(
      "SELECT id, code, title, file_id, is_active, cn_direct, created_at FROM links WHERE id=?1"
    )
    .bind(id)
    .first();

  return c.json(row);
});

// === DELETE Link ===
app.delete("/admin/links/:id", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.APP_DB.prepare("DELETE FROM links WHERE id=?1").bind(id).run();
  const changes = (res as any)?.meta?.changes ?? (res as any)?.changes ?? 0;
  return c.json({ ok: true, changes });
});

// === DELETE File（若還有連結，回 409）===
app.delete("/admin/files/:id", async (c) => {
  const id = c.req.param("id");
  // 檔案是否仍被連結指向
  const cnt = (await c.env.APP_DB
    .prepare("SELECT COUNT(1) AS n FROM links WHERE file_id=?1")
    .bind(id)
    .first()) as { n: number } | null;

  const n = (cnt as any)?.n ?? (cnt as any)?.["COUNT(1)"] ?? 0;
  if (n > 0) {
    c.status(409);
    return c.text("has_links");
  }
  const res = await c.env.APP_DB.prepare("DELETE FROM files WHERE id=?1").bind(id).run();
  const changes = (res as any)?.meta?.changes ?? (res as any)?.changes ?? 0;
  return c.json({ ok: true, changes });
});


export default app;
