import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { fetchMembers } from '@/lib/members';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

export default async function MembersPage() {
  const cookieStore = await cookies();
  const uid = cookieStore.get('uid')?.value;
  if (!uid) {
    const langCookie = cookieStore.get('lang')?.value as Locale | undefined;
    const cookieLocale = cookieStore.get('locale')?.value as Locale | undefined;
    const curLocale = langCookie && dictionaries[langCookie] ? langCookie : cookieLocale && dictionaries[cookieLocale] ? cookieLocale : DEFAULT_LOCALE;
    const localePrefix = `/${curLocale}`;
    const nextPath = `${localePrefix}/members`;
    const qs = new URLSearchParams({ next: nextPath, reason: 'auth' });
    redirect(`${localePrefix}/login?${qs.toString()}`);
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const langCookie = cookieStore.get('lang')?.value as Locale | undefined;
  const cookieLocale = cookieStore.get('locale')?.value as Locale | undefined;
  const locale = langCookie && dictionaries[langCookie] ? langCookie : cookieLocale && dictionaries[cookieLocale] ? cookieLocale : DEFAULT_LOCALE;
  const dict = dictionaries[locale];

  const members = await fetchMembers(DB);

  const formatDate = (value: number) => {
    if (!value) return '-';
    const date = new Date(value * 1000);
    const fallback = locale === 'zh-TW' ? 'zh-Hant' : locale;
    return date.toLocaleString(fallback);
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
