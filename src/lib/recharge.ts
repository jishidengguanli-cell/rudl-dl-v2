import type { D1Database } from '@cloudflare/workers-types';
import { ensurePointTables, hasPointAccountsUpdatedAt, hasUsersBalanceColumn } from './schema';

export type RechargeResult = {
  amount: number;
  balance: number;
  ledgerId: string;
};

export class RechargeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function applyRecharge(DB: D1Database, accountId: string, delta: number, memo?: string): Promise<RechargeResult> {
  if (!accountId) {
    throw new RechargeError('ACCOUNT_NOT_FOUND', 404);
  }
  if (!Number.isFinite(delta) || delta <= 0) {
    throw new RechargeError('INVALID_AMOUNT', 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const ledgerId = crypto.randomUUID();
  await ensurePointTables(DB);
  const hasBalanceColumn = await hasUsersBalanceColumn(DB);

  if (hasBalanceColumn) {
    const current = await DB.prepare('SELECT balance FROM users WHERE id=? LIMIT 1')
      .bind(accountId)
      .first<{ balance: number }>();

    if (!current) {
      throw new RechargeError('ACCOUNT_NOT_FOUND', 404);
    }

    try {
      await DB.prepare(
        `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
      )
        .bind(ledgerId, accountId, delta, memo ?? 'recharge', now)
        .run();
    } catch (error) {
      logDbError('[recharge] insert ledger (users branch) failed', error);
      throw error;
    }

    try {
      await DB.prepare('UPDATE users SET balance = balance + ? WHERE id=?')
        .bind(delta, accountId)
        .run();
    } catch (error) {
      logDbError('[recharge] update users balance failed', error);
      throw error;
    }

    const baseBalance = Number(current.balance ?? 0);
    return {
      amount: delta,
      balance: baseBalance + delta,
      ledgerId,
    };
  }

  const currentLegacy = await DB.prepare('SELECT balance FROM point_accounts WHERE id=? LIMIT 1')
    .bind(accountId)
    .first<{ balance: number }>();
  if (!currentLegacy) {
    throw new RechargeError('ACCOUNT_NOT_FOUND', 404);
  }

  const hasUpdatedAt = await hasPointAccountsUpdatedAt(DB);

  try {
    await DB.prepare(
      `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
    )
      .bind(ledgerId, accountId, delta, memo ?? 'recharge', now)
      .run();

    if (hasUpdatedAt) {
      await DB.prepare('UPDATE point_accounts SET balance = balance + ?, updated_at=? WHERE id=?')
        .bind(delta, now, accountId)
        .run();
    } else {
      await DB.prepare('UPDATE point_accounts SET balance = balance + ? WHERE id=?')
        .bind(delta, accountId)
        .run();
    }
  } catch (error) {
    logDbError('[recharge] legacy-table update failed', error);
    throw error;
  }

  return {
    amount: delta,
    balance: Number(currentLegacy.balance ?? 0) + delta,
    ledgerId,
  };
}

const logDbError = (context: string, error: unknown) => {
  if (error instanceof Error) {
    console.error(context, {
      message: error.message,
      stack: error.stack,
      cause: (error as { cause?: unknown }).cause,
    });
  } else {
    console.error(context, error);
  }
};
