import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

type Env = {
  R2_BUCKET?: R2Bucket;
};

type UploadResponse = {
  ok: true;
  linkId: string;
  upload: {
    platform: 'apk' | 'ipa';
    key: string;
    size: number;
    title: string | null;
    bundleId: string | null;
    version: string | null;
    contentType: string;
    sha256: string | null;
  };
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

function sanitizeFileName(value: string, fallback: string): string {
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '') || fallback;
}

export async function POST(req: Request) {
  const uid = parseUid(req);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const R2 = bindings.R2_BUCKET;
  if (!R2) {
    return NextResponse.json({ ok: false, error: 'Missing R2 binding' }, { status: 500 });
  }

  const form = await req.formData();
  const fileEntry = form.get('file');
  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return NextResponse.json({ ok: false, error: 'FILE_REQUIRED' }, { status: 400 });
  }

  const platform = (form.get('platform') as string | null)?.trim();
  if (platform !== 'apk' && platform !== 'ipa') {
    return NextResponse.json({ ok: false, error: 'INVALID_PLATFORM' }, { status: 400 });
  }

  let linkId = (form.get('linkId') as string | null)?.trim() ?? '';
  if (!linkId) {
    linkId = crypto.randomUUID();
  }

  const contentType =
    (form.get('contentType') as string | null)?.trim() ||
    fileEntry.type ||
    'application/octet-stream';

  const title = (form.get('title') as string | null)?.trim() || null;
  const bundleId = (form.get('bundleId') as string | null)?.trim() || null;
  const version = (form.get('version') as string | null)?.trim() || null;

  const safeName = sanitizeFileName(fileEntry.name ?? `${platform}.bin`, `${platform}.bin`);
  const key = `links/${uid}/${linkId}/${platform}/${Date.now()}-${safeName}`;

  await R2.put(key, fileEntry.stream(), {
    httpMetadata: {
      contentType,
    },
  });

  const upload: UploadResponse['upload'] = {
    platform,
    key,
    size: fileEntry.size,
    title,
    bundleId,
    version,
    contentType,
    sha256: null,
  };

  return NextResponse.json({ ok: true, linkId, upload } satisfies UploadResponse);
}
