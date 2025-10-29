import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { D1Database } from '@cloudflare/workers-types';
import {
  getEcpayOrder,
  markEcpayOrderFailed,
  markEcpayOrderPaid,
  verifyCheckMacValue,
} from '@/lib/ecpay';
import { applyRecharge, RechargeError } from '@/lib/recharge';
import { ensurePointTables } from '@/lib/schema';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

export const runtime = 'edge';

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

export async function POST(req: Request) {
  const payload = await parseForm(req);

  try {
    await processOrderResult(payload);
  } catch (error) {
    console.error(
      '[ecpay] order-result processing error',
      error instanceof Error ? error.stack ?? error.message : error
    );
  }

  const redirectUrl = buildRedirectUrl(Object.entries(payload));
  const response = NextResponse.redirect(redirectUrl, { status: 303 });
  const tradeNo =
    payload.MerchantTradeNo ?? payload.merchantTradeNo ?? payload.TradeNo ?? payload.tradeNo ?? null;
  if (tradeNo) {
    response.cookies.set('ecpay_last_trade', tradeNo, {
      path: '/',
      maxAge: 60 * 10, // keep for 10 minutes
      sameSite: 'lax',
      httpOnly: false,
    });
  }
  return response;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const redirectUrl = buildRedirectUrl(url.searchParams.entries());
  return NextResponse.redirect(redirectUrl, { status: 303 });
}

async function processOrderResult(payload: Record<string, string>) {
  const merchantTradeNo = payload.MerchantTradeNo ?? payload.merchantTradeNo ?? '';
  if (!merchantTradeNo) return;

  const rtnCode = payload.RtnCode ?? payload.rtnCode ?? '';
  const rtnMsg = payload.RtnMsg ?? payload.rtnMsg ?? '';

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    console.warn('[ecpay] order-result missing D1 binding');
    return;
  }

  const isValid = await verifyCheckMacValue(payload);
  if (!isValid) {
    console.warn('[ecpay] order-result CheckMacValue mismatch', merchantTradeNo);
    return;
  }

  const order = await getEcpayOrder(DB, merchantTradeNo);
  if (!order) {
    console.warn('[ecpay] order-result for unknown order', merchantTradeNo);
    return;
  }

  if (rtnCode === '1') {
    if (order.status !== 'PAID') {
      try {
        await ensurePointTables(DB);
        const recharge = await applyRecharge(DB, order.accountId, order.points, `ecpay:${merchantTradeNo}`);
        await markEcpayOrderPaid(DB, merchantTradeNo, {
          rtnCode,
          rtnMsg,
          paymentType: payload.PaymentType ?? payload.ChoosePayment,
          paymentMethod: payload.ChoosePayment ?? payload.PaymentType,
          tradeNo: payload.TradeNo ?? null,
          tradeAmt: payload.TradeAmt ?? null,
          paymentDate: payload.PaymentDate ?? null,
          raw: payload,
          ledgerId: recharge.ledgerId,
          balanceAfter: recharge.balance,
        });
      } catch (error) {
        if (error instanceof RechargeError) {
          console.error('[ecpay] order-result recharge error', merchantTradeNo, error.message);
          return;
        }
        console.error('[ecpay] order-result unexpected error', merchantTradeNo, error);
        return;
      }
    } else {
      await markEcpayOrderPaid(DB, merchantTradeNo, {
        rtnCode,
        rtnMsg,
        paymentType: payload.PaymentType ?? payload.ChoosePayment,
        paymentMethod: payload.ChoosePayment ?? payload.PaymentType,
        tradeNo: payload.TradeNo ?? null,
        tradeAmt: payload.TradeAmt ?? null,
        paymentDate: payload.PaymentDate ?? null,
        raw: payload,
      });
    }
  } else {
    await markEcpayOrderFailed(DB, merchantTradeNo, { rtnCode: rtnCode || '0', rtnMsg: rtnMsg || '', raw: payload });
  }
}
