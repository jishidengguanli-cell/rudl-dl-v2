import { languageCodes, type LangCode } from '@/lib/language';
import { DEFAULT_LOCALE } from './dictionary';

export const locales = languageCodes;
export type Locale = LangCode;
export const defaultLocale: Locale = DEFAULT_LOCALE;

export const localeNames: Record<Locale, string> = {
  en: 'English',
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  ru: 'Русский',
  vi: 'Tiếng Việt',
};
