import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { createCnUploadTicket, cleanupCnUploads } from '@/lib/cn-server';

export const runtime = 'edge';

type Env = {
  CN_SERVER_API_BASE?: string;
  CN_SERVER_API_TOKEN?: string;
  CN_DOWNLOAD_BASE_URL?: string;
};

type JsonResponse =
  | { ok: true; logs: string[] }
  | { ok: false; error: string; logs?: string[] };

const parseUid = (req: Request): string | null => {
  const cookie = req.headers.get('cookie') ?? '';
  const pair = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='));
  if (!pair) return null;
  return pair.slice(4);
};

export async function POST(req: Request) {
  const logs: string[] = [];
  const uid = parseUid(req);
  if (!uid) {
    return NextResponse.json<JsonResponse>(
      { ok: false, error: 'UNAUTHENTICATED', logs },
      { status: 401 }
    );
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  if (!bindings.CN_SERVER_API_BASE || !bindings.CN_SERVER_API_TOKEN) {
    logs.push('CN server configuration missing.');
    return NextResponse.json<JsonResponse>(
      { ok: false, error: 'CN_SERVER_NOT_CONFIGURED', logs },
      { status: 500 }
    );
  }

  const linkId = `cn-test-${uid}`;
  const key = `${uid}/cn-test/${Date.now()}/test.init`;

  try {
    logs.push('Requesting upload ticket from CN server…');
    const ticket = await createCnUploadTicket(
      bindings,
      {
        platform: 'apk',
        ownerId: uid,
        linkId,
        key,
        size: 4,
        contentType: 'text/plain',
      }
    );
    logs.push('Upload ticket received.');

    logs.push('Uploading test file to CN server…');
    const payload = new TextEncoder().encode('ping');
    const uploadResponse = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain',
        ...(ticket.uploadHeaders ?? {}),
      },
      body: payload,
    });
    if (!uploadResponse.ok) {
      logs.push(`Upload failed with status ${uploadResponse.status}`);
      return NextResponse.json<JsonResponse>(
        { ok: false, error: `UPLOAD_FAILED_${uploadResponse.status}`, logs },
        { status: 502 }
      );
    }
    logs.push('Upload completed. Cleaning up test file…');
    await cleanupCnUploads(bindings, [key]).catch((error) => {
      logs.push(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    logs.push('CN upload test finished.');
    return NextResponse.json<JsonResponse>({ ok: true, logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.push(`Error: ${message}`);
    return NextResponse.json<JsonResponse>(
      { ok: false, error: message || 'UNKNOWN_ERROR', logs },
      { status: 500 }
    );
  }
}
