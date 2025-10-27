'use client';

import { useState, useCallback } from 'react';
import { useI18n } from '@/i18n/provider';

const USD_TO_TWD = 32;

const PACKAGES = [
  { points: 200, priceUsd: 1 },
  { points: 1000, priceUsd: 5 },
  { points: 5000, priceUsd: 15 },
  { points: 15000, priceUsd: 35 },
  { points: 50000, priceUsd: 100 },
  { points: 100000, priceUsd: 200 },
].map((item) => ({
  ...item,
  priceTwd: Math.round(item.priceUsd * USD_TO_TWD),
}));

const TEST_PACKAGE = {
  points: 10,
  priceUsd: 10 / USD_TO_TWD,
  priceTwd: 10,
};

type CheckoutResponse = {
  ok: boolean;
  action?: string;
  form?: Record<string, string>;
  error?: string;
};

const submitEcpayForm = (action: string, formFields: Record<string, string>) => {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;

  Object.entries(formFields).forEach(([key, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
};

type Props = {
  enableEcpay: boolean;
};

export default function RechargeClient({ enableEcpay }: Props) {
  const { t } = useI18n();
  const [submittingPoints, setSubmittingPoints] = useState<number | null>(null);

  const handleCheckout = useCallback(
    async (points: number, priceUsd: number, priceTwd: number) => {
      if (!enableEcpay) {
        return;
      }
      try {
        setSubmittingPoints(points);
        const response = await fetch('/api/recharge/ecpay', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: priceTwd,
            points,
            priceUsd,
            priceTwd,
          }),
        });

        const data = (await response.json()) as CheckoutResponse;
        if (!response.ok || !data.ok || !data.action || !data.form) {
          throw new Error(data.error ?? 'Invalid ECPay response');
        }

        submitEcpayForm(data.action, data.form);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[ecpay] checkout failed', message);
        window.alert(`${t('recharge.paymentError')}\n${message}`);
      } finally {
        setSubmittingPoints(null);
      }
    },
    [enableEcpay, t]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('recharge.title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('recharge.selectPackage')}</p>
      </div>
      {!enableEcpay && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          {t('recharge.ecpayUnavailable')}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PACKAGES.map(({ points, priceUsd, priceTwd }) => {
          const isSubmitting = submittingPoints === points;
          return (
            <div
              key={points}
              className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="text-sm font-medium text-gray-500">{t('recharge.pointsLabel')}</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{points.toLocaleString()}</div>
              <div className="mt-4 text-sm font-medium text-gray-500">{t('recharge.priceLabel')}</div>
              <div className="mt-1 text-lg font-semibold">
                ${priceUsd.toFixed(2)} USD
                <span className="ml-2 text-sm text-gray-500">(NT${priceTwd.toLocaleString()})</span>
              </div>
              {enableEcpay && (
                <button
                  type="button"
                  onClick={() => handleCheckout(points, priceUsd, priceTwd)}
                  disabled={isSubmitting}
                  className="mt-6 rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-white shadow hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-80"
                >
                  {isSubmitting ? t('recharge.processingPayment') : t('recharge.payWithEcpay')}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
        {t('recharge.contactSupport')}
      </div>
      {enableEcpay && (
        <button
          type="button"
          onClick={() => handleCheckout(TEST_PACKAGE.points, TEST_PACKAGE.priceUsd, TEST_PACKAGE.priceTwd)}
          disabled={submittingPoints === TEST_PACKAGE.points}
          className="w-full rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-80"
        >
          {submittingPoints === TEST_PACKAGE.points ? t('recharge.processingPayment') : t('recharge.testPayment')}
        </button>
      )}
    </div>
  );
}
