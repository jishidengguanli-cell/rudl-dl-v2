import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, type Locale, dictionaries } from '@/i18n/dictionary';
import DashboardClient from './DashboardClient';
import { fetchDashboardPage } from '@/lib/dashboard';
import { requireVerifiedUser } from '@/lib/require-verified-user';

export const runtime = 'edge';

const PAGE_SIZE = 10;

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

export default async function Dashboard() {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get('locale')?.value as Locale | undefined;
  const resolvedLocale =
    localeCookie && dictionaries[localeCookie] ? localeCookie : DEFAULT_LOCALE;
  const localePrefix = `/${resolvedLocale}`;
  const loginParams = new URLSearchParams({ next: `${localePrefix}/dashboard`, reason: 'auth' });
  const loginUrl = `${localePrefix}/login?${loginParams.toString()}`;
  const uid = cookieStore.get('uid')?.value;
  if (!uid) {
    redirect(loginUrl);
  }

  const ctx = getRequestContext();
  const { env } = ctx;
  const request = (ctx as { request?: Request }).request;
  const requestUrl = request ? new URL(request.url) : null;
  const currentPath = requestUrl
    ? `${requestUrl.pathname}${requestUrl.search}`
    : `${localePrefix}/dashboard`;

  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  await requireVerifiedUser({
    DB,
    uid: uid!,
    locale: resolvedLocale,
    currentPath,
    loginRedirect: loginUrl,
  });

  const initialData = await fetchDashboardPage(DB, uid!, 1, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <DashboardClient initialData={initialData} initialLocale={resolvedLocale} />
    </div>
  );
}
