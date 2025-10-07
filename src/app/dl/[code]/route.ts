import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

type Env = {
  DB: D1Database;
  ['rudl-app']?: D1Database;
};
type Link = { id: string; code: string; file_id: string; is_active: number; platform: string | null };
type FileRec = { id: string; r2_key: string; platform: string };

export async function GET(_: Request, context: { params: Promise<{ code: string }> }) {
  const { env } = getRequestContext<Env>();
  const legacyDB = (env as unknown as { ['rudl-app']?: D1Database })['rudl-app'];
  const DB = env.DB ?? legacyDB;
  if (!DB) {
    return new Response('Missing D1 binding DB', { status: 500 });
  }

  const params = await context.params;
  const code = String(params?.code ?? '').trim().toUpperCase();
  if (!code) return new Response('Invalid code', { status: 400 });

  const link = await DB.prepare(
    'SELECT id, code, file_id, is_active, platform FROM links WHERE code=? LIMIT 1'
  )
    .bind(code)
    .first<Link>();
  if (!link) return new Response('Not Found', { status: 404 });
  if (!link.is_active) return new Response('Disabled', { status: 403 });

  const file = await DB.prepare(
    'SELECT id, r2_key, platform FROM files WHERE id=? LIMIT 1'
  )
    .bind(link.file_id)
    .first<FileRec>();
  if (!file?.r2_key) return new Response('File Missing', { status: 404 });

  const target = `https://cdn.dataruapp.com/${file.r2_key.replace(/^\/+/, '')}`;
  return NextResponse.redirect(target, 302);
}
