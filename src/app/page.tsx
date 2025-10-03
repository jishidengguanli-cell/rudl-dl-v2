import { getRequestContext } from '@cloudflare/next-on-pages';
import { cookies } from 'next/headers';
import { getT } from '@/i18n/provider';
import { DEFAULT_LOCALE, type Locale, dictionaries } from '@/i18n/dictionary';

export const runtime = 'edge';

export default async function Page() {
  // 取得當前語系（cookie 沒有就預設）
  const c = cookies().get('locale')?.value as Locale | undefined;
  const cur = c && dictionaries[c] ? c : DEFAULT_LOCALE;
  const t = getT(cur);

  // 簡單 ping D1：取 links 計數（失敗就忽略）
  let linksCount: number | null = null;
  try {
    const { env } = getRequestContext();
    const r = await env.DB.prepare('SELECT COUNT(1) as c FROM links').first<{ c: number }>();
    linksCount = Number(r?.c ?? 0);
  } catch {
    linksCount = null;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-lg font-medium">{t('env.check')}</h2>
        <ul className="list-disc pl-6 text-sm">
          <li>{t('env.nextReact')}</li>
          <li>{t('env.adapter')}</li>
          <li>
            {t('env.d1Binding')}
            <code>DB</code>（rudl-app）
          </li>
          <li>
            {t('env.r2Cdn')}
            <code>https://cdn.dataruapp.com/</code>
          </li>
          <li>
            {t('env.linksCount')}
            {linksCount ?? <span className="text-red-600">{t('status.unreadable')}</span>}
          </li>
        </ul>
      </div>
      <p className="text-sm text-gray-600">{t('home.desc')}</p>
    </div>
  );
}
