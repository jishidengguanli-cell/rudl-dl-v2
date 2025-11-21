import type { D1Database } from '@cloudflare/workers-types';
import { normalizeLanguageCode, type LangCode } from '@/lib/language';
import { normalizeNetworkArea, type NetworkArea } from './network-area';

export type TableName = 'links' | 'files' | 'users';

export type TableInfo = {
  columns: Set<string>;
  types: Record<string, string>;
};

const tableInfoCache: Partial<Record<TableName, TableInfo>> = {};

export async function getTableInfo(
  DB: D1Database,
  table: TableName,
  forceRefresh = false
): Promise<TableInfo> {
  if (forceRefresh) {
    delete tableInfoCache[table];
  }

  const cached = tableInfoCache[table];
  if (cached) return cached;

  const results = await DB.prepare(`PRAGMA table_info(${table})`).all();
  const info: TableInfo = { columns: new Set(), types: {} };
  const rows = (results.results as Array<{ name?: string; type?: string }> | undefined) ?? [];

  for (const row of rows) {
    if (!row?.name) continue;
    info.columns.add(row.name);
    if (row.type) {
      info.types[row.name] = row.type;
    }
  }

  tableInfoCache[table] = info;
  return info;
}

export function hasColumn(info: TableInfo, column: string): boolean {
  return info.columns.has(column);
}

export function isTextColumn(info: TableInfo, column: string): boolean {
  const type = info.types[column]?.toUpperCase() ?? '';
  return type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT');
}

export type DistributionFile = {
  id: string;
  platform: string | null;
  title: string | null;
  bundleId: string | null;
  version: string | null;
  size: number | null;
  r2Key: string | null;
  sha256: string | null;
  contentType: string | null;
  createdAt: number;
};

export type DistributionLink = {
  id: string;
  code: string;
  ownerId: string | null;
  title: string | null;
  bundleId: string | null;
  apkVersion: string | null;
  ipaVersion: string | null;
  platform: string;
  isActive: boolean;
  createdAt: number;
  language: LangCode;
  fileId: string | null;
  networkArea: NetworkArea;
  files: DistributionFile[];
};

type LinkRow = Record<string, unknown>;
type FileRow = Record<string, unknown>;

const toEpochSeconds = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  return 0;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
};

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric !== 0;
    return value.toLowerCase() === 'true';
  }
  return Boolean(value);
};

type LookupField = 'id' | 'code';

async function fetchDistributionByField(
  DB: D1Database,
  field: LookupField,
  value: string
): Promise<DistributionLink | null> {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let linksInfo = await getTableInfo(DB, 'links');
  if (!hasColumn(linksInfo, 'lang')) {
    linksInfo = await getTableInfo(DB, 'links', true);
  }
  const filesInfo = await getTableInfo(DB, 'files');

  const linkColumns = [
    'id',
    'code',
    'owner_id',
    'title',
    'bundle_id',
    'apk_version',
    'ipa_version',
    'platform',
    'is_active',
    'created_at',
    'lang',
    'file_id',
    'network_area',
  ].filter((column) => hasColumn(linksInfo, column));
  if (!linkColumns.includes('id') || !linkColumns.includes('code')) {
    return null;
  }

  const linkRow = await DB.prepare(
    `SELECT ${linkColumns.join(', ')} FROM links WHERE ${field}=? LIMIT 1`
  )
    .bind(trimmed)
    .first<LinkRow>();

  if (!linkRow) return null;

  const linkId = toStringOrNull(linkRow.id);
  if (!linkId) return null;

  const fileColumns = [
    'id',
    'link_id',
    'platform',
    'title',
    'bundle_id',
    'version',
    'size',
    'r2_key',
    'sha256',
    'content_type',
    'created_at',
  ].filter((column) => hasColumn(filesInfo, column));

  let fileRows: FileRow[] = [];
  if (fileColumns.length) {
    const result = await DB.prepare(
      `SELECT ${fileColumns.join(', ')} FROM files WHERE link_id=? ORDER BY created_at DESC`
    )
      .bind(linkId)
      .all();
    fileRows = (result?.results as FileRow[] | undefined) ?? [];
  }

  const files: DistributionFile[] = fileRows.map((row) => ({
    id: toStringOrNull(row.id) ?? '',
    platform: toStringOrNull(row.platform),
    title: toStringOrNull(row.title),
    bundleId: toStringOrNull(row.bundle_id),
    version: toStringOrNull(row.version),
    size: toNumberOrNull(row.size),
    r2Key: toStringOrNull(row.r2_key),
    sha256: toStringOrNull(row.sha256),
    contentType: toStringOrNull(row.content_type),
    createdAt: toEpochSeconds(row.created_at),
  }));

  const linkCode = toStringOrNull(linkRow.code);

  const link: DistributionLink = {
    id: linkId,
    code: field === 'code' ? linkCode ?? trimmed : linkCode ?? '',
    ownerId: toStringOrNull(linkRow.owner_id),
    title: toStringOrNull(linkRow.title),
    bundleId: toStringOrNull(linkRow.bundle_id),
    apkVersion: toStringOrNull(linkRow.apk_version),
    ipaVersion: toStringOrNull(linkRow.ipa_version),
    platform: toStringOrNull(linkRow.platform) ?? '',
    isActive: hasColumn(linksInfo, 'is_active') ? toBoolean(linkRow.is_active) : true,
    createdAt: toEpochSeconds(linkRow.created_at),
    language: normalizeLanguageCode(linkRow.lang),
    fileId: toStringOrNull(linkRow.file_id),
    networkArea: normalizeNetworkArea(toStringOrNull(linkRow.network_area)),
    files,
  };

  return link;
}

export async function fetchDistributionByCode(
  DB: D1Database,
  code: string
): Promise<DistributionLink | null> {
  return fetchDistributionByField(DB, 'code', code);
}

export async function fetchDistributionById(
  DB: D1Database,
  id: string
): Promise<DistributionLink | null> {
  return fetchDistributionByField(DB, 'id', id);
}

export type DistributionLinkSummary = {
  id: string;
  code: string;
  title: string | null;
  createdAt: number;
  networkArea: NetworkArea;
};

export async function fetchDistributionSummariesByOwner(
  DB: D1Database,
  ownerId: string
): Promise<DistributionLinkSummary[]> {
  if (!ownerId?.trim()) return [];
  const linksInfo = await getTableInfo(DB, 'links');
  if (!hasColumn(linksInfo, 'owner_id')) return [];
  const columns = ['id', 'code', 'title', 'created_at'].filter((column) =>
    hasColumn(linksInfo, column)
  );
  const includeNetworkArea = hasColumn(linksInfo, 'network_area');
  if (includeNetworkArea) {
    columns.push('network_area');
  }
  if (!columns.includes('id') || !columns.includes('code')) return [];

  const statement = `SELECT ${columns.join(', ')} FROM links WHERE owner_id=? ORDER BY created_at DESC`;
  const result = await DB.prepare(statement).bind(ownerId).all();
  const rows = (result?.results as LinkRow[] | undefined) ?? [];

  return rows
    .map((row) => ({
      id: toStringOrNull(row.id) ?? '',
      code: toStringOrNull(row.code) ?? '',
      title: toStringOrNull(row.title),
      createdAt: toEpochSeconds(row.created_at),
      networkArea: includeNetworkArea
        ? normalizeNetworkArea(toStringOrNull(row.network_area))
        : normalizeNetworkArea(null),
    }))
    .filter((entry) => entry.id && entry.code);
}
