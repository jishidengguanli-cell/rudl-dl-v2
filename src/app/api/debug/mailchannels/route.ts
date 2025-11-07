import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

type Env = {
  MAILCHANNELS_API_KEY?: string;
  MAILCHANNELS_API_BASE?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
};

export async function GET() {
  const { env } = getRequestContext();
  const bindings = env as Env;

  const bindingKey = bindings.MAILCHANNELS_API_KEY ?? '';
  const processKey = process.env.MAILCHANNELS_API_KEY ?? '';
  const bindingFrom = bindings.EMAIL_FROM ?? '';
  const processFrom = process.env.EMAIL_FROM ?? '';
  const bindingApiBase = bindings.MAILCHANNELS_API_BASE ?? '';
  const processApiBase = process.env.MAILCHANNELS_API_BASE ?? '';

  const resolvedKey = bindingKey || processKey;

  const payload = {
    ok: Boolean(resolvedKey),
    viaBindings: Boolean(bindingKey),
    viaProcessEnv: Boolean(processKey),
    hasFromAddress: Boolean(bindingFrom || processFrom),
    apiBase:
      bindingApiBase ||
      processApiBase ||
      'https://api.mailchannels.net/tx/v1',
  };

  if (!payload.ok) {
    return NextResponse.json(
      {
        ...payload,
        message:
          'MAILCHANNELS_API_KEY is missing from both bindings and process.env.',
      },
      { status: 500 }
    );
  }

  return NextResponse.json(payload);
}

