import { NextResponse } from 'next/server';

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

export async function POST(req: Request) {
  try {
    const payload = await parseForm(req);

    const merchantTradeNo = payload.MerchantTradeNo;
    if (!merchantTradeNo) {
      return new Response('0|MissingTradeNo', { status: 400 });
    }

    console.info('[ecpay] payment info callback received (handled by order-result)', merchantTradeNo);
    return new Response('1|OK', { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ecpay] payment info error', message);
    return new Response('0|Exception', { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
