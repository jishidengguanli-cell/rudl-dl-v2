// scripts/import-i18n.ts
//
// 用法：
//   tsx scripts/import-i18n.ts <path/to/file.csv|json> [--locale=zh-TW] [--skip-empty] [--dry]
//
// 支援：
//  1) CSV：第一欄必須是 key，其後每欄為語系（例如 zh-TW, zh-CN, en）
//     key,zh-TW,zh-CN,en
//     home.title,"首頁標題","首页标题","Home title"
//     ➜ 直接合併到 src/i18n/dictionary.ts（若 CSV 出現新語系，會自動加入）
//
//  2) JSON（多語）：{ "zh-TW": { "k":"v" }, "en": { ... } }  ➜ 直接合併
//  3) JSON（單語）：{ "k":"v" }  ➜ 需要 `--locale=xx` 指定語系
//
// 旗標：
//   --locale / --locale=xx   指定單語 JSON 的語系
//   --skip-empty             匯入時略過空字串（不會覆蓋現有值）
//   --dry                    僅顯示結果，不寫檔
//
// 產出：覆寫 src/i18n/dictionary.ts（保留 DEFAULT_LOCALE，鍵與語系排序）

import fs from 'node:fs';
import path from 'node:path';

// 讀現有字典與預設語系
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { dictionaries as currentDicts, DEFAULT_LOCALE as CURRENT_DEFAULT } from '../src/i18n/dictionary';

type Dicts = Record<string, Record<string, string>>;

/* ---------- 小工具：旗標解析（支援 --k=v 與 --k v） ---------- */
const args = process.argv.slice(2);
function readFlag(name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return undefined;
}
const localeFlag = readFlag('locale');
const skipEmpty = args.includes('--skip-empty');
const dry = args.includes('--dry');

/* ---------- 檢查輸入檔 ---------- */
const fileArg = args.find((a) => !a.startsWith('--'));
if (!fileArg) {
  console.error('Usage: tsx scripts/import-i18n.ts <path/to/file.csv|json> [--locale=zh-TW] [--skip-empty] [--dry]');
  process.exit(1);
}
const inFile = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(inFile)) {
  console.error(`❌ File not found: ${inFile}`);
  process.exit(1);
}

/* ---------- 讀檔 ---------- */
function readText(file: string) {
  let txt = fs.readFileSync(file, 'utf8');
  // 去除 UTF-8 BOM
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
  return txt;
}

/* ---------- CSV 解析（支援引號、跳脫、換行） ---------- */
type Row = string[];
type Table = Row[];
function parseCSV(text: string): Table {
  const rows: Table = [];
  let field = '';
  let row: Row = [];
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        // 忽略，等待 \n
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        field = '';
        row = [];
      } else {
        field += ch;
      }
    }
    i++;
  }
  row.push(field);
  rows.push(row);
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/* ---------- 將 CSV / JSON 轉成 { [locale]: { key: val } } ---------- */
function loadPatchFromCSV(text: string): Dicts {
  const table = parseCSV(text);
  if (table.length === 0) {
    throw new Error('CSV is empty.');
  }
  const header = table[0].map((h) => h.trim());
  if (!header.length || header[0].toLowerCase() !== 'key') {
    throw new Error('First column must be "key". Header example: key,zh-TW,zh-CN,en');
  }
  const locales = header.slice(1).filter(Boolean);
  if (!locales.length) {
    throw new Error('No locales found in header (after "key").');
  }
  const out: Dicts = {};
  for (const l of locales) out[l] = {};

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (!row || row.length === 0) continue;
    const key = (row[0] ?? '').trim();
    if (!key) continue;

    for (let c = 1; c < header.length; c++) {
      const locale = header[c];
      if (!locale) continue;
      const val = row[c] ?? '';
      if (skipEmpty && String(val).trim() === '') continue;
      if (!out[locale]) out[locale] = {};
      out[locale][key] = String(val);
    }
  }
  return out;
}

function loadPatchFromJSON(text: string): Dicts {
  let incoming: any;
  try {
    incoming = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON.');
  }

  // 多語
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    const maybeLocales = Object.keys(incoming);
    const looksMulti = maybeLocales.some((k) => typeof incoming[k] === 'object' && incoming[k] !== null && !Array.isArray(incoming[k]));
    if (looksMulti) {
      // { "zh-TW": { ... }, "en": { ... } }
      const out: Dicts = {};
      for (const l of maybeLocales) {
        if (!out[l]) out[l] = {};
        Object.assign(out[l], incoming[l]);
      }
      return out;
    }
  }

  // 單語需要 --locale
  if (!localeFlag) {
    throw new Error('Single-locale JSON requires --locale=<code>.');
  }
  return { [localeFlag]: incoming };
}

/* ---------- 讀入 Patch ---------- */
const ext = path.extname(inFile).toLowerCase();
const raw = readText(inFile);

let patchByLocale: Dicts;
if (ext === '.csv') {
  patchByLocale = loadPatchFromCSV(raw);
} else if (ext === '.json') {
  patchByLocale = loadPatchFromJSON(raw);
} else {
  console.error('❌ Unsupported file type, please provide .csv or .json');
  process.exit(1);
}

/* ---------- 合併到現有字典 ---------- */
const dicts: Dicts = JSON.parse(JSON.stringify(currentDicts)) as Dicts; // 深拷貝
const beforeLocales = new Set(Object.keys(dicts));

let updated = 0;
let addedLocales: string[] = [];

for (const [l, obj] of Object.entries(patchByLocale)) {
  if (!dicts[l]) {
    dicts[l] = {};
    if (!beforeLocales.has(l)) addedLocales.push(l);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (skipEmpty && (v === '' || v == null)) continue;
    if (dicts[l][k] !== v) {
      dicts[l][k] = v;
      updated++;
    }
  }
}

console.log(`🔧 Merged ${updated} entries${addedLocales.length ? `; added locales: ${addedLocales.join(', ')}` : ''}.`);

/* ---------- 輸出新的 dictionary.ts（排序 & 保留 DEFAULT_LOCALE） ---------- */
function emitDictionaryTS(dictsOut: Dicts, defaultLocale: string) {
  const locs = Object.keys(dictsOut).sort((a, b) => {
    // 讓 DEFAULT_LOCALE 排在最前
    if (a === defaultLocale && b !== defaultLocale) return -1;
    if (b === defaultLocale && a !== defaultLocale) return 1;
    return a.localeCompare(b);
  });

  const localeUnion = locs.map((l) => `'${l}'`).join(' | ');

  const sections = locs.map((l) => {
    const entries = Object.entries(dictsOut[l] || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `    '${k}': ${JSON.stringify(v)},`)
      .join('\n');
    return `  '${l}': {\n${entries}\n  }`;
  }).join(',\n');

  return `export type Locale = ${localeUnion};
export const DEFAULT_LOCALE: Locale = '${defaultLocale}';

type Dict = Record<string, string>;
export const dictionaries: Record<Locale, Dict> = {
${sections}
};
`;
}

const outTS = emitDictionaryTS(dicts, CURRENT_DEFAULT || Object.keys(dicts)[0]);
const outPath = path.resolve(process.cwd(), 'src/i18n/dictionary.ts');

if (dry) {
  console.log('\n🧪 --dry set, preview of src/i18n/dictionary.ts:\n');
  console.log(outTS);
  process.exit(0);
}

fs.writeFileSync(outPath, outTS, 'utf8');
console.log(`✅ Wrote merged dictionary to ${outPath}`);
