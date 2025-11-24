import { getRequestContext } from '@cloudflare/next-on-pages';
import { fetchDistributionByCode } from '@/lib/distribution';
import {
  getRegionalDownloadBaseUrl,
  isRegionalServerConfigured,
  type RegionalServerBindings,
} from '@/lib/regional-server';
import { isRegionalNetworkArea } from '@/lib/network-area';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
} & RegionalServerBindings;

const DEFAULT_TITLE = 'App';
const CDN_BASE = 'https://cdn.dataruapp.com/';

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return new Response('Missing D1 binding DB', {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    });
  }

  const params = await context.params;
  const code = String(params?.code ?? '').trim();
  if (!code) return resp404('Invalid code');

  const link = await fetchDistributionByCode(DB, code);
  if (!link || !link.isActive) return resp404('Not Found');
  if (
    isRegionalNetworkArea(link.networkArea) &&
    isRegionalServerConfigured(link.networkArea, bindings)
  ) {
    const baseUrl = getRegionalDownloadBaseUrl(link.networkArea, bindings);
    const target = `${baseUrl}/m/${encodeURIComponent(link.code)}`;
    return Response.redirect(target, 302);
  }

  const files = link.files ?? [];
  const primaryFile =
    (link.fileId && files.find((file) => file.id === link.fileId && file.r2Key)) ||
    files.find(
      (file) => file.r2Key && (file.platform ?? '').toLowerCase() === 'ipa'
    ) ||
    null;

  if (!primaryFile?.r2Key) {
    return resp404('File Missing');
  }

  const title =
    primaryFile.title ??
    link.title ??
    DEFAULT_TITLE;
  const version =
    primaryFile.version ??
    link.ipaVersion ??
    link.apkVersion ??
    '1.0';
  const bundleId =
    primaryFile.bundleId ??
    link.bundleId ??
    `com.unknown.${link.code.toLowerCase()}`;

  const ipaUrl = `${CDN_BASE}${encodeRfc3986Path(primaryFile.r2Key.replace(/^\/+/, ''))}`;

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>items</key>
    <array>
      <dict>
        <key>assets</key>
        <array>
          <dict>
            <key>kind</key><string>software-package</string>
            <key>url</key><string>${xml(ipaUrl)}</string>
          </dict>
        </array>
        <key>metadata</key>
        <dict>
          <key>bundle-identifier</key><string>${xml(bundleId)}</string>
          <key>bundle-version</key><string>${xml(version)}</string>
          <key>kind</key><string>software</string>
          <key>title</key><string>${xml(title)}</string>
        </dict>
      </dict>
    </array>
  </dict>
</plist>`;

  return new Response(plist, {
    status: 200,
    headers: {
      'content-type': 'application/x-plist; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}

function resp404(message: string) {
  return new Response(message || 'Not Found', {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });
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

function xml(input: unknown) {
  return String(input ?? '').replace(/[<>&"]/g, (match) => {
    switch (match) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return match;
    }
  });
}
