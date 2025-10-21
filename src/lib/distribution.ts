import type { D1Database } from '@cloudflare/workers-types';

export type TableName = 'links' | 'files';

export type TableInfo = {
  columns: Set<string>;
  types: Record<string, string>;
};

const tableInfoCache: Partial<Record<TableName, TableInfo>> = {};
const SUPPORTED_LANGS = ['en', 'ru', 'vi', 'zh-TW', 'zh-CN'] as const;
type LangCode = (typeof SUPPORTED_LANGS)[number];
const LANG_SET = new Set<LangCode>(SUPPORTED_LANGS);
const LANG_ALIASES: Record<string, LangCode> = {
  en: 'en',
  english: 'en',
  'en-us': 'en',
  'en_gb': 'en',
  'en-gb': 'en',
  zh: 'zh-TW',
  'zh-tw': 'zh-TW',
  'zh_tw': 'zh-TW',
  'zh-hant': 'zh-TW',
  'zh_hant': 'zh-TW',
  'traditional chinese': 'zh-TW',
  'traditional-chinese': 'zh-TW',
  '繁體中文': 'zh-TW',
  '繁中': 'zh-TW',
  cn: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh_cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh_hans': 'zh-CN',
  'simplified chinese': 'zh-CN',
  'simplified-chinese': 'zh-CN',
  '简体中文': 'zh-CN',
  '簡中': 'zh-CN',
  ru: 'ru',
  russian: 'ru',
  'русский': 'ru',
  vi: 'vi',
  vietnamese: 'vi',
  viet: 'vi',
  'tiếng việt': 'vi',
  'tieng viet': 'vi',
};

export async function getTableInfo(
  DB: D1Database,
  table: TableName,
  forceRefresh = false
): Promise<TableInfo> {
  const cached = tableInfoCache[table];
  if (cached && !forceRefresh) return cached;

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
  language: string;
  fileId: string | null;
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

export const normalizeLanguageCode = (value: unknown): LangCode => {
  if (typeof value !== 'string') return 'en';
  const trimmed = value.trim();
  if (LANG_SET.has(trimmed as LangCode)) return trimmed as LangCode;
  const lower = trimmed.toLowerCase();
  if (lower === 'zh' || lower === 'zh-hant') return 'zh-TW';
  if (lower === 'zh-hans') return 'zh-CN';
  if (lower === 'en-us' || lower === 'en-gb') return 'en';
  return LANG_ALIASES[lower] ?? 'en';
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
