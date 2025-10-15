import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { generateLinkCode } from '@/lib/code';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  R2_BUCKET?: R2Bucket;
};

type FileMeta = {
  title?: string | null;
  bundleId?: string | null;
  version?: string | null;
  sha256?: string | null;
};

const SUPPORTED_PLATFORMS: Array<'apk' | 'ipa'> = ['apk', 'ipa'];
const DEFAULT_TITLE = 'APP';

type TableInfo = {
  columns: Set<string>;
  types: Record<string, string>;
};

const tableInfoCache: Partial<Record<'links' | 'files', TableInfo>> = {};

async function getTableInfo(DB: D1Database, table: 'links' | 'files'): Promise<TableInfo> {
  const cached = tableInfoCache[table];
  if (cached) return cached;
  const results = await DB.prepare(`PRAGMA table_info(${table})`).all();
  const columns = new Set<string>();
  const types: Record<string, string> = {};
  const rows = (results.results as Array<{ name?: string; type?: string }> | undefined) ?? [];
  for (const row of rows) {
    if (!row?.name) continue;
    columns.add(row.name);
    if (row.type) {
      types[row.name] = row.type;
    }
  }
  const info: TableInfo = { columns, types };
  tableInfoCache[table] = info;
  return info;
}

function hasColumn(info: TableInfo, column: string): boolean {
  return info.columns.has(column);
}

function isTextColumn(info: TableInfo, column: string): boolean {
  const type = info.types[column]?.toUpperCase() ?? '';
  return type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT');
}

function parseUid(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const pair = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='));
  if (!pair) return null;
  return pair.slice(4);
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function POST(req: Request) {
  const uid = parseUid(req);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  const R2 = bindings.R2_BUCKET;
  if (!DB || !R2) {
    return NextResponse.json({ ok: false, error: 'Missing DB or R2 binding' }, { status: 500 });
  }

  const form = await req.formData();

  const titleInput = ((form.get('title') as string | null) ?? '').trim();
  const bundleIdInput = ((form.get('bundle_id') as string | null) ?? '').trim();
  const apkVersionInput = ((form.get('apk_version') as string | null) ?? '').trim();
  const ipaVersionInput = ((form.get('ipa_version') as string | null) ?? '').trim();
  const autofill = ((form.get('autofill') as string | null) ?? 'true').toLowerCase() === 'true';

  type FilePayload = {
    platform: 'apk' | 'ipa';
    file: File;
    meta: FileMeta;
  };
  const files: FilePayload[] = [];

  for (const platform of SUPPORTED_PLATFORMS) {
    const value = form.get(platform);
    if (value instanceof File && value.size > 0) {
      let meta: FileMeta = {};
      const metaRaw = form.get(`${platform}_meta`);
      if (typeof metaRaw === 'string' && metaRaw.trim()) {
        try {
          meta = JSON.parse(metaRaw) as FileMeta;
        } catch (error) {
          console.warn('Failed to parse metadata for platform', platform, error);
        }
      }
      files.push({ platform, file: value, meta });
    }
  }

  if (!files.length) {
    return NextResponse.json({ ok: false, error: 'NO_FILES' }, { status: 400 });
  }

  if (autofill) {
    const bundleValues = files
      .map((entry) => entry.meta?.bundleId)
      .filter((value): value is string => Boolean(value));
    if (bundleValues.length > 1) {
      const unique = new Set(bundleValues);
      if (unique.size > 1) {
        return NextResponse.json({ ok: false, error: 'AUTOFILL_MISMATCH' }, { status: 400 });
      }
    }
  }

  const linkId = crypto.randomUUID();
  const code = generateLinkCode();
  const platformString = Array.from(new Set(files.map((f) => f.platform))).join(',');

  const derivedTitle =
    (autofill && files.find((f) => f.meta?.title)?.meta?.title?.trim()) ||
    titleInput ||
    DEFAULT_TITLE;
  const derivedBundleId =
    (autofill && files.find((f) => f.meta?.bundleId)?.meta?.bundleId?.trim()) ||
    bundleIdInput ||
    '';
  const derivedApkVersion =
    (autofill &&
      files.find((f) => f.platform === 'apk' && f.meta?.version)?.meta?.version?.trim()) ||
    apkVersionInput ||
    '';
  const derivedIpaVersion =
    (autofill &&
      files.find((f) => f.platform === 'ipa' && f.meta?.version)?.meta?.version?.trim()) ||
    ipaVersionInput ||
    '';

  const r2KeysToDelete: string[] = [];

  try {
    const linksInfo = await getTableInfo(DB, 'links');
    const filesInfo = await getTableInfo(DB, 'files');
    const hasFileIdColumn = hasColumn(linksInfo, 'file_id');
    const createdAt = Date.now();
    const createdAtIso = new Date(createdAt).toISOString();
    const linkCreatedAtValue = hasColumn(linksInfo, 'created_at')
      ? isTextColumn(linksInfo, 'created_at')
        ? createdAtIso
        : Math.floor(createdAt / 1000)
      : undefined;
    const fileCreatedAtValue = hasColumn(filesInfo, 'created_at')
      ? isTextColumn(filesInfo, 'created_at')
        ? createdAtIso
        : Math.floor(createdAt / 1000)
      : undefined;
    const isActiveValue = hasColumn(linksInfo, 'is_active')
      ? isTextColumn(linksInfo, 'is_active')
        ? '0'
        : 0
      : undefined;

    await DB.prepare('BEGIN').run();

    const linkColumnPairs: Array<[string, unknown]> = [
      ['id', linkId],
      ['code', code],
      ['owner_id', uid],
      ['title', derivedTitle],
      ['bundle_id', derivedBundleId],
      ['apk_version', derivedApkVersion],
      ['ipa_version', derivedIpaVersion],
      ['platform', platformString],
    ];
    if (linkCreatedAtValue !== undefined) {
      linkColumnPairs.push(['created_at', linkCreatedAtValue]);
    }
    if (isActiveValue !== undefined) {
      linkColumnPairs.push(['is_active', isActiveValue]);
    }
    if (hasFileIdColumn) {
      linkColumnPairs.push(['file_id', null]);
    }

    const linkColumns = linkColumnPairs
      .filter(([column]) => hasColumn(linksInfo, column))
      .map(([column]) => column);
    const linkValues = linkColumnPairs
      .filter(([column]) => hasColumn(linksInfo, column))
      .map(([, value]) => value);

    if (!linkColumns.length) {
      throw new Error('LINK_TABLE_UNSUPPORTED');
    }

    const linkPlaceholders = linkColumns.map(() => '?').join(', ');
    const linkQuery = `INSERT INTO links (${linkColumns.join(', ')}) VALUES (${linkPlaceholders})`;
    await DB.prepare(linkQuery).bind(...linkValues).run();

    let firstFileId: string | null = null;

    for (const entry of files) {
      const buffer = await entry.file.arrayBuffer();
      const sha = entry.meta?.sha256 ?? (await sha256(buffer));
      const key = `links/${uid}/${linkId}/${entry.platform}/${Date.now()}-${entry.file.name}`;
      r2KeysToDelete.push(key);

      await R2.put(key, buffer, {
        httpMetadata: {
          contentType: entry.file.type || 'application/octet-stream',
        },
      });

      const fileId = crypto.randomUUID();
      if (!firstFileId) {
        firstFileId = fileId;
      }

      const metaTitle = entry.meta?.title?.trim() || null;
      const metaBundleId = entry.meta?.bundleId?.trim() || null;
      const metaVersion = entry.meta?.version?.trim() || null;

      const fileColumnPairs: Array<[string, unknown]> = [
        ['id', fileId],
        ['owner_id', uid],
        ['platform', entry.platform],
        ['version', metaVersion ?? ''],
        ['size', entry.file.size],
        ['title', metaTitle ?? entry.file.name ?? DEFAULT_TITLE],
        ['bundle_id', metaBundleId ?? ''],
        ['link_id', linkId],
      ];
      if (fileCreatedAtValue !== undefined) {
        fileColumnPairs.push(['created_at', fileCreatedAtValue]);
      }
      if (hasColumn(filesInfo, 'sha256')) {
        fileColumnPairs.push(['sha256', sha]);
      }
      if (hasColumn(filesInfo, 'content_type')) {
        fileColumnPairs.push(['content_type', entry.file.type || 'application/octet-stream']);
      }
      if (hasColumn(filesInfo, 'r2_key')) {
        fileColumnPairs.push(['r2_key', key]);
      }

      const fileColumns = fileColumnPairs
        .filter(([column]) => hasColumn(filesInfo, column))
        .map(([column]) => column);
      const fileValues = fileColumnPairs
        .filter(([column]) => hasColumn(filesInfo, column))
        .map(([, value]) => value);

      if (!fileColumns.length) {
        throw new Error('FILE_TABLE_UNSUPPORTED');
      }

      const filePlaceholders = fileColumns.map(() => '?').join(', ');
      const fileQuery = `INSERT INTO files (${fileColumns.join(', ')}) VALUES (${filePlaceholders})`;
      await DB.prepare(fileQuery).bind(...fileValues).run();
    }

    if (hasFileIdColumn && firstFileId) {
      await DB.prepare('UPDATE links SET file_id=? WHERE id=?')
        .bind(firstFileId, linkId)
        .run();
    }

    if (hasColumn(linksInfo, 'is_active')) {
      const activeValue = isTextColumn(linksInfo, 'is_active') ? '1' : 1;
      await DB.prepare('UPDATE links SET is_active=? WHERE id=?')
        .bind(activeValue, linkId)
        .run();
    }
    await DB.prepare('COMMIT').run();

    return NextResponse.json({ ok: true, linkId, code });
  } catch (error) {
    await DB.prepare('ROLLBACK').run().catch(() => null);
    for (const key of r2KeysToDelete) {
      await R2.delete(key).catch(() => null);
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
