import type { D1Database } from '@cloudflare/workers-types';
import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import {
  verifyCheckMacValue,
  getEcpayOrder,
  markEcpayOrderPaid,
  markEcpayOrderFailed,
  recordEcpayRawNotify,
} from '@/lib/ecpay';
import { applyRecharge, RechargeError } from '@/lib/recharge';

export const runtime = 'edge';

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

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
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
    if (!DB) {
      return new Response('0|DBMissing', { status: 500 });
    }

    const order = await getEcpayOrder(DB, merchantTradeNo);
    if (!order) {
      console.warn('[ecpay] notify for unknown order', merchantTradeNo);
      return new Response('1|OK', { status: 200 });
    }

    try {
      await recordEcpayRawNotify(DB, merchantTradeNo, payload);
    } catch (error) {
      console.error('[ecpay] failed to record raw notify', merchantTradeNo, error);
    }

    if (!(await verifyCheckMacValue(payload))) {
      return new Response('0|CheckMacValueError', { status: 400 });
    }

    const rtnCode = payload.RtnCode ?? '0';
    const rtnMsg = payload.RtnMsg ?? '';

    if (rtnCode === '1') {
      if (order.status !== 'PAID') {
        try {
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
          console.info('[ecpay] order settled and balance updated', merchantTradeNo);
        } catch (error) {
          if (error instanceof RechargeError) {
            console.error('[ecpay] recharge error', merchantTradeNo, error.message);
            return new Response('0|RechargeError', { status: 500 });
          }
          console.error(
            '[ecpay] unexpected error during recharge',
            merchantTradeNo,
            error instanceof Error ? error.stack ?? error.message : error
          );
          return new Response('0|Exception', { status: 500 });
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
      return new Response('1|OK', { status: 200 });
    }

    await markEcpayOrderFailed(DB, merchantTradeNo, { rtnCode, rtnMsg, raw: payload });
    console.warn('[ecpay] order failed', merchantTradeNo, rtnCode, rtnMsg);
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
