import type { D1Database } from '@cloudflare/workers-types';
import { getTableInfo, hasColumn } from './distribution';
import {
  normalizeNetworkArea,
  isRegionalNetworkArea,
  type NetworkArea,
} from './network-area';

export type AnalyticsWatcherSettings = {
  httpErrors: boolean;
  buttonErrors: boolean;
  lcp: boolean;
  inp: boolean;
  testMode: boolean;
};

export const DEFAULT_ANALYTICS_WATCHER_SETTINGS: AnalyticsWatcherSettings = {
  httpErrors: true,
  buttonErrors: true,
  lcp: true,
  inp: true,
  testMode: false,
};

export type AnalyticsWatcher = {
  id: string;
  ownerId: string;
  linkId: string;
  linkCode: string;
  linkTitle: string | null;
  linkIsActive: boolean;
  linkNetworkArea: NetworkArea;
  chatId: string;
  isActive: boolean;
  settings: AnalyticsWatcherSettings;
};

export class AnalyticsWatcherError extends Error {
  constructor(
    public code:
      | 'INVALID_CHAT_ID'
      | 'LINK_NOT_FOUND'
      | 'LINK_NOT_OWNED'
      | 'LINK_UNSUPPORTED_CN'
      | 'WATCHER_NOT_FOUND',
    message?: string
  ) {
    super(message ?? code);
    this.name = 'AnalyticsWatcherError';
  }
}

const ANALYTICS_TABLE = 'analytics_watchers';
let analyticsTableReady = false;

type LinkColumnFlags = {
  hasTitle: boolean;
  hasNetworkArea: boolean;
  hasIsActive: boolean;
};

let linkColumnFlags: LinkColumnFlags | null = null;

const normalizeId = (value: string | null | undefined): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return Number(value) !== 0 && value.toLowerCase() !== 'false';
  return Boolean(value);
};

const ensureAnalyticsTable = async (DB: D1Database) => {
  if (analyticsTableReady) return;
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${ANALYTICS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      link_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      settings TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  await DB.prepare(
    `CREATE INDEX IF NOT EXISTS analytics_watchers_owner_idx ON ${ANALYTICS_TABLE}(owner_id)`
  ).run();
  await DB.prepare(
    `CREATE INDEX IF NOT EXISTS analytics_watchers_link_idx ON ${ANALYTICS_TABLE}(link_id)`
  ).run();
  analyticsTableReady = true;
};

const ensureLinkColumnFlags = async (DB: D1Database): Promise<LinkColumnFlags> => {
  if (linkColumnFlags) return linkColumnFlags;
  const info = await getTableInfo(DB, 'links');
  linkColumnFlags = {
    hasTitle: hasColumn(info, 'title'),
    hasNetworkArea: hasColumn(info, 'network_area'),
    hasIsActive: hasColumn(info, 'is_active'),
  };
  return linkColumnFlags;
};

const normalizeChatId = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new AnalyticsWatcherError('INVALID_CHAT_ID');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AnalyticsWatcherError('INVALID_CHAT_ID');
  }
  return trimmed;
};

const normalizeSettings = (
  partial: Partial<AnalyticsWatcherSettings> | null | undefined
): AnalyticsWatcherSettings => {
  const next: AnalyticsWatcherSettings = { ...DEFAULT_ANALYTICS_WATCHER_SETTINGS };
  if (!partial || typeof partial !== 'object') {
    return next;
  }
  if (typeof partial.httpErrors === 'boolean') next.httpErrors = partial.httpErrors;
  if (typeof partial.buttonErrors === 'boolean') next.buttonErrors = partial.buttonErrors;
  if (typeof partial.lcp === 'boolean') next.lcp = partial.lcp;
  if (typeof partial.inp === 'boolean') next.inp = partial.inp;
  if (typeof partial.testMode === 'boolean') next.testMode = partial.testMode;
  return next;
};

const parseSettings = (value: string | null): AnalyticsWatcherSettings => {
  if (!value) return { ...DEFAULT_ANALYTICS_WATCHER_SETTINGS };
  try {
    const parsed = JSON.parse(value) as Partial<AnalyticsWatcherSettings>;
    return normalizeSettings(parsed);
  } catch {
    return { ...DEFAULT_ANALYTICS_WATCHER_SETTINGS };
  }
};

type WatcherRow = {
  watcher_id: number | string;
  watcher_owner_id: string;
  watcher_link_id: string;
  watcher_chat_id: string;
  watcher_settings: string | null;
  watcher_is_active: number | null;
  link_code?: string;
  link_title?: string | null;
  link_network_area?: string | null;
  link_is_active?: number | null;
  link_owner_id?: string | null;
};

const mapWatcherRow = (
  row: WatcherRow | null | undefined,
  flags: LinkColumnFlags
): AnalyticsWatcher | null => {
  if (!row) return null;
  const id = toStringOrNull(row.watcher_id);
  const ownerId = toStringOrNull(row.watcher_owner_id);
  const linkId = toStringOrNull(row.watcher_link_id);
  const linkCode = toStringOrNull(row.link_code);
  const chatId = toStringOrNull(row.watcher_chat_id);
  if (!id || !ownerId || !linkId || !linkCode || !chatId) return null;
  const normalizedOwnerId = normalizeId(ownerId);
  if (!normalizedOwnerId) return null;

  const settings = parseSettings(row.watcher_settings ?? null);
  const linkTitle = flags.hasTitle ? toStringOrNull(row.link_title ?? null) : null;
  const linkNetworkArea = flags.hasNetworkArea
    ? normalizeNetworkArea(toStringOrNull(row.link_network_area ?? null))
    : normalizeNetworkArea(null);
  const linkIsActive = !flags.hasIsActive || toBoolean(row.link_is_active);

  return {
    id,
    ownerId: normalizedOwnerId,
    linkId,
    linkCode,
    linkTitle,
    linkIsActive,
    linkNetworkArea,
    chatId,
    isActive: toBoolean(row.watcher_is_active),
    settings,
  };
};

type QueryFilters = {
  ownerId?: string;
  watcherId?: string;
  onlyActive?: boolean;
  excludeChina?: boolean;
};

async function queryWatchers(DB: D1Database, filters: QueryFilters = {}): Promise<AnalyticsWatcher[]> {
  await ensureAnalyticsTable(DB);
  const flags = await ensureLinkColumnFlags(DB);

  const selectColumns = [
    'w.id as watcher_id',
    'w.owner_id as watcher_owner_id',
    'w.link_id as watcher_link_id',
    'w.chat_id as watcher_chat_id',
    'w.settings as watcher_settings',
    'w.is_active as watcher_is_active',
    'l.code as link_code',
    'l.owner_id as link_owner_id',
  ];
  if (flags.hasTitle) selectColumns.push('l.title as link_title');
  if (flags.hasNetworkArea) selectColumns.push('l.network_area as link_network_area');
  if (flags.hasIsActive) selectColumns.push('l.is_active as link_is_active');

  const conditions = ['l.id = w.link_id', 'l.owner_id = w.owner_id'];
  const bindings: unknown[] = [];

  if (filters.ownerId) {
    conditions.push('w.owner_id = ?');
    bindings.push(filters.ownerId);
  }

  if (filters.watcherId) {
    conditions.push('w.id = ?');
    bindings.push(filters.watcherId);
  }

  if (filters.onlyActive) {
    conditions.push('w.is_active = 1');
    if (flags.hasIsActive) {
      conditions.push('l.is_active = 1');
    }
  }

  if (filters.excludeChina && flags.hasNetworkArea) {
    conditions.push(
      "(UPPER(l.network_area) IS NULL OR UPPER(l.network_area) NOT IN ('CN','RU'))"
    );
  }

  const query = `SELECT ${selectColumns.join(', ')}
    FROM ${ANALYTICS_TABLE} w
    JOIN links l ON l.id = w.link_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY w.id DESC`;

  const result = await DB.prepare(query)
    .bind(...bindings)
    .all<WatcherRow>()
    .catch(() => null);
  const rows = result?.results ?? [];
  return rows
    .map((row) => mapWatcherRow(row, flags))
    .filter((entry): entry is AnalyticsWatcher => Boolean(entry));
}

export async function listAnalyticsWatchersByOwner(
  DB: D1Database,
  ownerId: string
): Promise<AnalyticsWatcher[]> {
  const normalized = normalizeId(ownerId);
  if (!normalized) return [];
  return queryWatchers(DB, { ownerId: normalized });
}

export async function listActiveAnalyticsWatchers(DB: D1Database): Promise<AnalyticsWatcher[]> {
  return queryWatchers(DB, { onlyActive: true, excludeChina: true });
}

export type AnalyticsWatcherInput = {
  linkId: string;
  chatId: string;
  settings?: Partial<AnalyticsWatcherSettings>;
  isActive?: boolean;
};

export async function createAnalyticsWatcher(
  DB: D1Database,
  ownerId: string,
  payload: AnalyticsWatcherInput
): Promise<AnalyticsWatcher> {
  await ensureAnalyticsTable(DB);
  const normalizedOwnerId = normalizeId(ownerId);
  if (!normalizedOwnerId) {
    throw new AnalyticsWatcherError('LINK_NOT_OWNED');
  }
  const linkId = payload.linkId?.trim();
  if (!linkId) {
    throw new AnalyticsWatcherError('LINK_NOT_FOUND');
  }

  const flags = await ensureLinkColumnFlags(DB);
  const columns = ['id', 'owner_id', 'code'];
  if (flags.hasTitle) columns.push('title');
  if (flags.hasNetworkArea) columns.push('network_area');
  if (flags.hasIsActive) columns.push('is_active');
  const statement = `SELECT ${columns.join(', ')} FROM links WHERE id=? LIMIT 1`;
  const linkRow = await DB.prepare(statement)
    .bind(linkId)
    .first<Record<string, unknown>>()
    .catch(() => null);

  if (!linkRow) {
    throw new AnalyticsWatcherError('LINK_NOT_FOUND');
  }
  const linkOwnerId = toStringOrNull(linkRow['owner_id']);
  const linkCode = toStringOrNull(linkRow['code']);
  if (!linkOwnerId || !linkCode) {
    throw new AnalyticsWatcherError('LINK_NOT_FOUND');
  }
  if (!linkOwnerId || linkOwnerId.trim() !== normalizedOwnerId) {
    throw new AnalyticsWatcherError('LINK_NOT_OWNED');
  }

  const networkArea = flags.hasNetworkArea
    ? normalizeNetworkArea(toStringOrNull(linkRow['network_area']))
    : normalizeNetworkArea(null);
  if (isRegionalNetworkArea(networkArea)) {
    throw new AnalyticsWatcherError('LINK_UNSUPPORTED_CN');
  }

  const chatId = normalizeChatId(payload.chatId);
  const settings = normalizeSettings(payload.settings);

  const insert = await DB.prepare(
    `INSERT INTO ${ANALYTICS_TABLE} (owner_id, link_id, chat_id, settings, is_active)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(normalizedOwnerId, linkId, chatId, JSON.stringify(settings), payload.isActive === false ? 0 : 1)
    .run();
  const id =
    typeof insert.meta?.last_row_id === 'number'
      ? String(insert.meta.last_row_id)
      : crypto.randomUUID();

  return {
    id,
    ownerId,
    linkId,
    linkCode,
    linkTitle: flags.hasTitle ? toStringOrNull(linkRow['title']) : null,
    linkIsActive: !flags.hasIsActive || toBoolean(linkRow['is_active']),
    linkNetworkArea: networkArea,
    chatId,
    isActive: payload.isActive === false ? false : true,
    settings,
  };
}

export async function updateAnalyticsWatcher(
  DB: D1Database,
  ownerId: string,
  watcherId: string,
  payload: Partial<AnalyticsWatcherInput>
): Promise<AnalyticsWatcher> {
  const normalizedOwnerId = normalizeId(ownerId);
  if (!normalizedOwnerId) {
    throw new AnalyticsWatcherError('WATCHER_NOT_FOUND');
  }
  const watcher = await queryWatchers(DB, { ownerId: normalizedOwnerId, watcherId });
  if (!watcher.length) {
    throw new AnalyticsWatcherError('WATCHER_NOT_FOUND');
  }
  const current = watcher[0];

  const chatId = payload.chatId ? normalizeChatId(payload.chatId) : current.chatId;
  const settings = payload.settings ? normalizeSettings(payload.settings) : current.settings;
  const nextIsActive =
    typeof payload.isActive === 'boolean' ? payload.isActive : current.isActive;

  await DB.prepare(
    `UPDATE ${ANALYTICS_TABLE}
     SET chat_id=?, settings=?, is_active=?
     WHERE id=? AND owner_id=?`
  )
    .bind(chatId, JSON.stringify(settings), nextIsActive ? 1 : 0, watcherId, normalizedOwnerId)
    .run();

  return {
    ...current,
    chatId,
    settings,
    isActive: nextIsActive,
  };
}

export async function deleteAnalyticsWatcher(
  DB: D1Database,
  ownerId: string,
  watcherId: string
): Promise<boolean> {
  await ensureAnalyticsTable(DB);
  const normalizedOwnerId = normalizeId(ownerId);
  if (!normalizedOwnerId) return false;
  const result = await DB.prepare(`DELETE FROM ${ANALYTICS_TABLE} WHERE id=? AND owner_id=?`)
    .bind(watcherId, normalizedOwnerId)
    .run();
  return typeof result.meta?.changes === 'number' && result.meta.changes > 0;
}
