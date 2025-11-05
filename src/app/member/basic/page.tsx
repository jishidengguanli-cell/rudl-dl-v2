import Link from 'next/link';
import { cookies } from 'next/headers';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { getTranslator } from '@/i18n/helpers';
import { fetchMemberById } from '@/lib/members';

export const runtime = 'edge';

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

const resolveLocale = (langCookie: string | undefined, localeCookie: string | undefined): Locale => {
  if (isLocale(langCookie)) return langCookie;
  if (isLocale(localeCookie)) return localeCookie;
  return DEFAULT_LOCALE;
};

const formatDateTime = (value: number, locale: Locale) => {
  if (!value) return 'N/A';
  const date = new Date(value * 1000);
  const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
  return date.toLocaleString(localeHint);
};

const formatNumber = (value: number | null, locale: Locale) => {
  if (value === null || Number.isNaN(value)) return 'N/A';
  const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
  return new Intl.NumberFormat(localeHint).format(value);
};

const resolveRoleLabel = (role: string | null, t: (key: string) => string) => {
  if (!role) return t('member.basic.role.unknown');
  const key = `member.basic.role.${role.toLowerCase()}`;
  const label = t(key);
  return label === key ? role : label;
};

export default async function MemberBasicPage() {
  const cookieStore = await cookies();
  const uid = cookieStore.get('uid')?.value ?? null;
  const langCookie = cookieStore.get('lang')?.value;
  const localeCookie = cookieStore.get('locale')?.value;
  const locale = resolveLocale(langCookie, localeCookie);
  const t = getTranslator(locale);
  const localePrefix = `/${locale}`;

  if (!uid) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {t('member.basic.notFound')}
      </div>
    );
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const member = await fetchMemberById(DB, uid);
  if (!member) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {t('member.basic.notFound')}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{t('member.basic.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('member.basic.description')}</p>
      </div>
      <dl className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-gray-500">{t('member.basic.email')}</dt>
          <dd className="mt-1 text-base text-gray-900">
            {member.email ?? t('member.basic.notAvailable')}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">{t('member.basic.role')}</dt>
          <dd className="mt-1 text-base text-gray-900">
            {resolveRoleLabel(member.role ?? null, t)}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">{t('member.basic.points')}</dt>
          <dd className="mt-1 text-base font-semibold text-emerald-700">
            {formatNumber(member.balance ?? null, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-500">{t('member.basic.createdAt')}</dt>
          <dd className="mt-1 text-base text-gray-900">
            {formatDateTime(member.createdAt, locale)}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-sm font-medium text-gray-500">
            {t('member.basic.emailVerification')}
          </dt>
          <dd className="mt-1 flex flex-wrap items-center gap-3 text-base text-gray-900">
            <span
              className={
                member.isEmailVerified
                  ? 'font-semibold text-emerald-600'
                  : 'font-medium text-amber-600'
              }
            >
              {member.isEmailVerified
                ? t('member.basic.emailVerification.verified')
                : t('member.basic.emailVerification.pending')}
            </span>
            {!member.isEmailVerified && (
              <Link
                href={`${localePrefix}/member/email-verification`}
                className="inline-flex items-center rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-indigo-600"
              >
                {t('member.basic.emailVerification.cta')}
              </Link>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

