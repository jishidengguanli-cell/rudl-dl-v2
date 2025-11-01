import type { D1Database } from '@cloudflare/workers-types';
import { runWithD1Retry } from './d1';

type Flags = {
  hasUsersBalance?: boolean;
  pointTablesEnsured?: boolean;
  pointAccountsHasUpdatedAt?: boolean;
};

let flagsStore: Flags | undefined;

const ensureFlags = () => {
  if (!flagsStore) {
    flagsStore = {};
  }
  return flagsStore;
};

const tableExists = async (DB: D1Database, name: string) => {
  const result = await runWithD1Retry(
    () =>
      DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`)
        .bind(name)
        .all<{ name: string }>(),
    `schema:check-table-${name}`
  );
  return Boolean(result?.results?.length);
};

const indexExists = async (DB: D1Database, name: string) => {
  const result = await runWithD1Retry(
    () =>
      DB.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=? LIMIT 1`)
        .bind(name)
        .all<{ name: string }>(),
    `schema:check-index-${name}`
  );
  return Boolean(result?.results?.length);
};

export async function hasUsersBalanceColumn(DB?: D1Database): Promise<boolean> {
  if (!DB) return false;
  const flags = ensureFlags();
  if (flags.hasUsersBalance !== undefined) return flags.hasUsersBalance;
  try {
    await runWithD1Retry(() => DB.prepare('SELECT balance FROM users LIMIT 1').all(), 'schema:check-users-balance');
    flags.hasUsersBalance = true;
  } catch {
    flags.hasUsersBalance = false;
  }
  return flags.hasUsersBalance;
}

export async function hasPointAccountsUpdatedAt(DB?: D1Database): Promise<boolean> {
  if (!DB) return false;
  const flags = ensureFlags();
  if (flags.pointAccountsHasUpdatedAt !== undefined) return flags.pointAccountsHasUpdatedAt;
  try {
    await runWithD1Retry(() => DB.prepare('SELECT updated_at FROM point_accounts LIMIT 1').all(), 'schema:check-point-accounts-updated-at');
    flags.pointAccountsHasUpdatedAt = true;
  } catch {
    flags.pointAccountsHasUpdatedAt = false;
  }
  return flags.pointAccountsHasUpdatedAt;
}

export async function ensurePointTables(DB?: D1Database) {
  if (!DB) return;
  const flags = ensureFlags();
  if (flags.pointTablesEnsured) return;

  const ledgerExists = await tableExists(DB, 'point_ledger');
  if (!ledgerExists) {
    console.info('[schema] creating point_ledger');
    await runWithD1Retry(
      () =>
        DB.exec(
          `CREATE TABLE point_ledger (
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
  }

  const ledgerIndexExists = ledgerExists ? await indexExists(DB, 'idx_point_ledger_account') : false;
  if (!ledgerIndexExists) {
    await runWithD1Retry(
      () => DB.exec(`CREATE INDEX IF NOT EXISTS idx_point_ledger_account ON point_ledger (account_id);`),
      'schema:create-point-ledger-index'
    );
  }

  const pointAccountsExists = await tableExists(DB, 'point_accounts');
  if (!pointAccountsExists) {
    console.info('[schema] creating point_accounts');
    await runWithD1Retry(
      () =>
        DB.exec(
          `CREATE TABLE point_accounts (
            id TEXT PRIMARY KEY,
            balance INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0
          );`
        ),
      'schema:create-point-accounts'
    );
  }

  const pointDedupeExists = await tableExists(DB, 'point_dedupe');
  if (!pointDedupeExists) {
    console.info('[schema] creating point_dedupe');
    await runWithD1Retry(
      () =>
        DB.exec(
          `CREATE TABLE point_dedupe (
            account_id TEXT NOT NULL,
            link_id TEXT NOT NULL,
            bucket_minute INTEGER NOT NULL,
            platform TEXT NOT NULL,
            PRIMARY KEY (account_id, link_id, bucket_minute, platform)
          );`
        ),
      'schema:create-point-dedupe'
    );
  }

  flags.pointTablesEnsured = true;
}
