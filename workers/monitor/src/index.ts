export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
}

type MonitorKind = 'pb' | 'dc';

type MonitorRow = {
  rowid: number;
  mon_option: MonitorKind;
  mon_detail: string;
  noti_method: string;
  noti_detail: string;
  is_active: number;
};

type MonitorDetail =
  | { point: number }
  | { link: string; metric: string; num: number };

type NotiDetail = {
  content: string;
  target: string;
};

const TABLE_PREFIX = 'monitor_';

const sanitizeIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, '_');

async function listMonitorTables(DB: D1Database): Promise<string[]> {
  const result = await DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`
  )
    .bind(`${TABLE_PREFIX}%`)
    .all<{ name: string }>();
  return (result.results ?? []).map((row) => row.name).filter(Boolean);
}

async function fetchPointBalance(DB: D1Database, userId: string): Promise<number | null> {
  const row = await DB.prepare('SELECT balance FROM users WHERE id=? LIMIT 1')
    .bind(userId)
    .first<{ balance?: number | string }>()
    .catch(() => null);
  if (!row || row.balance === undefined || row.balance === null) return null;
  const numeric = Number(row.balance);
  return Number.isFinite(numeric) ? numeric : null;
}

async function fetchDownloadCount(
  _DB: D1Database,
  _code: string,
  _metric: string
): Promise<number | null> {
  // TODO: Connect to real download statistics once available.
  return null;
}

async function sendTelegram(env: Env, detail: NotiDetail) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.warn('[monitor] TELEGRAM_BOT_TOKEN missing, skip notification');
    return;
  }
  const body = {
    chat_id: detail.target,
    text: detail.content,
    parse_mode: 'Markdown',
  };
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[monitor] telegram send failed', res.status, text);
  } else {
    console.log('[monitor] telegram sent', detail.target);
  }
}

function parseJSON<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function processMonitor(env: Env, table: string, row: MonitorRow) {
  if (!row.is_active) return;
  const detail = parseJSON<MonitorDetail>(row.mon_detail);
  const noti = parseJSON<NotiDetail>(row.noti_detail);
  if (!detail || !noti) {
    console.warn('[monitor] skip invalid row', table, row.rowid);
    return;
  }

  const userId = table.slice(TABLE_PREFIX.length);
  if (!userId) return;

  if (row.mon_option === 'pb' && 'point' in detail) {
    const balance = await fetchPointBalance(env.DB, userId);
    if (balance !== null && balance <= detail.point) {
      await sendTelegram(env, noti);
    }
    return;
  }

  if (row.mon_option === 'dc' && 'link' in detail) {
    const count = await fetchDownloadCount(env.DB, detail.link, detail.metric);
    if (count !== null && count >= detail.num) {
      await sendTelegram(env, noti);
    } else {
      console.info('[monitor] download metric not implemented, skipped', detail.link);
    }
  }
}

async function processTable(env: Env, table: string) {
  const safeTable = sanitizeIdentifier(table);
  const query = `SELECT rowid, mon_option, mon_detail, noti_method, noti_detail, is_active FROM ${safeTable}`;
  const result = await env.DB.prepare(query).all<MonitorRow>().catch(() => null);
  if (!result?.results) return;
  for (const row of result.results) {
    await processMonitor(env, safeTable, row);
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    try {
      const tables = await listMonitorTables(env.DB);
      for (const table of tables) {
        await processTable(env, table);
      }
    } catch (error) {
      console.error('[monitor] scheduled execution failed', error);
    }
  },
};
