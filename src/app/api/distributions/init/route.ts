import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { generateLinkCode } from '@/lib/code';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  R2_BUCKET?: R2Bucket;
};

const VALID_PLATFORMS = new Set(['apk', 'ipa']);

function parseUid(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const pair = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='));
  if (!pair) return null;
  return pair.slice(4);
}

export async function POST(req: Request) {
  try {
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

    const body = (await req.json().catch(() => ({}))) as Partial<{
      platforms: unknown;
    }>;

    const platformsInput = Array.isArray(body.platforms) ? body.platforms : [];
    const platforms = platformsInput
      .map((p) => (typeof p === 'string' ? p.toLowerCase() : ''))
      .filter((p) => VALID_PLATFORMS.has(p));

    if (!platforms.length) {
      return NextResponse.json({ ok: false, error: 'INVALID_PLATFORMS' }, { status: 400 });
    }

    const linkId = crypto.randomUUID();
    const code = generateLinkCode();
    const createdAt = Math.floor(Date.now() / 1000);
    const platformString = platforms.join(',');

    await DB.prepare(
      `INSERT INTO links (id, code, owner_id, title, bundle_id, apk_version, ipa_version, platform, is_active, created_at)
       VALUES (?, ?, ?, '', '', '', '', ?, 0, ?)`
    )
      .bind(linkId, code, uid, platformString, createdAt)
      .run();

    const uploads: Record<string, { url: string; key: string }> = {};
    for (const platform of platforms) {
      const key = `uploads/${uid}/${linkId}/${platform}/${Date.now()}-${crypto.randomUUID()}`;
      const presigned = await R2.createPresignedUrl({
        key,
        method: 'PUT',
        expiration: 600,
      });
      uploads[platform] = { url: presigned.url.toString(), key };
    }

    return NextResponse.json({ ok: true, linkId, code, uploads });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
