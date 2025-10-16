import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

type Env = {
  R2_BUCKET?: R2Bucket;
};

type Platform = 'apk' | 'ipa';

type UploadInitResponse = {
  ok: true;
  linkId: string;
  uploadId: string;
  key: string;
  partSize: number;
  metadata: {
    title: string | null;
    bundleId: string | null;
    version: string | null;
    contentType: string;
  };
};

type UploadPartResponse = {
  ok: true;
  etag: string;
  partNumber: number;
};

type UploadCompleteResponse = {
  ok: true;
  linkId: string;
  upload: {
    platform: Platform;
    key: string;
    size: number;
    title: string | null;
    bundleId: string | null;
    version: string | null;
    contentType: string;
    sha256: string | null;
  };
};

type UploadErrorResponse = {
  ok: false;
  error: string;
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

  const phase = (req.headers.get('x-upload-phase') ?? '').toLowerCase();

  try {
    if (phase === 'init') {
      return await handleInitPhase(req, uid, R2);
    }
    if (phase === 'part') {
      return await handlePartPhase(req, uid, R2);
    }
    if (phase === 'complete') {
      return await handleCompletePhase(req, uid, R2);
    }
    if (phase === 'abort') {
      return await handleAbortPhase(req, uid, R2);
    }
    return NextResponse.json({ ok: false, error: 'INVALID_PHASE' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function handleInitPhase(req: Request, uid: string, R2: R2Bucket) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const payload = body as Partial<{
    platform: string;
    linkId: string | null;
    fileName: string;
    size: number;
    contentType: string | null;
    title: string | null;
    bundleId: string | null;
    version: string | null;
  }>;

  const platform = (payload.platform ?? '').trim().toLowerCase();
  if (platform !== 'apk' && platform !== 'ipa') {
    return NextResponse.json({ ok: false, error: 'INVALID_PLATFORM' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const rawFileName = payload.fileName ?? '';
  const fileName = rawFileName.trim();
  if (!fileName) {
    return NextResponse.json({ ok: false, error: 'FILENAME_REQUIRED' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const size = typeof payload.size === 'number' ? payload.size : Number(payload.size);
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ ok: false, error: 'INVALID_SIZE' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const contentType = (payload.contentType ?? '').trim() || 'application/octet-stream';
  const title = (payload.title ?? '').trim() || null;
  const bundleId = (payload.bundleId ?? '').trim() || null;
  const version = (payload.version ?? '').trim() || null;

  let linkId = (payload.linkId ?? '').trim();
  if (!linkId) {
    linkId = crypto.randomUUID();
  }

  const safeName = sanitizeFileName(fileName, `${platform}.bin`);
  const key = `links/${uid}/${linkId}/${platform}/${Date.now()}-${safeName}`;

  const DEFAULT_PART_SIZE = 8 * 1024 * 1024; // 8 MB
  const MAX_PART_SIZE = 32 * 1024 * 1024; // 32 MB
  const MIN_PART_SIZE = 5 * 1024 * 1024; // 5 MB
  const partSize = Math.max(MIN_PART_SIZE, Math.min(MAX_PART_SIZE, DEFAULT_PART_SIZE));

  const upload = await R2.createMultipartUpload(key, {
    httpMetadata: {
      contentType,
    },
  });

  return NextResponse.json({
    ok: true,
    linkId,
    uploadId: upload.uploadId,
    key,
    partSize,
    metadata: {
      title,
      bundleId,
      version,
      contentType,
    },
  } satisfies UploadInitResponse);
}

async function handlePartPhase(req: Request, uid: string, R2: R2Bucket) {
  void uid; // uid is already validated by caller; unused otherwise
  const uploadId = (req.headers.get('x-upload-id') ?? '').trim();
  const key = req.headers.get('x-key') ?? '';
  const partNumberValue = req.headers.get('x-part-number') ?? '';

  if (!uploadId || !key || !partNumberValue) {
    return NextResponse.json({ ok: false, error: 'MISSING_PART_HEADERS' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const partNumber = Number(partNumberValue);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return NextResponse.json({ ok: false, error: 'INVALID_PART_NUMBER' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const bodyStream = req.body;
  if (!bodyStream) {
    return NextResponse.json({ ok: false, error: 'EMPTY_CHUNK' } satisfies UploadErrorResponse, { status: 400 });
  }

  const upload = R2.resumeMultipartUpload(key, uploadId);
  const uploadedPart = await upload.uploadPart(partNumber, bodyStream);

  return NextResponse.json({
    ok: true,
    etag: uploadedPart.etag,
    partNumber: uploadedPart.partNumber,
  } satisfies UploadPartResponse);
}

async function handleCompletePhase(req: Request, uid: string, R2: R2Bucket) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const payload = body as Partial<{
    platform: string;
    linkId: string;
    uploadId: string;
    key: string;
    size: number;
    contentType: string | null;
    title: string | null;
    bundleId: string | null;
    version: string | null;
    parts: Array<{ partNumber?: number; etag?: string }>;
  }>;

  const platform = (payload.platform ?? '').trim().toLowerCase();
  if (platform !== 'apk' && platform !== 'ipa') {
    return NextResponse.json({ ok: false, error: 'INVALID_PLATFORM' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const linkId = (payload.linkId ?? '').trim();
  if (!linkId) {
    return NextResponse.json({ ok: false, error: 'INVALID_LINK_ID' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const uploadId = (payload.uploadId ?? '').trim();
  const key = (payload.key ?? '').trim();
  if (!uploadId || !key) {
    return NextResponse.json({ ok: false, error: 'MISSING_UPLOAD_INFO' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const size = typeof payload.size === 'number' ? payload.size : Number(payload.size);
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ ok: false, error: 'INVALID_SIZE' } satisfies UploadErrorResponse, { status: 400 });
  }

  const contentType = (payload.contentType ?? '').trim() || 'application/octet-stream';
  const title = (payload.title ?? '').trim() || null;
  const bundleId = (payload.bundleId ?? '').trim() || null;
  const version = (payload.version ?? '').trim() || null;

  const partsRaw = Array.isArray(payload.parts) ? payload.parts : [];
  const parts = partsRaw
    .map((part) => ({
      partNumber: Number(part.partNumber),
      etag: typeof part.etag === 'string' ? part.etag : '',
    }))
    .filter((part) => Number.isInteger(part.partNumber) && part.partNumber >= 1 && part.etag);

  if (!parts.length) {
    return NextResponse.json({ ok: false, error: 'NO_PARTS' } satisfies UploadErrorResponse, { status: 400 });
  }

  const upload = R2.resumeMultipartUpload(key, uploadId);
  await upload.complete(parts);

  const response: UploadCompleteResponse = {
    ok: true,
    linkId,
    upload: {
      platform,
      key,
      size,
      title,
      bundleId,
      version,
      contentType,
      sha256: null,
    },
  };

  return NextResponse.json(response);
}

async function handleAbortPhase(req: Request, uid: string, R2: R2Bucket) {
  void uid;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const payload = body as Partial<{ uploadId: string; key: string }>;
  const uploadId = (payload.uploadId ?? '').trim();
  const key = (payload.key ?? '').trim();
  if (!uploadId || !key) {
    return NextResponse.json({ ok: false, error: 'MISSING_UPLOAD_INFO' } satisfies UploadErrorResponse, {
      status: 400,
    });
  }

  const upload = R2.resumeMultipartUpload(key, uploadId);
  await upload.abort().catch(() => null);

  return NextResponse.json({ ok: true } satisfies { ok: true });
}
