import BillPlaygroundClient from './BillPlaygroundClient';
import { dictionaries, DEFAULT_LOCALE, type Locale } from '@/i18n/dictionary';

export const runtime = 'edge';

type PageParams = { lang?: string };

const resolveLocale = (value?: string): Locale => {
  if (!value) return DEFAULT_LOCALE;
  return Object.hasOwn(dictionaries, value) ? (value as Locale) : DEFAULT_LOCALE;
};

export default async function BillPlaygroundPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { lang } = await params;
  const locale = resolveLocale(lang);
  const messages = dictionaries[locale];

  return <BillPlaygroundClient messages={messages} />;
}
