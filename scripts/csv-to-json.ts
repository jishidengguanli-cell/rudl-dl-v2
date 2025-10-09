// scripts/csv-to-json.ts
// 用法：
//   tsx scripts/csv-to-json.ts i18n_export.csv [--out=translated.json] [--single=en] [--skip-empty] [--dry]
//
// 輸入 CSV 格式：第一欄必須是 key，其後每欄為語系（例如 zh-TW, zh-CN, en）
// key,zh-TW,zh-CN,en
// home.title,"首頁標題","首页标题","Home title"

import fs from 'node:fs';
import path from 'node:path';

type Row = string[];
type Table = Row[];

// ---- 小工具：讀檔／寫檔／CSV 解析 ----
function readText(file: string) {
  let txt = fs.readFileSync(file, 'utf8');
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1); // 去 BOM
  return txt;
}

// 支援雙引號、逗號、換行、雙引號跳脫（"" => "）
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
        // ignore, wait for \n
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
  // 最後一格
  row.push(field);
  rows.push(row);

  // 去除檔尾完全空白列
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// ---- CLI 參數 ----
const args = process.argv.slice(2);
if (args.length < 1 || args[0].startsWith('--')) {
  console.error('Usage: tsx scripts/csv-to-json.ts <path/to/file.csv> [--out=translated.json] [--single=<locale>] [--skip-empty] [--dry]');
  process.exit(1);
}
const inFile = path.resolve(process.cwd(), args[0]);
const outArg = args.find((a) => a.startsWith('--out='))?.split('=')[1];
const singleLocale = args.find((a) => a.startsWith('--single='))?.split('=')[1];
const skipEmpty = args.includes('--skip-empty');
const dry = args.includes('--dry');

if (!fs.existsSync(inFile)) {
  console.error(`❌ CSV not found: ${inFile}`);
  process.exit(1);
}

// ---- 讀 CSV ----
const csv = readText(inFile);
const table = parseCSV(csv);
if (table.length === 0) {
  console.error('❌ CSV is empty.');
  process.exit(1);
}

const header = table[0].map((h) => h.trim());
if (!header.length || header[0].toLowerCase() !== 'key') {
  console.error('❌ First column must be "key". Header example: key,zh-TW,zh-CN,en');
  process.exit(1);
}
const locales = header.slice(1).filter(Boolean);
if (locales.length === 0) {
  console.error('❌ No locales found in header. Example: key,zh-TW,zh-CN,en');
  process.exit(1);
}

// ---- 建立資料結構 ----
const multi: Record<string, Record<string, string>> = {};
for (const l of locales) multi[l] = {};

for (let r = 1; r < table.length; r++) {
  const row = table[r];
  if (!row || row.length === 0) continue;

  const key = (row[0] ?? '').trim();
  if (!key) continue;

  for (let c = 1; c < header.length; c++) {
    const locale = header[c];
    if (!locale) continue;
    const val = (row[c] ?? '');
    if (skipEmpty && val.trim() === '') continue; // 跳過空值
    multi[locale][key] = val;
  }
}

// ---- 單語輸出 or 多語輸出 ----
let outObj: any;
let outPath: string;

if (singleLocale) {
  if (!locales.includes(singleLocale)) {
    console.error(`❌ Unknown locale "${singleLocale}". CSV locales: ${locales.join(', ')}`);
    process.exit(1);
  }
  outObj = multi[singleLocale] || {};
  const base = path.basename(inFile, path.extname(inFile));
  outPath = path.resolve(process.cwd(), outArg || `${base}.${singleLocale}.json`);
} else {
  outObj = multi;
  const base = path.basename(inFile, path.extname(inFile));
  outPath = path.resolve(process.cwd(), outArg || `${base}.json`);
}

const json = JSON.stringify(outObj, null, 2) + '\n';

if (dry) {
  console.log(json);
} else {
  fs.writeFileSync(outPath, json, 'utf8');
  console.log(`✅ Wrote ${singleLocale ? 'single-locale' : 'multi-locale'} JSON -> ${outPath}`);
  console.log(`   Locales: ${singleLocale ? singleLocale : locales.join(', ')}`);
  if (skipEmpty) console.log('   (empty cells were skipped)');
}
