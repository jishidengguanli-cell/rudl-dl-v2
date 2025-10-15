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

  const titleInput = (form.get('title') as string | null) ?? '';
  const bundleIdInput = (form.get('bundle_id') as string | null) ?? '';
  const apkVersionInput = (form.get('apk_version') as string | null) ?? '';
  const ipaVersionInput = (form.get('ipa_version') as string | null) ?? '';
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

  const now = Math.floor(Date.now() / 1000);
  const linkId = crypto.randomUUID();
  const code = generateLinkCode();
  const platformString = files.map((f) => f.platform).join(',');

  const derivedTitle =
    (autofill && files.find((f) => f.meta?.title)?.meta?.title) ||
    titleInput ||
    DEFAULT_TITLE;
  const derivedBundleId =
    (autofill && files.find((f) => f.meta?.bundleId)?.meta?.bundleId) || bundleIdInput || '';
  const derivedApkVersion =
    (autofill && files.find((f) => f.platform === 'apk' && f.meta?.version)?.meta?.version) ||
    apkVersionInput ||
    '';
  const derivedIpaVersion =
    (autofill && files.find((f) => f.platform === 'ipa' && f.meta?.version)?.meta?.version) ||
    ipaVersionInput ||
    '';

  const r2KeysToDelete: string[] = [];

  try {
    await DB.prepare('BEGIN').run();
    await DB.prepare(
      `INSERT INTO links (id, code, owner_id, title, bundle_id, apk_version, ipa_version, platform, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
      .bind(
        linkId,
        code,
        uid,
        derivedTitle,
        derivedBundleId,
        derivedApkVersion,
        derivedIpaVersion,
        platformString,
        now
      )
      .run();

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

      await DB.prepare(
        `INSERT INTO files (id, owner_id, link_id, platform, title, bundle_id, version, size, sha256, content_type, created_at, r2_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          crypto.randomUUID(),
          uid,
          linkId,
          entry.platform,
          entry.meta?.title ?? entry.file.name ?? DEFAULT_TITLE,
          entry.meta?.bundleId ?? '',
          entry.meta?.version ?? '',
          entry.file.size,
          sha,
          entry.file.type || 'application/octet-stream',
          now,
          key
        )
        .run();
    }

    await DB.prepare('UPDATE links SET is_active=1 WHERE id=?').bind(linkId).run();
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
