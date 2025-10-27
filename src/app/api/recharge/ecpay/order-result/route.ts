import { NextResponse } from 'next/server';

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
