// scripts/import-i18n.ts
import fs from 'node:fs';
import path from 'node:path';

// 讀現有字典與預設語系
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { dictionaries as currentDicts, DEFAULT_LOCALE as CURRENT_DEFAULT } from '../src/i18n/dictionary';

type Dicts = Record<string, Record<string, string>>;
const dicts: Dicts = JSON.parse(JSON.stringify(currentDicts)) as Dicts; // 深拷貝，避免改動到 import 緩存
const locales = Object.keys(dicts);

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: tsx scripts/import-i18n.ts <path/to/file.json> [--locale=zh-TW] [--dry]');
  process.exit(1);
}

const fileArg = args.find((a) => !a.startsWith('--'));
const localeArg = args.find((a) => a.startsWith('--locale='));
const dry = args.includes('--dry');

if (!fileArg) {
  console.error('❌ Missing JSON file path.');
  process.exit(1);
}
const localeFromArg = localeArg ? localeArg.split('=')[1] : undefined;

const filePath = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(filePath)) {
  console.error(`❌ File not found: ${filePath}`);
  process.exit(1);
}

const incomingRaw = fs.readFileSync(filePath, 'utf8');
let incoming: any;
try {
  incoming = JSON.parse(incomingRaw);
} catch (e) {
  console.error('❌ Invalid JSON content.');
  process.exit(1);
}

// 判斷是多語或單語
const isMultiLocale = typeof incoming === 'object' && incoming && locales.some((l) => l in incoming);

if (!isMultiLocale && !localeFromArg) {
  console.error('❌ Single-locale JSON requires --locale=<code>. Known locales:', locales.join(', '));
  process.exit(1);
}

// 合併
let updatedKeys = 0;
if (isMultiLocale) {
  for (const l of locales) {
    const patch = incoming[l];
    if (patch && typeof patch === 'object') {
      for (const [k, v] of Object.entries<string>(patch)) {
        if (!dicts[l]) dicts[l] = {};
        if (dicts[l][k] !== v) {
          dicts[l][k] = v;
          updatedKeys++;
        }
      }
    }
  }
} else {
  const l = localeFromArg!;
  if (!locales.includes(l)) {
    console.error(`❌ Unknown locale "${l}". Known: ${locales.join(', ')}`);
    process.exit(1);
  }
  for (const [k, v] of Object.entries<string>(incoming)) {
    if (!dicts[l]) dicts[l] = {};
    if (dicts[l][k] !== v) {
      dicts[l][k] = v;
      updatedKeys++;
    }
  }
}

console.log(`🔧 Merged ${updatedKeys} entries into dictionaries.`);

// 產出新的 dictionary.ts（保持型別、預設語系；鍵依字母順序）
function emitDictionaryTS(dictsOut: Dicts, defaultLocale: string) {
  const locs = Object.keys(dictsOut);
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

const outTS = emitDictionaryTS(dicts, CURRENT_DEFAULT || locales[0]);

const outPath = path.resolve(process.cwd(), 'src/i18n/dictionary.ts');
if (dry) {
  console.log('🧪 --dry set, not writing file. Preview below:\n');
  console.log(outTS);
  process.exit(0);
}

fs.writeFileSync(outPath, outTS, 'utf8');
console.log(`✅ Wrote merged dictionary to ${outPath}`);
