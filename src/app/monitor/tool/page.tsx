import { cookies } from 'next/headers';
import { getRequestContext } from '@cloudflare/next-on-pages';
import MonitorToolsClient from './MonitorToolsClient';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { getTranslator } from '@/i18n/helpers';
import { fetchTelegramSettings } from '@/lib/monitor';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

export default async function MonitorToolsPage() {
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
        {t('monitor.tools.unauthenticated')}
      </div>
    );
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const settings = await fetchTelegramSettings(DB, uid);
  const hasBotToken = Boolean(settings.telegramBotToken?.trim().length);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{t('monitor.tools.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('monitor.tools.description')}</p>
      </div>
      <MonitorToolsClient hasBotToken={hasBotToken} />
    </section>
  );
}
