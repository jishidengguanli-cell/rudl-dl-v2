import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { D1Database } from '@cloudflare/workers-types';
import { recordEcpayRawNotify } from '@/lib/ecpay';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const parseForm = async (req: Request) => {
  const formData = await req.formData();
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
};

export async function POST(req: Request) {
  try {
    const payload = await parseForm(req);
    const merchantTradeNo = payload.MerchantTradeNo;
    if (!merchantTradeNo) {
      return new Response('0|MissingTradeNo', { status: 400 });
    }

    const { env } = getRequestContext();
    const bindings = env as Env;
    const DB = bindings.DB ?? bindings['rudl-app'];
    if (DB) {
      try {
        await recordEcpayRawNotify(DB, merchantTradeNo, payload);
      } catch (error) {
        console.error('[ecpay] failed to record raw notify', merchantTradeNo, error);
      }
    }

    return new Response('1|OK', { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ecpay] callback error', message);
    return new Response('0|Exception', { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
