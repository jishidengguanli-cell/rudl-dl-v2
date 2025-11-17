import { cookies } from 'next/headers';
import { getTranslator } from '@/i18n/helpers';
import { DEFAULT_LOCALE, type Locale, dictionaries } from '@/i18n/dictionary';

export const runtime = 'edge';

export default async function Page() {
  const cookieStore = await cookies();
  const c = cookieStore.get('locale')?.value as Locale | undefined;
  const cur = c && dictionaries[c] ? c : DEFAULT_LOCALE;
  const t = getTranslator(cur);
  const features = [
    { title: 'home.features.upload.title', desc: 'home.features.upload.desc' },
    { title: 'home.features.manage.title', desc: 'home.features.manage.desc' },
    { title: 'home.features.monitor.title', desc: 'home.features.monitor.desc' },
    { title: 'home.features.support.title', desc: 'home.features.support.desc' },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-semibold text-gray-900">{t('home.title')}</h1>
        <p className="mt-3 text-sm text-gray-600">{t('home.desc')}</p>
      </section>
      <section className="rounded-lg border bg-white p-6">
        <h2 className="text-xl font-semibold text-gray-900">{t('home.features.title')}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('home.features.desc')}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {features.map((item) => (
            <div key={item.title} className="rounded-lg border bg-gray-50 p-4">
              <h3 className="text-base font-semibold text-gray-900">{t(item.title)}</h3>
              <p className="mt-1 text-sm text-gray-600">{t(item.desc)}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-lg border bg-white p-6">
        <h2 className="text-xl font-semibold text-gray-900">{t('home.cta.title')}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('home.cta.desc')}</p>
        <p className="mt-4 text-sm text-gray-500">{t('home.cta.note')}</p>
      </section>
    </div>
  );
}
