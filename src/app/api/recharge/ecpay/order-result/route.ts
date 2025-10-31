import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { D1Database } from '@cloudflare/workers-types';
import {
  verifyCheckMacValue,
  getEcpayOrder,
  markEcpayOrderPaid,
  markEcpayOrderFailed,
  markEcpayOrderPaymentInfo,
} from '@/lib/ecpay';
import { applyRecharge, RechargeError } from '@/lib/recharge';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
  ECPAY_MERCHANT_ID?: string;
  ECPAY_HASH_KEY?: string;
  ECPAY_HASH_IV?: string;
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
    if (typeof value === 'string') {
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

const resolveCredentialsOverride = (bindings: Env) =>
  typeof bindings.ECPAY_HASH_KEY === 'string' &&
  bindings.ECPAY_HASH_KEY.length > 0 &&
  typeof bindings.ECPAY_HASH_IV === 'string' &&
  bindings.ECPAY_HASH_IV.length > 0
    ? {
        merchantId: typeof bindings.ECPAY_MERCHANT_ID === 'string' ? bindings.ECPAY_MERCHANT_ID : undefined,
        hashKey: bindings.ECPAY_HASH_KEY,
        hashIv: bindings.ECPAY_HASH_IV,
      }
    : undefined;

const persistPaymentInfo = async (payload: Record<string, string>, bindings: Env) => {
  const merchantTradeNo =
    payload.MerchantTradeNo ??
    payload.merchantTradeNo ??
    payload.TradeNo ??
    payload.tradeNo ??
    '';
  if (!merchantTradeNo) return;

  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) return;

  const order = await getEcpayOrder(DB, merchantTradeNo);
  if (!order) {
    console.warn('[ecpay] order-result for unknown order', merchantTradeNo);
    return;
  }

  try {
    await markEcpayOrderPaymentInfo(DB, merchantTradeNo, payload, 'orderResult');
  } catch (error) {
    console.error(
      '[ecpay] order-result record payment info failed',
      merchantTradeNo,
      error instanceof Error ? error.stack ?? error.message : error
    );
  }

  const rtnCode = payload.RtnCode ?? payload.rtnCode ?? '0';
  const rtnMsg = payload.RtnMsg ?? payload.rtnMsg ?? '';
  const baseMarkPayload = {
    rtnCode,
    rtnMsg,
    paymentType: payload.PaymentType ?? payload.ChoosePayment,
    paymentMethod: payload.ChoosePayment ?? payload.PaymentType,
    tradeNo: payload.TradeNo ?? null,
    tradeAmt: payload.TradeAmt ?? null,
    paymentDate: payload.PaymentDate ?? null,
    raw: payload,
  };

  if (rtnCode === '1') {
    try {
      if (order.status !== 'PAID') {
        const recharge = await applyRecharge(DB, order.accountId, order.points, `ecpay:${merchantTradeNo}`);
        await markEcpayOrderPaid(
          DB,
          merchantTradeNo,
          { ...baseMarkPayload, ledgerId: recharge.ledgerId, balanceAfter: recharge.balance },
          'orderResult'
        );
        console.info('[ecpay] order-result settled and balance updated', merchantTradeNo);
      } else {
        await markEcpayOrderPaid(DB, merchantTradeNo, baseMarkPayload, 'orderResult');
      }
    } catch (error) {
      if (error instanceof RechargeError) {
        console.error('[ecpay] order-result recharge error', merchantTradeNo, error.message);
        throw error;
      }
      console.error(
        '[ecpay] order-result unexpected error during recharge',
        merchantTradeNo,
        error instanceof Error ? error.stack ?? error.message : error
      );
      throw error;
    }
  } else {
    await markEcpayOrderFailed(DB, merchantTradeNo, { rtnCode, rtnMsg, raw: payload }, 'orderResult');
    console.warn('[ecpay] order-result marked failed', merchantTradeNo, rtnCode, rtnMsg);
  }
};

export async function POST(req: Request) {
  const payload = await parseForm(req);
  const { env } = getRequestContext();
  const bindings = env as Env;
  const credentialsOverride = resolveCredentialsOverride(bindings);
  if (!(await verifyCheckMacValue(payload, credentialsOverride))) {
    const merchantTradeNo =
      payload.MerchantTradeNo ?? payload.merchantTradeNo ?? payload.TradeNo ?? payload.tradeNo ?? '';
    console.warn('[ecpay] order-result CheckMacValue mismatch', merchantTradeNo || 'unknown');
    const errorUrl = new URL(`${baseUrl}/recharge`);
    if (merchantTradeNo) {
      errorUrl.searchParams.set('merchantTradeNo', merchantTradeNo);
    }
    errorUrl.searchParams.set('error', 'CheckMacValueError');
    errorUrl.searchParams.set('source', 'order-result');
    return NextResponse.redirect(errorUrl.toString(), { status: 303 });
  }
  try {
    await persistPaymentInfo(payload, bindings);
  } catch (error) {
    const merchantTradeNo =
      payload.MerchantTradeNo ?? payload.merchantTradeNo ?? payload.TradeNo ?? payload.tradeNo ?? '';
    console.error(
      '[ecpay] order-result processing failed',
      merchantTradeNo || 'unknown',
      error instanceof Error ? error.stack ?? error.message : error
    );
    const errorUrl = new URL(`${baseUrl}/recharge`);
    if (merchantTradeNo) {
      errorUrl.searchParams.set('merchantTradeNo', merchantTradeNo);
    }
    if (error instanceof RechargeError) {
      errorUrl.searchParams.set('error', error.message ?? 'RechargeError');
    } else {
      errorUrl.searchParams.set('error', 'Exception');
    }
    errorUrl.searchParams.set('source', 'order-result');
    return NextResponse.redirect(errorUrl.toString(), { status: 303 });
  }

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
  const { env } = getRequestContext();
  const bindings = env as Env;
  const credentialsOverride = resolveCredentialsOverride(bindings);
  if (!(await verifyCheckMacValue(paramsPayload, credentialsOverride))) {
    const merchantTradeNo =
      paramsPayload.MerchantTradeNo ??
      paramsPayload.merchantTradeNo ??
      paramsPayload.TradeNo ??
      paramsPayload.tradeNo ??
      '';
    console.warn('[ecpay] order-result (GET) CheckMacValue mismatch', merchantTradeNo || 'unknown');
    const errorUrl = new URL(`${baseUrl}/recharge`);
    if (merchantTradeNo) {
      errorUrl.searchParams.set('merchantTradeNo', merchantTradeNo);
    }
    errorUrl.searchParams.set('error', 'CheckMacValueError');
    errorUrl.searchParams.set('source', 'order-result');
    return NextResponse.redirect(errorUrl.toString(), { status: 303 });
  }
  try {
    await persistPaymentInfo(paramsPayload, bindings);
    const redirectUrl = buildRedirectUrl(url.searchParams.entries());
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    const merchantTradeNo =
      paramsPayload.MerchantTradeNo ??
      paramsPayload.merchantTradeNo ??
      paramsPayload.TradeNo ??
      paramsPayload.tradeNo ??
      '';
    console.error(
      '[ecpay] order-result GET processing failed',
      merchantTradeNo || 'unknown',
      error instanceof Error ? error.stack ?? error.message : error
    );
    const errorUrl = new URL(`${baseUrl}/recharge`);
    if (merchantTradeNo) {
      errorUrl.searchParams.set('merchantTradeNo', merchantTradeNo);
    }
    if (error instanceof RechargeError) {
      errorUrl.searchParams.set('error', error.message ?? 'RechargeError');
    } else {
      errorUrl.searchParams.set('error', 'Exception');
    }
    errorUrl.searchParams.set('source', 'order-result');
    return NextResponse.redirect(errorUrl.toString(), { status: 303 });
  }
}
