import type { D1Database } from '@cloudflare/workers-types';
import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { buildCheckoutForm, createEcpayOrder, type EcpayCheckoutParams } from '@/lib/ecpay';

export const runtime = 'edge';

const read = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

const fallbackBaseUrl = read(process.env.ECPAY_BASE_URL) ?? read(process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000';
const baseUrl = fallbackBaseUrl.replace(/\/+$/, '');

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

export async function POST(req: Request) {
  const badRequest = (message: string) => NextResponse.json({ ok: false, error: message }, { status: 400 });

  try {
    const cookieHeader = req.headers.get('cookie') ?? '';
    const accountId =
      cookieHeader
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('uid='))?.split('=')[1] ?? null;
    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({})) as Partial<{
      amount: number | string;
      description: string;
      itemName: string;
      points: number | string;
      clientBackUrl: string;
      orderResultUrl: string;
      returnUrl: string;
    }>;

    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return badRequest('Invalid amount');
    }

    const points = Number(payload.points);
    const displayPoints = Number.isFinite(points) && points > 0 ? Math.round(points) : undefined;

    const description = read(payload.description) ?? 'Recharge order';
    const itemName = read(payload.itemName) ?? (displayPoints ? `Points ${displayPoints}` : `Recharge ${Math.round(amount)}`);
    const pointsToCredit = displayPoints ?? Math.round(amount);

    const defaultReturnUrl =
      read(process.env.ECPAY_RETURN_URL) ??
      read(payload.returnUrl) ??
      `${baseUrl}/api/recharge/ecpay/notify`;
    if (!defaultReturnUrl) {
      return badRequest('ECPAY_RETURN_URL must be configured');
    }

    const paymentMethodEnv = read(process.env.ECPAY_PAYMENT_METHOD)?.toUpperCase();
    let paymentMethod: EcpayCheckoutParams['paymentMethod'];
    switch (paymentMethodEnv) {
      case 'ALL':
        paymentMethod = 'ALL';
        break;
      case 'ATM':
        paymentMethod = 'ATM';
        break;
      case 'CVS':
        paymentMethod = 'CVS';
        break;
      case 'BARCODE':
        paymentMethod = 'BARCODE';
        break;
      case 'CREDIT':
      default:
        paymentMethod = 'ALL';
        break;
    }
    const requiresPaymentInfo = paymentMethod === 'ATM' || paymentMethod === 'CVS' || paymentMethod === 'BARCODE';
    const paymentInfoUrl =
      requiresPaymentInfo
        ? read(process.env.ECPAY_PAYMENT_INFO_URL) ?? `${baseUrl}/api/recharge/ecpay/payment-info`
        : '';
    const clientRedirectUrl =
      requiresPaymentInfo
        ? read(process.env.ECPAY_CLIENT_REDIRECT_URL) ?? `${baseUrl}/recharge/payment-info`
        : '';
    const needExtraPaidInfoEnv = read(process.env.ECPAY_NEED_EXTRA_PAID_INFO);
    const needExtraPaidInfo =
      requiresPaymentInfo ? (needExtraPaidInfoEnv === 'N' ? 'N' : 'Y') : 'N';

    const formPayload = await buildCheckoutForm({
      totalAmount: amount,
      description,
      itemName,
      returnUrl: defaultReturnUrl,
      clientBackUrl: read(process.env.ECPAY_CLIENT_BACK_URL) ?? read(payload.clientBackUrl) ?? `${baseUrl}/recharge`,
      orderResultUrl:
        read(process.env.ECPAY_ORDER_RESULT_URL) ??
        read(payload.orderResultUrl) ??
        `${baseUrl}/api/recharge/ecpay/order-result`,
      paymentMethod,
      paymentInfoUrl,
      clientRedirectUrl,
      needExtraPaidInfo,
      customFields: {
        CustomField1: accountId,
        CustomField2: String(pointsToCredit),
        CustomField3: String(Math.round(amount)),
      },
    });

    const merchantTradeNo = formPayload.form.MerchantTradeNo;
    if (!merchantTradeNo) {
      return NextResponse.json({ ok: false, error: 'Missing MerchantTradeNo' }, { status: 500 });
    }

    const { env } = getRequestContext();
    const bindings = env as Env;
    const DB = bindings.DB ?? bindings['rudl-app'];
    if (!DB) {
      return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
    }

    await createEcpayOrder(DB, {
      merchantTradeNo,
      accountId,
      points: pointsToCredit,
      amount: Math.round(amount),
      description,
      itemName,
      customField1: accountId,
      customField2: String(pointsToCredit),
      customField3: String(Math.round(amount)),
    });

    return NextResponse.json({
      ok: true,
      ...formPayload,
      merchantTradeNo,
      points: pointsToCredit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('ECPAY') ? 500 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
