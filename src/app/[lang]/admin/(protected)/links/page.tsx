import { cookies } from 'next/headers';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import DashboardClient from '@/app/dashboard/DashboardClient';
import { fetchAdminLinksPage } from '@/lib/dashboard';

export const runtime = 'edge';

const PAGE_SIZE = 10;

type Params = { lang: string };

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

const resolveLocale = (langParam: string | undefined, cookieLang: string | undefined, cookieLocale: string | undefined): Locale => {
  if (isLocale(langParam)) return langParam;
  if (isLocale(cookieLang)) return cookieLang;
  if (isLocale(cookieLocale)) return cookieLocale;
  return DEFAULT_LOCALE;
};

export default async function AdminLinksPage({ params }: { params: Promise<Params> }) {
  const { lang } = await params;
  const cookieStore = await cookies();
  const cookieLang = cookieStore.get('lang')?.value;
  const cookieLocale = cookieStore.get('locale')?.value;
  const locale = resolveLocale(lang, cookieLang, cookieLocale);

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const initialData = await fetchAdminLinksPage(DB, 1, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <DashboardClient
        initialData={initialData}
        initialLocale={locale}
        fetchUrl="/api/admin/links"
        allowManage={false}
        showBalance={false}
      />
    </div>
  );
}
