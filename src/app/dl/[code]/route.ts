import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { fetchDistributionByCode } from '@/lib/distribution';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const CDN_BASE = 'https://cdn.dataruapp.com/';

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return new Response('Missing D1 binding DB', { status: 500 });
  }

  const params = await context.params;
  const code = String(params?.code ?? '').trim();
  if (!code) return new Response('Invalid code', { status: 400 });

  const link = await fetchDistributionByCode(DB, code);
  if (!link || !link.isActive) {
    return new Response('Not Found', { status: 404 });
  }

  const files = link.files.filter((file) => file.r2Key);
  if (!files.length) return new Response('File Missing', { status: 404 });

  const url = new URL(request.url);
  const queryPlatform =
    url.searchParams.get('p') ??
    url.searchParams.get('platform') ??
    '';
  const normalizedQuery = queryPlatform.trim().toLowerCase();

  const availablePlatforms = new Set(
    files
      .map((file) => (file.platform ?? '').toLowerCase())
      .filter(Boolean)
  );

  const resolvePlatform = (): 'apk' | 'ipa' => {
    if (normalizedQuery === 'apk' || normalizedQuery === 'android') return 'apk';
    if (normalizedQuery === 'ipa' || normalizedQuery === 'ios') return 'ipa';
    if (availablePlatforms.has('apk') && !availablePlatforms.has('ipa')) return 'apk';
    if (!availablePlatforms.has('apk') && availablePlatforms.has('ipa')) return 'ipa';
    return 'apk';
  };

  const platform = resolvePlatform();

  const byId =
    link.fileId ? files.find((file) => file.id === link.fileId) ?? null : null;
  const byPlatform = (target: 'apk' | 'ipa') =>
    files.find((file) => (file.platform ?? '').toLowerCase() === target) ?? null;

  let selected =
    (byId && (byId.platform ?? '').toLowerCase() === platform ? byId : null) ??
    byPlatform(platform) ??
    byId ??
    null;

  if (!selected) {
    selected = platform === 'apk' ? byPlatform('ipa') : byPlatform('apk');
  }

  if (!selected?.r2Key) {
    return new Response('File Missing', { status: 404 });
  }

  let effectivePlatform = (selected.platform ?? '').toLowerCase() as 'apk' | 'ipa';
  if (effectivePlatform !== 'apk' && effectivePlatform !== 'ipa') {
    effectivePlatform = platform;
  }

  const destination =
    effectivePlatform === 'apk'
      ? `${CDN_BASE}${encodeRfc3986Path(selected.r2Key.replace(/^\/+/, ''))}`
      : `itms-services://?action=download-manifest&url=${encodeURIComponent(
          `${url.origin}/m/${encodeURIComponent(link.code)}`
        )}`;

  if (link.ownerId) {
    try {
      await fetch(new URL('/api/dl/bill', url.origin).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          account_id: link.ownerId,
          link_id: link.id,
          platform: effectivePlatform,
        }),
      });
    } catch {
      // ignore billing failure to avoid blocking download
    }
  }

  const response = NextResponse.redirect(destination, 302);
  response.headers.set('cache-control', 'no-store');
  return response;
}

function encodeRfc3986Path(path: string) {
  return path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join('/');
}
