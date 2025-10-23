import { cookies } from 'next/headers';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { fetchMembers } from '@/lib/members';

export const runtime = 'edge';

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

export default async function AdminMembers({ params }: { params: Promise<Params> }) {
  const { lang } = await params;
  const cookieStore = await cookies();
  const langCookie = cookieStore.get('lang')?.value;
  const localeCookie = cookieStore.get('locale')?.value;
  const locale = resolveLocale(lang, langCookie, localeCookie);
  const dict = dictionaries[locale];

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const members = await fetchMembers(DB);

  const formatDate = (value: number) => {
    if (!value) return '-';
    const date = new Date(value * 1000);
    const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
    return date.toLocaleString(localeHint);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{dict['members.title'] ?? 'Members'}</h1>
        {members.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">{dict['members.empty'] ?? 'No members found.'}</p>
        ) : null}
      </div>

      {members.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{dict['members.table.id']}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{dict['members.table.email']}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{dict['members.table.role']}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{dict['members.table.balance']}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{dict['members.table.createdAt']}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{member.id}</td>
                  <td className="px-3 py-2 text-gray-900">{member.email ?? '-'}</td>
                  <td className="px-3 py-2 text-gray-700">{member.role ?? '-'}</td>
                  <td className="px-3 py-2 text-gray-900">{typeof member.balance === 'number' ? member.balance : '-'}</td>
                  <td className="px-3 py-2 text-gray-700">{formatDate(member.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
