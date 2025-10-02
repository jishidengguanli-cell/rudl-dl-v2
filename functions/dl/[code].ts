// /dl/:code?p=apk|ipa
import { text } from "../_lib/respond";
import { one } from "../_lib/db";

type Link = {
  id: string;
  code: string;
  file_id: string;
  is_active: number;
  platform: string | null;
};

type FileRec = {
  id: string;
  r2_key: string;
  platform: string;
};

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { DB } = ctx.env;
  const url = new URL(ctx.request.url);
  const code = String(ctx.params?.code || "").trim().toUpperCase();
  if (!code) return text("Invalid code", 400);

  // 1) 讀 link
  const link = await one<Link>(DB,
    `SELECT id, code, file_id, is_active, platform FROM links WHERE code = ? LIMIT 1`,
    [code]
  );
  if (!link) return text("Not Found", 404);
  if (!link.is_active) return text("Disabled", 403);

  // 2) 讀檔案
  const file = await one<FileRec>(DB,
    `SELECT id, r2_key, platform FROM files WHERE id = ? LIMIT 1`,
    [link.file_id]
  );
  if (!file || !file.r2_key) return text("File Missing", 404);

  // 3) 組 CDN 連結（直接檔案下載）
  const target = `https://cdn.dataruapp.com/${file.r2_key.replace(/^\/+/, "")}`;

  // TODO：若 iOS 需 itms-services，可在此依 platform === 'ipa' 轉出 manifest.plist 連結
  return new Response(null, { status: 302, headers: { Location: target } });
};
