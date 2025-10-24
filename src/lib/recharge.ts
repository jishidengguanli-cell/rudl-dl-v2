import type { D1Database } from '@cloudflare/workers-types';
import { hasUsersBalanceColumn } from './schema';

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

  try {
    const hasBalanceColumn = await hasUsersBalanceColumn(DB);
    await DB.exec('BEGIN');

    if (hasBalanceColumn) {
      const current = await DB.prepare('SELECT balance FROM users WHERE id=? LIMIT 1')
        .bind(accountId)
        .first<{ balance: number }>();

      if (!current) {
        await DB.exec('ROLLBACK');
        throw new RechargeError('ACCOUNT_NOT_FOUND', 404);
      }

      await DB.prepare(
        `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
      )
        .bind(ledgerId, accountId, delta, memo ?? 'recharge', now)
        .run();

      await DB.prepare('UPDATE users SET balance = balance + ? WHERE id=?')
        .bind(delta, accountId)
        .run();

      await DB.exec('COMMIT');

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
      await DB.exec('ROLLBACK');
      throw new RechargeError('ACCOUNT_NOT_FOUND', 404);
    }

    await DB.prepare(
      `INSERT INTO point_ledger (id, account_id, delta, reason, link_id, download_id, bucket_minute, platform, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
    )
      .bind(ledgerId, accountId, delta, memo ?? 'recharge', now)
      .run();

    await DB.prepare('UPDATE point_accounts SET balance = balance + ?, updated_at=? WHERE id=?')
      .bind(delta, now, accountId)
      .run();

    await DB.exec('COMMIT');

    return {
      amount: delta,
      balance: Number(currentLegacy.balance ?? 0) + delta,
      ledgerId,
    };
  } catch (error) {
    await DB.exec('ROLLBACK');
    throw error;
  }
}

