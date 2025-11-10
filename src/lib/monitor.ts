import type { D1Database } from '@cloudflare/workers-types';
import { getTableInfo } from '@/lib/distribution';

export type TelegramSettings = {
  telegramBotToken: string | null;
};

type ColumnMap = {
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
    botToken: resolveColumn(usersInfo.columns, ['telegram_bot_token', 'TELEGRAM_BOT_TOKEN']),
  };
};

export async function fetchTelegramSettings(DB: D1Database, userId: string): Promise<TelegramSettings> {
  const columns = ['id'];
  const columnMap = await buildColumnMap(DB);
  if (columnMap.botToken) columns.push(columnMap.botToken);

  const row = await DB.prepare(`SELECT ${columns.join(', ')} FROM users WHERE id=? LIMIT 1`)
    .bind(userId)
    .first<Record<string, unknown>>();

  if (!row) {
    return { telegramBotToken: null };
  }

  return {
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

const monitorTableCache = new Set<string>();

const sanitizeMonitorSuffix = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

const monitorTableName = (userId: string) => `monitor_${sanitizeMonitorSuffix(userId)}`;

const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function ensureMonitorTable(DB: D1Database, userId: string): Promise<string> {
  const name = monitorTableName(userId);
  if (monitorTableCache.has(name)) return name;
  const quoted = quoteIdentifier(name);
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${quoted} (
      mon_option TEXT NOT NULL,
      mon_detail TEXT NOT NULL,
      noti_method TEXT NOT NULL,
      noti_detail TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    )`
  ).run();
  monitorTableCache.add(name);
  return name;
}

type MonitorRecordInsert = {
  monOption: 'pb' | 'dc';
  monDetail: Record<string, unknown>;
  notiMethod: 'tg';
  notiDetail: { content: string; target: string };
  isActive?: number;
};

export async function insertMonitorRecord(
  DB: D1Database,
  userId: string,
  record: MonitorRecordInsert
): Promise<number | null> {
  const name = await ensureMonitorTable(DB, userId);
  const quoted = quoteIdentifier(name);
  const result = await DB.prepare(
    `INSERT INTO ${quoted} (mon_option, mon_detail, noti_method, noti_detail, is_active) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      record.monOption,
      JSON.stringify(record.monDetail),
      record.notiMethod,
      JSON.stringify(record.notiDetail),
      typeof record.isActive === 'number' ? record.isActive : 1
    )
    .run();
  return typeof result.meta?.last_row_id === 'number' ? result.meta.last_row_id : null;
}
