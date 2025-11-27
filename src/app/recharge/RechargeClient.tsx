'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/provider';
import { PACKAGES } from './packages';

type Props = {
  enableEcpay: boolean;
};

const STORAGE_KEY = 'recharge:lastPackage';

export default function RechargeClient({ enableEcpay }: Props) {
  const { t } = useI18n();
  const router = useRouter();

  const handleGoToPayment = useCallback(
    (points: number) => {
      try {
        sessionStorage.setItem(STORAGE_KEY, String(points));
      } catch (error) {
        console.warn('[recharge] unable to persist selection', error);
      }
      router.push(`/recharge/payment?points=${points}`);
    },
    [router]
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
              <button
                type="button"
                onClick={() => handleGoToPayment(points)}
                disabled={!enableEcpay}
                className="mt-6 rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-white shadow hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-80"
              >
                {t('recharge.goToPayment')}
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
