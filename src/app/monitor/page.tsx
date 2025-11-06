import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { getTranslator } from '@/i18n/helpers';

export const runtime = 'edge';

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

export default async function MonitorOverviewPage() {
  const cookieStore = await cookies();
  const langCookie = cookieStore.get('lang')?.value as Locale | undefined;
  const localeCookie = cookieStore.get('locale')?.value as Locale | undefined;
  const locale = isLocale(langCookie)
    ? langCookie
    : isLocale(localeCookie)
    ? localeCookie
    : DEFAULT_LOCALE;
  const t = getTranslator(locale);

  return (
    <section className="rounded-lg border border-dashed border-gray-300 bg-white/60 p-6 text-sm text-gray-700">
      <h2 className="text-base font-semibold text-gray-900">{t('monitor.overview.title')}</h2>
      <p className="mt-2 max-w-2xl text-gray-600">{t('monitor.overview.description')}</p>
    </section>
  );
}

