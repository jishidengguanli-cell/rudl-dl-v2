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
  tradeAmt: number | null;
  paymentDate: string | null;
  rawPaymentInfo: Record<string, string> | null;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  order?: OrderSummary;
};

const IMPORTANT_KEYS = ['PaymentNo', 'BankCode', 'vAccount', 'ExpireDate', 'Barcode1', 'Barcode2', 'Barcode3'];

export default function RechargePaymentInfoPage() {
  const searchParams = useSearchParams();
  const merchantTradeNo =
    searchParams.get('MerchantTradeNo') ?? searchParams.get('merchantTradeNo') ?? searchParams.get('TradeNo') ?? '';

  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(merchantTradeNo));

  useEffect(() => {
    if (!merchantTradeNo) return;

    let cancelled = false;

    const fetchInfo = async () => {
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
    fetchInfo();

    return () => {
      cancelled = true;
    };
  }, [merchantTradeNo]);

  const redirectInfo = useMemo(() => {
    const entries: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      entries[key] = value;
    });
    return entries;
  }, [searchParams]);

  const combinedInfo = useMemo(() => {
    const info: Record<string, string> = { ...redirectInfo };
    if (order?.rawPaymentInfo) {
      Object.entries(order.rawPaymentInfo).forEach(([key, value]) => {
        if (!info[key]) info[key] = value;
      });
    }
    return info;
  }, [order?.rawPaymentInfo, redirectInfo]);

  const highlightRows = IMPORTANT_KEYS.filter((key) => combinedInfo[key]);
  const extraEntries = Object.entries(combinedInfo).filter(
    ([key]) => !IMPORTANT_KEYS.includes(key) && key !== 'MerchantTradeNo' && key !== 'merchantTradeNo'
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Payment instructions</h1>
        <p className="mt-1 text-sm text-gray-600">Use the details below to complete your payment.</p>
      </div>

      {!merchantTradeNo ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Missing payment reference. Please return to the recharge page and try again.
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-900">
          Complete the payment before the expiry time and keep the payment code private.
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">Loading payment details...</div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {merchantTradeNo && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-gray-500">
            Merchant trade no.: <span className="font-mono">{merchantTradeNo}</span>
          </div>

          {highlightRows.length > 0 ? (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              {highlightRows.map((key) => (
                <div key={key}>
                  <dt className="font-medium text-gray-500">{key}</dt>
                  <dd className="font-semibold text-gray-900 break-all">{combinedInfo[key]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-4 text-sm text-gray-500">
              Payment information has not been issued yet. Please refresh this page in a moment.
            </p>
          )}

          {extraEntries.length > 0 && (
            <div className="mt-5">
              <div className="text-sm font-medium text-gray-500">Additional details</div>
              <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <tbody className="divide-y divide-gray-200">
                    {extraEntries.map(([key, value]) => (
                      <tr key={key}>
                        <td className="bg-gray-50 px-3 py-2 font-medium text-gray-600">{key}</td>
                        <td className="px-3 py-2 font-mono text-sm text-gray-900">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <Link
        href="/recharge"
        className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700"
      >
        {'<'} Back to recharge
      </Link>
    </div>
  );
}

