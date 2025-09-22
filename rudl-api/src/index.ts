import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";

type Platform = "apk" | "ipa";

interface Env {
  APP_DB: D1Database;
  ADMIN_TOKEN: string;
}

const app = new Hono<{ Bindings: Env }>();

// 簡易管理員驗證
app.use("/admin/*", async (c, next) => {
  const token = c.req.header("x-admin-token");
  if (!token || token !== c.env.ADMIN_TOKEN) return c.text("Unauthorized", 401);
  await next();
});

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

// 建 user（含點數帳戶）
app.post("/admin/users", async (c) => {
  const { email, initialBalance = 0 } = await c.req.json<{ email: string; initialBalance?: number }>();
  const id = uuidv4(), now = Date.now();

  const existed = await c.env.APP_DB.prepare("SELECT id FROM users WHERE email=?1").bind(email).first();
  if (existed) return c.text("Email already exists", 409);

  await c.env.APP_DB.prepare(
    "INSERT INTO users (id, email, pw_hash, role, created_at) VALUES (?1, ?2, NULL, 'user', ?3)"
  ).bind(id, email, now).run();

  await c.env.APP_DB.prepare(
    "INSERT INTO point_accounts (id, user_id, balance, updated_at) VALUES (?1, ?2, ?3, ?4)"
  ).bind(id, id, initialBalance, now).run();

  return c.json({ id, email, balance: initialBalance });
});

app.get("/admin/users/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.APP_DB.prepare(
    "SELECT u.id, u.email, u.role, p.balance FROM users u LEFT JOIN point_accounts p ON p.user_id=u.id WHERE u.id=?1"
  ).bind(id).first();
  if (!row) return c.text("Not Found", 404);
  return c.json(row);
});

const PACKAGES: Record<string, number> = {
  "P1": 500, "P5": 3000, "P15": 20000, "P35": 50000, "P100": 150000, "P300": 500000
};

app.post("/admin/recharge", async (c) => {
  const { userId, packageId } = await c.req.json<{ userId: string; packageId: keyof typeof PACKAGES }>();
  const points = PACKAGES[packageId];
  if (!points) return c.text("Invalid packageId", 400);

  const now = Date.now();
  const upd = await c.env.APP_DB.prepare(
    "UPDATE point_accounts SET balance = balance + ?1, updated_at=?2 WHERE user_id=?3"
  ).bind(points, now, userId).run();
  if (upd.meta.changes === 0) return c.text("User/Account Not Found", 404);

  const ledgerId = uuidv4();
  await c.env.APP_DB.prepare(
    "INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL, ?5)"
  ).bind(ledgerId, userId, points, `recharge:${packageId}`, now).run();

  const acc = await c.env.APP_DB.prepare("SELECT balance FROM point_accounts WHERE user_id=?1")
    .bind(userId).first<{ balance: number }>();
  return c.json({ ok: true, balance: acc?.balance ?? 0, ledgerId });
});

app.post("/admin/files", async (c) => {
  const body = await c.req.json<{
    ownerId: string; platform: Platform; r2_key: string;
    package_name?: string; channel?: string; version?: string; size?: number; sha256?: string | null;
  }>();
  const id = uuidv4(), now = Date.now();
  // 檢查 ownerId 是否存在於 point_accounts（防止填到 ledgerId）
  const ownerOk = await c.env.APP_DB.prepare(
    "SELECT 1 FROM point_accounts WHERE id=?1"
  ).bind(body.ownerId).first();
  if (!ownerOk) return c.text("ownerId not found", 400);

  await c.env.APP_DB.prepare(
    "INSERT INTO files (id, owner_id, platform, package_name, channel, version, size, sha256, r2_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
  ).bind(id, body.ownerId, body.platform, body.package_name || null, body.channel || null,
         body.version || null, body.size || null, body.sha256 || null, body.r2_key, now).run();

  return c.json({ id });
});

function randomCode(n = 6) {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = ""; for (let i=0;i<n;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

app.post("/admin/links", async (c) => {
  const { fileId, title, code, is_active = 1, cn_direct = 0 } = await c.req.json<{
    fileId: string; title?: string; code?: string; is_active?: number; cn_direct?: number;
  }>();
  const id = uuidv4(), now = Date.now(), codeToUse = code || randomCode();

  const dup = await c.env.APP_DB.prepare("SELECT 1 FROM links WHERE code=?1").bind(codeToUse).first();
  if (dup) return c.text("Code already exists", 409);

  await c.env.APP_DB.prepare(
    "INSERT INTO links (id, code, file_id, title, is_active, created_at, cn_direct) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
  ).bind(id, codeToUse, fileId, title || null, is_active, now, cn_direct).run();

  return c.json({ id, code: codeToUse });
});

app.patch("/admin/links/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ title?: string; is_active?: number; cn_direct?: number }>();
  const sets: string[] = []; const vals: any[] = [];
  if (body.title !== undefined) { sets.push("title=?"); vals.push(body.title); }
  if (body.is_active !== undefined) { sets.push("is_active=?"); vals.push(body.is_active); }
  if (body.cn_direct !== undefined) { sets.push("cn_direct=?"); vals.push(body.cn_direct); }
  if (sets.length === 0) return c.text("Nothing to update", 400);
  vals.push(id);
  const res = await c.env.APP_DB.prepare(`UPDATE links SET ${sets.join(", ")} WHERE id=?`).bind(...vals).run();
  if (res.meta.changes === 0) return c.text("Not Found", 404);
  return c.json({ ok: true });
});

app.get("/admin/links", async (c) => {
  const ownerId = c.req.query("ownerId");
  const sql = ownerId
    ? `SELECT l.*, f.owner_id, f.platform, f.r2_key FROM links l JOIN files f ON f.id=l.file_id WHERE f.owner_id=?1 ORDER BY l.created_at DESC`
    : `SELECT l.*, f.owner_id, f.platform, f.r2_key FROM links l JOIN files f ON f.id=l.file_id ORDER BY l.created_at DESC`;
  const stmt = c.env.APP_DB.prepare(sql);
  const rows = ownerId ? await stmt.bind(ownerId).all() : await stmt.all();
  return c.json(rows.results || []);
});

// 取得帳戶餘額＋最近20筆流水
app.get("/admin/accounts/:userId", async (c) => {
  const userId = c.req.param("userId");
  const acc = await c.env.APP_DB.prepare(
    "SELECT balance FROM point_accounts WHERE user_id=?1"
  ).bind(userId).first<{ balance: number }>();
  const ledger = await c.env.APP_DB.prepare(
    "SELECT * FROM point_ledger WHERE account_id=?1 ORDER BY created_at DESC LIMIT 20"
  ).bind(userId).all();
  return c.json({ balance: acc?.balance ?? 0, ledger: ledger.results || [] });
});

// 更正檔案 owner 或其他欄位（ownerId/r2_key/version/...）
app.patch("/admin/files/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<{
    ownerId?: string; r2_key?: string; package_name?: string; channel?: string;
    version?: string; size?: number; sha256?: string | null;
  }>();

  if (b.ownerId) {
    const ok = await c.env.APP_DB.prepare("SELECT 1 FROM point_accounts WHERE id=?1")
      .bind(b.ownerId).first();
    if (!ok) return c.text("ownerId not found", 400);
  }

  const sets: string[] = []; const vals: any[] = [];
  if (b.ownerId !== undefined)     { sets.push("owner_id=?");     vals.push(b.ownerId); }
  if (b.r2_key !== undefined)      { sets.push("r2_key=?");       vals.push(b.r2_key); }
  if (b.package_name !== undefined){ sets.push("package_name=?"); vals.push(b.package_name); }
  if (b.channel !== undefined)     { sets.push("channel=?");      vals.push(b.channel); }
  if (b.version !== undefined)     { sets.push("version=?");      vals.push(b.version); }
  if (b.size !== undefined)        { sets.push("size=?");         vals.push(b.size); }
  if (b.sha256 !== undefined)      { sets.push("sha256=?");       vals.push(b.sha256); }
  if (!sets.length) return c.text("Nothing to update", 400);

  vals.push(id);
  const res = await c.env.APP_DB.prepare(`UPDATE files SET ${sets.join(", ")} WHERE id=?`).bind(...vals).run();
  if (!res.meta.changes) return c.text("Not Found", 404);
  return c.json({ ok: true });
});

// 下載記錄查詢（可用 linkCode 過濾）
app.get("/admin/downloads", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const linkCode = c.req.query("linkCode");
  const sql = `SELECT d.*, l.code, f.platform, f.r2_key
               FROM downloads d
               JOIN links l ON l.id=d.link_id
               JOIN files f ON f.id=d.file_id
               ${linkCode ? "WHERE l.code=?1" : ""}
               ORDER BY d.created_at DESC
               LIMIT ${limit}`;
  const rows = linkCode
    ? await c.env.APP_DB.prepare(sql).bind(linkCode!).all()
    : await c.env.APP_DB.prepare(sql).all();
  return c.json(rows.results || []);
});


export default app;
