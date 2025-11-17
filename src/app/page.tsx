import { cookies } from 'next/headers';
import { getTranslator } from '@/i18n/helpers';
import { DEFAULT_LOCALE, type Locale, dictionaries } from '@/i18n/dictionary';

export const runtime = 'edge';

export default async function Page() {
  const cookieStore = await cookies();
  const c = cookieStore.get('locale')?.value as Locale | undefined;
  const cur = c && dictionaries[c] ? c : DEFAULT_LOCALE;
  const t = getTranslator(cur);
  const hostingSteps = [
    'home.hosting.step1',
    'home.hosting.step2',
    'home.hosting.step3',
    'home.hosting.step4',
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-semibold text-gray-900">{t('home.title')}</h1>
        <p className="mt-3 text-sm text-gray-600">{t('home.desc')}</p>
      </section>
      <section className="rounded-lg border bg-white p-6">
        <h2 className="text-xl font-semibold text-gray-900">{t('home.hosting.title')}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('home.hosting.desc')}</p>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-gray-800">
          {hostingSteps.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
      </section>
      <section className="rounded-lg border bg-white p-6">
        <h2 className="text-xl font-semibold text-gray-900">{t('home.support.title')}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('home.support.desc')}</p>
      </section>
    </div>
  );
}
