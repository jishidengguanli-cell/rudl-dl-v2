import type { D1Database } from '@cloudflare/workers-types';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatDate = (date: Date) => DATE_FORMATTER.format(date);

const sanitizeLinkId = (linkId: string) => linkId.replace(/[^a-zA-Z0-9]/g, '_');

export const getStatsTableName = (linkId: string) =>
  `stats_${sanitizeLinkId(linkId)}`;

const tableExists = async (DB: D1Database, tableName: string) => {
  const row = await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
  )
    .bind(tableName)
    .first<{ name?: string }>();
  return Boolean(row?.name);
};

const ensureStatsTable = async (DB: D1Database, tableName: string) => {
  const statement = DB.prepare(
    `CREATE TABLE IF NOT EXISTS "${tableName}" (
      date TEXT PRIMARY KEY,
      apk_dl INTEGER DEFAULT 0,
      ipa_dl INTEGER DEFAULT 0
    )`
  );
  await statement.run();
};

const toNumber = (value: unknown): number => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

type LinkStatsColumnKey =
  | 'todayApk'
  | 'todayIpa'
  | 'todayTotal'
  | 'totalApk'
  | 'totalIpa'
  | 'totalTotal';

type LinkStatsColumnMap = Partial<Record<LinkStatsColumnKey, string>>;

const LINK_STATS_COLUMN_CANDIDATES: Record<LinkStatsColumnKey, readonly string[]> = {
  todayApk: ['today_apk_dl', 'today_apk_d', 'today_apk'],
  todayIpa: ['today_ipa_dl', 'today_ipa_d', 'today_ipa'],
  todayTotal: ['today_total_dl', 'today_total_d', 'today_total'],
  totalApk: ['total_apk_dl', 'total_apk_d', 'total_apk'],
  totalIpa: ['total_ipa_dl', 'total_ipa_d', 'total_ipa'],
  totalTotal: ['total_total_dl', 'total_total_d', 'total_total'],
};

let cachedLinkStatsColumns: Promise<LinkStatsColumnMap> | null = null;

const getLinkStatsColumns = (DB: D1Database): Promise<LinkStatsColumnMap> => {
  if (!cachedLinkStatsColumns) {
    cachedLinkStatsColumns = (async () => {
      try {
        const response = await DB.prepare('PRAGMA table_info(links)').all<{ name?: string }>();
        const rows = (response?.results as Array<{ name?: string }> | undefined) ?? [];
        const knownColumns = new Set(rows.map((row) => row.name).filter((name): name is string => Boolean(name)));
        const resolved: LinkStatsColumnMap = {};
        (Object.keys(LINK_STATS_COLUMN_CANDIDATES) as LinkStatsColumnKey[]).forEach((key) => {
          const match = LINK_STATS_COLUMN_CANDIDATES[key].find((candidate) => knownColumns.has(candidate));
          if (match) resolved[key] = match;
        });
        return resolved;
      } catch (error) {
        console.warn('[downloads] unable to inspect links table columns', error);
        return {};
      }
    })();
  }
  return cachedLinkStatsColumns;
};

const updateLinkDownloadColumns = async (
  DB: D1Database,
  linkId: string,
  totals: DownloadTotals
) => {
  const columns = await getLinkStatsColumns(DB);
  const assignments: string[] = [];
  const values: number[] = [];

  const pushColumn = (key: LinkStatsColumnKey, value: number) => {
    const column = columns[key];
    if (!column) return;
    assignments.push(`${column}=?`);
    values.push(value);
  };

  pushColumn('todayApk', totals.todayApk);
  pushColumn('todayIpa', totals.todayIpa);
  pushColumn('todayTotal', totals.todayTotal);
  pushColumn('totalApk', totals.totalApk);
  pushColumn('totalIpa', totals.totalIpa);
  pushColumn('totalTotal', totals.totalTotal);

  if (!assignments.length) return;

  try {
    await DB.prepare(`UPDATE links SET ${assignments.join(', ')} WHERE id=?`)
      .bind(...values, linkId)
      .run();
  } catch (error) {
    console.warn('[downloads] unable to update link download totals', error);
  }
};

export type DownloadTotals = {
  todayApk: number;
  todayIpa: number;
  todayTotal: number;
  totalApk: number;
  totalIpa: number;
  totalTotal: number;
};

export async function ensureDownloadStatsTable(DB: D1Database, linkId?: string) {
  if (!linkId) return;
  const tableName = getStatsTableName(linkId);
  await ensureStatsTable(DB, tableName);
}

export async function deleteDownloadStatsForLink(DB: D1Database, linkId: string) {
  const tableName = getStatsTableName(linkId);
  if (!(await tableExists(DB, tableName))) {
    return;
  }
  await DB.prepare(`DROP TABLE IF EXISTS "${tableName}"`).run();
}

export async function recordDownload(
  DB: D1Database,
  linkId: string,
  platform: 'apk' | 'ipa',
  now: Date = new Date()
): Promise<DownloadTotals> {
  const tableName = getStatsTableName(linkId);
  await ensureStatsTable(DB, tableName);

  const today = formatDate(now);

  const insertRow = DB.prepare(
    `INSERT OR IGNORE INTO "${tableName}" (date, apk_dl, ipa_dl) VALUES (?, 0, 0)`
  ).bind(today);

  const updateColumn = platform === 'apk' ? 'apk_dl' : 'ipa_dl';
  const updateRow = DB.prepare(
    `UPDATE "${tableName}" SET ${updateColumn} = ${updateColumn} + 1 WHERE date=?`
  ).bind(today);

  await DB.batch([insertRow, updateRow]);

  const todayRow =
    (await DB.prepare(
      `SELECT apk_dl, ipa_dl FROM "${tableName}" WHERE date=?`
    )
      .bind(today)
      .first<{ apk_dl?: number | string | null; ipa_dl?: number | string | null }>()) ?? {
      apk_dl: 0,
      ipa_dl: 0,
    };

  const totals =
    (await DB.prepare(
      `SELECT SUM(apk_dl) AS apkSum, SUM(ipa_dl) AS ipaSum FROM "${tableName}"`
    ).first<{ apkSum?: number | string | null; ipaSum?: number | string | null }>()) ?? {};

  const todayApk = toNumber(todayRow.apk_dl);
  const todayIpa = toNumber(todayRow.ipa_dl);
  const totalApk = toNumber(totals.apkSum);
  const totalIpa = toNumber(totals.ipaSum);

  const totalsPayload: DownloadTotals = {
    todayApk,
    todayIpa,
    todayTotal: todayApk + todayIpa,
    totalApk,
    totalIpa,
    totalTotal: totalApk + totalIpa,
  };

  await updateLinkDownloadColumns(DB, linkId, totalsPayload);

  return totalsPayload;
}

export type DownloadStatsRow = {
  date: string;
  apk_dl: number | string | null;
  ipa_dl: number | string | null;
};

export async function fetchDownloadStatsRange(
  DB: D1Database,
  linkId: string,
  startDate: string,
  endDate: string
) {
  const tableName = getStatsTableName(linkId);
  if (!(await tableExists(DB, tableName))) {
    return [];
  }
  const result = await DB.prepare(
    `SELECT date, apk_dl, ipa_dl
     FROM "${tableName}"
     WHERE date BETWEEN ? AND ?
     ORDER BY date ASC`
  )
    .bind(startDate, endDate)
    .all<DownloadStatsRow>();
  return (result?.results as DownloadStatsRow[] | undefined) ?? [];
}
