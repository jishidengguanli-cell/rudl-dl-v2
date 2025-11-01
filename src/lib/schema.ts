import type { D1Database } from '@cloudflare/workers-types';
import { runWithD1Retry } from './d1';

type Flags = {
  hasUsersBalance?: boolean;
  pointTablesEnsured?: boolean;
  pointAccountsHasUpdatedAt?: boolean;
};

let flagsStore: Flags | undefined;

export async function hasUsersBalanceColumn(DB?: D1Database): Promise<boolean> {
  if (!DB) return false;
  if (!flagsStore) {
    flagsStore = {};
  }
  if (flagsStore.hasUsersBalance !== undefined) return flagsStore.hasUsersBalance;
  try {
    await runWithD1Retry(() => DB.prepare('SELECT balance FROM users LIMIT 1').all(), 'schema:check-users-balance');
    flagsStore.hasUsersBalance = true;
  } catch {
    flagsStore.hasUsersBalance = false;
  }
  return flagsStore.hasUsersBalance;
}

export async function hasPointAccountsUpdatedAt(DB?: D1Database): Promise<boolean> {
  if (!DB) return false;
  if (!flagsStore) {
    flagsStore = {};
  }
  if (flagsStore.pointAccountsHasUpdatedAt !== undefined) return flagsStore.pointAccountsHasUpdatedAt;
  try {
    await runWithD1Retry(() => DB.prepare('SELECT updated_at FROM point_accounts LIMIT 1').all(), 'schema:check-point-accounts-updated-at');
    flagsStore.pointAccountsHasUpdatedAt = true;
  } catch {
    flagsStore.pointAccountsHasUpdatedAt = false;
  }
  return flagsStore.pointAccountsHasUpdatedAt;
}

export async function ensurePointTables(DB?: D1Database) {
  if (!DB) return;
  if (!flagsStore) {
    flagsStore = {};
  }
  if (flagsStore.pointTablesEnsured) return;

  await runWithD1Retry(
    () =>
      DB.exec(
        `CREATE TABLE IF NOT EXISTS point_ledger (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          delta INTEGER NOT NULL,
          reason TEXT NOT NULL,
          link_id TEXT,
          download_id TEXT,
          bucket_minute INTEGER,
          platform TEXT,
          created_at INTEGER NOT NULL
        );`
      ),
    'schema:create-point-ledger'
  );
  await runWithD1Retry(
    () => DB.exec(`CREATE INDEX IF NOT EXISTS idx_point_ledger_account ON point_ledger (account_id);`),
    'schema:create-point-ledger-index'
  );

  await runWithD1Retry(
    () =>
      DB.exec(
        `CREATE TABLE IF NOT EXISTS point_accounts (
          id TEXT PRIMARY KEY,
          balance INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0
        );`
      ),
    'schema:create-point-accounts'
  );

  await runWithD1Retry(
    () =>
      DB.exec(
        `CREATE TABLE IF NOT EXISTS point_dedupe (
          account_id TEXT NOT NULL,
          link_id TEXT NOT NULL,
          bucket_minute INTEGER NOT NULL,
          platform TEXT NOT NULL,
          PRIMARY KEY (account_id, link_id, bucket_minute, platform)
        );`
      ),
    'schema:create-point-dedupe'
  );

  flagsStore.pointTablesEnsured = true;
}
