import type { D1Database } from '@cloudflare/workers-types';

type EmailEnv = {
  MAILCHANNELS_API_KEY?: string;
  MAILCHANNELS_API_BASE?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  APP_BASE_URL?: string;
  APP_NAME?: string;
};

const TOKENS_TABLE = 'email_verification_tokens';

let tokensTableEnsured = false;

const ensureTokensTable = async (DB: D1Database) => {
  if (tokensTableEnsured) return;
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${TOKENS_TABLE} (
      user_id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  ).run();
  await DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_${TOKENS_TABLE}_token_hash
      ON ${TOKENS_TABLE} (token_hash)`
  ).run();
  tokensTableEnsured = true;
};

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const hashToken = async (token: string) => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
};

export type VerificationToken = {
  token: string;
  expiresAt: number;
};

export const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60; // 1 hour

export async function createEmailVerificationToken(
  DB: D1Database,
  userId: string,
  ttlSeconds = EMAIL_VERIFICATION_TTL_SECONDS
): Promise<VerificationToken> {
  await ensureTokensTable(DB);
  const token = crypto.randomUUID().replace(/-/g, '');
  const tokenHash = await hashToken(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.max(60, ttlSeconds);

  await DB.prepare(
    `INSERT INTO ${TOKENS_TABLE} (user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       token_hash=excluded.token_hash,
       expires_at=excluded.expires_at,
       created_at=excluded.created_at`
  )
    .bind(userId, tokenHash, expiresAt, now)
    .run();

  return { token, expiresAt };
}

type ConsumeResult =
  | { status: 'success'; userId: string }
  | { status: 'expired' }
  | { status: 'invalid' };

export async function consumeEmailVerificationToken(
  DB: D1Database,
  token: string
): Promise<ConsumeResult> {
  await ensureTokensTable(DB);
  const tokenHash = await hashToken(token);
  const now = Math.floor(Date.now() / 1000);
  const record = await DB.prepare(
    `SELECT user_id, expires_at FROM ${TOKENS_TABLE} WHERE token_hash=? LIMIT 1`
  )
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: number }>()
    .catch(() => null);

  if (!record?.user_id) {
    return { status: 'invalid' };
  }

  const userId = record.user_id;

  if (!record.expires_at || record.expires_at < now) {
    await DB.prepare(`DELETE FROM ${TOKENS_TABLE} WHERE user_id=?`).bind(userId).run();
    return { status: 'expired' };
  }

  await DB.prepare(`DELETE FROM ${TOKENS_TABLE} WHERE user_id=?`).bind(userId).run();

  return { status: 'success', userId };
}

export async function markEmailVerified(DB: D1Database, userId: string): Promise<void> {
  await ensureTokensTable(DB);
  await DB.prepare(`UPDATE users SET is_email_verified=1 WHERE id=?`).bind(userId).run();
  await DB.prepare(`DELETE FROM ${TOKENS_TABLE} WHERE user_id=?`).bind(userId).run();
}

export type VerificationEmailParams = {
  env: EmailEnv;
  to: string;
  subject?: string;
  verificationUrl: string;
  appName?: string;
};

export async function sendVerificationEmail({
  env,
  to,
  verificationUrl,
  subject = 'Verify your email address',
  appName = 'DataruApp',
}: VerificationEmailParams): Promise<void> {
  console.log('[email] sendVerificationEmail invoked', {
    to,
    verificationUrl,
    hasApiKey: Boolean(env.MAILCHANNELS_API_KEY),
    hasFrom: Boolean(env.EMAIL_FROM),
    apiBase: env.MAILCHANNELS_API_BASE ?? 'https://api.mailchannels.net/tx/v1',
  });

  const fromAddress = env.EMAIL_FROM;
  if (!fromAddress) {
    throw new Error('EMAIL_FROM must be configured to send verification emails.');
  }

  const fromName = env.EMAIL_FROM_NAME ?? appName;
  const apiKey = env.MAILCHANNELS_API_KEY;
  if (!apiKey) {
    throw new Error('MAILCHANNELS_API_KEY must be configured to send verification emails.');
  }

  const apiBase = (env.MAILCHANNELS_API_BASE ?? 'https://api.mailchannels.net/tx/v1').replace(
    /\/+$/,
    ''
  );

  const textBody = [
    appName,
    '',
    '您好：',
    '',
    '請點擊以下連結完成電子郵件驗證：',
    verificationUrl,
    '',
    '此連結將在 60 分鐘後失效，如果無法點擊，請複製連結到瀏覽器開啟。',
    '',
    `— ${appName} 團隊`,
  ].join('\n');

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>${appName}</h2>
      <p>您好：</p>
      <p>請點擊下方按鈕完成電子郵件驗證：</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${verificationUrl}" style="background-color:#2563eb;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
          驗證電子郵件
        </a>
      </p>
      <p>若按鈕無法點擊，請將以下連結貼到瀏覽器開啟：</p>
      <p><a href="${verificationUrl}">${verificationUrl}</a></p>
      <p>此連結將在 60 分鐘後失效。</p>
      <p>— ${appName} 團隊</p>
    </div>
  `.trim();

  const payload = {
    personalizations: [
      {
        to: [{ email: to }],
      },
    ],
    from: {
      email: fromAddress,
      name: fromName,
    },
    subject,
    content: [
      {
        type: 'text/plain',
        value: textBody,
      },
      {
        type: 'text/html',
        value: htmlBody,
      },
    ],
  };

  try {
    const credentials = btoa(`api:${apiKey}`);
    const response = await fetch(`${apiBase}/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify(payload),
    });

    const debugSnippet = await response
      .clone()
      .text()
      .then((text) => text.slice(0, 500))
      .catch(() => '<body unavailable>');

    console.log('[email] mailchannels response', {
      status: response.status,
      ok: response.ok,
      bodySnippet: debugSnippet,
    });

    if (!response.ok) {
      throw new Error(
        `MailChannels responded with ${response.status}: ${debugSnippet || response.statusText}`
      );
    }

    console.log('[email] verification mail enqueued successfully', { to });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[email] verification mail failure', {
      error: reason,
      to,
      endpoint: `${apiBase}/send`,
    });
    throw new Error(`Failed to dispatch verification email: ${reason}`);
  }
}
