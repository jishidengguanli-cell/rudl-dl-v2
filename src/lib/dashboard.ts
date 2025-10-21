import type { D1Database } from '@cloudflare/workers-types';
import { getTableInfo, hasColumn } from './distribution';

export type DashboardFile = {
  id: string;
  platform: string;
  title: string | null;
  bundleId: string | null;
  version: string | null;
  size: number | null;
  createdAt: number;
};

export type DashboardLink = {
  id: string;
  code: string;
  title: string | null;
  bundleId: string | null;
  apkVersion: string | null;
  ipaVersion: string | null;
  platform: string;
  isActive: boolean;
  createdAt: number;
  language: string;
  todayApkDl: number;
  todayIpaDl: number;
  todayTotalDl: number;
  totalApkDl: number;
  totalIpaDl: number;
  totalTotalDl: number;
  files: DashboardFile[];
};

export type DashboardPage = {
  page: number;
  pageSize: number;
  total: number;
  balance: number;
  links: DashboardLink[];
};

type LinkRow = {
  id: string;
  code: string;
  title: string | null;
  bundle_id: string | null;
  apk_version: string | null;
  ipa_version: string | null;
  platform: string;
  is_active: number | string | null;
  created_at: number | string | null;
  lang?: string | null;
  today_apk_dl?: number | string | null;
  today_ipa_dl?: number | string | null;
  today_total_dl?: number | string | null;
  total_apk_dl?: number | string | null;
  total_ipa_dl?: number | string | null;
  total_total_dl?: number | string | null;
};

type FileRow = {
  id: string;
  platform: string;
  title: string | null;
  bundle_id: string | null;
  version: string | null;
  size: number | null;
  created_at: number | string | null;
};

const toNumber = (value: number | string | null | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return 0;
};

const toEpochSeconds = (value: number | string | null | undefined): number => {
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

export async function fetchDashboardPage(
  DB: D1Database,
  ownerId: string,
  page: number,
  pageSize: number
): Promise<DashboardPage> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 10;
  const offset = (safePage - 1) * safePageSize;

  const linksInfo = await getTableInfo(DB, 'links');
  const hasLangColumn = hasColumn(linksInfo, 'lang');

  const balanceRow = await DB.prepare('SELECT balance FROM users WHERE id=? LIMIT 1')
    .bind(ownerId)
    .first<{ balance: number }>();
  const totalRow = await DB.prepare('SELECT COUNT(*) as count FROM links WHERE owner_id=?')
    .bind(ownerId)
    .first<{ count: number }>();

  const selectColumns = [
    'id',
    'code',
    'title',
    'bundle_id',
    'apk_version',
    'ipa_version',
    'platform',
    'is_active',
    'created_at',
    hasLangColumn ? 'lang' : null,
    'today_apk_dl',
    'today_ipa_dl',
    'today_total_dl',
    'total_apk_dl',
    'total_ipa_dl',
    'total_total_dl',
  ].filter((column): column is string => Boolean(column));

  const linksResult = await DB.prepare(
    `SELECT ${selectColumns.join(', ')}
     FROM links
     WHERE owner_id=?
     ORDER BY created_at DESC
     LIMIT ?
     OFFSET ?`
  )
    .bind(ownerId, safePageSize, offset)
    .all();

  const linkRows = (linksResult.results as LinkRow[] | undefined) ?? [];

  const links: DashboardLink[] = [];
  for (const link of linkRows) {
    const fileRows = await DB.prepare(
      `SELECT id, platform, title, bundle_id, version, size, created_at
       FROM files
       WHERE link_id=?
       ORDER BY created_at DESC`
    )
      .bind(link.id)
      .all();

    const files: DashboardFile[] =
      (fileRows.results as FileRow[] | undefined)?.map((file) => ({
        id: file.id,
        platform: file.platform,
        title: file.title,
        bundleId: file.bundle_id,
        version: file.version,
        size: file.size ?? null,
        createdAt: toEpochSeconds(file.created_at),
      })) ?? [];

    links.push({
      id: link.id,
      code: link.code,
      title: link.title,
      bundleId: link.bundle_id,
      apkVersion: link.apk_version,
      ipaVersion: link.ipa_version,
      platform: link.platform,
      isActive: Boolean(
        typeof link.is_active === 'string'
          ? Number(link.is_active)
          : Number(link.is_active ?? 0)
      ),
      createdAt: toEpochSeconds(link.created_at),
      language:
        hasLangColumn && typeof link.lang === 'string' && link.lang ? link.lang : 'en',
      todayApkDl: toNumber(link.today_apk_dl),
      todayIpaDl: toNumber(link.today_ipa_dl),
      todayTotalDl: toNumber(link.today_total_dl),
      totalApkDl: toNumber(link.total_apk_dl),
      totalIpaDl: toNumber(link.total_ipa_dl),
      totalTotalDl: toNumber(link.total_total_dl),
      files,
    });
  }

  return {
    page: safePage,
    pageSize: safePageSize,
    total: totalRow?.count ?? 0,
    balance: balanceRow?.balance ?? 0,
    links,
  };
}






