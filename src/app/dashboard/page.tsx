import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, type Locale, dictionaries } from '@/i18n/dictionary';
import DashboardClient from './DashboardClient';
import { fetchDashboardPage } from '@/lib/dashboard';

export const runtime = 'edge';

const PAGE_SIZE = 10;

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

export default async function Dashboard() {
  const cookieStore = await cookies();
  const uid = cookieStore.get('uid')?.value;
  if (!uid) {
    const c = cookieStore.get('locale')?.value as Locale | undefined;
    const curLocale = c && dictionaries[c] ? c : DEFAULT_LOCALE;
    const localePrefix = `/${curLocale}`;
    const nextPath = `${localePrefix}/dashboard`;
    const qs = new URLSearchParams({ next: nextPath, reason: 'auth' });
    redirect(`${localePrefix}/login?${qs.toString()}`);
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const cookieLocale = cookieStore.get('locale')?.value as Locale | undefined;
  const curLocale = cookieLocale && dictionaries[cookieLocale] ? cookieLocale : DEFAULT_LOCALE;

  const initialData = await fetchDashboardPage(DB, uid!, 1, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <DashboardClient initialData={initialData} initialLocale={curLocale} />
    </div>
  );
}
