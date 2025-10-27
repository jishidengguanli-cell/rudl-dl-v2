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
  // Use 303 so the provider's POST follow-up becomes a GET when landing on our page.
  return NextResponse.redirect(redirectUrl, { status: 303 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const redirectUrl = buildRedirectUrl(url.searchParams.entries());
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
