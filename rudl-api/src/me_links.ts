import type { Context } from "hono";
import { Hono } from "hono";
import { mustUser } from "./auth"; // 你既有的中介層
type Platform = "apk" | "ipa";

function randCode4() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

async function uniqueCode(c: Context) {
  for (let i = 0; i < 50; i++) {
    const code = randCode4();
    const hit = await c.env.APP_DB.prepare("SELECT id FROM links WHERE code=?").bind(code).first();
    if (!hit) return code;
  }
  throw new Error("code generation failed");
}

async function sha256Hex(file: File) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function putToR2(c: Context, key: string, file: File) {
  // 使用 Streaming 上傳
  const stream = file.stream();
  await c.env.R2_BUCKET.put(key, stream as any, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
}

export function installMeLinks(app: Hono) {

  // === 建立分發 + 同步上傳（multipart/form-data）
  app.post("/me/links", mustUser, async (c) => {
    const userId = c.get("userId") as string;
    const form = await c.req.formData();

    const title = (form.get("title") as string) ?? "";
    const version = (form.get("version") as string) ?? "";
    const bundle_id = (form.get("bundle_id") as string) ?? "";
    const lang = (form.get("lang") as string) ?? "en";
    const cn_direct = (form.get("cn_direct") as string) === "1" ? 1 : 0;

    const apk = form.get("apk") as File | null;
    const ipa = form.get("ipa") as File | null;

    if (!apk && !ipa) return c.text("至少上傳一個檔案", 400);

    // 產生唯一 code
    const code = (form.get("code") as string) || await uniqueCode(c);

    // 建立 link（先建立，拿 link_id）
    const now = Date.now();
    const ins = await c.env.APP_DB.prepare(
      "INSERT INTO links (id, code, title, is_active, cn_direct, created_at, owner_id, lang) VALUES (uuid(), ?, ?, 1, ?, ?, ?, ?)"
    ).bind(code, title, cn_direct, now, userId, lang).run();
    if (!ins.success) return c.text("Create link failed", 500);

    const linkRow = await c.env.APP_DB.prepare("SELECT id FROM links WHERE code=?").bind(code).first<{ id: string }>();
    if (!linkRow) return c.text("link not found after create", 500);
    const linkId = linkRow.id;

    // 準備回滾清單
    const uploadedKeys: string[] = [];

    // 內部函式：處理單一平台
    const handleOne = async (file: File, platform: Platform) => {
      const sha = await sha256Hex(file);
      const key = `dist/${userId}/${linkId}/${platform}/${file.name}`;
      await putToR2(c, key, file);
      uploadedKeys.push(key);

      const size = file.size;
      await c.env.APP_DB.prepare(
        "INSERT INTO files (id, owner_id, link_id, platform, package_name, version, size, r2_key, sha256, created_at) VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(userId, linkId, platform, bundle_id, version, size, key, sha, now).run();
    };

    try {
      if (apk) await handleOne(apk, "apk");
      if (ipa) await handleOne(ipa, "ipa");
    } catch (e) {
      // 發生例外 → 刪掉已上傳 R2 與 DB row、刪 link
      for (const k of uploadedKeys) await c.env.R2_BUCKET.delete(k);
      await c.env.APP_DB.prepare("DELETE FROM files WHERE link_id=?").bind(linkId).run();
      await c.env.APP_DB.prepare("DELETE FROM links WHERE id=?").bind(linkId).run();
      return c.text(`Upload failed: ${(e as Error).message}`, 500);
    }

    return c.json({ ok: true, link: { id: linkId, code, title, cn_direct, lang } });
  });

  // === 刪除分發（連檔案與 R2）
  app.delete("/me/links/:id", mustUser, async (c) => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");

    // 只能刪自己的
    const link = await c.env.APP_DB.prepare("SELECT id FROM links WHERE id=? AND owner_id=?").bind(id, userId).first();
    if (!link) return c.text("Not found", 404);

    const files = await c.env.APP_DB.prepare("SELECT r2_key FROM files WHERE link_id=?").bind(id).all<{ r2_key: string }>();

    // 先刪 R2
    for (const f of files.results ?? []) {
      if (f.r2_key) await c.env.R2_BUCKET.delete(f.r2_key);
    }

    // 再刪 DB
    await c.env.APP_DB.prepare("DELETE FROM files WHERE link_id=?").bind(id).run();
    await c.env.APP_DB.prepare("DELETE FROM links WHERE id=?").bind(id).run();

    return c.json({ ok: true });
  });

  // ===（可選）替換某平台檔案
  app.patch("/me/links/:id/files", mustUser, async (c) => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    const form = await c.req.formData();
    const apk = form.get("apk") as File | null;
    const ipa = form.get("ipa") as File | null;

    const link = await c.env.APP_DB.prepare("SELECT id FROM links WHERE id=? AND owner_id=?").bind(id, userId).first();
    if (!link) return c.text("Not found", 404);

    const now = Date.now();

    const replaceOne = async (file: File, platform: Platform) => {
      // 查舊檔
      const old = await c.env.APP_DB.prepare("SELECT id, r2_key FROM files WHERE link_id=? AND platform=?")
        .bind(id, platform).first<{ id: string; r2_key: string }>();

      // 刪舊 R2 + 刪舊 row
      if (old?.r2_key) await c.env.R2_BUCKET.delete(old.r2_key);
      if (old?.id) await c.env.APP_DB.prepare("DELETE FROM files WHERE id=?").bind(old.id).run();

      // 上傳新
      const sha = await sha256Hex(file);
      const key = `dist/${userId}/${id}/${platform}/${file.name}`;
      await putToR2(c, key, file);
      const size = file.size;

      await c.env.APP_DB.prepare(
        "INSERT INTO files (id, owner_id, link_id, platform, package_name, version, size, r2_key, sha256, created_at) VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(userId, id, platform, "", "", size, key, sha, now).run();
    };

    if (!apk && !ipa) return c.text("no file", 400);
    if (apk) await replaceOne(apk, "apk");
    if (ipa) await replaceOne(ipa, "ipa");

    return c.json({ ok: true });
  });
}
