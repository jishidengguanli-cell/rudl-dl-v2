import { cookies } from 'next/headers';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { DEFAULT_LOCALE, dictionaries, type Locale } from '@/i18n/dictionary';
import { listEcpayOrdersForAccount } from '@/lib/ecpay';

export const runtime = 'edge';

const TARGET_ACCOUNT_ID = 'hjp7y94';

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

const formatStatus = (dict: Record<string, string>, status: string) => {
  const normalized = status.toLowerCase();
  const key = `member.orders.status.${normalized}`;
  return dict[key] ?? status;
};

const formatCurrency = (amount: number, currency: string, locale: Locale) => {
  if (!Number.isFinite(amount)) return '-';
  const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
  try {
    return new Intl.NumberFormat(localeHint, {
      style: 'currency',
      currency: currency || 'TWD',
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency || 'TWD'} ${amount.toLocaleString(localeHint)}`;
  }
};

const normalizeDateInput = (value: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isoCandidate = trimmed.replace(' ', 'T');
  const withSlashes = trimmed.replace(/-/g, '/');
  const parsers = [trimmed, isoCandidate, withSlashes];
  for (const candidate of parsers) {
    const timestamp = Date.parse(candidate);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp);
    }
  }
  return null;
};

const formatDate = (value: string | null, locale: Locale) => {
  if (!value) return '-';
  const date = normalizeDateInput(value);
  if (!date) return value;
  const localeHint = locale === 'zh-TW' ? 'zh-Hant' : locale;
  return date.toLocaleString(localeHint);
};

export default async function AdminOrdersPage({ params }: { params: Promise<Params> }) {
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

  const orders = await listEcpayOrdersForAccount(DB, TARGET_ACCOUNT_ID);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{dict['admin.orders.title'] ?? 'Order management'}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {dict['admin.orders.description'] ?? `Review orders for account ${TARGET_ACCOUNT_ID}.`}
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
                  {dict['admin.orders.table.paymentDate'] ?? 'Payment date'}
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
              {orders.map((order) => (
                <tr key={order.merchantTradeNo}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{order.merchantTradeNo}</td>
                  <td className="px-3 py-2 text-gray-800">{formatStatus(dict, order.status)}</td>
                  <td className="px-3 py-2 text-gray-900">
                    {formatCurrency(order.amount, order.currency ?? 'TWD', locale)}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{order.points.toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-700">{formatDate(order.paymentDate ?? null, locale)}</td>
                  <td className="px-3 py-2 text-gray-700">{order.paymentMethod ?? '-'}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {order.description ?? order.itemName ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
