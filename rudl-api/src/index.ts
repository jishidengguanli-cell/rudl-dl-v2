// src/index.ts
import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { auth, withCors, mustUser } from "./auth";
import { installMeLinks } from "./me_links";
import type {
  D1Database,
  KVNamespace,
  R2Bucket,
  DurableObjectNamespace,
} from "cloudflare:workers";

// ---- Environment typings ----
export interface Env {
  APP_DB: D1Database;
  APP_KV: KVNamespace;
  R2_BUCKET: R2Bucket;
  PointAccountDO: DurableObjectNamespace;
  R2_PUBLIC_HOST: string;
  ADMIN_TOKEN: string;
}

type Platform = "apk" | "ipa";
// ---- App & CORS ----
const app = new Hono<{ Bindings: Env; Variables: { userId?: string } }>();

installMeLinks(app);

// 允許跨網域並帶 cookie（web → api）
app.use("*", withCors);

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

/* =========================
 * 1) Admin: 建使用者
 * body: { email: string, initialBalance?: number }
 * ========================= */
app.post("/admin/users", async (c) => {
  const { email, initialBalance = 0 } = await readJSON<{ email: string; initialBalance?: number }>(c);
  if (!email) return c.text("email required", 400);

  const id = crypto.randomUUID();
  const now = Date.now();
  const db = c.env.APP_DB;

  await db
    .prepare("INSERT INTO users (id, email, pw_hash, role, created_at) VALUES (?1, ?2, '', 'user', ?3)")
    .bind(id, email, now)
    .run();

  await db
    .prepare("INSERT INTO point_accounts (id, user_id, balance, updated_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, id, initialBalance, now)
    .run();

  if (initialBalance > 0) {
    await db
      .prepare(
        "INSERT INTO point_ledger (id, account_id, delta, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
      )
      .bind(crypto.randomUUID(), id, initialBalance, "init credit", now)
      .run();
  }

  return c.json({ id, email, balance: initialBalance, created_at: now });
});

/* =========================
 * 2) Admin: 充值（套餐）
 * body: { userId: string, packageId: 'P1'|'P2'|'P3'|'P5'|'P6'|'P7' }
 * ========================= */
app.post("/admin/recharge", async (c) => {
  const { userId, packageId } = await readJSON<{ userId: string; packageId: string }>(c);
  if (!userId || !packageId) return c.text("userId & packageId required", 400);

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

  const acc = await db
    .prepare("SELECT balance FROM point_accounts WHERE id=?1")
    .bind(userId)
    .first<{ balance: number }>();
  if (!acc) return c.text("User/Account Not Found", 404);

  const newBal = (acc.balance || 0) + sel.points;

  // 同步更新餘額 + 新增明細（使用 account_id / delta）
  await db.batch([
    db.prepare("UPDATE point_accounts SET balance=?, updated_at=? WHERE id=?").bind(newBal, now, userId),
    db
      .prepare(
        "INSERT INTO point_ledger (id, account_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), userId, sel.points, `recharge ${packageId}`, now),
  ]);

  return c.json({ ok: true, balance: newBal });
});

/* =========================
 * 3) Admin: 建檔案
 * body: { ownerId, platform:'apk'|'ipa', package_name, version, size?, r2_key, channel?, sha256? }
 * ========================= */
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

  const acc = await c.env.APP_DB.prepare("SELECT 1 FROM point_accounts WHERE id=?1").bind(body.ownerId).first();
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

/* =========================
 * 4) Admin: 建連結
 * body: { fileId: string, title?: string, code: string, cn_direct?: number (0/1) }
 * ========================= */
app.post("/admin/links", async (c) => {
  const body = await readJSON<{ fileId: string; title?: string; code: string; cn_direct?: number }>(c);
  if (!body.fileId || !body.code) return c.text("fileId & code required", 400);

  const dup = await c.env.APP_DB.prepare("SELECT 1 FROM links WHERE code=?1").bind(body.code).first();
  if (dup) {
    c.status(409);
    return c.text("code already exists");
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.APP_DB
    .prepare(
      `INSERT INTO links (id, code, title, file_id, is_active, cn_direct, created_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)`
    )
    .bind(id, body.code, body.fileId, body.title ?? "", body.cn_direct ? 1 : 0, now)
    .run();

  return c.json({ id, code: body.code });
});

/* =========================
 * 5) Admin: Users 列表（搜尋 + 分頁）
 * ========================= */
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

/* =========================
 * 6) Admin: Files 列表（搜尋 + 分頁）
 * ========================= */
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

/* =========================
 * 7) Admin: Links 列表（搜尋 + 分頁）
 * ========================= */
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

/* =========================
 * 8) Admin: 編輯 File
 * ========================= */
app.patch("/admin/files/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJSON<any>(c);

  const fields: string[] = [];
  const binds: any[] = [];

  if (body.ownerId) {
    const ok = await c.env.APP_DB.prepare("SELECT 1 FROM point_accounts WHERE id=?1").bind(body.ownerId).first();
    if (!ok) return c.text("ownerId not found", 400);
    fields.push("owner_id=?");
    binds.push(body.ownerId);
  }
  if (typeof body.r2_key === "string") { fields.push("r2_key=?"); binds.push(body.r2_key); }
  if (typeof body.package_name === "string") { fields.push("package_name=?"); binds.push(body.package_name); }
  if (typeof body.channel === "string" || body.channel === null) { fields.push("channel=?"); binds.push(body.channel); }
  if (typeof body.version === "string") { fields.push("version=?"); binds.push(body.version); }
  if (Number.isFinite(body.size)) { fields.push("size=?"); binds.push(Number(body.size)); }
  if (typeof body.sha256 === "string" || body.sha256 === null) { fields.push("sha256=?"); binds.push(body.sha256); }

  if (!fields.length) return c.text("no fields", 400);

  await c.env.APP_DB.prepare(`UPDATE files SET ${fields.join(", ")} WHERE id=?`).bind(...binds, id).run();

  const row = await c.env.APP_DB
    .prepare(
      "SELECT id, owner_id, platform, package_name, channel, version, size, sha256, r2_key, created_at FROM files WHERE id=?1"
    )
    .bind(id)
    .first();

  return c.json(row);
});

/* =========================
 * 9) Admin: 編輯 Link
 * ========================= */
app.patch("/admin/links/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJSON<any>(c);

  const fields: string[] = [];
  const binds: any[] = [];

  if (typeof body.title === "string") { fields.push("title=?"); binds.push(body.title); }
  if (typeof body.is_active !== "undefined") { fields.push("is_active=?"); binds.push(body.is_active ? 1 : 0); }
  if (typeof body.cn_direct !== "undefined") { fields.push("cn_direct=?"); binds.push(body.cn_direct ? 1 : 0); }
  if (typeof body.code === "string") { fields.push("code=?"); binds.push(body.code); }
  if (typeof body.fileId === "string") { fields.push("file_id=?"); binds.push(body.fileId); }

  if (!fields.length) return c.text("no fields", 400);

  try {
    await c.env.APP_DB.prepare(`UPDATE links SET ${fields.join(", ")} WHERE id=?`).bind(...binds, id).run();
  } catch (e: any) {
    if (String(e?.message || "").includes("UNIQUE")) {
      c.status(409);
      return c.text("code already exists");
    }
    throw e;
  }

  const row = await c.env.APP_DB
    .prepare("SELECT id, code, title, file_id, is_active, cn_direct, created_at FROM links WHERE id=?1")
    .bind(id)
    .first();

  return c.json(row);
});

/* =========================
 * 10) Admin: 刪除 Link
 * ========================= */
app.delete("/admin/links/:id", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.APP_DB.prepare("DELETE FROM links WHERE id=?1").bind(id).run();
  const changes = (res as any)?.meta?.changes ?? (res as any)?.changes ?? 0;
  return c.json({ ok: true, changes });
});

/* =========================
 * 11) Admin: 刪除 File（若仍有連結 → 409）
 * ========================= */
app.delete("/admin/files/:id", async (c) => {
  const id = c.req.param("id");
  const cnt = await c.env.APP_DB.prepare("SELECT COUNT(1) AS n FROM links WHERE file_id=?1").bind(id).first<{ n: number }>();
  const n = cnt?.n ?? 0;
  if (n > 0) {
    c.status(409);
    return c.text("has_links");
  }
  const res = await c.env.APP_DB.prepare("DELETE FROM files WHERE id=?1").bind(id).run();
  const changes = (res as any)?.meta?.changes ?? (res as any)?.changes ?? 0;
  return c.json({ ok: true, changes });
});

/* =========================
 * 12) Admin: 手動加/扣點
 * POST /admin/points/adjust { userId: string, delta: number, reason?: string }
 * ========================= */
app.post("/admin/points/adjust", async (c) => {
  try {
    const { userId, delta, reason } = await c.req.json<{ userId: string; delta: number; reason?: string }>();
    if (!userId || !Number.isFinite(Number(delta))) {
      return c.json({ error: "bad_request" }, 400);
    }
    const db = c.env.APP_DB;
    const now = Date.now();
    const ledId = crypto.randomUUID();

    const res = await db.batch([
      db.prepare("UPDATE point_accounts SET balance = balance + ?, updated_at=? WHERE id=?")
        .bind(Number(delta), now, userId),
      db.prepare(
        "INSERT INTO point_ledger (id, account_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(ledId, userId, Number(delta), reason ?? null, now),
    ]);

    const changed = (res?.[0] as any)?.meta?.changes ?? 0;
    if (!changed) return c.text("User/Account Not Found", 404);

    const row = await db.prepare("SELECT balance FROM point_accounts WHERE id=?").bind(userId).first<{ balance: number }>();
    return c.json({ ok: true, balance: row?.balance ?? null, ledgerId: ledId });
  } catch (e: any) {
    console.error("adjust error", e);
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

/* =========================
 * 13) Admin: 查某使用者的點數異動（ledger）
 * GET /admin/points/ledger?userId=...&limit=20&offset=0
 * ========================= */
app.get("/admin/points/ledger", async (c) => {
  try {
    const userId = c.req.query("userId") || "";
    const limit = Number(c.req.query("limit") ?? 20);
    const offset = Number(c.req.query("offset") ?? 0);
    if (!userId) return c.json({ items: [], nextOffset: null });

    const rs = await c.env.APP_DB.prepare(
      `SELECT id, delta, reason, created_at
         FROM point_ledger
        WHERE account_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`
    ).bind(userId, limit, offset)
     .all<{ id: string; delta: number; reason: string | null; created_at: number }>();

    const items = rs?.results ?? [];
    const nextOffset = items.length === limit ? offset + limit : null;
    return c.json({ items, nextOffset });
  } catch (e: any) {
    console.error("ledger error", e);
    return c.json({ error: e?.message || String(e) }, 500);
  }
});

/* =========================
 * 使用者自己的功能（需登入）
 * ========================= */

// 1) 取得自己的分發列表（連 files）
app.get("/me/links", mustUser, async (c) => {
  const userId = c.get("userId") as string;
  const limit = Number(c.req.query("limit") ?? 20);
  const offset = Number(c.req.query("offset") ?? 0);

  const rows = await c.env.APP_DB.prepare(
    `SELECT l.id, l.code, l.title, l.is_active, l.created_at,
            f.id as file_id, f.platform, f.package_name, f.version, f.size
       FROM links l
       JOIN files f ON f.id = l.file_id
      WHERE f.owner_id = ?
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?`
  ).bind(userId, limit, offset).all();

  return c.json({ ok: true, items: rows.results ?? [] });
});

// 2) 新增自己的 File（先用手動輸入 r2_key；之後再補 R2 簽名上傳）
app.post("/me/files", mustUser, async (c) => {
  // 允許 multipart
  const ct = c.req.header("content-type") || "";
  if (!ct.toLowerCase().startsWith("multipart/form-data")) {
    return c.text("Content-Type must be multipart/form-data", 400);
  }

  const userId = c.get("userId") as string;
  const form = await c.req.formData();

  const file = form.get("file");
  if (!(file instanceof File)) return c.text("file is required", 400);

  // 可由前端帶，也可自動判斷
  const platform: Platform =
    ((form.get("platform") as string) as Platform) ??
    (file.name.toLowerCase().endsWith(".ipa") ? "ipa" : "apk");

  const packageName = (form.get("package_name") as string) || "";
  const version = (form.get("version") as string) || "1.0.0";

  const now = Date.now();
  const safeName = encodeURIComponent(file.name);
  const r2Key = `uploads/${userId}/${now}/${safeName}`;

  // Put 到 R2（串流）
  await c.env.R2_BUCKET.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  // 計算 sha256
  const ab = await file.arrayBuffer();
  const shaBuf = await crypto.subtle.digest("SHA-256", ab);
  const sha256 = [...new Uint8Array(shaBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const id = crypto.randomUUID();
  const size = file.size;

  await c.env.APP_DB
    .prepare(
      `INSERT INTO files (id, owner_id, platform, package_name, version, size, r2_key, sha256, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(id, userId, platform, packageName, version, size, r2Key, sha256, now)
    .run();

  return c.json({
    ok: true,
    file: {
      id,
      platform,
      package_name: packageName,
      version,
      size,
      r2_key: r2Key,
      sha256,
      created_at: now,
    },
  });
});

// 3) 針對自己的 File 新增 Link
app.post("/me/links", mustUser, async (c) => {
  const userId = c.get("userId") as string;

  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    cn_direct?: number | boolean;
    locale?: string;
    apk?: { file_id: string } | null;
    ios?: { file_id: string } | null;
    code?: string;
    // 新增：暫存提交
    apk_temp_key?: string | null;
    ios_temp_key?: string | null;

    // 顯示用（可留空）
    version?: string | null;
    bundle_id?: string | null;
  };

  const title = (body.title ?? "").trim();
  const cnDirect = body.cn_direct ? 1 : 0;
  const locale = (body.locale || "en").trim();
  const now = Date.now();

  type FileRow = { id: string; owner_id: string; platform: Platform };

  // 先處理 temp_key -> 產生 files 資料列
  async function finalizeFromTemp(tempKey: string, platform: Platform): Promise<FileRow> {
    const raw = await c.env.APP_KV.get(`temp_upload:${tempKey}`);
    if (!raw) throw new Error("temp key not found");
    const meta = JSON.parse(raw) as { userId: string; r2_key: string; platform: string; size: number };
    if (meta.userId !== userId) throw new Error("temp key not owned by user");
    if (meta.platform !== platform) throw new Error("platform mismatch");

    // 讀暫存物件
    const tmpObj = await c.env.R2_BUCKET.get(meta.r2_key);
    if (!tmpObj || !tmpObj.body) throw new Error("temp object not found");

    // 正式 key：dist/<user>/<link-proto>/<platform>/<uuid>.ext
    // 注意：此時還沒有 linkId，因此先用一個 uuid 當 proto 目錄；或直接 uploads/<user>/<uuid>.ext 也可
    const fileId = crypto.randomUUID();
    const ext = platform === "apk" ? ".apk" : ".ipa";
    const finalKey = `uploads/${userId}/${fileId}${ext}`;

    // 搬移 = put 新的 + 刪舊的（R2 沒 rename）
    await c.env.R2_BUCKET.put(finalKey, tmpObj.body, { httpMetadata: tmpObj.httpMetadata });
    await c.env.R2_BUCKET.delete(meta.r2_key);
    await c.env.APP_KV.delete(`temp_upload:${tempKey}`);

    // 寫入 files（package_name/version 作顯示用，可帶 body.bundle_id/version，或留空）
    const pkg = (body.bundle_id ?? "").trim();
    const ver = (body.version ?? "").trim();

    await c.env.APP_DB
      .prepare(
        `INSERT INTO files (id, owner_id, platform, package_name, version, size, r2_key, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      )
      .bind(fileId, userId, platform, pkg, ver, meta.size || 0, finalKey, now)
      .run();

    return { id: fileId, owner_id: userId, platform };
  }

  // 取得既有 file（你原本就有）
  const getFile = async (id: string) =>
    (await c.env.APP_DB
      .prepare("SELECT id, owner_id, platform FROM files WHERE id=?1")
      .bind(id)
      .first<FileRow>()) || null;

  // 收集本次要建 link 的兩個平台檔案
  let apkFile: FileRow | null = null;
  let iosFile: FileRow | null = null;

  // 先走 temp_key（若有）
  if (body.apk_temp_key) apkFile = await finalizeFromTemp(body.apk_temp_key, "apk");
  if (body.ios_temp_key) iosFile = await finalizeFromTemp(body.ios_temp_key, "ipa");

  // 再支援你原本的 file_id 型式（相容）
  if (!apkFile && body.apk?.file_id) {
    const f = await getFile(body.apk.file_id);
    if (!f) return c.text("apk file not found", 404);
    if (f.owner_id !== userId) return c.text("apk file not owned by user", 403);
    if (f.platform !== "apk") return c.text("apk file_id is not an APK", 400);
    apkFile = f;
  }
  if (!iosFile && body.ios?.file_id) {
    const f = await getFile(body.ios.file_id);
    if (!f) return c.text("ios file not found", 404);
    if (f.owner_id !== userId) return c.text("ios file not owned by user", 403);
    if (f.platform !== "ipa") return c.text("ios file_id is not an IPA", 400);
    iosFile = f;
  }

  if (!apkFile && !iosFile) {
    return c.text("no file selected", 400);
  }

  // 產 code（你原邏輯保留），確保唯一
  let code =
    body.code && /^[a-zA-Z]{4}$/.test(body.code) ? body.code : randomCode4();
  for (let i = 0; i < 5; i++) {
    const exists = await c.env.APP_DB
      .prepare("SELECT 1 FROM links WHERE code=?1 LIMIT 1")
      .bind(code)
      .first();
    if (!exists) break;
    code = randomCode4();
    if (i === 4) return c.text("code collision, please retry", 409);
  }

  const now2 = Date.now();
  const linksCreated: Array<{ id: string; platform: Platform }> = [];

  const insertLink = async (fileId: string, platform: Platform) => {
    const id = uuidv4();
    await c.env.APP_DB
      .prepare(
        `INSERT INTO links (id, code, file_id, title, is_active, created_at, cn_direct)
         VALUES (?,?,?,?, 1, ?, ?)`
      )
      .bind(id, code, fileId, title, now2, cnDirect)
      .run();
    linksCreated.push({ id, platform });
  };

  if (apkFile) await insertLink(apkFile.id, "apk");
  if (iosFile) await insertLink(iosFile.id, "ipa");

  // 存語系在 KV（你原做法）
  await c.env.APP_KV.put(`link_lang:${code}`, locale);

  return c.json({ ok: true, code, links: linksCreated });
});



// === 列出自己的檔案（提供下拉/回填用）===
app.get("/me/files", mustUser, async (c) => {
  const userId = c.get("userId") as string;
  const limit = Number(c.req.query("limit") ?? "100");

  const rs = await c.env.APP_DB
    .prepare(
      `SELECT id, owner_id, platform, package_name, version, size, r2_key, sha256, created_at
       FROM files WHERE owner_id=? ORDER BY created_at DESC LIMIT ?`
    )
    .bind(userId, limit)
    .all();

  return c.json({ ok: true, files: rs.results ?? [] });
});

// === 上傳檔案（本機 → Worker → R2）===
app.post("/me/upload", withCors, mustUser, async (c) => {
  const userId = c.get("userId") as string;

  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  const platform = (form.get("platform") as string | null)?.toLowerCase();

  // 可選（顯示用；你之後也可以做自動解析）
  const pkg = ((form.get("package_name") as string | null) ?? "").trim();
  const ver = ((form.get("version") as string | null) ?? "").trim();

  if (!(file instanceof File)) return c.text("file is required", 400);
  if (platform !== "apk" && platform !== "ipa") {
    return c.text("platform must be apk or ipa", 400);
  }

  if (platform === "apk" && !file.name.toLowerCase().endsWith(".apk")) {
    return c.text("file extension must be .apk for platform=apk", 400);
  }
  if (platform === "ipa" && !file.name.toLowerCase().endsWith(".ipa")) {
    return c.text("file extension must be .ipa for platform=ipa", 400);
  }

  // 統一用 uuid + 副檔名，避免使用者檔名造成覆寫/字元問題
  const id = crypto.randomUUID();
  const ext = platform === "apk" ? ".apk" : ".ipa";

  const r2Key =
    pkg && ver
      ? `apps/${pkg}/${ver}/${id}${ext}`
      : `uploads/${userId}/${id}${ext}`;

  // 串流寫入 R2
  await c.env.R2_BUCKET.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  const size = file.size || 0;

  // 寫 files（package_name/version 可為空字串）
  await c.env.APP_DB
    .prepare(
      `INSERT INTO files (id, owner_id, platform, package_name, version, size, r2_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(id, userId, platform, pkg, ver, size, r2Key, Date.now())
    .run();

  // 回傳格式改為 { ok:true, file:{ id, ... } }，對齊前端 uploadOne 的使用
  return c.json({
    ok: true,
    file: {
      id,
      r2_key: r2Key,
      size,
      platform,
      package_name: pkg,
      version: ver,
    },
  });
});

function randomCode4() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

app.post("/me/upload-temp", withCors, mustUser, async (c) => {
  const userId = c.get("userId") as string;
  const form = await c.req.formData();
  const file = form.get("file");
  const platform = (form.get("platform") as string | null)?.toLowerCase();

  if (!(file instanceof File)) return c.text("file is required", 400);
  if (platform !== "apk" && platform !== "ipa") return c.text("platform must be apk or ipa", 400);

  const ext = platform === "apk" ? ".apk" : ".ipa";
  const token = crypto.randomUUID(); // 用這個當 temp_key
  const r2Key = `temp/${userId}/${token}${ext}`;

  await c.env.R2_BUCKET.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  const meta = {
    userId,
    platform,
    r2_key: r2Key,
    size: file.size || 0,
    created_at: Date.now(),
  };

  // 設 1 小時 TTL（你可改長短）
  await c.env.APP_KV.put(`temp_upload:${token}`, JSON.stringify(meta), { expirationTtl: 3600 });

  return c.json({ ok: true, temp_key: token, size: meta.size, platform });
});

app.post("/me/upload-discard", withCors, mustUser, async (c) => {
  const userId = c.get("userId") as string;
  const { temp_key } = await c.req.json().catch(() => ({ temp_key: "" }));
  if (!temp_key) return c.text("temp_key required", 400);

  const raw = await c.env.APP_KV.get(`temp_upload:${temp_key}`);
  if (raw) {
    const meta = JSON.parse(raw) as { userId: string; r2_key: string };
    if (meta.userId === userId) {
      await c.env.R2_BUCKET.delete(meta.r2_key);
    }
    await c.env.APP_KV.delete(`temp_upload:${temp_key}`);
  }
  return c.json({ ok: true });
});


// 掛載 Auth 路由
app.route("/auth", auth);

export default app;
