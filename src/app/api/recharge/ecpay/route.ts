import { NextResponse } from 'next/server';
import { buildCheckoutForm } from '@/lib/ecpay';

export const runtime = 'edge';

const read = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

const fallbackBaseUrl = read(process.env.ECPAY_BASE_URL) ?? read(process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000';

export async function POST(req: Request) {
  const badRequest = (message: string) => NextResponse.json({ ok: false, error: message }, { status: 400 });

  try {
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

    const defaultReturnUrl =
      read(process.env.ECPAY_RETURN_URL) ??
      read(payload.returnUrl) ??
      `${fallbackBaseUrl}/api/recharge/ecpay/notify`;
    if (!defaultReturnUrl) {
      return badRequest('ECPAY_RETURN_URL must be configured');
    }

    const paymentInfoUrl = read(process.env.ECPAY_PAYMENT_INFO_URL) ?? `${fallbackBaseUrl}/api/recharge/ecpay/payment-info`;
    const clientRedirectUrl = read(process.env.ECPAY_CLIENT_REDIRECT_URL) ?? `${fallbackBaseUrl}/recharge/payment-info`;
    const needExtraPaidInfoEnv = read(process.env.ECPAY_NEED_EXTRA_PAID_INFO);
    const needExtraPaidInfo = needExtraPaidInfoEnv === 'N' ? 'N' : 'Y';

    const formPayload = await buildCheckoutForm({
      totalAmount: amount,
      description,
      itemName,
      returnUrl: defaultReturnUrl,
      clientBackUrl: read(process.env.ECPAY_CLIENT_BACK_URL) ?? read(payload.clientBackUrl) ?? `${fallbackBaseUrl}/recharge`,
      orderResultUrl: read(process.env.ECPAY_ORDER_RESULT_URL) ?? read(payload.orderResultUrl) ?? `${fallbackBaseUrl}/recharge/complete`,
      paymentInfoUrl,
      clientRedirectUrl,
      needExtraPaidInfo,
    });

    return NextResponse.json({
      ok: true,
      ...formPayload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('ECPAY') ? 500 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
