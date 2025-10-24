'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

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
  paidAt: number | null;
  ledgerId: string | null;
  balanceAfter: number | null;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  order?: OrderSummary & { rawPaymentInfo: Record<string, string> | null };
};

const statusColor = (status: OrderStatus) => {
  switch (status) {
    case 'PAID':
      return 'text-emerald-600';
    case 'FAILED':
      return 'text-red-600';
    default:
      return 'text-amber-600';
  }
};

export default function RechargeCompletePage() {
  const searchParams = useSearchParams();
  const merchantTradeNo =
    searchParams.get('MerchantTradeNo') ?? searchParams.get('merchantTradeNo') ?? searchParams.get('TradeNo') ?? '';
  const initialRtnCode = searchParams.get('RtnCode') ?? '';
  const initialRtnMsg = searchParams.get('RtnMsg') ?? '';

  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(merchantTradeNo));
  const [refreshIndex, setRefreshIndex] = useState(0);

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

  const statusLabel = useMemo(() => {
    if (!order) {
      if (initialRtnCode === '1') return 'Payment successful';
      if (initialRtnCode) return 'Payment failed';
      return 'Processing';
    }
    if (order.status === 'PAID') return 'Payment successful';
    if (order.status === 'FAILED') return 'Payment failed';
    return 'Processing';
  }, [order, initialRtnCode]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Payment Result</h1>
        <p className="mt-1 text-sm text-gray-600">You can review the transaction status below.</p>
      </div>

      {!merchantTradeNo ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Missing payment reference. Please check your order history.
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className={`text-lg font-semibold ${statusColor(order?.status ?? 'PENDING')}`}>{statusLabel}</div>
            <div className="text-sm text-gray-500">
              Merchant trade no.: <span className="font-mono">{merchantTradeNo}</span>
            </div>
          </div>

          {loading && (
            <p className="mt-3 text-sm text-gray-500">Confirming payment status...</p>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600">
              Error: {error}
            </p>
          )}

          {order && (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-gray-500">Points credited</dt>
                <dd className="font-semibold text-gray-900">{order.points.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Amount paid</dt>
                <dd className="font-semibold text-gray-900">
                  {order.amount.toLocaleString()} {order.currency}
                </dd>
              </div>
              {order.balanceAfter !== null && (
                <div>
                  <dt className="font-medium text-gray-500">New balance</dt>
                  <dd className="font-semibold text-gray-900">{order.balanceAfter.toLocaleString()}</dd>
                </div>
              )}
              {order.paymentType && (
                <div>
                  <dt className="font-medium text-gray-500">Payment method</dt>
                  <dd className="font-semibold text-gray-900">{order.paymentType}</dd>
                </div>
              )}
              {order.paymentDate && (
                <div>
                  <dt className="font-medium text-gray-500">Payment time</dt>
                  <dd className="font-semibold text-gray-900">{order.paymentDate}</dd>
                </div>
              )}
            </dl>
          )}

          {combinedRtnMsg && (
            <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm text-gray-600">
              <div className="font-medium text-gray-500">Provider message</div>
              <div>{combinedRtnMsg}</div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/recharge"
          className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700"
        >
          {'<'} Back to recharge
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
            Refresh status
          </button>
        )}
      </div>
    </div>
  );
}

