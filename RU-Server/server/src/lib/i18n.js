const translations = require('../../i18n/download.json');

const FALLBACK_LOCALE = 'en';
const supportedLocales = Object.keys(translations);

const tryNormalizeLocale = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace('_', '-');
  if (supportedLocales.includes(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  const caseInsensitiveMatch =
    supportedLocales.find((locale) => locale.toLowerCase() === lower) ?? null;
  if (caseInsensitiveMatch) return caseInsensitiveMatch;
  if (/^zh/i.test(lower)) {
    if (/tw|hk|mo|hant/i.test(normalized)) return 'zh-TW';
    return 'zh-CN';
  }
  if (/^en/i.test(lower)) return 'en';
  if (/^ru/i.test(lower)) return 'ru';
  if (/^vi/i.test(lower)) return 'vi';
  return null;
};

const pickLocale = (primary, acceptLanguage) => {
  const normalizedPrimary = tryNormalizeLocale(primary);
  if (normalizedPrimary) return normalizedPrimary;
  const header = (acceptLanguage ?? '').split(',');
  for (const entry of header) {
    const locale = tryNormalizeLocale(entry.split(';')[0]);
    if (locale) return locale;
  }
  return FALLBACK_LOCALE;
};

const translate = (locale, key) => {
  const source = translations[locale] ?? translations[FALLBACK_LOCALE] ?? {};
  const fallback = translations[FALLBACK_LOCALE] ?? {};
  return source[key] ?? fallback[key] ?? key;
};

module.exports = {
  translate,
  pickLocale,
  supportedLocales,
};
