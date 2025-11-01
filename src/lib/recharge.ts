import type { D1Database } from '@cloudflare/workers-types';
import { runWithD1Retry } from './d1';
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
  console.info('[recharge] start', { accountId, delta, memo, ledgerId });
  await ensurePointTables(DB);
  const hasBalanceColumn = await hasUsersBalanceColumn(DB);
  console.info('[recharge] schema detection', { accountId, hasUsersBalanceColumn: hasBalanceColumn });

  if (hasBalanceColumn) {
    const currentResult = await runWithD1Retry(
      () => DB.prepare('SELECT balance FROM users WHERE id=? LIMIT 1').bind(accountId).all<{ balance: number }>(),
      'recharge:select-users-balance'
    );
    const current = currentResult?.results?.[0] ?? null;

    if (!current) {
      console.warn('[recharge] user not found in users table', { accountId });
      throw new RechargeError('ACCOUNT_NOT_FOUND', 404);
    }

    await runWithD1Retry(
      () =>
        DB.prepare(
          `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
           VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
        )
          .bind(ledgerId, accountId, delta, memo ?? 'recharge', now)
          .run(),
      'recharge:insert-ledger-users'
    ).catch((error) => {
      logDbError('[recharge] insert ledger (users branch) failed', error);
      throw error;
    });
    console.info('[recharge] ledger inserted', { accountId, ledgerId });

    await runWithD1Retry(
      () => DB.prepare('UPDATE users SET balance = balance + ? WHERE id=?').bind(delta, accountId).run(),
      'recharge:update-users-balance'
    ).catch((error) => {
      logDbError('[recharge] update users balance failed', error);
      throw error;
    });
    console.info('[recharge] users balance updated', { accountId, delta });

    const baseBalance = Number(current.balance ?? 0);
    return {
      amount: delta,
      balance: baseBalance + delta,
      ledgerId,
    };
  }

  const legacyResult = await runWithD1Retry(
    () => DB.prepare('SELECT balance FROM point_accounts WHERE id=? LIMIT 1').bind(accountId).all<{ balance: number }>(),
    'recharge:select-point-accounts'
  );
  const currentLegacy = legacyResult?.results?.[0] ?? null;
  if (!currentLegacy) {
    console.warn('[recharge] account not found in point_accounts', { accountId });
    throw new RechargeError('ACCOUNT_NOT_FOUND', 404);
  }

  const hasUpdatedAt = await hasPointAccountsUpdatedAt(DB);
  console.info('[recharge] legacy branch', { accountId, hasUpdatedAt });

  await runWithD1Retry(
    () =>
      DB.prepare(
        `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
      )
        .bind(ledgerId, accountId, delta, memo ?? 'recharge', now)
        .run(),
    'recharge:insert-ledger-legacy'
  ).catch((error) => {
    logDbError('[recharge] legacy-table update failed (ledger)', error);
    throw error;
  });
  console.info('[recharge] ledger inserted legacy', { accountId, ledgerId });

  if (hasUpdatedAt) {
    await runWithD1Retry(
      () => DB.prepare('UPDATE point_accounts SET balance = balance + ?, updated_at=? WHERE id=?').bind(delta, now, accountId).run(),
      'recharge:update-point-accounts-timestamp'
    ).catch((error) => {
      logDbError('[recharge] legacy-table update failed (point_accounts timestamp)', error);
      throw error;
    });
    console.info('[recharge] point_accounts updated with timestamp', { accountId, delta, now });
  } else {
    await runWithD1Retry(
      () => DB.prepare('UPDATE point_accounts SET balance = balance + ? WHERE id=?').bind(delta, accountId).run(),
      'recharge:update-point-accounts'
    ).catch((error) => {
      logDbError('[recharge] legacy-table update failed (point_accounts)', error);
      throw error;
    });
    console.info('[recharge] point_accounts updated', { accountId, delta });
  }

  console.info('[recharge] completed', { accountId, ledgerId, delta });
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
