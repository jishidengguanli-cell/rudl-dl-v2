export const SUPPORTED_LANG_CODES = ['en', 'zh-TW', 'zh-CN', 'ru', 'vi'] as const;

export type LangCode = (typeof SUPPORTED_LANG_CODES)[number];

export const LANGUAGE_CODE_SET = new Set<LangCode>(SUPPORTED_LANG_CODES);

const LANGUAGE_ALIAS_MAP: Record<string, LangCode> = {
  en: 'en',
  english: 'en',
  'en-us': 'en',
  'en_gb': 'en',
  'en-gb': 'en',
  zh: 'zh-TW',
  'zh-tw': 'zh-TW',
  'zh_tw': 'zh-TW',
  'zh-hant': 'zh-TW',
  'zh_hant': 'zh-TW',
  'traditional chinese': 'zh-TW',
  'traditional-chinese': 'zh-TW',
  '繁體中文': 'zh-TW',
  '繁中': 'zh-TW',
  '繁體': 'zh-TW',
  cn: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh_cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh_hans': 'zh-CN',
  'simplified chinese': 'zh-CN',
  'simplified-chinese': 'zh-CN',
  '简体中文': 'zh-CN',
  '簡中': 'zh-CN',
  '简体': 'zh-CN',
  ru: 'ru',
  russian: 'ru',
  'русский': 'ru',
  vi: 'vi',
  vietnamese: 'vi',
  viet: 'vi',
  'tiếng việt': 'vi',
  'tieng viet': 'vi',
};

export const tryNormalizeLanguageCode = (value: unknown): LangCode | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (LANGUAGE_CODE_SET.has(trimmed as LangCode)) return trimmed as LangCode;

  const lower = trimmed.toLowerCase();
  const direct = LANGUAGE_ALIAS_MAP[lower];
  if (direct) return direct;

  if (lower.startsWith('zh')) {
    if (lower.includes('tw') || lower.includes('hant')) return 'zh-TW';
    return 'zh-CN';
  }
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('ru')) return 'ru';
  if (lower.startsWith('vi')) return 'vi';
  return null;
};

export const normalizeLanguageCode = (value: unknown, fallback: LangCode = 'en'): LangCode =>
  tryNormalizeLanguageCode(value) ?? fallback;

export const isLanguageCode = (value: string): value is LangCode =>
  LANGUAGE_CODE_SET.has(value as LangCode);

export const languageCodes = [...SUPPORTED_LANG_CODES] as readonly LangCode[];
