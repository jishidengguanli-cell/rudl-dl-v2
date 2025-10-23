import { NextResponse } from 'next/server';
import { verifyCheckMacValue } from '@/lib/ecpay';

export const runtime = 'nodejs';

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
    if (!verifyCheckMacValue(payload)) {
      return new Response('0|CheckMacValueError', { status: 400 });
    }

    console.info('[ecpay] payment callback', payload);

    // TODO: persist payment result and update point balance.

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

