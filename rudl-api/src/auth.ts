import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Env } from "./index"; // 你的 Env 介面定義在 src/index.ts

/* ---------------------------------- */
/* Constants                          */
/* ---------------------------------- */

const SESSION_COOKIE = "sid";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days (seconds) for KV expiration

// PBKDF2：Cloudflare Workers WebCrypto 上限為 100_000
const PBKDF2_HASH = "SHA-256";
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32; // bytes
const SALT_BYTES = 16;

/* ---------------------------------- */
/* Utilities                          */
/* ---------------------------------- */

function b64e(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function b64d(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: PBKDF2_HASH, salt, iterations },
    key,
    PBKDF2_KEYLEN * 8
  );
  return new Uint8Array(bits);
}

// 輸出：pbkdf2:sha256:<iter>:<salt_b64>:<hash_b64>
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const dk = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:sha256:${PBKDF2_ITERATIONS}:${b64e(salt)}:${b64e(dk)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, hash, iterStr, saltB64, dkB64] = stored.split(":");
  if (alg !== "pbkdf2" || hash !== "sha256") return false;

  const iterations = parseInt(iterStr, 10);
  if (!Number.isFinite(iterations) || iterations > 100_000) return false; // Workers 限制

  const salt = b64d(saltB64);
  const expected = b64d(dkB64);
  const got = await pbkdf2(password, salt, iterations);

  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}

/* ---------------------------------- */
/* Session via KV                     */
/* ---------------------------------- */

async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  await env.APP_KV.put(`sess:${token}`, userId, { expirationTtl: SESSION_TTL });
  return token;
}

async function readSession(env: Env, token?: string | null): Promise<string | null> {
  if (!token) return null;
  const uid = await env.APP_KV.get(`sess:${token}`);
  return uid ?? null;
}

async function destroySession(env: Env, token?: string | null): Promise<void> {
  if (!token) return;
  await env.APP_KV.delete(`sess:${token}`);
}

/* ---------------------------------- */
/* Middlewares                        */
/* ---------------------------------- */

// 讓你原本在 index.ts 的 `withCors` 匯入可用
export const withCors: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header("Origin") ?? "*";

  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
      },
    });
  }

  await next();

  c.res.headers.set("Access-Control-Allow-Origin", origin);
  c.res.headers.set("Access-Control-Allow-Credentials", "true");
};

export async function mustUser(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
  const sid = getCookie(c, SESSION_COOKIE);
  const uid = await readSession(c.env, sid);
  if (!uid) return c.text("Unauthorized", 401);

  (c as any).get = (k: string) => (k === "userId" ? uid : undefined);
  await next();
}

// 可選的 Admin 檢查（如果之後要用得到）
export async function mustAdmin(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
  const sid = getCookie(c, SESSION_COOKIE);
  const uid = await readSession(c.env, sid);
  if (!uid) return c.text("Unauthorized", 401);

  const u = await c.env.APP_DB.prepare(
    "SELECT role FROM users WHERE id=?1"
  ).bind(uid).first<{ role: string }>();

  if (!u || u.role !== "admin") return c.text("Forbidden", 403);

  (c as any).get = (k: string) => (k === "userId" ? uid : undefined);
  await next();
}

/* ---------------------------------- */
/* Router                             */
/* ---------------------------------- */

// 這裡改成「命名匯出」以符合你的 index.ts：import { auth, withCors, mustUser } from "./auth";
export const auth = new Hono<{ Bindings: Env }>();

// POST /auth/register  { email, password }
auth.post("/register", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({} as any));
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !password) return c.text("Invalid payload", 400);

  // 檢查 email 是否存在
  const e = await c.env.APP_DB.prepare(
    "SELECT id FROM users WHERE email=?1"
  ).bind(email).first<{ id: string }>();
  if (e) return c.text("Email already exists", 409);

  const id = crypto.randomUUID();
  const pw_hash = await hashPassword(password);
  const now = Date.now();

  await c.env.APP_DB.prepare(
    "INSERT INTO users (id,email,pw_hash,role,created_at) VALUES (?1,?2,?3,?4,?5)"
  ).bind(id, email, pw_hash, "user", now).run();

  // 建立 point_accounts（你的表使用 user_id）
  await c.env.APP_DB.prepare(
    "INSERT INTO point_accounts (id,user_id,balance,updated_at) VALUES (?1,?2,?3,?4)"
  ).bind(crypto.randomUUID(), id, 0, now).run();

  const token = await createSession(c.env, id);

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: true,
    domain: ".dataruapp.com",
    maxAge: SESSION_TTL,
  });

  return c.json({ ok: true, user: { id, email } });
});

// POST /auth/login  { email, password }
auth.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({} as any));
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) return c.text("Invalid email or password", 401);

  const u = await c.env.APP_DB.prepare(
    "SELECT id, pw_hash FROM users WHERE email=?1"
  ).bind(email).first<{ id: string; pw_hash: string }>();

  if (!u) return c.text("Invalid email or password", 401);

  const ok = await verifyPassword(password, u.pw_hash);
  if (!ok) return c.text("Invalid email or password", 401);

  const token = await createSession(c.env, u.id);

  // 登入：發 Token cookie
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,           // 必須搭配 SameSite=None
    sameSite: 'None',       // 允許跨站（從 localhost:3000 到 api.dataruapp.com）
    path: '/',
    domain: '.dataruapp.com',
    maxAge: SESSION_TTL,
  });

  return c.json({ ok: true, user: { id: u.id, email } });
});

// POST /auth/logout
auth.post("/logout", async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  await destroySession(c.env, sid);
  // 登出：把同樣屬性的 cookie 清掉
  deleteCookie(c, SESSION_COOKIE, {
    path: '/',
    domain: '.dataruapp.com',
    secure: true,
    sameSite: 'None',
  });
  return c.json({ ok: true });
});

// GET /auth/me  （需登入）
auth.get("/me", mustUser, async (c) => {
  const userId = (c as any).get("userId") as string;

  const u = await c.env.APP_DB.prepare(
    "SELECT id,email,role,created_at FROM users WHERE id=?1"
  ).bind(userId).first<{ id: string; email: string; role: string; created_at: number }>();

  if (!u) return c.text("User not found", 404);

  // 用 point_accounts.user_id 取得餘額（對齊你目前資料）
  const acc = await c.env.APP_DB.prepare(
    "SELECT balance FROM point_accounts WHERE user_id=?1"
  ).bind(userId).first<{ balance: number }>();

  return c.json({
    ok: true,
    user: u,
    balance: acc?.balance ?? 0,
  });
});

// 也保留 default 匯出，之後若要改回 default import 也能用
export default auth;
