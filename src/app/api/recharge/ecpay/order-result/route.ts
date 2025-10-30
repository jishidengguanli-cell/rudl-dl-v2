import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { D1Database } from '@cloudflare/workers-types';
import { markEcpayOrderPaymentInfo, verifyCheckMacValue } from '@/lib/ecpay';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const read = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

const fallbackBaseUrl =
  read(process.env.ECPAY_BASE_URL) ?? read(process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000';

const ensureNoTrailingSlash = (input: string) => input.replace(/\/+$/, '');

const baseUrl = ensureNoTrailingSlash(fallbackBaseUrl);

const parseForm = async (req: Request) => {
  const formData = await req.formData();
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && value.length > 0) {
      result[key] = value;
    }
  }
  return result;
};

const buildRedirectUrl = (entries: Iterable<[string, string]>) => {
  const target = new URL(`${baseUrl}/recharge/complete`);
  for (const [key, value] of entries) {
    if (value && !target.searchParams.has(key)) {
      target.searchParams.set(key, value);
    } else if (value) {
      target.searchParams.set(key, value);
    }
  }
  return target.toString();
};

const persistPaymentInfo = async (payload: Record<string, string>) => {
  const merchantTradeNo =
    payload.MerchantTradeNo ??
    payload.merchantTradeNo ??
    payload.TradeNo ??
    payload.tradeNo ??
    '';
  if (!merchantTradeNo) return;

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) return;

  const normalized: Record<string, string> = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (typeof value === 'string' && value.length > 0) {
      normalized[key] = value;
    }
  });

  try {
    await markEcpayOrderPaymentInfo(DB, merchantTradeNo, normalized, 'orderResult');
  } catch (error) {
    console.error(
      '[ecpay] order-result record payment info failed',
      merchantTradeNo,
      error instanceof Error ? error.stack ?? error.message : error
    );
  }
};

export async function POST(req: Request) {
  const payload = await parseForm(req);
  if (!(await verifyCheckMacValue(payload))) {
    const merchantTradeNo =
      payload.MerchantTradeNo ?? payload.merchantTradeNo ?? payload.TradeNo ?? payload.tradeNo ?? '';
    console.warn('[ecpay] order-result CheckMacValue mismatch', merchantTradeNo || 'unknown');
    const errorUrl = new URL(`${baseUrl}/recharge/error`);
    if (merchantTradeNo) {
      errorUrl.searchParams.set('merchantTradeNo', merchantTradeNo);
    }
    errorUrl.searchParams.set('error', 'CheckMacValueError');
    return NextResponse.redirect(errorUrl.toString(), { status: 303 });
  }
  await persistPaymentInfo(payload);

  const redirectUrl = buildRedirectUrl(Object.entries(payload));
  const response = NextResponse.redirect(redirectUrl, { status: 303 });
  const tradeNo =
    payload.MerchantTradeNo ?? payload.merchantTradeNo ?? payload.TradeNo ?? payload.tradeNo ?? null;
  if (tradeNo) {
    response.cookies.set('ecpay_last_trade', tradeNo, {
      path: '/',
      maxAge: 60 * 10,
      sameSite: 'lax',
      httpOnly: false,
    });
  }
  return response;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const paramsPayload: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (value) paramsPayload[key] = value;
  });
  await persistPaymentInfo(paramsPayload);

  const redirectUrl = buildRedirectUrl(url.searchParams.entries());
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
