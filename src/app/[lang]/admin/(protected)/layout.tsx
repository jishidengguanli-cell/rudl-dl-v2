import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { fetchAdminUser } from '@/lib/admin';
import { requireVerifiedUser } from '@/lib/require-verified-user';

export const runtime = 'edge';

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ lang: string }>;
};

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

export default async function AdminProtectedLayout({ children, params }: LayoutProps) {
  const { lang } = await params;
  const cookieStore = await cookies();
  const cookieLang = cookieStore.get('lang')?.value;
  const cookieLocale = cookieStore.get('locale')?.value;
  const locale = resolveLocale(lang, cookieLang, cookieLocale);
  const dict = dictionaries[locale];

  const basePath = `/${locale}/admin`;

  const ctx = getRequestContext();
  const bindings = (ctx.env ?? {}) as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  const request = (ctx as { request?: Request }).request;
  const requestUrl = request ? new URL(request.url) : null;
  const currentPath = requestUrl ? `${requestUrl.pathname}${requestUrl.search}` : basePath;
  const rawUid = cookieStore.get('uid')?.value ?? null;

  const loginUrl = `/${locale}/admin/login?next=${encodeURIComponent(currentPath)}`;
  if (!rawUid) {
    redirect(loginUrl);
  }
  const uid = rawUid;

  await requireVerifiedUser({
    DB,
    uid,
    locale,
    currentPath,
    loginRedirect: loginUrl,
  });

  const adminUser = await fetchAdminUser(DB, uid);
  if (!adminUser) {
    redirect(loginUrl);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{dict['admin.overviewTitle'] ?? 'Admin'}</h1>
          <p className="mt-1 text-sm text-gray-600">{dict['admin.overviewDescription'] ?? ''}</p>
        </div>
        <nav className="flex items-center gap-3 text-sm text-gray-700">
          <Link className="underline" href={basePath}>
            {dict['admin.nav.overview'] ?? 'Overview'}
          </Link>
          <Link className="underline" href={`${basePath}/members`}>
            {dict['admin.nav.members'] ?? 'Members'}
          </Link>
          <Link className="underline" href={`${basePath}/orders`}>
            {dict['admin.nav.orders'] ?? 'Orders'}
          </Link>
          <Link className="underline" href={`${basePath}/links`}>
            {dict['admin.nav.links'] ?? 'Distributions'}
          </Link>
        </nav>
      </div>
      <div>{children}</div>
    </div>
  );
}
