import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { generateLinkCode } from '@/lib/code';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  R2_BUCKET?: R2Bucket;
};

type UploadInput = {
  platform: 'apk' | 'ipa';
  key: string;
  size: number;
  title?: string | null;
  bundleId?: string | null;
  version?: string | null;
  contentType?: string | null;
  sha256?: string | null;
};

type FinalizeBody = {
  linkId: string;
  title: string;
  bundleId: string;
  apkVersion: string;
  ipaVersion: string;
  autofill: boolean;
  uploads: UploadInput[];
};

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

function sanitizeTitleFromKey(key: string): string | null {
  const parts = key.split('/');
  const fileName = parts[parts.length - 1] ?? '';
  return fileName.replace(/^\d+-/, '').replace(/\.[^.]+$/, '') || null;
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

  let payload: FinalizeBody | undefined;
  try {
    payload = (await req.json()) as FinalizeBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  if (!payload) {
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  const {
    linkId,
    title: titleInputRaw,
    bundleId: bundleIdInputRaw,
    apkVersion: apkVersionInputRaw,
    ipaVersion: ipaVersionInputRaw,
    autofill,
    uploads: uploadsInput,
  } = payload;

  if (!linkId || typeof linkId !== 'string') {
    return NextResponse.json({ ok: false, error: 'INVALID_LINK_ID' }, { status: 400 });
  }
  if (!Array.isArray(uploadsInput) || uploadsInput.length === 0) {
    return NextResponse.json({ ok: false, error: 'NO_FILES' }, { status: 400 });
  }

  const uploads: UploadInput[] = []
  for (const raw of uploadsInput ?? []) {
    if (!raw || (raw.platform !== 'apk' && raw.platform !== 'ipa') || !raw.key) continue;
    uploads.push({
      platform: raw.platform,
      key: String(raw.key),
      size: Number(raw.size ?? 0),
      title: raw.title ?? null,
      bundleId: raw.bundleId ?? null,
      version: raw.version ?? null,
      contentType: raw.contentType ?? 'application/octet-stream',
      sha256: raw.sha256 ?? null,
    });
  }

  if (!uploads.length) {
    return NextResponse.json({ ok: false, error: 'NO_FILES' }, { status: 400 });
  }

  if (autofill) {
    const bundleValues = uploads
      .map((entry) => entry.bundleId?.trim())
      .filter((value): value is string => Boolean(value));
    if (bundleValues.length > 1) {
      const unique = new Set(bundleValues);
      if (unique.size > 1) {
        return NextResponse.json({ ok: false, error: 'AUTOFILL_MISMATCH' }, { status: 400 });
      }
    }
  }

  const now = Date.now();
  const titleInput = (titleInputRaw ?? '').trim();
  const bundleIdInput = (bundleIdInputRaw ?? '').trim();
  const apkVersionInput = (apkVersionInputRaw ?? '').trim();
  const ipaVersionInput = (ipaVersionInputRaw ?? '').trim();
  const platformString = uploads.map((upload) => upload.platform).join(',');

  const derivedTitle =
    (autofill && uploads.find((upload) => upload.title)?.title?.trim()) ||
    titleInput ||
    DEFAULT_TITLE;
  const derivedBundleId =
    (autofill && uploads.find((upload) => upload.bundleId)?.bundleId?.trim()) ||
    bundleIdInput ||
    '';
  const derivedApkVersion =
    (autofill &&
      uploads.find((upload) => upload.platform === 'apk' && upload.version)?.version?.trim()) ||
    apkVersionInput ||
    '';
  const derivedIpaVersion =
    (autofill &&
      uploads.find((upload) => upload.platform === 'ipa' && upload.version)?.version?.trim()) ||
    ipaVersionInput ||
    '';

  const r2KeysToDelete = uploads.map((upload) => upload.key);
  const code = generateLinkCode();

  try {
    const linksInfo = await getTableInfo(DB, 'links');
    const filesInfo = await getTableInfo(DB, 'files');
    const hasFileIdColumn = hasColumn(linksInfo, 'file_id');
    const createdAtIso = new Date(now).toISOString();
    const createdAtEpoch = Math.floor(now / 1000);
    const linkCreatedAtValue = hasColumn(linksInfo, 'created_at')
      ? isTextColumn(linksInfo, 'created_at')
        ? createdAtIso
        : createdAtEpoch
      : undefined;
    const fileCreatedAtValue = hasColumn(filesInfo, 'created_at')
      ? isTextColumn(filesInfo, 'created_at')
        ? createdAtIso
        : createdAtEpoch
      : undefined;
    const isActiveValue = hasColumn(linksInfo, 'is_active')
      ? isTextColumn(linksInfo, 'is_active')
        ? '0'
        : 0
      : undefined;

    await Promise.all(
      uploads.map(async (upload) => {
        const head = await R2.head(upload.key);
        if (!head) {
          throw new Error(`MISSING_OBJECT:${upload.platform}`);
        }
      })
    );

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

    for (const upload of uploads) {
      const fileId = crypto.randomUUID();
      if (!firstFileId) {
        firstFileId = fileId;
      }

      const metaTitle = upload.title?.trim() || sanitizeTitleFromKey(upload.key);
      const metaBundleId = upload.bundleId?.trim() ?? '';
      const metaVersion = upload.version?.trim() ?? '';

      const fileColumnPairs: Array<[string, unknown]> = [
        ['id', fileId],
        ['owner_id', uid],
        ['platform', upload.platform],
        ['version', metaVersion],
        ['size', upload.size],
        ['title', metaTitle ?? DEFAULT_TITLE],
        ['bundle_id', metaBundleId],
        ['link_id', linkId],
      ];
      if (fileCreatedAtValue !== undefined) {
        fileColumnPairs.push(['created_at', fileCreatedAtValue]);
      }
      if (hasColumn(filesInfo, 'sha256')) {
        fileColumnPairs.push(['sha256', upload.sha256 ?? '']);
      }
      if (hasColumn(filesInfo, 'content_type')) {
        fileColumnPairs.push([
          'content_type',
          upload.contentType ?? 'application/octet-stream',
        ]);
      }
      if (hasColumn(filesInfo, 'r2_key')) {
        fileColumnPairs.push(['r2_key', upload.key]);
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
    await Promise.all(r2KeysToDelete.map((key) => R2.delete(key).catch(() => null)));
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
