import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

type Env = {
  MAILCHANNELS_API_KEY?: string;
  MAILCHANNELS_API_BASE?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  APP_NAME?: string;
};

type LogEntry = {
  step: string;
  detail?: unknown;
};

const resolveEnv = (bindings: Env) => {
  const processEnv = process.env ?? {};
  return {
    MAILCHANNELS_API_KEY: bindings.MAILCHANNELS_API_KEY ?? processEnv.MAILCHANNELS_API_KEY ?? '',
    MAILCHANNELS_API_BASE: bindings.MAILCHANNELS_API_BASE ?? processEnv.MAILCHANNELS_API_BASE ?? '',
    EMAIL_FROM: bindings.EMAIL_FROM ?? processEnv.EMAIL_FROM ?? '',
    EMAIL_FROM_NAME: bindings.EMAIL_FROM_NAME ?? processEnv.EMAIL_FROM_NAME ?? '',
    APP_NAME: bindings.APP_NAME ?? processEnv.APP_NAME ?? 'DataruApp',
  };
};

export async function GET() {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const logs: LogEntry[] = [];
  const log = (step: string, detail?: unknown) => {
    logs.push({ step, detail });
  };

  const resolved = resolveEnv(bindings);

  log('env-detection', {
    viaBindings: Boolean(bindings.MAILCHANNELS_API_KEY),
    viaProcessEnv: Boolean(process.env?.MAILCHANNELS_API_KEY),
    hasFromAddress: Boolean(resolved.EMAIL_FROM),
    apiBase: resolved.MAILCHANNELS_API_BASE || 'https://api.mailchannels.net/tx/v1',
    bindingKeysPresent: Object.keys(bindings).filter((key) =>
      key.toUpperCase().includes('MAILCHANNEL')
    ),
    processKeysPresent: Object.keys(process.env ?? {}).filter((key) =>
      key.toUpperCase().includes('MAILCHANNEL')
    ),
  });

  if (!resolved.MAILCHANNELS_API_KEY) {
    const message = 'MAILCHANNELS_API_KEY is missing. Define it in Cloudflare Pages/Workers variables.';
    log('error', message);
    return NextResponse.json({ ok: false, logs, error: message }, { status: 500 });
  }

  if (!resolved.EMAIL_FROM) {
    const message = 'EMAIL_FROM is missing. Please configure the sender address.';
    log('error', message);
    return NextResponse.json({ ok: false, logs, error: message }, { status: 500 });
  }

  const apiBase = (resolved.MAILCHANNELS_API_BASE || 'https://api.mailchannels.net/tx/v1').replace(
    /\/+$/,
    ''
  );
  const url = `${apiBase}/send`;
  const subject = `[${resolved.APP_NAME}] MailChannels debug ${(new Date()).toISOString()}`;
  const payload = {
    personalizations: [
      {
        to: [{ email: resolved.EMAIL_FROM }],
      },
    ],
    from: {
      email: resolved.EMAIL_FROM,
      name: resolved.EMAIL_FROM_NAME || resolved.APP_NAME,
    },
    subject,
    content: [
      {
        type: 'text/plain',
        value:
          `This is a MailChannels debug message generated at ${new Date().toISOString()}.\n` +
          `If you receive this email, the MailChannels API is accepting requests from your environment.`,
      },
    ],
  };
  log('request-prepared', {
    url,
    to: resolved.EMAIL_FROM,
    payloadPreview: { subject, to: resolved.EMAIL_FROM },
  });

  try {
    const credentials = btoa(`api:${resolved.MAILCHANNELS_API_KEY}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify(payload),
    });

    const bodySnippet = await response
      .clone()
      .text()
      .then((text) => text.slice(0, 500))
      .catch(() => '<response unavailable>');

    log('mailchannels-response', {
      status: response.status,
      ok: response.ok,
      headers: {
        'x-request-id': response.headers.get('x-request-id'),
        'x-mc-request-id': response.headers.get('x-mc-request-id'),
      },
      bodySnippet,
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          logs,
          error: `MailChannels responded with ${response.status}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('exception', message);
    return NextResponse.json({ ok: false, logs, error: message }, { status: 500 });
  }
}

