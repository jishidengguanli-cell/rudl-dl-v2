import type { D1Database } from '@cloudflare/workers-types';

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
  is_active: number;
  created_at: number;
};

type FileRow = {
  id: string;
  platform: string;
  title: string | null;
  bundle_id: string | null;
  version: string | null;
  size: number | null;
  created_at: number;
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

  const balanceRow = await DB.prepare('SELECT balance FROM users WHERE id=? LIMIT 1')
    .bind(ownerId)
    .first<{ balance: number }>();
  const totalRow = await DB.prepare('SELECT COUNT(*) as count FROM links WHERE owner_id=?')
    .bind(ownerId)
    .first<{ count: number }>();

  const linksResult = await DB.prepare(
    `SELECT id, code, title, bundle_id, apk_version, ipa_version, platform, is_active, created_at
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
        createdAt: file.created_at,
      })) ?? [];

    links.push({
      id: link.id,
      code: link.code,
      title: link.title,
      bundleId: link.bundle_id,
      apkVersion: link.apk_version,
      ipaVersion: link.ipa_version,
      platform: link.platform,
      isActive: !!link.is_active,
      createdAt: link.created_at,
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






