'use client';

import { useState, useCallback } from 'react';
import { useI18n } from '@/i18n/provider';

const PACKAGES = [
  { points: 200, price: 1 },
  { points: 1000, price: 5 },
  { points: 5000, price: 15 },
  { points: 15000, price: 35 },
  { points: 50000, price: 100 },
  { points: 100000, price: 200 },
];

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

export default function RechargePage() {
  const { t } = useI18n();
  const [submittingPoints, setSubmittingPoints] = useState<number | null>(null);

  const handleCheckout = useCallback(
    async (points: number, price: number) => {
      try {
        setSubmittingPoints(points);
        const response = await fetch('/api/recharge/ecpay', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: price,
            points,
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
    [t]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('recharge.title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('recharge.selectPackage')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PACKAGES.map((item) => {
          const isSubmitting = submittingPoints === item.points;
          return (
            <div
              key={item.points}
              className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="text-sm font-medium text-gray-500">{t('recharge.pointsLabel')}</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{item.points.toLocaleString()}</div>
              <div className="mt-4 text-sm font-medium text-gray-500">{t('recharge.priceLabel')}</div>
              <div className="mt-1 text-lg font-semibold">${item.price.toFixed(2)} USD</div>
              <button
                type="button"
                onClick={() => handleCheckout(item.points, item.price)}
                disabled={isSubmitting}
                className="mt-6 rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-white shadow hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-80"
              >
                {isSubmitting ? t('recharge.processingPayment') : t('recharge.payWithEcpay')}
              </button>
            </div>
          );
        })}
      </div>
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
        {t('recharge.contactSupport')}
      </div>
    </div>
  );
}
