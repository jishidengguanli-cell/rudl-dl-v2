import type { D1Database } from '@cloudflare/workers-types';

let flagsStore: { hasUsersBalance?: boolean } | undefined;

export async function hasUsersBalanceColumn(DB?: D1Database): Promise<boolean> {
  if (!DB) return false;
  if (!flagsStore) {
    flagsStore = {};
  }
  if (flagsStore.hasUsersBalance !== undefined) return flagsStore.hasUsersBalance;
  try {
    await DB.prepare('SELECT balance FROM users LIMIT 1').first();
    flagsStore.hasUsersBalance = true;
  } catch {
    flagsStore.hasUsersBalance = false;
  }
  return flagsStore.hasUsersBalance;
}

