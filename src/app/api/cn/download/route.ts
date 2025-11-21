import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { fetchDistributionById } from '@/lib/distribution';
import { recordDownload, type DownloadTotals } from '@/lib/downloads';
import { triggerDownloadMonitors } from '@/lib/monitor';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  CN_SERVER_API_TOKEN?: string;
};

type Body = {
  linkId?: string;
  linkCode?: string;
  ownerId?: string;
  platform?: string;
};

const normalizePlatform = (value: string | null | undefined): 'apk' | 'ipa' | null => {
  const lower = (value ?? '').toLowerCase();
  if (lower === 'apk' || lower === 'android') return 'apk';
  if (lower === 'ipa' || lower === 'ios') return 'ipa';
  return null;
};

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!bindings.CN_SERVER_API_TOKEN || token !== bindings.CN_SERVER_API_TOKEN) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'DB_MISSING' }, { status: 500 });
  }

  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
  }

  const linkId = (payload.linkId ?? '').trim();
  const platform = normalizePlatform(payload.platform);
  if (!linkId || !platform) {
    return NextResponse.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
  }

  const link = await fetchDistributionById(DB, linkId);
  if (!link || !link.isActive || link.networkArea !== 'CN') {
    return NextResponse.json({ ok: false, error: 'LINK_NOT_FOUND' }, { status: 404 });
  }

  const ownerId = (link.ownerId ?? payload.ownerId ?? '').trim();

  let totals: DownloadTotals | null = null;
  try {
    totals = await recordDownload(DB, link.id, platform);
  } catch (error) {
    console.error('[cn-download] recordDownload failed', error);
  }

  if (totals && ownerId) {
    try {
      await triggerDownloadMonitors(DB, {
        ownerId,
        linkCode: link.code,
        platform,
        totals,
      });
    } catch (error) {
      console.warn('[cn-download] monitor failed', error);
    }
  }

  if (ownerId) {
    const origin = new URL(req.url);
    const billUrl = new URL('/api/dl/bill', `${origin.protocol}//${origin.host}`);
    try {
      const response = await fetch(billUrl.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          account_id: ownerId,
          link_id: link.id,
          platform,
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.warn('[cn-download] billing responded with', response.status, body);
      }
    } catch (error) {
      console.warn('[cn-download] billing failed', error);
    }
  }

  return NextResponse.json({ ok: true });
}
