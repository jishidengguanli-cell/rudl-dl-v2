'use client';

import { useI18n } from '@/i18n/provider';

const PACKAGES = [
  { points: 200, price: 1 },
  { points: 1000, price: 5 },
  { points: 5000, price: 15 },
  { points: 15000, price: 35 },
  { points: 50000, price: 100 },
  { points: 100000, price: 200 },
];

export default function RechargePage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('recharge.title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('recharge.selectPackage')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PACKAGES.map((item) => (
          <div
            key={item.points}
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
          >
            <div className="text-sm font-medium text-gray-500">{t('recharge.pointsLabel')}</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{item.points.toLocaleString()}</div>
            <div className="mt-4 text-sm font-medium text-gray-500">{t('recharge.priceLabel')}</div>
            <div className="mt-1 text-lg font-semibold">${item.price.toFixed(2)} USD</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
        {t('recharge.contactSupport')}
      </div>
    </div>
  );
}
