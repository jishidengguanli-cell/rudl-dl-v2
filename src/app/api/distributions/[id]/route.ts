import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { ensureDownloadStatsTable, getStatsTableName } from '@/lib/downloads';
import {
  fetchDistributionById,
  getTableInfo,
  hasColumn,
  isTextColumn,
  type DistributionFile,
} from '@/lib/distribution';
import { normalizeLanguageCode } from '@/lib/language';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export const runtime = 'edge';

const DEFAULT_TITLE = 'APP';

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

type UpdateBody = {
  title: string;
  bundleId: string;
  apkVersion: string;
  ipaVersion: string;
  autofill: boolean;
  lang: string;
  uploads: UploadInput[];
  isActive?: boolean;
};

type JsonOk = { ok: true; linkId?: string; code?: string };
type JsonError = { ok: false; error: string };

const jsonError = (error: string, status = 400) =>
  NextResponse.json<JsonError>({ ok: false, error }, { status });

function parseUid(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const pair = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='));
  if (!pair) return null;
  return pair.slice(4);
}

const normalizePlatform = (value: string | null | undefined) =>
  (value ?? '').toLowerCase() === 'ipa' ? 'ipa' : (value ?? '').toLowerCase() === 'apk' ? 'apk' : null;

const trimOrEmpty = (value: string | null | undefined) => (value ? value.trim() : '');

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const linkId = String(params?.id ?? '').trim();
  if (!linkId) {
    return jsonError('INVALID_LINK_ID', 400);
  }

  const uid = parseUid(req);
  if (!uid) {
    return jsonError('UNAUTHENTICATED', 401);
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  const R2 = bindings.R2_BUCKET;
  if (!DB || !R2) {
    return jsonError('Missing DB or R2 binding', 500);
  }

  const existing = await fetchDistributionById(DB, linkId);
  if (!existing) {
    return jsonError('NOT_FOUND', 404);
  }

  if (existing.ownerId !== uid) {
    return jsonError('FORBIDDEN', 403);
  }

  await ensureDownloadStatsTable(DB, linkId);

  let payload: UpdateBody;
  try {
    payload = (await req.json()) as UpdateBody;
  } catch {
    return jsonError('INVALID_PAYLOAD', 400);
  }

  if (!payload || typeof payload !== 'object') {
    return jsonError('INVALID_PAYLOAD', 400);
  }

  const uploads = Array.isArray(payload.uploads) ? payload.uploads.filter(Boolean) : [];
  const newUploadKeys = uploads.map((item) => item.key.replace(/^\/+/, ''));
  const title = (payload.title ?? '').trim();
  const bundleId = (payload.bundleId ?? '').trim();
  const apkVersion = (payload.apkVersion ?? '').trim();
  const ipaVersion = (payload.ipaVersion ?? '').trim();
  const autofill = Boolean(payload.autofill);
  const linkLang = normalizeLanguageCode(typeof payload.lang === 'string' ? payload.lang : '');
  const isActive = typeof payload.isActive === 'boolean' ? payload.isActive : existing.isActive;

  const existingFiles = new Map<'apk' | 'ipa', DistributionFile>();
  for (const file of existing.files) {
    const platform = normalizePlatform(file.platform);
    if (platform) {
      existingFiles.set(platform, file);
    }
  }

  const uploadMap = new Map<'apk' | 'ipa', UploadInput>();
  for (const upload of uploads) {
    const platform = normalizePlatform(upload.platform);
    if (!platform) continue;
    uploadMap.set(platform, upload);
  }

  if (autofill) {
    const apkBundle = trimOrEmpty(uploadMap.get('apk')?.bundleId ?? existingFiles.get('apk')?.bundleId);
    const ipaBundle = trimOrEmpty(uploadMap.get('ipa')?.bundleId ?? existingFiles.get('ipa')?.bundleId);
    if (apkBundle && ipaBundle && apkBundle !== ipaBundle) {
      return jsonError('AUTOFILL_MISMATCH', 400);
    }
  }

  try {
    const now = Date.now();
    const nowEpoch = Math.floor(now / 1000);
    const nowIso = new Date(now).toISOString();

    let linksInfo = await getTableInfo(DB, 'links');
    if (!hasColumn(linksInfo, 'lang')) {
      linksInfo = await getTableInfo(DB, 'links', true);
    }
    const filesInfo = await getTableInfo(DB, 'files');

    const statements: D1PreparedStatement[] = [];
    const r2KeysToDelete: string[] = [];

    // Update link record
    const linkUpdates: Array<[string, unknown]> = [
      ['title', title || DEFAULT_TITLE],
      ['bundle_id', bundleId],
      ['apk_version', apkVersion],
      ['ipa_version', ipaVersion],
      ['lang', linkLang],
    ];

    const platformsFinal = new Set<string>();
    existing.files.forEach((file) => {
      const platform = normalizePlatform(file.platform);
      if (platform) platformsFinal.add(platform);
    });
    for (const upload of uploadMap.values()) {
      const platform = normalizePlatform(upload.platform);
      if (platform) platformsFinal.add(platform);
    }
    if (platformsFinal.size) {
      linkUpdates.push(['platform', Array.from(platformsFinal).join(',')]);
    }

    if (hasColumn(linksInfo, 'updated_at')) {
      linkUpdates.push([
        'updated_at',
        isTextColumn(linksInfo, 'updated_at') ? nowIso : nowEpoch,
      ]);
    }

    if (hasColumn(linksInfo, 'bundle_id')) {
      // ensure the value exists even if empty string
    }

    if (hasColumn(linksInfo, 'is_active')) {
      linkUpdates.push([
        'is_active',
        isTextColumn(linksInfo, 'is_active') ? (isActive ? '1' : '0') : isActive ? 1 : 0,
      ]);
    }

    const linkColumns = linkUpdates
      .filter(([column]) => hasColumn(linksInfo, column))
      .map(([column]) => column);
    const linkValues = linkUpdates
      .filter(([column]) => hasColumn(linksInfo, column))
      .map(([, value]) => value);

    if (linkColumns.length) {
      const sets = linkColumns.map((column) => `${column}=?`).join(', ');
      statements.push(DB.prepare(`UPDATE links SET ${sets} WHERE id=?`).bind(...linkValues, linkId));
    }

    let fileIdForLink: string | null = existing.fileId;

    const ensureFileColumns = (entries: Array<[string, unknown]>, platform: 'apk' | 'ipa') => {
      if (hasColumn(filesInfo, 'platform')) entries.push(['platform', platform]);
      if (hasColumn(filesInfo, 'link_id')) entries.push(['link_id', linkId]);
      if (hasColumn(filesInfo, 'updated_at')) {
        entries.push([
          'updated_at',
          isTextColumn(filesInfo, 'updated_at') ? nowIso : nowEpoch,
        ]);
      }
      return entries.filter(([column]) => hasColumn(filesInfo, column));
    };

    for (const [platform, upload] of uploadMap.entries()) {
      const target = existingFiles.get(platform);
      const baseTitle = trimOrEmpty(upload.title) || target?.title || DEFAULT_TITLE;
      const baseBundle = trimOrEmpty(upload.bundleId) || target?.bundleId || '';
      const baseVersion = trimOrEmpty(upload.version) || target?.version || '';
      const contentType = trimOrEmpty(upload.contentType) || target?.contentType || 'application/octet-stream';
      const sha256 = trimOrEmpty(upload.sha256) || target?.sha256 || '';
      const r2Key = upload.key.replace(/^\/+/, '');

      const entries: Array<[string, unknown]> = [
        ['title', baseTitle],
        ['bundle_id', baseBundle],
        ['version', baseVersion],
        ['size', upload.size],
        ['r2_key', r2Key],
        ['content_type', contentType],
        ['sha256', sha256],
      ];

      if (target) {
        const columns = ensureFileColumns(entries, platform);
        if (columns.length) {
          const sets = columns.map(([column]) => `${column}=?`).join(', ');
          const values = columns.map(([, value]) => value);
          statements.push(
            DB.prepare(`UPDATE files SET ${sets} WHERE id=?`).bind(...values, target.id)
          );
        }
        if (target.r2Key && target.r2Key !== r2Key) {
          r2KeysToDelete.push(target.r2Key);
        }
      } else {
        const newFileId = crypto.randomUUID();
        const insertPairs: Array<[string, unknown]> = [
          ['id', newFileId],
          ['title', baseTitle],
          ['bundle_id', baseBundle],
          ['version', baseVersion],
          ['size', upload.size],
          ['r2_key', r2Key],
          ['content_type', contentType],
          ['sha256', sha256],
          ['owner_id', uid],
        ];

        if (hasColumn(filesInfo, 'created_at')) {
          insertPairs.push([
            'created_at',
            isTextColumn(filesInfo, 'created_at') ? nowIso : nowEpoch,
          ]);
        }

        const columns = ensureFileColumns(insertPairs, platform);
        const fileColumns = columns.map(([column]) => column);
        const fileValues = columns.map(([, value]) => value);
        if (fileColumns.length) {
          const placeholders = fileColumns.map(() => '?').join(', ');
          statements.push(
            DB.prepare(`INSERT INTO files (${fileColumns.join(', ')}) VALUES (${placeholders})`).bind(
              ...fileValues
            )
          );
          if (!fileIdForLink) {
            fileIdForLink = newFileId;
          }
        }
      }
    }

    if (!existing.fileId && fileIdForLink && hasColumn(linksInfo, 'file_id')) {
      statements.push(
        DB.prepare(`UPDATE links SET file_id=? WHERE id=?`).bind(fileIdForLink, linkId)
      );
    }

    if (statements.length) {
      await DB.batch(statements);
    }

    if (r2KeysToDelete.length) {
      await Promise.all(
        r2KeysToDelete.map(async (key) => {
          try {
            await R2.delete(key);
          } catch {
            // ignore deletion errors
          }
        })
      );
    }

    return NextResponse.json<JsonOk>({ ok: true, linkId, code: existing.code });
  } catch (error) {
    if (newUploadKeys.length) {
      await Promise.all(
        newUploadKeys.map(async (key) => {
          try {
            await R2.delete(key);
          } catch {
            // ignore
          }
        })
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message || 'UPDATE_FAILED', 500);
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const linkId = String(params?.id ?? '').trim();
  if (!linkId) {
    return jsonError('INVALID_LINK_ID', 400);
  }

  const uid = parseUid(_req);
  if (!uid) {
    return jsonError('UNAUTHENTICATED', 401);
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  const R2 = bindings.R2_BUCKET;
  if (!DB || !R2) {
    return jsonError('Missing DB or R2 binding', 500);
  }

  const existing = await fetchDistributionById(DB, linkId);
  if (!existing) {
    return jsonError('NOT_FOUND', 404);
  }
  if (existing.ownerId !== uid) {
    return jsonError('FORBIDDEN', 403);
  }

  const r2Keys = existing.files
    .map((file) => file.r2Key)
    .filter((key): key is string => Boolean(key));

  try {
    await DB.batch([
      DB.prepare('DELETE FROM files WHERE link_id=?').bind(linkId),
      DB.prepare('DELETE FROM links WHERE id=?').bind(linkId),
    ]);
    const statsTable = getStatsTableName(linkId);
    await DB.exec(`DROP TABLE IF EXISTS "${statsTable}"`);

    if (r2Keys.length) {
      await Promise.all(
        r2Keys.map(async (key) => {
          try {
            await R2.delete(key);
          } catch {
            // ignore deletion errors
          }
        })
      );
    }

    return NextResponse.json<JsonOk>({ ok: true, linkId, code: existing.code });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message || 'DELETE_FAILED', 500);
  }
}
