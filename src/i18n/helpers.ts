import { DEFAULT_LOCALE, dictionaries, type Locale } from './dictionary';

export const isLocale = (value: string | undefined): value is Locale =>
  !!value && value in dictionaries;

export const resolveLocale = (value: string | undefined): Locale =>
  (isLocale(value) ? value : DEFAULT_LOCALE);

export const createTranslator = (locale: Locale) => {
  const dict = dictionaries[locale] ?? {};
  return (key: string) => dict[key] ?? key;
};

export const getTranslator = (value: string | undefined) =>
  createTranslator(resolveLocale(value));
