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

export const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60; // 1 hour
export const EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS = 60; // 1 minute

let tokensTableEnsured = false;

const ensureTokensColumn = async (DB: D1Database, column: string, definition: string) => {
  try {
    await DB.prepare(`ALTER TABLE ${TOKENS_TABLE} ADD COLUMN ${column} ${definition}`).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/duplicate column name/i.test(message)) {
      throw error;
    }
  }
};

const ensureTokensTable = async (DB: D1Database) => {
  if (tokensTableEnsured) return;
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${TOKENS_TABLE} (
      user_id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      next_allowed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  ).run();
  await DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_${TOKENS_TABLE}_token_hash
      ON ${TOKENS_TABLE} (token_hash)`
  ).run();
  await ensureTokensColumn(DB, 'next_allowed_at', 'INTEGER');
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
  createdAt: number;
  nextAllowedAt: number;
};

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
  const cooldownSeconds = Math.max(10, EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS);
  const nextAllowedAt = now + cooldownSeconds;

  await DB.prepare(
    `INSERT INTO ${TOKENS_TABLE} (user_id, token_hash, expires_at, created_at, next_allowed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       token_hash=excluded.token_hash,
       expires_at=excluded.expires_at,
       created_at=excluded.created_at,
       next_allowed_at=excluded.next_allowed_at`
  )
    .bind(userId, tokenHash, expiresAt, now, nextAllowedAt)
    .run();

  return { token, expiresAt, createdAt: now, nextAllowedAt };
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

const toNumeric = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric !== 0;
    return value.toLowerCase() === 'true';
  }
  return false;
};

export type VerificationCooldown = {
  allowed: boolean;
  retryAfterSeconds: number;
  nextAllowedAt: number;
};

export async function getVerificationCooldown(
  DB: D1Database,
  userId: string
): Promise<VerificationCooldown> {
  await ensureTokensTable(DB);
  const now = Math.floor(Date.now() / 1000);
  const existing = await DB.prepare(
    `SELECT created_at, next_allowed_at FROM ${TOKENS_TABLE} WHERE user_id=? LIMIT 1`
  )
    .bind(userId)
    .first<{ created_at: number | string | null; next_allowed_at?: number | string | null } | null>()
    .catch(() => null);

  const createdAt = toNumeric(existing?.created_at) ?? null;
  const storedNextAllowed = toNumeric(existing?.next_allowed_at) ?? null;
  const nextAllowedAt =
    storedNextAllowed ??
    (createdAt ? createdAt + EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS : null);

  if (!nextAllowedAt) {
    return { allowed: true, retryAfterSeconds: 0, nextAllowedAt: now };
  }

  if (nextAllowedAt <= now) {
    return { allowed: true, retryAfterSeconds: 0, nextAllowedAt };
  }

  return {
    allowed: false,
    retryAfterSeconds: nextAllowedAt - now,
    nextAllowedAt,
  };
}

export async function markEmailVerified(DB: D1Database, userId: string): Promise<void> {
  await ensureTokensTable(DB);
  await DB.prepare(`UPDATE users SET is_email_verified=1 WHERE id=?`).bind(userId).run();
  await DB.prepare(`DELETE FROM ${TOKENS_TABLE} WHERE user_id=?`).bind(userId).run();
}

export type VerificationSummary = {
  email: string | null;
  isVerified: boolean;
  nextAllowedAt: number | null;
};

export async function getVerificationSummary(
  DB: D1Database,
  userId: string
): Promise<VerificationSummary | null> {
  await ensureTokensTable(DB);
  const [user, cooldown] = await Promise.all([
    DB.prepare('SELECT email, is_email_verified FROM users WHERE id=? LIMIT 1')
      .bind(userId)
      .first<{ email?: unknown; is_email_verified?: unknown } | null>()
      .catch(() => null),
    DB.prepare(`SELECT created_at, next_allowed_at FROM ${TOKENS_TABLE} WHERE user_id=? LIMIT 1`)
      .bind(userId)
      .first<{ created_at?: unknown; next_allowed_at?: unknown } | null>()
      .catch(() => null),
  ]);

  if (!user) {
    return null;
  }

  const createdAt = toNumeric(cooldown?.created_at) ?? null;
  const storedNextAllowed = toNumeric(cooldown?.next_allowed_at) ?? null;
  const nextAllowedAt =
    storedNextAllowed ??
    (createdAt ? createdAt + EMAIL_VERIFICATION_RESEND_INTERVAL_SECONDS : null);
  return {
    email: typeof user?.email === 'string' ? user.email : null,
    isVerified: toBoolean(user?.is_email_verified),
    nextAllowedAt,
  };
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
  const resolvedEnv: Required<EmailEnv> = {
    MAILCHANNELS_API_KEY: env.MAILCHANNELS_API_KEY ?? process.env.MAILCHANNELS_API_KEY ?? '',
    MAILCHANNELS_API_BASE: env.MAILCHANNELS_API_BASE ?? process.env.MAILCHANNELS_API_BASE ?? '',
    EMAIL_FROM: env.EMAIL_FROM ?? process.env.EMAIL_FROM ?? '',
    EMAIL_FROM_NAME: env.EMAIL_FROM_NAME ?? process.env.EMAIL_FROM_NAME ?? '',
    APP_BASE_URL: env.APP_BASE_URL ?? process.env.APP_BASE_URL ?? '',
    APP_NAME: env.APP_NAME ?? process.env.APP_NAME ?? appName,
  };

  console.log('[email] sendVerificationEmail invoked', {
    to,
    verificationUrl,
    hasApiKey: Boolean(resolvedEnv.MAILCHANNELS_API_KEY),
    hasFrom: Boolean(resolvedEnv.EMAIL_FROM),
    apiBase: resolvedEnv.MAILCHANNELS_API_BASE || 'https://api.mailchannels.net/tx/v1',
  });

  const fromAddress = resolvedEnv.EMAIL_FROM;
  if (!fromAddress) {
    throw new Error('EMAIL_FROM must be configured to send verification emails.');
  }

  const fromName = resolvedEnv.EMAIL_FROM_NAME || appName;
  const apiKey = resolvedEnv.MAILCHANNELS_API_KEY;
  if (!apiKey) {
    throw new Error('MAILCHANNELS_API_KEY must be configured to send verification emails.');
  }

  const apiBase = (resolvedEnv.MAILCHANNELS_API_BASE || 'https://api.mailchannels.net/tx/v1').replace(
    /\/+$/,
    ''
  );

  const textBody = [
    `${appName} email verification`,
    '',
    'Hello,',
    '',
    'Please verify your email address by visiting the link below:',
    verificationUrl,
    '',
    'This link expires in 60 minutes. If you did not request this email, you can safely ignore it.',
    '',
    `-- ${appName} Team`,
  ].join('\n');

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>${appName}</h2>
      <p>Hello,</p>
      <p>Please verify your email address by clicking the button below.</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${verificationUrl}" style="background-color:#2563eb;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
          Verify email address
        </a>
      </p>
      <p>If the button does not work, copy and paste this URL into your browser:</p>
      <p><a href="${verificationUrl}">${verificationUrl}</a></p>
      <p style="color:#6b7280;font-size:12px;">This link expires in 60 minutes. If you did not request this email, you can ignore it.</p>
      <p>-- ${appName} Team</p>
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
    const response = await fetch(`${apiBase}/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Api-Key': apiKey,
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


