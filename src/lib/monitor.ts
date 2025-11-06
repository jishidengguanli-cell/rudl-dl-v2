import type { D1Database } from '@cloudflare/workers-types';
import { getTableInfo, hasColumn } from '@/lib/distribution';

export type TelegramSettings = {
  telegramApiId: string | null;
  telegramApiHash: string | null;
  telegramBotToken: string | null;
};

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
};

const normalizeInput = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export async function fetchTelegramSettings(DB: D1Database, userId: string): Promise<TelegramSettings> {
  const usersInfo = await getTableInfo(DB, 'users');
  const columns = ['id'];
  if (hasColumn(usersInfo, 'telegram_api_id')) columns.push('telegram_api_id');
  if (hasColumn(usersInfo, 'telegram_api_hash')) columns.push('telegram_api_hash');
  if (hasColumn(usersInfo, 'telegram_bot_token')) columns.push('telegram_bot_token');

  const row = await DB.prepare(`SELECT ${columns.join(', ')} FROM users WHERE id=? LIMIT 1`)
    .bind(userId)
    .first<Record<string, unknown>>();

  if (!row) {
    return { telegramApiId: null, telegramApiHash: null, telegramBotToken: null };
  }

  return {
    telegramApiId: 'telegram_api_id' in row ? toStringOrNull(row.telegram_api_id) : null,
    telegramApiHash: 'telegram_api_hash' in row ? toStringOrNull(row.telegram_api_hash) : null,
    telegramBotToken: 'telegram_bot_token' in row ? toStringOrNull(row.telegram_bot_token) : null,
  };
}

export async function updateTelegramSettings(
  DB: D1Database,
  userId: string,
  payload: TelegramSettings
): Promise<TelegramSettings> {
  const usersInfo = await getTableInfo(DB, 'users');
  const updates: string[] = [];
  const bindings: (string | null)[] = [];

  if (hasColumn(usersInfo, 'telegram_api_id')) {
    updates.push('telegram_api_id=?');
    bindings.push(normalizeInput(payload.telegramApiId));
  }
  if (hasColumn(usersInfo, 'telegram_api_hash')) {
    updates.push('telegram_api_hash=?');
    bindings.push(normalizeInput(payload.telegramApiHash));
  }
  if (hasColumn(usersInfo, 'telegram_bot_token')) {
    updates.push('telegram_bot_token=?');
    bindings.push(normalizeInput(payload.telegramBotToken));
  }

  if (updates.length) {
    await DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id=?`)
      .bind(...bindings, userId)
      .run();
  }

  return fetchTelegramSettings(DB, userId);
}

