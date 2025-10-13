import { cookies } from 'next/headers';
import { getT } from '@/i18n/provider';
import { DEFAULT_LOCALE, type Locale, dictionaries } from '@/i18n/dictionary';

export const runtime = 'edge';

export default async function Page() {
  const cookieStore = await cookies();
  const c = cookieStore.get('locale')?.value as Locale | undefined;
  const cur = c && dictionaries[c] ? c : DEFAULT_LOCALE;
  const t = getT(cur);
  const linksCount = null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('home.desc')}</p>
      </div>
      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-lg font-medium">{t('env.check')}</h2>
        <ul className="list-disc pl-6 text-sm">
          <li>{t('env.nextReact')}</li>
          <li>{t('env.adapter')}</li>
          <li>
            {t('env.d1Binding')}
            <code>DB</code> (rudl-app)
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
    </div>
  );
}
