import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { normalizeNetworkArea, isRegionalNetworkArea } from '@/lib/network-area';
import { createCnUploadTicket } from '@/lib/cn-server';
import { createRuUploadTicket } from '@/lib/ru-server';

export const runtime = 'edge';

type Env = {
  R2_BUCKET?: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  CN_SERVER_API_BASE?: string;
  CN_SERVER_API_TOKEN?: string;
  RU_SERVER_API_BASE?: string;
  RU_SERVER_API_TOKEN?: string;
};

type Platform = 'apk' | 'ipa';

type UploadRequestBody = {
  platform?: string;
  linkId?: string | null;
  fileName?: string | null;
  size?: number | null;
  contentType?: string | null;
  title?: string | null;
  bundleId?: string | null;
  version?: string | null;
  networkArea?: string | null;
};

type UploadResponse = {
  ok: true;
  linkId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
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

function toAmzDate(date: Date) {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function encodeRfc3986Path(path: string) {
  return path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join('/');
}

async function sha256Hex(input: string | ArrayBuffer) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: ArrayBuffer | ArrayBufferView, data: string) {
  const sourceView =
    key instanceof ArrayBuffer
      ? new Uint8Array(key)
      : new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
  const keyView = new Uint8Array(sourceView);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyView,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return signature;
}

async function getSigningKey(secretKey: string, date: string, region: string, service: string) {
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secretKey}`), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  return kSigning;
}

async function hmacHex(key: ArrayBuffer, data: string) {
  const signature = await hmac(key, data);
  const bytes = new Uint8Array(signature);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function presignPutUrl(options: {
  accountId: string;
  accessKeyId: string;
  secretKey: string;
  bucket: string;
  key: string;
  contentType: string;
  expires: number;
}) {
  const { accountId, accessKeyId, secretKey, bucket, key, contentType, expires } = options;
  const service = 's3';
  const region = 'auto';
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = `/${encodeURIComponent(bucket)}/${encodeRfc3986Path(key)}`;

  const queryPairs: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expires)],
    ['X-Amz-SignedHeaders', 'content-type;host'],
  ];

  const canonicalQuery = queryPairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join('&');

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const hashCanonical = await sha256Hex(canonicalRequest);
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${hashCanonical}`;
  const signingKey = await getSigningKey(secretKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const baseUrl = `https://${host}${canonicalUri}`;
  const signedUrl = `${baseUrl}?${canonicalQuery}&X-Amz-Signature=${signature}`;

  return signedUrl;
}

export async function POST(req: Request) {
  const uid = parseUid(req);
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const R2 = bindings.R2_BUCKET;
  const accountId = bindings.R2_ACCOUNT_ID;
  const accessKeyId = bindings.R2_ACCESS_KEY_ID;
  const secretKey = bindings.R2_SECRET_ACCESS_KEY;
  const bucketName = bindings.R2_BUCKET_NAME;

  let payload: UploadRequestBody | undefined;
  try {
    payload = (await req.json()) as UploadRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  if (!payload) {
    return NextResponse.json({ ok: false, error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  const platform = (payload.platform ?? '').trim().toLowerCase() as Platform;
  if (platform !== 'apk' && platform !== 'ipa') {
    return NextResponse.json({ ok: false, error: 'INVALID_PLATFORM' }, { status: 400 });
  }

  const fileName = (payload.fileName ?? '').trim();
  if (!fileName) {
    return NextResponse.json({ ok: false, error: 'FILENAME_REQUIRED' }, { status: 400 });
  }

  const size = typeof payload.size === 'number' && Number.isFinite(payload.size) ? payload.size : null;
  if (!size || size <= 0) {
    return NextResponse.json({ ok: false, error: 'INVALID_SIZE' }, { status: 400 });
  }

  const rawContentType = (payload.contentType ?? '').trim();
  const contentType =
    rawContentType ||
    (platform === 'apk' ? 'application/vnd.android.package-archive' : 'application/octet-stream');

  const title = (payload.title ?? '').trim() || null;
  const bundleId = (payload.bundleId ?? '').trim() || null;
  const version = (payload.version ?? '').trim() || null;
  const networkArea = normalizeNetworkArea(payload.networkArea);
  const regionalArea = isRegionalNetworkArea(networkArea) ? networkArea : null;
  const useRegionalBackend = Boolean(regionalArea);

  let linkId = (payload.linkId ?? '').trim();
  if (!linkId) {
    linkId = crypto.randomUUID();
  }

  const safeName = sanitizeFileName(fileName, `${platform}.bin`);
  const key = `${uid}/links/${linkId}/${platform}/${safeName}`;

  if (useRegionalBackend && regionalArea) {
    try {
      const creator =
        regionalArea === 'CN' ? createCnUploadTicket : createRuUploadTicket;
      const ticket = await creator(bindings, {
        key,
        contentType,
        size,
        platform,
        linkId,
        ownerId: uid,
      });
      const response: UploadResponse = {
        ok: true,
        linkId,
        uploadUrl: ticket.uploadUrl,
        uploadHeaders: {
          'Content-Type': contentType,
          ...ticket.uploadHeaders,
        },
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  if (!R2 || !accountId || !accessKeyId || !secretKey || !bucketName) {
    return NextResponse.json({ ok: false, error: 'Missing R2 credentials' }, { status: 500 });
  }

  const exists = await R2.head(key);
  if (exists) {
    await R2.delete(key).catch(() => null);
  }

  const uploadUrl = await presignPutUrl({
    accountId,
    accessKeyId,
    secretKey,
    bucket: bucketName,
    key,
    contentType,
    expires: 600,
  });

  const response: UploadResponse = {
    ok: true,
    linkId,
    uploadUrl,
    uploadHeaders: {
      'Content-Type': contentType,
    },
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
