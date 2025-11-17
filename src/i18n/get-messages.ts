import { DEFAULT_LOCALE, dictionaries, type Locale } from './dictionary';

export type Messages = Record<string, string>;

export async function getMessages(locale: Locale): Promise<Messages> {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}

