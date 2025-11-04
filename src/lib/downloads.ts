import type { D1Database } from '@cloudflare/workers-types';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatDate = (date: Date) => DATE_FORMATTER.format(date);

const DOWNLOAD_STATS_TABLE = 'link_download_stats';
const LEGACY_STATS_PREFIX = 'stats_';

const sanitizeLinkId = (linkId: string) => linkId.replace(/[^a-zA-Z0-9]/g, '_');

const getLegacyStatsTableName = (linkId: string) =>
  `${LEGACY_STATS_PREFIX}${sanitizeLinkId(linkId)}`;

let statsTableEnsured = false;

const ensureBaseTable = async (DB: D1Database) => {
  if (statsTableEnsured) return;
  await DB.exec(
    `CREATE TABLE IF NOT EXISTS ${DOWNLOAD_STATS_TABLE} (
      link_id TEXT NOT NULL,
      date TEXT NOT NULL,
      apk_dl INTEGER NOT NULL DEFAULT 0,
      ipa_dl INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (link_id, date),
      FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
    )`
  );
  await DB.exec(
    `CREATE INDEX IF NOT EXISTS idx_${DOWNLOAD_STATS_TABLE}_link_date
      ON ${DOWNLOAD_STATS_TABLE} (link_id, date)`
  );
  statsTableEnsured = true;
};

const migrateLegacyStatsTable = async (DB: D1Database, linkId: string) => {
  const legacyTable = getLegacyStatsTableName(linkId);
  const legacyExists = await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
  )
    .bind(legacyTable)
    .first<{ name?: string }>();

  if (!legacyExists?.name) return;

  await ensureBaseTable(DB);

  await DB.prepare(
    `INSERT INTO ${DOWNLOAD_STATS_TABLE} (link_id, date, apk_dl, ipa_dl)
     SELECT ?, date, apk_dl, ipa_dl FROM "${legacyTable}"
     ON CONFLICT(link_id, date) DO UPDATE SET
       apk_dl = link_download_stats.apk_dl + excluded.apk_dl,
       ipa_dl = link_download_stats.ipa_dl + excluded.ipa_dl`
  )
    .bind(linkId)
    .run();

  await DB.exec(`DROP TABLE IF EXISTS "${legacyTable}"`);
};

export async function ensureDownloadStatsTable(DB: D1Database, linkId?: string) {
  await ensureBaseTable(DB);
  if (linkId) {
    await migrateLegacyStatsTable(DB, linkId);
  }
}

export async function deleteDownloadStatsForLink(DB: D1Database, linkId: string) {
  await ensureBaseTable(DB);
  await DB.prepare(
    `DELETE FROM ${DOWNLOAD_STATS_TABLE} WHERE link_id=?`
  )
    .bind(linkId)
    .run();
}

export async function recordDownload(
  DB: D1Database,
  linkId: string,
  platform: 'apk' | 'ipa',
  now: Date = new Date()
) {
  await ensureDownloadStatsTable(DB, linkId);

  const today = formatDate(now);
  const apkDelta = platform === 'apk' ? 1 : 0;
  const ipaDelta = platform === 'ipa' ? 1 : 0;

  await DB.prepare(
    `INSERT INTO ${DOWNLOAD_STATS_TABLE} (link_id, date, apk_dl, ipa_dl)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(link_id, date) DO UPDATE SET
       apk_dl = link_download_stats.apk_dl + excluded.apk_dl,
       ipa_dl = link_download_stats.ipa_dl + excluded.ipa_dl`
  )
    .bind(linkId, today, apkDelta, ipaDelta)
    .run();
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
  await ensureDownloadStatsTable(DB, linkId);
  const result = await DB.prepare(
    `SELECT date, apk_dl, ipa_dl
     FROM ${DOWNLOAD_STATS_TABLE}
     WHERE link_id=? AND date BETWEEN ? AND ?
     ORDER BY date ASC`
  )
    .bind(linkId, startDate, endDate)
    .all<DownloadStatsRow>();
  return (result?.results as DownloadStatsRow[] | undefined) ?? [];
}
