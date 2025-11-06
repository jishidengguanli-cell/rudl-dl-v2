import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import MonitorNav from '@/components/MonitorNav';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { getTranslator } from '@/i18n/helpers';

export const runtime = 'edge';

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

export default async function MonitorLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const uid = cookieStore.get('uid')?.value ?? null;
  const langCookie = cookieStore.get('lang')?.value as Locale | undefined;
  const localeCookie = cookieStore.get('locale')?.value as Locale | undefined;
  const locale = isLocale(langCookie)
    ? langCookie
    : isLocale(localeCookie)
    ? localeCookie
    : DEFAULT_LOCALE;
  const localePrefix = `/${locale}`;

  if (!uid) {
    const params = new URLSearchParams({ next: `${localePrefix}/monitor`, reason: 'auth' });
    redirect(`${localePrefix}/login?${params.toString()}`);
  }

  const t = getTranslator(locale);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('monitor.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('monitor.subtitle')}</p>
      </div>
      <MonitorNav />
      <div>{children}</div>
    </div>
  );
}

