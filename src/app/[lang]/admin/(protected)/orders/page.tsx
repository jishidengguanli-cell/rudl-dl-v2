import Link from 'next/link';
import { cookies } from 'next/headers';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { listEcpayOrders } from '@/lib/ecpay';

export const runtime = 'edge';

type Params = { lang: string };

type Env = {
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

const isLocale = (value: string | undefined): value is Locale =>
  Boolean(value && value in dictionaries);

const resolveLocale = (
  langParam: string | undefined,
  cookieLang: string | undefined,
  cookieLocale: string | undefined
): Locale => {
  if (isLocale(langParam)) return langParam;
  if (isLocale(cookieLang)) return cookieLang;
  if (isLocale(cookieLocale)) return cookieLocale;
  return DEFAULT_LOCALE;
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

const resolveStatusLabel = (dict: Record<string, string>, status: string) => {
  const key = `member.orders.status.${status.toLowerCase()}`;
  return dict[key] ?? status;
};

const formatNumber = (value: number | null | undefined, locale: Locale) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
  return new Intl.NumberFormat(localeHint).format(value);
};

const formatCurrency = (amount: number | null | undefined, currency: string | null, locale: Locale) => {
  if (!Number.isFinite(amount ?? NaN)) return '-';
  const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
  const code = currency && currency.trim() ? currency : 'TWD';
  try {
    return new Intl.NumberFormat(localeHint, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0,
    }).format(amount ?? 0);
  } catch {
    return `${code} ${formatNumber(amount ?? 0, locale)}`;
  }
};

const normalizeDateInput = (value: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    trimmed.replace(' ', 'T'),
    trimmed.includes('T') ? (trimmed.endsWith('Z') ? trimmed : `${trimmed}Z`) : `${trimmed}Z`,
    trimmed.replace(/-/g, '/'),
  ];
  for (const candidate of candidates) {
    const timestamp = Date.parse(candidate);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp);
    }
  }
  return null;
};

const formatDateString = (value: string | null | undefined, locale: Locale) => {
  if (!value) return '-';
  const normalized = normalizeDateInput(value);
  if (!normalized) return value;
  const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
  return normalized.toLocaleString(localeHint);
};

const formatEpochSeconds = (value: number | null | undefined, locale: Locale) => {
  if (!value) return '-';
  const date = new Date(value * 1000);
  const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
  return date.toLocaleString(localeHint);
};

export default async function AdminOrdersPage({ params }: { params: Promise<Params> }) {
  const { lang } = await params;
  const cookieStore = await cookies();
  const cookieLang = cookieStore.get('lang')?.value;
  const cookieLocale = cookieStore.get('locale')?.value;
  const locale = resolveLocale(lang, cookieLang, cookieLocale);
  const dict = dictionaries[locale];
  const localePrefix = `/${locale}`;

  const { env } = getRequestContext();
  const bindings = env as Env;
  const DB = bindings.DB ?? bindings['rudl-app'];
  if (!DB) {
    throw new Error('D1 binding DB is missing');
  }

  const orders = await listEcpayOrders(DB);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{dict['admin.orders.title'] ?? 'Order management'}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {dict['admin.orders.description'] ?? 'Review recharge orders recorded in ECPay.'}
        </p>
      </div>

      {orders.length === 0 ? (
        <p className="rounded border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
          {dict['admin.orders.empty'] ?? 'No orders found.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  {dict['admin.orders.table.tradeNo'] ?? 'Merchant trade no.'}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  {dict['admin.orders.table.status'] ?? 'Status'}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  {dict['admin.orders.table.amount'] ?? 'Amount'}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  {dict['admin.orders.table.points'] ?? 'Points'}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  {dict['member.basic.email'] ?? 'Account'}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  {dict['admin.orders.table.paymentDate'] ?? 'Payment date'}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  {dict['member.orders.table.createdAt'] ?? 'Created'}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  {dict['admin.orders.table.method'] ?? 'Payment method'}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  {dict['admin.orders.table.description'] ?? 'Description'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((order) => {
                const detailHref = `${localePrefix}/recharge/complete?merchantTradeNo=${encodeURIComponent(
                  order.merchantTradeNo
                )}`;
                return (
                  <tr key={order.merchantTradeNo}>
                    <td className="px-3 py-2 font-mono text-xs text-blue-600">
                      <Link className="underline" href={detailHref}>
                        {order.merchantTradeNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(
                          order.status
                        )}`}
                      >
                        {resolveStatusLabel(dict, order.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      {formatCurrency(order.amount ?? 0, order.currency ?? 'TWD', locale)}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{formatNumber(order.points ?? 0, locale)}</td>
                    <td className="px-3 py-2 text-gray-700">{order.accountId}</td>
                    <td className="px-3 py-2 text-gray-700">{formatDateString(order.paymentDate, locale)}</td>
                    <td className="px-3 py-2 text-gray-700">{formatEpochSeconds(order.createdAt, locale)}</td>
                    <td className="px-3 py-2 text-gray-700">{order.paymentMethod ?? order.paymentType ?? '-'}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-xs truncate" title={order.description ?? order.itemName ?? undefined}>
                      {order.description ?? order.itemName ?? '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
