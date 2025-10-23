import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';

export const runtime = 'edge';

type PageParams = { lang: string };

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

const resolveLocale = (langParam: string | undefined, cookieLang: string | undefined, cookieLocale: string | undefined): Locale => {
  if (isLocale(langParam)) return langParam;
  if (isLocale(cookieLang)) return cookieLang;
  if (isLocale(cookieLocale)) return cookieLocale;
  return DEFAULT_LOCALE;
};

export default async function AdminOverview({ params }: { params: Promise<PageParams> }) {
  const { lang } = await params;
  const cookieStore = await cookies();
  const langCookie = cookieStore.get('lang')?.value;
  const localeCookie = cookieStore.get('locale')?.value;
  const locale = resolveLocale(lang, langCookie, localeCookie);
  const dict = dictionaries[locale];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">{dict['admin.overviewTitle'] ?? 'Admin dashboard'}</h2>
        <p className="mt-2 text-sm text-gray-600">{dict['admin.overviewLead'] ?? ''}</p>
      </div>
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{dict['admin.quickLinks'] ?? 'Quick links'}</h3>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-sm text-blue-600">
          <li>
            <a className="underline" href={`/${locale}/admin/members`}>
              {dict['admin.membersLink'] ?? 'View members'}
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
