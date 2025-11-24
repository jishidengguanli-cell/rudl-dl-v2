import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { generateLinkCode } from '@/lib/code';
import { deleteDownloadStatsForLink, ensureDownloadStatsTable } from '@/lib/downloads';
import { normalizeLanguageCode } from '@/lib/language';
import {
  cleanupRegionalUploads,
  publishLinkToRegionalServer,
  type RegionalServerBindings,
} from '@/lib/regional-server';
import {
  normalizeNetworkArea,
  isRegionalNetworkArea,
  type NetworkArea,
  type RegionalNetworkArea,
} from '@/lib/network-area';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  R2_BUCKET?: R2Bucket;
} & RegionalServerBindings;

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
  lang: string;
  uploads: UploadInput[];
  isActive?: boolean;
  networkArea?: NetworkArea | string;
};

const DEFAULT_TITLE = 'APP';

type TableInfo = {
  columns: Set<string>;
  types: Record<string, string>;
};

const tableInfoCache: Partial<Record<'links' | 'files', TableInfo>> = {};

async function getTableInfo(
  DB: D1Database,
  table: 'links' | 'files',
  forceRefresh = false
): Promise<TableInfo> {
  if (forceRefresh) {
    delete tableInfoCache[table];
  }

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
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'Missing DB binding' }, { status: 500 });
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
    lang: langInputRaw,
    uploads: uploadsInput,
    isActive: isActiveRaw,
    networkArea: networkAreaRaw,
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
  const linkLang = normalizeLanguageCode(typeof langInputRaw === 'string' ? langInputRaw : '');
  const isActiveInput = typeof isActiveRaw === 'boolean' ? isActiveRaw : true;
  const networkArea = normalizeNetworkArea(
    typeof networkAreaRaw === 'string' ? networkAreaRaw : null
  );
  const regionalArea: RegionalNetworkArea | null = isRegionalNetworkArea(networkArea)
    ? networkArea
    : null;
  const platformString = uploads.map((upload) => upload.platform).join(',');
  if (!regionalArea && !R2) {
    return NextResponse.json({ ok: false, error: 'Missing R2 binding' }, { status: 500 });
  }

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

  const pendingUploadKeys = regionalArea ? uploads.map((upload) => upload.key) : [];
  const code = generateLinkCode();

  try {
  let linksInfo = await getTableInfo(DB, 'links');
  if (!hasColumn(linksInfo, 'lang')) {
    linksInfo = await getTableInfo(DB, 'links', true);
  }
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
        ? isActiveInput ? '1' : '0'
        : isActiveInput ? 1 : 0
      : undefined;

    if (!regionalArea && R2) {
      await Promise.all(
        uploads.map(async (upload) => {
          const head = await R2.head(upload.key);
          if (!head) {
            throw new Error(`MISSING_OBJECT:${upload.platform}`);
          }
        })
      );
    }

    const linkColumnPairs: Array<[string, unknown]> = [
      ['id', linkId],
      ['code', code],
      ['owner_id', uid],
      ['title', derivedTitle],
      ['bundle_id', derivedBundleId],
      ['apk_version', derivedApkVersion],
      ['ipa_version', derivedIpaVersion],
      ['platform', platformString],
      ['lang', linkLang],
      ['network_area', networkArea],
      ['today_apk_dl', 0],
      ['today_ipa_dl', 0],
      ['today_total_dl', 0],
      ['total_apk_dl', 0],
      ['total_ipa_dl', 0],
      ['total_total_dl', 0],
    ];

    if (linkCreatedAtValue !== undefined) {
      linkColumnPairs.push(['created_at', linkCreatedAtValue]);
    }
    if (isActiveValue !== undefined) {
      linkColumnPairs.push(['is_active', isActiveValue]);
    }

    const fileIds: string[] = [];
    const fileStatements: D1PreparedStatement[] = [];
    for (const upload of uploads) {
      const fileId = crypto.randomUUID();
      fileIds.push(fileId);
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
      fileStatements.push(DB.prepare(fileQuery).bind(...fileValues));
    }

    const firstFileId = fileIds[0] ?? null;
    if (hasFileIdColumn) {
      linkColumnPairs.push(['file_id', firstFileId]);
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

    const linkStatement = DB.prepare(linkQuery).bind(...linkValues);
    await linkStatement.run();

    if (fileStatements.length) {
      await Promise.all(fileStatements.map((statement) => statement.run()));
    }

    if (hasColumn(linksInfo, 'is_active')) {
      const activeValue = isTextColumn(linksInfo, 'is_active')
        ? isActiveInput
          ? '1'
          : '0'
        : isActiveInput
        ? 1
        : 0;
      await DB.prepare('UPDATE links SET is_active=? WHERE id=?')
        .bind(activeValue, linkId)
        .run();
    }
    await ensureDownloadStatsTable(DB, linkId);
    if (regionalArea) {
      await publishLinkToRegionalServer(regionalArea, DB, bindings, linkId);
    }

    return NextResponse.json({ ok: true, linkId, code });
  } catch (error) {
    await DB.prepare('DELETE FROM files WHERE link_id=?')
      .bind(linkId)
      .run()
      .catch(() => null);
    await DB.prepare('DELETE FROM links WHERE id=?')
      .bind(linkId)
      .run()
      .catch(() => null);
    await deleteDownloadStatsForLink(DB, linkId).catch(() => null);
    if (!regionalArea && R2) {
      await Promise.all(pendingUploadKeys.map((key) => R2.delete(key).catch(() => null)));
    } else if (regionalArea) {
      await cleanupRegionalUploads(regionalArea, bindings, pendingUploadKeys).catch(() => null);
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
