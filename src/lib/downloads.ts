import type { D1Database } from '@cloudflare/workers-types';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatDate = (date: Date) => DATE_FORMATTER.format(date);

export const getStatsTableName = (linkId: string) =>
  `stats_${linkId.replace(/[^a-zA-Z0-9]/g, '_')}`;

export async function ensureDownloadStatsTable(DB: D1Database, linkId: string) {
  const tableName = getStatsTableName(linkId);
  await DB.exec(
    `CREATE TABLE IF NOT EXISTS "${tableName}" (date TEXT PRIMARY KEY, apk_dl INTEGER DEFAULT 0, ipa_dl INTEGER DEFAULT 0)`
  );
}

type TotalsRow = {
  apk_dl?: number;
  ipa_dl?: number;
  apkSum?: number;
  ipaSum?: number;
};

const toNumber = (value: unknown): number => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

export async function recordDownload(
  DB: D1Database,
  linkId: string,
  platform: 'apk' | 'ipa',
  now: Date = new Date()
) {
  const tableName = getStatsTableName(linkId);
  await ensureDownloadStatsTable(DB, linkId);

  const today = formatDate(now);

  const insertRow = DB.prepare(
    `INSERT OR IGNORE INTO "${tableName}" (date, apk_dl, ipa_dl) VALUES (?, 0, 0)`
  ).bind(today);

  const updateRow = DB.prepare(
    `UPDATE "${tableName}" SET ${platform === 'apk' ? 'apk_dl' : 'ipa_dl'} = ${
      platform === 'apk' ? 'apk_dl' : 'ipa_dl'
    } + 1 WHERE date=?`
  ).bind(today);

  await DB.batch([insertRow, updateRow]);

  const todayRow = (await DB.prepare(
    `SELECT apk_dl, ipa_dl FROM "${tableName}" WHERE date=?`
  )
    .bind(today)
    .first<TotalsRow>()) ?? { apk_dl: 0, ipa_dl: 0 };

  const totals =
    (await DB.prepare(
      `SELECT SUM(apk_dl) as apkSum, SUM(ipa_dl) as ipaSum FROM "${tableName}"`
    ).first<TotalsRow>()) ?? ({} as TotalsRow);

  const todayApk = toNumber(todayRow.apk_dl);
  const todayIpa = toNumber(todayRow.ipa_dl);
  const totalApk = toNumber(totals.apkSum);
  const totalIpa = toNumber(totals.ipaSum);

  await DB.prepare(
    `UPDATE links
     SET today_apk_dl=?, today_ipa_dl=?, today_total_dl=?,
         total_apk_dl=?, total_ipa_dl=?, total_total_dl=?
     WHERE id=?`
  )
    .bind(
      todayApk,
      todayIpa,
      todayApk + todayIpa,
      totalApk,
      totalIpa,
      totalApk + totalIpa,
      linkId
    )
    .run();
}
