import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

type Env = {
  DB: D1Database;
  ['rudl-app']?: D1Database;
};

type TableInfo = {
  columns: Set<string>;
};

const tableInfoCache: Partial<Record<'links' | 'files', TableInfo>> = {};

async function getTableInfo(DB: D1Database, table: 'links' | 'files'): Promise<TableInfo> {
  const cached = tableInfoCache[table];
  if (cached) return cached;
  const results = await DB.prepare(`PRAGMA table_info(${table})`).all();
  const columns = new Set(
    ((results.results as Array<{ name?: string }> | undefined) ?? [])
      .map((row) => row?.name)
      .filter((name): name is string => Boolean(name))
  );
  const info: TableInfo = { columns };
  tableInfoCache[table] = info;
  return info;
}

function hasColumn(info: TableInfo, column: string): boolean {
  return info.columns.has(column);
}

type LinkRow = {
  id: string;
  code: string;
  platform: string | null;
  is_active: number | string | null;
  file_id?: string | null;
};

type FileRow = {
  id: string;
  platform: string | null;
  r2_key?: string | null;
};

const parseBoolean = (value: number | string | null | undefined): boolean => {
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return Number(value) !== 0;
  return false;
};

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { env } = getRequestContext<Env>();
  const legacyDB = (env as unknown as { ['rudl-app']?: D1Database })['rudl-app'];
  const DB = env.DB ?? legacyDB;
  if (!DB) {
    return new Response('Missing D1 binding DB', { status: 500 });
  }

  const params = await context.params;
  const code = String(params?.code ?? '').trim().toUpperCase();
  if (!code) return new Response('Invalid code', { status: 400 });

  const linksInfo = await getTableInfo(DB, 'links');
  const filesInfo = await getTableInfo(DB, 'files');
  const hasFileIdColumn = hasColumn(linksInfo, 'file_id');
  const hasR2KeyColumn = hasColumn(filesInfo, 'r2_key');
  if (!hasR2KeyColumn) {
    return new Response('Storage configuration missing', { status: 500 });
  }

  const linkColumns = ['id', 'code', 'platform', 'is_active'];
  if (hasFileIdColumn) {
    linkColumns.push('file_id');
  }
  const linkQuery = `SELECT ${linkColumns.join(', ')} FROM links WHERE code=? LIMIT 1`;
  const link = await DB.prepare(linkQuery)
    .bind(code)
    .first<LinkRow>();

  if (!link) return new Response('Not Found', { status: 404 });
  if (!parseBoolean(link.is_active)) return new Response('Disabled', { status: 403 });

  const url = new URL(request.url);
  const preferredPlatform = url.searchParams.get('platform')?.toLowerCase() ?? null;

  const buildFileQuery = (withPlatform: boolean) => {
    const baseColumns = ['id', 'platform', 'r2_key'];
    const conditions = ['link_id=?'];
    if (withPlatform) {
      conditions.push('LOWER(platform)=?');
    }
    return `SELECT ${baseColumns.join(', ')} FROM files WHERE ${conditions.join(
      ' AND '
    )} ORDER BY created_at DESC LIMIT 1`;
  };

  let file: FileRow | null = null;

  if (hasFileIdColumn && link.file_id) {
    const fileQuery = `SELECT id, platform, r2_key FROM files WHERE id=? LIMIT 1`;
    file = await DB.prepare(fileQuery)
      .bind(link.file_id)
      .first<FileRow>();
  } else {
    const platformCandidates: string[] = [];
    if (preferredPlatform) {
      platformCandidates.push(preferredPlatform);
    }
    const linkPlatforms =
      (link.platform ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value && !platformCandidates.includes(value)) ?? [];
    platformCandidates.push(...linkPlatforms);

    for (const platform of platformCandidates) {
      const candidate = await DB.prepare(buildFileQuery(true))
        .bind(link.id, platform)
        .first<FileRow>();
      if (candidate) {
        file = candidate;
        break;
      }
    }

    if (!file) {
      file = await DB.prepare(buildFileQuery(false)).bind(link.id).first<FileRow>();
    }
  }

  if (!file || !file.r2_key) {
    return new Response('File Missing', { status: 404 });
  }

  const target = `https://cdn.dataruapp.com/${file.r2_key.replace(/^\/+/, '')}`;
  return NextResponse.redirect(target, 302);
}
