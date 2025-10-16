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

function decodeHeaderValue(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const coerced = Math.floor(parsed);
  if (coerced <= 0) return null;
  return coerced;
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

  const platformHeader = req.headers.get('x-platform');
  const platform = platformHeader === 'apk' || platformHeader === 'ipa' ? platformHeader : null;
  if (platform !== 'apk' && platform !== 'ipa') {
    return NextResponse.json({ ok: false, error: 'INVALID_PLATFORM' }, { status: 400 });
  }

  let linkId = (req.headers.get('x-link-id') ?? '').trim();
  if (!linkId) {
    linkId = crypto.randomUUID();
  }

  const contentType =
    req.headers.get('content-type')?.trim() ||
    'application/octet-stream';

  const rawTitle = decodeHeaderValue(req.headers.get('x-title'));
  const rawBundleId = decodeHeaderValue(req.headers.get('x-bundle-id'));
  const rawVersion = decodeHeaderValue(req.headers.get('x-version'));
  const rawFileName = decodeHeaderValue(req.headers.get('x-file-name'));

  const title = rawTitle?.trim() || null;
  const bundleId = rawBundleId?.trim() || null;
  const version = rawVersion?.trim() || null;

  const safeName = sanitizeFileName(rawFileName ?? `${platform}.bin`, `${platform}.bin`);
  const key = `links/${uid}/${linkId}/${platform}/${Date.now()}-${safeName}`;

  const sizeHeader = parsePositiveInteger(req.headers.get('x-file-size'));
  const size =
    sizeHeader ??
    parsePositiveInteger(req.headers.get('content-length')) ??
    null;
  if (size === null) {
    return NextResponse.json({ ok: false, error: 'FILE_REQUIRED' }, { status: 400 });
  }

  const bodyStream = req.body;
  if (!bodyStream) {
    return NextResponse.json({ ok: false, error: 'FILE_REQUIRED' }, { status: 400 });
  }

  await R2.put(key, bodyStream, {
    httpMetadata: {
      contentType,
    },
  });

  const upload: UploadResponse['upload'] = {
    platform,
    key,
    size,
    title,
    bundleId,
    version,
    contentType,
    sha256: null,
  };

  return NextResponse.json({ ok: true, linkId, upload } satisfies UploadResponse);
}
