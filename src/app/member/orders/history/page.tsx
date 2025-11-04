import Link from 'next/link';
import { cookies } from 'next/headers';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { getTranslator } from '@/i18n/helpers';
import { listEcpayOrdersForAccount } from '@/lib/ecpay';

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

const formatDateTime = (timestamp: number | null, locale: Locale) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp * 1000);
  const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
  return date.toLocaleString(localeHint);
};

const formatNumber = (value: number | null, locale: Locale) => {
  if (value === null || Number.isNaN(value)) return '-';
  const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
  return new Intl.NumberFormat(localeHint).format(value);
};

const resolveStatusLabel = (status: string, t: (key: string) => string) => {
  const key = `member.orders.status.${status.toLowerCase()}`;
  const label = t(key);
  return label === key ? status : label;
};

const statusBadgeClass = (status: string) => {
  switch (status) {
    case 'PAID':
      return 'bg-emerald-100 text-emerald-700';
    case 'FAILED':
      return 'bg-rose-100 text-rose-700';
    default:
      return 'bg-amber-100 text-amber-700';
  }
};

export default async function MemberOrderHistoryPage() {
  const cookieStore = await cookies();
  const uid = cookieStore.get('uid')?.value ?? null;
  const langCookie = cookieStore.get('lang')?.value;
  const localeCookie = cookieStore.get('locale')?.value;
  const locale = resolveLocale(langCookie, localeCookie);
  const t = getTranslator(locale);
  const localePrefix = `/${locale}`;

  if (!uid) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {t('member.orders.history.unauthenticated')}
      </section>
    );
  }

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const orders = await listEcpayOrdersForAccount(DB, uid);

  if (orders.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">{t('member.orders.history.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('member.orders.history.description')}</p>
        <p className="mt-4 text-sm text-gray-500">{t('member.orders.history.empty')}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">{t('member.orders.history.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('member.orders.history.description')}</p>
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('member.orders.table.tradeNo')}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('member.orders.table.status')}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('member.orders.table.points')}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('member.orders.table.amount')}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('member.orders.table.paymentTime')}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('member.orders.table.createdAt')}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('member.orders.table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((order) => {
                const detailHref = `${localePrefix}/recharge/complete?merchantTradeNo=${encodeURIComponent(order.merchantTradeNo)}`;
                return (
                  <tr key={order.merchantTradeNo}>
                    <td className="px-3 py-2 font-mono text-xs text-blue-600">
                      <Link className="underline" href={detailHref}>
                        {order.merchantTradeNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(order.status)}`}>
                        {resolveStatusLabel(order.status, t)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-900">{formatNumber(order.points, locale)}</td>
                    <td className="px-3 py-2 text-gray-900">
                      {formatNumber(order.amount, locale)}{' '}
                      <span className="text-xs text-gray-500">{order.currency}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {order.paymentDate ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {formatDateTime(order.createdAt, locale)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        className="inline-flex items-center rounded border border-blue-200 px-2 py-1 text-xs font-medium text-blue-600 transition hover:border-blue-400 hover:text-blue-700"
                        href={detailHref}
                      >
                        {t('member.orders.history.view')}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

