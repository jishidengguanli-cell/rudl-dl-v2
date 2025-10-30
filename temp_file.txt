import type { D1Database } from '@cloudflare/workers-types';
import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { getEcpayOrder } from '@/lib/ecpay';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const readCookieUid = (header: string | null) =>
  header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('uid='))?.split('=')[1] ?? null;

export async function GET(req: Request, context: { params: Promise<{ tradeNo: string }> }) {
  try {
    const uid = readCookieUid(req.headers.get('cookie'));
    if (!uid) {
      return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tradeNo } = await context.params;
    const merchantTradeNo = tradeNo;
    if (!merchantTradeNo) {
      return NextResponse.json({ ok: false, error: 'MISSING_TRADE_NO' }, { status: 400 });
    }

    const { env } = getRequestContext();
    const bindings = env as Env;
    const DB = bindings.DB ?? bindings['rudl-app'];
    if (!DB) {
      return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
    }

    const order = await getEcpayOrder(DB, merchantTradeNo);
    if (!order || order.accountId !== uid) {
      return NextResponse.json({ ok: false, error: 'ORDER_NOT_FOUND' }, { status: 404 });
    }

    const safeOrder = {
      merchantTradeNo: order.merchantTradeNo,
      status: order.status,
      points: order.points,
      amount: order.amount,
      currency: order.currency,
      rtnCode: order.rtnCode,
      rtnMsg: order.rtnMsg,
      paymentType: order.paymentType,
      paymentMethod: order.paymentMethod,
      tradeNo: order.tradeNo,
      tradeAmt: order.tradeAmt,
      paymentDate: order.paymentDate,
      paidAt: order.paidAt,
      ledgerId: order.ledgerId,
      balanceAfter: order.balanceAfter,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      rawPaymentInfo: order.rawPaymentInfo ? JSON.parse(order.rawPaymentInfo) : null,
    };

    return NextResponse.json({ ok: true, order: safeOrder });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
