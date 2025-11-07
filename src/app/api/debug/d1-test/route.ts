import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { ensureDownloadStatsTable } from '@/lib/downloads';
import { normalizeLanguageCode } from '@/lib/language';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type TableInfo = {
  columns: Set<string>;
  types: Record<string, string>;
};

const hasColumn = (info: TableInfo, column: string) => info.columns.has(column);
const isTextColumn = (info: TableInfo, column: string) => {
  const type = info.types[column]?.toUpperCase() ?? '';
  return type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT');
};

async function getTableInfo(DB: D1Database, table: 'links' | 'files'): Promise<TableInfo> {
  const result = await DB.prepare(`PRAGMA table_info(${table})`).all<{ name?: string; type?: string }>();
  const columns = new Set<string>();
  const types: Record<string, string> = {};
  const rows = (result.results as Array<{ name?: string; type?: string }> | undefined) ?? [];
  for (const row of rows) {
    if (!row?.name) continue;
    columns.add(row.name);
    if (row.type) {
      types[row.name] = row.type;
    }
  }
  return { columns, types };
}

export async function GET() {
  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    return NextResponse.json({ ok: false, error: 'D1 binding DB is missing' }, { status: 500 });
  }

  const logs: Array<{ step: string; detail?: unknown }> = [];
  const log = (step: string, detail?: unknown) => logs.push({ step, detail });

  const linkId = crypto.randomUUID();
  const code = `debug-${Math.random().toString(36).slice(2, 10)}`;
  const nowEpoch = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();
  const language = normalizeLanguageCode('en');

  try {
    log('setup', { linkId, code, language });
    const linksInfo = await getTableInfo(DB, 'links');
    const filesInfo = await getTableInfo(DB, 'files');
    log('table-info', {
      links: Array.from(linksInfo.columns),
      files: Array.from(filesInfo.columns),
    });

    const linkColumnPairs: Array<[string, unknown]> = [
      ['id', linkId],
      ['code', code],
      ['owner_id', 'debug-user'],
      ['title', 'Debug Link'],
      ['bundle_id', 'com.example.debug'],
      ['apk_version', '1.0.0'],
      ['ipa_version', '1.0.0'],
      ['platform', 'apk,ipa'],
      ['lang', language],
      ['today_apk_dl', 0],
      ['today_ipa_dl', 0],
      ['today_total_dl', 0],
      ['total_apk_dl', 0],
      ['total_ipa_dl', 0],
      ['total_total_dl', 0],
    ];
    if (hasColumn(linksInfo, 'created_at')) {
      linkColumnPairs.push([
        'created_at',
        isTextColumn(linksInfo, 'created_at') ? nowIso : nowEpoch,
      ]);
    }
    if (hasColumn(linksInfo, 'is_active')) {
      linkColumnPairs.push([
        'is_active',
        isTextColumn(linksInfo, 'is_active') ? '1' : 1,
      ]);
    }

    const linkColumns = linkColumnPairs.filter(([column]) => hasColumn(linksInfo, column)).map(([column]) => column);
    const linkValues = linkColumnPairs.filter(([column]) => hasColumn(linksInfo, column)).map(([, value]) => value);
    if (!linkColumns.length) {
      throw new Error('LINK_TABLE_UNSUPPORTED');
    }
    const linkPlaceholders = linkColumns.map(() => '?').join(', ');
    const linkResult = await DB.prepare(`INSERT INTO links (${linkColumns.join(', ')}) VALUES (${linkPlaceholders})`)
      .bind(...linkValues)
      .run();
    log('insert-link', linkResult.meta ?? null);

    const samplePlatforms: Array<'apk' | 'ipa'> = ['apk', 'ipa'];
    for (const platform of samplePlatforms) {
      const fileId = crypto.randomUUID();
      const filePairs: Array<[string, unknown]> = [
        ['id', fileId],
        ['owner_id', 'debug-user'],
        ['platform', platform],
        ['version', '1.0.0'],
        ['size', 123456],
        ['title', `Debug File ${platform.toUpperCase()}`],
        ['bundle_id', 'com.example.debug'],
        ['link_id', linkId],
      ];
      if (hasColumn(filesInfo, 'created_at')) {
        filePairs.push([
          'created_at',
          isTextColumn(filesInfo, 'created_at') ? nowIso : nowEpoch,
        ]);
      }
      if (hasColumn(filesInfo, 'r2_key')) {
        filePairs.push(['r2_key', `${linkId}/${platform}/debug.bin`]);
      }
      if (hasColumn(filesInfo, 'content_type')) {
        filePairs.push(['content_type', 'application/octet-stream']);
      }
      if (hasColumn(filesInfo, 'sha256')) {
        filePairs.push(['sha256', 'debug']);
      }

      const fileColumns = filePairs.filter(([column]) => hasColumn(filesInfo, column)).map(([column]) => column);
      const fileValues = filePairs.filter(([column]) => hasColumn(filesInfo, column)).map(([, value]) => value);
      if (!fileColumns.length) throw new Error('FILE_TABLE_UNSUPPORTED');
      const placeholders = fileColumns.map(() => '?').join(', ');
      const fileResult = await DB.prepare(
        `INSERT INTO files (${fileColumns.join(', ')}) VALUES (${placeholders})`
      )
        .bind(...fileValues)
        .run();
      log(`insert-file-${platform}`, fileResult.meta ?? null);
    }

    await ensureDownloadStatsTable(DB, linkId);
    log('ensure-download-stats', { linkId });

    return NextResponse.json({ ok: true, logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', message);
    return NextResponse.json({ ok: false, logs, error: message }, { status: 500 });
  } finally {
    await DB.prepare('DELETE FROM files WHERE link_id=?')
      .bind(linkId)
      .run()
      .catch(() => null);
    await DB.prepare('DELETE FROM links WHERE id=?')
      .bind(linkId)
      .run()
      .catch(() => null);
  }
}

