import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { D1Database } from '@cloudflare/workers-types';
import { enqueueRechargeTask } from '@/lib/recharge-queue';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type PayloadInput = {
  rtnCode?: string;
  rtnMsg?: string;
  paymentType?: string;
  paymentMethod?: string;
  tradeNo?: string;
  tradeAmt?: string | number;
  paymentDate?: string;
  raw?: Record<string, string>;
};

type RequestBody = {
  merchantTradeNo?: string;
  accountId?: string;
  points?: number;
  payload?: PayloadInput;
};

const normalizeRaw = (raw: Record<string, unknown>) => {
  const result: Record<string, string> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    result[key] = typeof value === 'string' ? value : String(value);
  });
  return result;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const merchantTradeNo = body.merchantTradeNo?.trim();
    const accountId = body.accountId?.trim();
    const points = Number(body.points ?? 0);
    const payloadInput = body.payload;

    if (!merchantTradeNo) {
      return NextResponse.json({ ok: false, error: 'MISSING_MERCHANT_TRADE_NO' }, { status: 400 });
    }
    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'MISSING_ACCOUNT_ID' }, { status: 400 });
    }
    if (!Number.isFinite(points) || points <= 0) {
      return NextResponse.json({ ok: false, error: 'INVALID_POINTS' }, { status: 400 });
    }
    if (!payloadInput?.raw || typeof payloadInput.raw !== 'object') {
      return NextResponse.json({ ok: false, error: 'MISSING_RAW_PAYLOAD' }, { status: 400 });
    }

    const normalizedPayload = {
      rtnCode: payloadInput.rtnCode ?? '1',
      rtnMsg: payloadInput.rtnMsg ?? 'Succeeded',
      paymentType: payloadInput.paymentType,
      paymentMethod: payloadInput.paymentMethod,
      tradeNo: payloadInput.tradeNo,
      tradeAmt: payloadInput.tradeAmt,
      paymentDate: payloadInput.paymentDate,
      raw: normalizeRaw(payloadInput.raw),
    };

    const { env } = getRequestContext();
    const bindings = env as Env;
    const DB = bindings.DB ?? bindings['rudl-app'];
    if (!DB) {
      return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
    }

    await enqueueRechargeTask(DB, merchantTradeNo, accountId, points, normalizedPayload);
    return NextResponse.json({ ok: true, enqueued: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[debug] enqueue recharge task failed', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: {
      method: 'POST',
      body: {
        merchantTradeNo: 'RG2025...',
        accountId: 'uuid...',
        points: 10,
        payload: {
          rtnCode: '1',
          rtnMsg: 'Succeeded',
          paymentType: 'Credit_CreditCard',
          paymentMethod: 'Credit_CreditCard',
          tradeNo: 'test-trade',
          tradeAmt: '10',
          paymentDate: '2025/11/01 21:56:12',
          raw: { MerchantTradeNo: 'RG2025...', RtnCode: '1', RtnMsg: 'Succeeded' },
        },
      },
    },
  });
}

