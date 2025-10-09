// scripts/export-i18n.ts
import fs from 'node:fs';
import path from 'node:path';

// 直接讀 TS 模組：用 tsx 執行本腳本即可
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { dictionaries } from '../src/i18n/dictionary';

type Dicts = Record<string, Record<string, string>>;
const dicts: Dicts = dictionaries as Dicts;

const locales = Object.keys(dicts);
if (locales.length === 0) {
  console.error('No locales found in dictionaries.');
  process.exit(1);
}

// 蒐集所有 key（各語系聯集）
const keySet = new Set<string>();
for (const l of locales) {
  Object.keys(dicts[l] || {}).forEach((k) => keySet.add(k));
}
const keys = Array.from(keySet).sort((a, b) => a.localeCompare(b));

// 產 CSV（加 BOM 讓 Excel 直接辨識 UTF-8）
const header = ['key', ...locales].join(',');
const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;

const rows = [header, ...keys.map((k) => {
  const cols = [k, ...locales.map((l) => dicts[l]?.[k] ?? '')];
  return cols.map(escape).join(',');
})];

const out = '\uFEFF' + rows.join('\n');

const outPath = path.resolve(process.cwd(), 'i18n_export.csv');
fs.writeFileSync(outPath, out, 'utf8');

console.log(`✅ Exported ${keys.length} keys for locales [${locales.join(', ')}] -> ${outPath}`);
