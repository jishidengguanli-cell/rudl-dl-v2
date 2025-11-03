'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/provider';

type OrderStatus = 'PENDING' | 'PAID' | 'FAILED';

type OrderSummary = {
  merchantTradeNo: string;
  status: OrderStatus;
  points: number;
  amount: number;
  currency: string;
  rtnCode: string | null;
  rtnMsg: string | null;
  paymentType: string | null;
  paymentMethod: string | null;
  tradeNo: string | null;
  tradeAmt: number | null;
  paymentDate: string | null;
  ledgerId: string | null;
  balanceAfter: number | null;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  order?: OrderSummary;
};

const statusColor = (status: OrderStatus) => {
  if (status === 'FAILED') return 'text-red-600';
  return 'text-emerald-600';
};

const readCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';').map((part) => part.trim());
  const target = cookies.find((part) => part.startsWith(`${name}=`));
  if (!target) return null;
  return decodeURIComponent(target.split('=')[1] ?? '');
};

const clearCookie = (name: string) => {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
};

export default function RechargeCompletePage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { t, locale } = useI18n();
  const queryTradeNo =
    searchParams.get('MerchantTradeNo') ?? searchParams.get('merchantTradeNo') ?? searchParams.get('TradeNo') ?? '';
  const initialRtnCode = searchParams.get('RtnCode') ?? '';
  const initialRtnMsg = searchParams.get('RtnMsg') ?? '';

  const redirectInfo = useMemo(() => {
    const entries: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (value) entries[key] = value;
    });
    return entries;
  }, [searchParams]);
  const [merchantTradeNo, setMerchantTradeNo] = useState<string>(queryTradeNo);
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(queryTradeNo));
  const [refreshIndex, setRefreshIndex] = useState(0);
  const dashboardHref = useMemo(() => {
    const segments = pathname?.split('/').filter(Boolean) ?? [];
    if (segments[0] === locale) {
      return `/${locale}/dashboard`;
    }
    return '/dashboard';
  }, [locale, pathname]);

  useEffect(() => {
    if (queryTradeNo) {
      setMerchantTradeNo(queryTradeNo);
      clearCookie('ecpay_last_trade');
      return;
    }
    const cookieTrade = readCookie('ecpay_last_trade');
    if (cookieTrade) {
      setMerchantTradeNo(cookieTrade);
      clearCookie('ecpay_last_trade');
    }
  }, [queryTradeNo]);

  useEffect(() => {
    if (!merchantTradeNo) return;

    let cancelled = false;
    let settled = false;
    let attempts = 0;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/recharge/ecpay/orders/${merchantTradeNo}`, {
          method: 'GET',
          cache: 'no-store',
        });
        const data = (await res.json()) as ApiResponse;
        if (!data.ok || !data.order) {
          if (!cancelled) {
            setError(data.error ?? 'UNKNOWN_ERROR');
            setLoading(false);
          }
          return;
        }
        if (!cancelled) {
          setOrder(data.order);
          setLoading(false);
          settled = data.order.status !== 'PENDING';
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    setOrder(null);
    setLoading(true);
    setError(null);
    fetchStatus();

    const timer = setInterval(() => {
      attempts += 1;
      if (cancelled || settled || attempts > 10) {
        clearInterval(timer);
      } else {
        fetchStatus();
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [merchantTradeNo, refreshIndex]);

  const combinedRtnMsg = useMemo(() => {
    if (order?.rtnMsg) return order.rtnMsg;
    if (initialRtnMsg) return initialRtnMsg;
    return null;
  }, [order?.rtnMsg, initialRtnMsg]);

  const gatewaySummary = useMemo(() => {
    const keys = ['RtnCode', 'RtnMsg', 'PaymentType', 'TradeAmt', 'TradeNo', 'PaymentDate', 'SimulatePaid'];
    const entries: Array<[string, string]> = [];
    keys.forEach((key) => {
      const value = redirectInfo[key] ?? redirectInfo[key.toLowerCase()];
      if (value) {
        entries.push([key, value]);
      }
    });
    return entries;
  }, [redirectInfo]);

  const statusLabel = useMemo(() => {
    if (!order) {
      if (initialRtnCode === '1') return t('recharge.complete.status.successProcessing');
      if (initialRtnCode) return t('recharge.complete.status.failed');
      return t('recharge.complete.status.processing');
    }
    if (order.status === 'FAILED') return t('recharge.complete.status.failed');
    if (order.status === 'PAID') return t('recharge.complete.status.success');
    return t('recharge.complete.status.successProcessing');
  }, [order, initialRtnCode, t]);

  const gatewayPending = order?.status === 'PENDING';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('recharge.complete.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('recharge.complete.subtitle')}</p>
      </div>

      {!merchantTradeNo ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {t('recharge.complete.missingRef')}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className={`text-lg font-semibold ${statusColor(order?.status ?? 'PENDING')}`}>{statusLabel}</div>
            <div className="text-sm text-gray-500">
              {t('member.orders.table.tradeNo')}: <span className="font-mono">{merchantTradeNo}</span>
            </div>
          </div>

          {gatewayPending && (
            <p className="mt-2 text-sm text-amber-600">
              {t('recharge.complete.gatewayPending')}
            </p>
          )}

          {gatewaySummary.length > 0 && (
            <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-600">
              <div className="font-medium text-gray-500">{t('recharge.complete.gatewayHeading')}</div>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {gatewaySummary.map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs uppercase tracking-wide text-gray-500">{key}</dt>
                    <dd className="font-mono text-sm text-gray-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {loading && (
            <p className="mt-3 text-sm text-gray-500">{t('recharge.complete.loading')}</p>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600">
              {t('recharge.complete.errorPrefix')} {error}
            </p>
          )}

          {order && (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-gray-500">{t('recharge.complete.points')}</dt>
                <dd className="font-semibold text-gray-900">{order.points.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">{t('recharge.complete.amount')}</dt>
                <dd className="font-semibold text-gray-900">
                  {order.amount.toLocaleString()} {order.currency}
                </dd>
              </div>
              {order.balanceAfter !== null && (
                <div>
                  <dt className="font-medium text-gray-500">{t('recharge.complete.balance')}</dt>
                  <dd className="font-semibold text-gray-900">{order.balanceAfter.toLocaleString()}</dd>
                </div>
              )}
              {order.paymentType && (
                <div>
                  <dt className="font-medium text-gray-500">{t('recharge.complete.method')}</dt>
                  <dd className="font-semibold text-gray-900">{order.paymentType}</dd>
                </div>
              )}
              {order.paymentDate && (
                <div>
                  <dt className="font-medium text-gray-500">{t('recharge.complete.time')}</dt>
                  <dd className="font-semibold text-gray-900">{order.paymentDate}</dd>
                </div>
              )}
            </dl>
          )}

          {combinedRtnMsg && (
            <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm text-gray-600">
              <div className="font-medium text-gray-500">{t('recharge.complete.providerMessage')}</div>
              <div>{combinedRtnMsg}</div>
            </div>
          )}

        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={dashboardHref}
          className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700"
        >
          {t('recharge.complete.back')}
        </Link>
        {merchantTradeNo && (
          <button
            type="button"
            onClick={() => {
              setOrder(null);
              setRefreshIndex((index) => index + 1);
            }}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('recharge.complete.refresh')}
          </button>
        )}
      </div>
    </div>
  );
}
