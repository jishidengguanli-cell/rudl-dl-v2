import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

type Env = {
  R2_BUCKET?: R2Bucket;
};

type PresignFileRequest = {
  platform: 'apk' | 'ipa';
  fileName: string;
  contentType?: string;
};

type PresignRequestBody = {
  files: PresignFileRequest[];
};

type PresignResult = {
  ok: true;
  linkId: string;
  uploads: Record<
    'apk' | 'ipa',
    { key: string; url: string; headers?: Record<string, string> } | undefined
  >;
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

function sanitizeFileName(name: string, fallback: string): string {
  const cleaned = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned.length ? cleaned : fallback;
}

export async function POST(req: Request) {
  const uid = parseUid(req);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  let body: PresignRequestBody | undefined;
  try {
    body = (await req.json()) as PresignRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  if (!body?.files?.length) {
    return NextResponse.json({ ok: false, error: 'NO_FILES' }, { status: 400 });
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const R2 = bindings.R2_BUCKET;
  if (!R2) {
    return NextResponse.json({ ok: false, error: 'Missing R2 binding' }, { status: 500 });
  }

  const linkId = crypto.randomUUID();
  const uploads: PresignResult['uploads'] = { apk: undefined, ipa: undefined };

  for (const entry of body.files) {
    if (!entry?.platform || (entry.platform !== 'apk' && entry.platform !== 'ipa')) continue;
    const safeName = sanitizeFileName(entry.fileName ?? '', `${entry.platform}.bin`);
    const key = `links/${uid}/${linkId}/${entry.platform}/${Date.now()}-${safeName}`;

    const signed = await (R2 as unknown as {
      createSignedUrl(options: {
        key: string;
        method: string;
        expiration: Date;
        headers?: Record<string, string>;
      }): Promise<{ url: string; headers?: Record<string, string> }>;
    }).createSignedUrl({
      key,
      method: 'PUT',
      expiration: new Date(Date.now() + 15 * 60 * 1000),
      headers: entry.contentType ? { 'content-type': entry.contentType } : undefined,
    });

    uploads[entry.platform] = {
      key,
      url: signed.url,
      headers: signed.headers,
    };
  }

  return NextResponse.json({ ok: true, linkId, uploads } satisfies PresignResult);
}
