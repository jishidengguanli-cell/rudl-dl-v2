import { cookies } from 'next/headers';
import { getRequestContext } from '@cloudflare/next-on-pages';
import MonitorAnalyticsClient from './MonitorAnalyticsClient';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { getTranslator } from '@/i18n/helpers';
import { fetchDistributionSummariesByOwner } from '@/lib/distribution';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type MonitorLink = {
  id: string;
  code: string;
  title: string | null;
  networkArea: string;
};

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

export default async function MonitorAnalyticsPage() {
  const cookieStore = await cookies();
  const uid = cookieStore.get('uid')?.value ?? null;
  const langCookie = cookieStore.get('lang')?.value as Locale | undefined;
  const localeCookie = cookieStore.get('locale')?.value as Locale | undefined;
  const locale = isLocale(langCookie)
    ? langCookie
    : isLocale(localeCookie)
    ? localeCookie
    : DEFAULT_LOCALE;
  const t = getTranslator(locale);

  if (!uid) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {t('monitor.analytics.unauthenticated')}
      </div>
    );
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const links = await fetchDistributionSummariesByOwner(DB, uid);
  const clientLinks: MonitorLink[] = links.map((link) => ({
    id: link.id,
    code: link.code,
    title: link.title,
    networkArea: link.networkArea,
  }));

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t('monitor.analytics.title')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('monitor.analytics.subtitle')}</p>
        </div>
      </div>
      <MonitorAnalyticsClient links={clientLinks} />
    </section>
  );
}
