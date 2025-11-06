import type { D1Database } from '@cloudflare/workers-types';
import { getTableInfo } from '@/lib/distribution';

export type TelegramSettings = {
  telegramApiId: string | null;
  telegramApiHash: string | null;
  telegramBotToken: string | null;
};

type ColumnMap = {
  apiId: string | null;
  apiHash: string | null;
  botToken: string | null;
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

const resolveColumn = (columns: Set<string>, names: string[]): string | null => {
  if (!columns.size) return null;
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const column of columns) {
      if (column === name || column.toLowerCase() === lower) {
        return column;
      }
    }
  }
  return null;
};

const buildColumnMap = async (DB: D1Database): Promise<ColumnMap> => {
  const usersInfo = await getTableInfo(DB, 'users');
  return {
    apiId: resolveColumn(usersInfo.columns, ['telegram_api_id', 'TELEGRAM_API_ID']),
    apiHash: resolveColumn(usersInfo.columns, ['telegram_api_hash', 'TELEGRAM_API_HASH']),
    botToken: resolveColumn(usersInfo.columns, ['telegram_bot_token', 'TELEGRAM_BOT_TOKEN']),
  };
};

export async function fetchTelegramSettings(DB: D1Database, userId: string): Promise<TelegramSettings> {
  const columns = ['id'];
  const columnMap = await buildColumnMap(DB);
  if (columnMap.apiId) columns.push(columnMap.apiId);
  if (columnMap.apiHash) columns.push(columnMap.apiHash);
  if (columnMap.botToken) columns.push(columnMap.botToken);

  const row = await DB.prepare(`SELECT ${columns.join(', ')} FROM users WHERE id=? LIMIT 1`)
    .bind(userId)
    .first<Record<string, unknown>>();

  if (!row) {
    return { telegramApiId: null, telegramApiHash: null, telegramBotToken: null };
  }

  return {
    telegramApiId: columnMap.apiId ? toStringOrNull(row[columnMap.apiId]) : null,
    telegramApiHash: columnMap.apiHash ? toStringOrNull(row[columnMap.apiHash]) : null,
    telegramBotToken: columnMap.botToken ? toStringOrNull(row[columnMap.botToken]) : null,
  };
}

export async function updateTelegramSettings(
  DB: D1Database,
  userId: string,
  payload: TelegramSettings
): Promise<TelegramSettings> {
  const columnMap = await buildColumnMap(DB);
  const updates: string[] = [];
  const bindings: (string | null)[] = [];

  if (columnMap.apiId) {
    updates.push(`${columnMap.apiId}=?`);
    bindings.push(normalizeInput(payload.telegramApiId));
  }
  if (columnMap.apiHash) {
    updates.push(`${columnMap.apiHash}=?`);
    bindings.push(normalizeInput(payload.telegramApiHash));
  }
  if (columnMap.botToken) {
    updates.push(`${columnMap.botToken}=?`);
    bindings.push(normalizeInput(payload.telegramBotToken));
  }

  if (updates.length) {
    await DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id=?`)
      .bind(...bindings, userId)
      .run();
  }

  return fetchTelegramSettings(DB, userId);
}
