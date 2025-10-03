export const locales = ['zh-TW', 'en'] as const;
export type Locale = typeof locales[number];
export const defaultLocale: Locale = 'zh-TW';

export const localeNames: Record<Locale, string> = {
  'zh-TW': '繁體中文',
  en: 'English',
};
