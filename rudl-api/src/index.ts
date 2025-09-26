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

/** ==== Bindings ==== */
export interface Env {
  APP_DB: D1Database;
  APP_KV: KVNamespace;
  R2_BUCKET: R2Bucket;

  // 既有綁定
  PointAccountDO: DurableObjectNamespace;
  R2_PUBLIC_HOST: string;
  ADMIN_TOKEN: string;

  // 直傳 R2 簽名所需
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

type Platform = "apk" | "ipa";

const app = new Hono<{ Bindings: Env; Variables: { userId?: string } }>();

// 既有 me 下載頁等路由
installMeLinks(app);

// 跨域（需要帶 cookie）
app.use("*", withCors);

/* =========================
 * 健康檢查
 * ========================= */
app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

/* =========================
 * 管理員保護
 * ========================= */
app.use("/admin/*", async (c, next) => {
  const token = c.req.header("x-admin-token");
  if (!token || token !== c.env.ADMIN_TOKEN) return c.text("Unauthorized", 401);
  await next();
});

/* 小工具：安全讀 JSON */
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
 * 3) Admin: 建檔案（直接插 DB）
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
    .bind(id, body.code, body.title ?? "", body.fileId, body.cn_direct ? 1 : 0, now)
    .run();

  return c.json({ id, code: body.code });
});

/* =========================
 * 5) Admin: Users 列表
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
 * 6) Admin: Files 列表
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
 * 7) Admin: Links 列表
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
 * 8) Admin: 編輯 / 刪除
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

app.delete("/admin/links/:id", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.APP_DB.prepare("DELETE FROM links WHERE id=?1").bind(id).run();
  const changes = (res as any)?.meta?.changes ?? (res as any)?.changes ?? 0;
  return c.json({ ok: true, changes });
});

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
 * 9) 使用者：查自己的分發
 * ========================= */
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

/* =========================
 * 10) 使用者：列出自己的檔案（下拉/回填用）
 * ========================= */
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

/* ========= R2 直傳：簽名工具 ========= */
function encodeRfc3986(s: string) {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function pathEncode(key: string) {
  return key.split('/').map(encodeRfc3986).join('/');
}
async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function importKeyRaw(rawKey: ArrayBuffer | Uint8Array) {
  return crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function hmacKey(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await importKeyRaw(key);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}
async function getSigningKey(secret: string, date: string, region: string, service: string) {
  const kDate   = await hmacKey(new TextEncoder().encode('AWS4' + secret), date);
  const kRegion = await hmacKey(kDate, region);
  const kServ   = await hmacKey(kRegion, service);
  const kSig    = await hmacKey(kServ, 'aws4_request');
  return await importKeyRaw(kSig);
}
async function hmacHex(key: CryptoKey, data: string) {
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function amzDateNow() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth()+1).padStart(2,'0');
  const dd = String(d.getUTCDate()).padStart(2,'0');
  const hh = String(d.getUTCHours()).padStart(2,'0');
  const mi = String(d.getUTCMinutes()).padStart(2,'0');
  const ss = String(d.getUTCSeconds()).padStart(2,'0');
  const datestamp = `${yyyy}${mm}${dd}`;
  const amzDate = `${datestamp}T${hh}${mi}${ss}Z`;
  return { datestamp, amzDate };
}
async function signR2PutUrl(env: Env, key: string, expiresSec = 3600) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const bucket = env.R2_BUCKET_NAME;
  const { datestamp, amzDate } = amzDateNow();

  const algorithm = 'AWS4-HMAC-SHA256';
  const credential = `${env.R2_ACCESS_KEY_ID}/${datestamp}/auto/s3/aws4_request`;
  const signedHeaders = 'host';

  const qs = new URLSearchParams({
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': signedHeaders
  });

  const canonicalQuery = qs.toString();
  const path = `/${bucket}/${pathEncode(key)}`;
  const canonicalRequest =
    `PUT\n${path}\n${canonicalQuery}\nhost:${host}\n\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
  const crHash = await sha256Hex(canonicalRequest);

  const stringToSign =
    `${algorithm}\n${amzDate}\n${datestamp}/auto/s3/aws4_request\n${crHash}`;
  const k = await getSigningKey(env.R2_SECRET_ACCESS_KEY, datestamp, 'auto', 's3');
  const signature = await hmacHex(k, stringToSign);

  const url = `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return url;
}

/* ========= R2 直傳：API ========= */

/** 取得預簽 URL（上傳到 tmp/ 前綴） */
app.post("/me/upload-temp", mustUser, async (c) => {
  const userId = c.get("userId") as string;
  const body = (await c.req.json().catch(() => ({}))) as {
    platform?: "apk" | "ipa";
    filename?: string;
  };

  if (body.platform !== "apk" && body.platform !== "ipa") return c.text("platform must be apk or ipa", 400);
  if (!body.filename) return c.text("filename required", 400);

  const safeName = body.filename.replace(/[^\w.\-]+/g, "_");
  const tmpKey = `tmp/${userId}/${crypto.randomUUID()}-${safeName}`;

  const putUrl = await signR2PutUrl(c.env, tmpKey, 300); // 5 分鐘
  return c.json({ ok: true, putUrl, key: tmpKey, expires: 300 });
});

/** 放棄暫存檔（改選檔案或離開頁面呼叫） */
app.post("/me/upload-abort", mustUser, async (c) => {
  const userId = c.get("userId") as string;
  const body = (await c.req.json().catch(() => ({}))) as { key?: string };
  if (!body.key || !body.key.startsWith(`tmp/${userId}/`)) return c.text("bad key", 400);

  await c.env.R2_BUCKET.delete(body.key).catch(() => {});
  return c.json({ ok: true });
});

/** 建立前「提交」：把 tmp/ 搬到正式路徑並寫入 DB，回傳 file_id */
app.post("/me/commit-files", mustUser, async (c) => {
  const userId = c.get("userId") as string;
  const now = Date.now();

  const body = (await c.req.json().catch(() => ({}))) as {
    apk?: { key: string; package_name: string; version: string } | null;
    ios?: { key: string; package_name: string; version: string } | null;
  };

  async function promote(kind: "apk" | "ipa", x?: { key: string; package_name: string; version: string } | null) {
    if (!x?.key) return null;
    if (!x.key.startsWith(`tmp/${userId}/`)) throw new Error("bad key");

    const fileName = x.key.split("/").pop()!;
    const finalKey = `apps/${x.package_name}/${x.version}/${fileName}`;

    // copy (若無 copy 支援則 fallback 到 get→put)
    // @ts-ignore
    if (typeof c.env.R2_BUCKET.copy === "function") {
      // @ts-ignore
      await c.env.R2_BUCKET.copy(x.key, finalKey);
    } else {
      const obj = await c.env.R2_BUCKET.get(x.key);
      if (!obj) throw new Error("tmp object missing");
      await c.env.R2_BUCKET.put(finalKey, obj.body, { httpMetadata: obj.httpMetadata });
    }
    await c.env.R2_BUCKET.delete(x.key);

    const head = await c.env.R2_BUCKET.head(finalKey);
    const size = head?.size ?? 0;

    const id = crypto.randomUUID();
    await c.env.APP_DB.prepare(
      `INSERT INTO files (id, owner_id, platform, package_name, version, size, r2_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(id, userId, kind, x.package_name, x.version, size, finalKey, now).run();

    return { id, r2_key: finalKey, size };
  }

  const apk = await promote("apk", body.apk ?? undefined);
  const ios = await promote("ipa", body.ios ?? undefined);

  if (!apk && !ios) return c.text("nothing to commit", 400);
  return c.json({ ok: true, apk, ios });
});

/** 使用者建立分發：帶檔案的 file_id（由前一步 commit-files 取得） */
function randomCode4() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

app.post("/me/links", mustUser, async (c) => {
  const userId = c.get("userId") as string;

  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    cn_direct?: number | boolean;
    locale?: string;
    apk?: { file_id: string } | null;
    ios?: { file_id: string } | null;
    code?: string;
  };

  const title = (body.title ?? "").trim();
  const cnDirect = body.cn_direct ? 1 : 0;
  const locale = (body.locale || "en").trim();
  const now2 = Date.now();

  type FileRow = { id: string; owner_id: string; platform: Platform };

  const getFile = async (id: string) =>
    (await c.env.APP_DB
      .prepare("SELECT id, owner_id, platform FROM files WHERE id=?1")
      .bind(id)
      .first<FileRow>()) || null;

  let apkFile: FileRow | null = null;
  let iosFile: FileRow | null = null;

  if (body.apk?.file_id) {
    const f = await getFile(body.apk.file_id);
    if (!f) return c.text("apk file not found", 404);
    if (f.owner_id !== userId) return c.text("apk file not owned by user", 403);
    if (f.platform !== "apk") return c.text("apk file_id is not an APK", 400);
    apkFile = f;
  }
  if (body.ios?.file_id) {
    const f = await getFile(body.ios.file_id);
    if (!f) return c.text("ios file not found", 404);
    if (f.owner_id !== userId) return c.text("ios file not owned by user", 403);
    if (f.platform !== "ipa") return c.text("ios file_id is not an IPA", 400);
    iosFile = f;
  }

  if (!apkFile && !iosFile) return c.text("no file selected", 400);

  // 產 4 碼 code，確保唯一
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

  // 預設語系放 KV
  await c.env.APP_KV.put(`link_lang:${code}`, locale);

  return c.json({ ok: true, code, links: linksCreated });
});

// 掛載 Auth（/auth/*）
app.route("/auth", auth);

export default app;
