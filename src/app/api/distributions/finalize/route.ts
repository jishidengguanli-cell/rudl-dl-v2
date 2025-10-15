import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  R2_BUCKET?: R2Bucket;
};

type FinalizeFile = {
  platform: 'apk' | 'ipa';
  key: string;
  size: number;
  contentType: string;
  title?: string | null;
  bundleId?: string | null;
  version?: string | null;
  sha256?: string | null;
};

type FinalizeBody = {
  linkId?: string;
  title?: string;
  bundleId?: string;
  apkVersion?: string;
  ipaVersion?: string;
  files?: FinalizeFile[];
  autofill?: boolean;
};

function parseUid(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const pair = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='));
  if (!pair) return null;
  return pair.slice(4);
}

async function deleteLink(DB: D1Database, linkId: string) {
  await DB.prepare('DELETE FROM files WHERE link_id=?').bind(linkId).run();
  await DB.prepare('DELETE FROM links WHERE id=?').bind(linkId).run();
}

export async function POST(req: Request) {
  const now = Math.floor(Date.now() / 1000);
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

  const body = (await req.json().catch(() => ({}))) as FinalizeBody;
  const { linkId, files = [], title, bundleId, apkVersion, ipaVersion, autofill } = body;

  if (!linkId || !files.length) {
    return NextResponse.json({ ok: false, error: 'INVALID_REQUEST' }, { status: 400 });
  }

  try {
    const linkRow = await DB.prepare(
      'SELECT owner_id, platform, is_active FROM links WHERE id=? LIMIT 1'
    )
      .bind(linkId)
      .first<{ owner_id: string; platform: string; is_active: number }>();

    if (!linkRow || linkRow.owner_id !== uid) {
      return NextResponse.json({ ok: false, error: 'LINK_NOT_FOUND' }, { status: 404 });
    }

    const normalizedFiles: FinalizeFile[] = files
      .filter((f) => f && f.platform && f.key)
      .map((f) => ({
        ...f,
        platform: f.platform.toLowerCase() === 'ipa' ? 'ipa' : 'apk',
        size: Number(f.size) || 0,
        contentType: f.contentType || 'application/octet-stream',
        title: f.title ?? null,
        bundleId: f.bundleId ?? null,
        version: f.version ?? null,
        sha256: f.sha256 ?? null,
      }));

    if (!normalizedFiles.length) {
      return NextResponse.json({ ok: false, error: 'NO_FILES' }, { status: 400 });
    }

    const platforms = Array.from(new Set(normalizedFiles.map((f) => f.platform)));

    if (autofill && platforms.length === 2) {
      const [apkMeta] = normalizedFiles.filter((f) => f.platform === 'apk');
      const [ipaMeta] = normalizedFiles.filter((f) => f.platform === 'ipa');
      if (
        apkMeta &&
        ipaMeta &&
        apkMeta.bundleId &&
        ipaMeta.bundleId &&
        apkMeta.bundleId !== ipaMeta.bundleId
      ) {
        throw new Error('AUTOFILL_MISMATCH');
      }
    }

    const deleteKeys: string[] = [];
    try {
      await DB.prepare('BEGIN').run();

      await DB.prepare('DELETE FROM files WHERE link_id=?').bind(linkId).run();

      for (const file of normalizedFiles) {
        const head = await R2.head(file.key);
        if (!head) {
          throw new Error('FILE_NOT_FOUND_IN_R2');
        }
        deleteKeys.push(file.key);

        await DB.prepare(
          `INSERT INTO files (id, owner_id, link_id, platform, title, bundle_id, version, size, sha256, content_type, created_at, r2_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            crypto.randomUUID(),
            uid,
            linkId,
            file.platform,
            file.title,
            file.bundleId,
            file.version,
            file.size,
            file.sha256,
            file.contentType,
            now,
            file.key
          )
          .run();
      }

      await DB.prepare(
        `UPDATE links
         SET title=?, bundle_id=?, apk_version=?, ipa_version=?, platform=?, is_active=1, updated_at=?
         WHERE id=?`
      )
        .bind(
          title ?? '',
          bundleId ?? '',
          apkVersion ?? '',
          ipaVersion ?? '',
          platforms.join(','),
          now,
          linkId
        )
        .run();

      await DB.prepare('COMMIT').run();
    } catch (error) {
      await DB.prepare('ROLLBACK').run().catch(() => null);
      await deleteLink(DB, linkId).catch(() => null);
      for (const key of deleteKeys) {
        await R2.delete(key).catch(() => null);
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
