import { getRequestContext } from '@cloudflare/next-on-pages';
import { cookies } from 'next/headers';
import { getT } from '@/i18n/provider';
import { DEFAULT_LOCALE, type Locale, dictionaries } from '@/i18n/dictionary';

export const runtime = 'edge';

type LinkRow = {
  id: string;
  code: string;
  title: string | null;
  is_active: number;
  platform: string | null;
  created_at: number | null;
};

export default async function Dashboard() {
  const cookieStore = await cookies();
  const c = cookieStore.get('locale')?.value as Locale | undefined;
  const cur = c && dictionaries[c] ? c : DEFAULT_LOCALE;
  const t = getT(cur);

  const { env } = getRequestContext();
  const rows = await env.DB.prepare(
    `SELECT id, code, title, is_active, platform, created_at
     FROM links ORDER BY created_at DESC LIMIT 50`
  )
    .all<LinkRow>()
    .then((r) => r.results ?? []);

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 text-lg font-medium">{t('dashboard.title')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">{t('table.code')}</th>
              <th className="py-2 pr-4">{t('table.title')}</th>
              <th className="py-2 pr-4">{t('table.platform')}</th>
              <th className="py-2 pr-4">{t('table.active')}</th>
              <th className="py-2 pr-4">{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-none">
                <td className="py-2 pr-4 font-mono">{r.code}</td>
                <td className="py-2 pr-4">{r.title ?? '-'}</td>
                <td className="py-2 pr-4">{r.platform ?? '-'}</td>
                <td className="py-2 pr-4">{r.is_active ? 'YES' : 'NO'}</td>
                <td className="py-2 pr-4">
                  <a
                    className="text-blue-600 underline"
                    href={`/dl/${r.code}`}
                    target="_blank"
                  >
                    {t('action.download')}
                  </a>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="py-4 text-gray-500" colSpan={5}>
                  {t('status.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
