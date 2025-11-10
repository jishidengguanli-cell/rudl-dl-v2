import type { D1Database } from '@cloudflare/workers-types';
import { getTableInfo } from '@/lib/distribution';
import type { DownloadTotals } from '@/lib/downloads';

export type TelegramSettings = {
  telegramBotToken: string | null;
};

type ColumnMap = {
  botToken: string | null;
};

export type DownloadMetric = 'total' | 'apk' | 'ipa';

const downloadMetricMap: Record<string, DownloadMetric> = {
  total: 'total',
  apk: 'apk',
  ipa: 'ipa',
};

export const parseDownloadMetric = (value: string | null | undefined): DownloadMetric | null => {
  if (!value) return null;
  return downloadMetricMap[value.toLowerCase()] ?? null;
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

export type MonitorRecordInsert = {
  monOption: 'pb' | 'dc';
  monDetail: Record<string, unknown>;
  notiMethod: 'tg';
  notiDetail: { content: string; target: string };
  isActive?: number;
};

const normalizeRowId = (value: string | number | null | undefined): number | null => {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
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

export async function updateMonitorRecord(
  DB: D1Database,
  userId: string,
  rowId: string | number,
  record: MonitorRecordInsert
): Promise<boolean> {
  const normalizedRowId = normalizeRowId(rowId);
  if (normalizedRowId === null) return false;
  const name = await ensureMonitorTable(DB, userId);
  const quoted = quoteIdentifier(name);
  const result = await DB.prepare(
    `UPDATE ${quoted}
     SET mon_option=?, mon_detail=?, noti_method=?, noti_detail=?, is_active=?
     WHERE rowid=?`
  )
    .bind(
      record.monOption,
      JSON.stringify(record.monDetail),
      record.notiMethod,
      JSON.stringify(record.notiDetail),
      typeof record.isActive === 'number' ? record.isActive : 1,
      normalizedRowId
    )
    .run();
  return typeof result.meta?.changes === 'number' && result.meta.changes > 0;
}

export async function deleteMonitorRecord(
  DB: D1Database,
  userId: string,
  rowId: string | number
): Promise<boolean> {
  const normalizedRowId = normalizeRowId(rowId);
  if (normalizedRowId === null) return false;
  const name = await ensureMonitorTable(DB, userId);
  const quoted = quoteIdentifier(name);
  const result = await DB.prepare(`DELETE FROM ${quoted} WHERE rowid=?`)
    .bind(normalizedRowId)
    .run();
  return typeof result.meta?.changes === 'number' && result.meta.changes > 0;
}

type RawMonitorRow = {
  rowid: number | string;
  mon_option: string;
  mon_detail: string | null;
  noti_detail: string | null;
  is_active: number | null;
};

export type MonitorSummary =
  | {
      id: string;
      type: 'points';
      threshold: number;
      target: string;
      message: string;
      isActive: boolean;
    }
  | {
      id: string;
      type: 'downloads';
      threshold: number;
      metric: DownloadMetric;
      linkCode: string;
      target: string;
      message: string;
      isActive: boolean;
    };

const parseJSON = <T>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

export async function listMonitorSummaries(
  DB: D1Database,
  userId: string
): Promise<MonitorSummary[]> {
  const name = await ensureMonitorTable(DB, userId);
  const quoted = quoteIdentifier(name);
  const result = await DB.prepare(
    `SELECT rowid, mon_option, mon_detail, noti_method, noti_detail, is_active FROM ${quoted} ORDER BY rowid DESC`
  )
    .all<RawMonitorRow>()
    .catch(() => null);
  const rows = result?.results ?? [];
  const summaries: MonitorSummary[] = [];

  for (const row of rows) {
    const detail = parseJSON<Record<string, unknown>>(row.mon_detail);
    const noti = parseJSON<{ content?: string; target?: string }>(row.noti_detail);
    if (!detail || !noti?.content || !noti?.target) continue;

    if (row.mon_option === 'pb' && typeof detail.point === 'number') {
      summaries.push({
        id: String(row.rowid),
        type: 'points',
        threshold: detail.point,
        target: noti.target,
        message: noti.content,
        isActive: Boolean(row.is_active),
      });
      continue;
    }

    if (row.mon_option === 'dc') {
      const metric = parseDownloadMetric(
        typeof detail.metric === 'string' ? detail.metric : null
      );
      if (!metric || typeof detail.link !== 'string' || typeof detail.num !== 'number') continue;
      summaries.push({
        id: String(row.rowid),
        type: 'downloads',
        threshold: detail.num,
        metric,
        linkCode: detail.link,
        target: noti.target,
        message: noti.content,
        isActive: Boolean(row.is_active),
      });
    }
  }

  return summaries;
}

type NotificationPayload = { target: string; message: string };

const postTelegramMessage = async (token: string, payload: NotificationPayload) => {
  if (!payload.target || !payload.message) return;
  const body = {
    chat_id: payload.target,
    text: payload.message,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response
      .clone()
      .text()
      .catch(() => '');
    console.error('[monitor] telegram send failed', response.status, text.slice(0, 200));
  }
};

const sendMonitorNotifications = async (
  DB: D1Database,
  ownerId: string,
  payloads: NotificationPayload[]
) => {
  if (!payloads.length) return;
  const settings = await fetchTelegramSettings(DB, ownerId);
  const token = settings.telegramBotToken?.trim();
  if (!token) {
    console.warn('[monitor] telegram token missing for owner', ownerId);
    return;
  }
  await Promise.all(
    payloads.map((payload) =>
      postTelegramMessage(token, payload).catch((error) => {
        console.error('[monitor] telegram send error', error);
      })
    )
  );
};

type DownloadMonitorParams = {
  ownerId: string | null | undefined;
  linkCode: string | null | undefined;
  platform: 'apk' | 'ipa';
  totals: DownloadTotals | null;
};

export async function triggerDownloadMonitors(DB: D1Database, params: DownloadMonitorParams) {
  const ownerId = params.ownerId?.trim();
  const linkCode = params.linkCode?.trim();
  if (!ownerId || !linkCode || !params.totals) return;

  const monitors = await listMonitorSummaries(DB, ownerId);
  const candidates = monitors.filter(
    (monitor): monitor is Extract<MonitorSummary, { type: 'downloads' }> =>
      monitor.type === 'downloads' && monitor.isActive && monitor.linkCode === linkCode
  );
  if (!candidates.length) return;

  const totalsByMetric: Record<DownloadMetric, number> = {
    total: params.totals.totalTotal,
    apk: params.totals.totalApk,
    ipa: params.totals.totalIpa,
  };
  const increments: Record<DownloadMetric, number> = {
    total: 1,
    apk: params.platform === 'apk' ? 1 : 0,
    ipa: params.platform === 'ipa' ? 1 : 0,
  };

  const notifications: NotificationPayload[] = [];
  for (const monitor of candidates) {
    const delta = increments[monitor.metric] ?? 0;
    if (!delta) continue;
    const current = totalsByMetric[monitor.metric];
    const previous = current - delta;
    if (previous < monitor.threshold && current >= monitor.threshold) {
      notifications.push({ target: monitor.target, message: monitor.message });
    }
  }

  await sendMonitorNotifications(DB, ownerId, notifications);
}

type PointMonitorParams = {
  ownerId: string | null | undefined;
  previousBalance: number | null | undefined;
  currentBalance: number | null | undefined;
};

export async function triggerPointMonitors(DB: D1Database, params: PointMonitorParams) {
  const ownerId = params.ownerId?.trim();
  const previous = Number(params.previousBalance ?? NaN);
  const current = Number(params.currentBalance ?? NaN);
  if (!ownerId || Number.isNaN(previous) || Number.isNaN(current)) return;

  const monitors = await listMonitorSummaries(DB, ownerId);
  const candidates = monitors.filter(
    (monitor): monitor is Extract<MonitorSummary, { type: 'points' }> =>
      monitor.type === 'points' && monitor.isActive
  );
  if (!candidates.length) return;

  const notifications: NotificationPayload[] = [];
  for (const monitor of candidates) {
    if (previous > monitor.threshold && current <= monitor.threshold) {
      notifications.push({ target: monitor.target, message: monitor.message });
    }
  }

  await sendMonitorNotifications(DB, ownerId, notifications);
}
