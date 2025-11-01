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
  flags.pointTablesEnsured = true;
}
