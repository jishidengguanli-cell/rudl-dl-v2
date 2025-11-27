'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/provider';
import { PACKAGES } from '../packages';

type Props = {
  enableEcpay: boolean;
};

type CheckoutResponse = {
  ok: boolean;
  action?: string;
  form?: Record<string, string>;
  error?: string;
};

const STORAGE_KEY = 'recharge:lastPackage';

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

const parsePoints = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const readStoredPoints = (): number | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return parsePoints(raw);
  } catch {
    return null;
  }
};

export default function PaymentClient({ enableEcpay }: Props) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [selectedPoints, setSelectedPoints] = useState<number | null>(() => {
    const fromQuery = parsePoints(searchParams.get('points'));
    if (fromQuery !== null) return fromQuery;
    return readStoredPoints();
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fromQuery = parsePoints(searchParams.get('points'));
    if (fromQuery !== null) {
      setSelectedPoints(fromQuery);
      return;
    }
    const stored = readStoredPoints();
    if (stored !== null) setSelectedPoints(stored);
  }, [searchParams]);

  useEffect(() => {
    if (selectedPoints === null) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, String(selectedPoints));
    } catch (error) {
      console.warn('[recharge] unable to persist selection', error);
    }
  }, [selectedPoints]);

  const selectedPackage = useMemo(() => {
    if (selectedPoints === null) return null;
    return PACKAGES.find((item) => item.points === selectedPoints) ?? null;
  }, [selectedPoints]);

  const handlePayWithEcpay = useCallback(async () => {
    if (!selectedPackage || !enableEcpay) return;
    try {
      setSubmitting(true);
      const response = await fetch('/api/recharge/ecpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: selectedPackage.priceTwd,
          points: selectedPackage.points,
          priceUsd: selectedPackage.priceUsd,
          priceTwd: selectedPackage.priceTwd,
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
      setSubmitting(false);
    }
  }, [enableEcpay, selectedPackage, t]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('recharge.payment.title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('recharge.payment.subtitle')}</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm font-medium text-gray-500">{t('recharge.payment.selectedPackage')}</div>
            {selectedPackage ? (
              <>
                <div className="mt-1 text-2xl font-semibold text-gray-900">
                  {selectedPackage.points.toLocaleString()}
                </div>
                <div className="mt-1 text-sm text-gray-600">
                  ${selectedPackage.priceUsd.toFixed(2)} USD{' '}
                  <span className="text-gray-400">(NT${selectedPackage.priceTwd.toLocaleString()})</span>
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm text-red-600">{t('recharge.payment.noSelection')}</div>
            )}
          </div>
          <Link
            href="/recharge"
            className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700"
          >
            {t('recharge.payment.changePackage')}
          </Link>
        </div>
        {selectedPackage && (
          <p className="mt-3 text-sm text-gray-600">{t('recharge.payment.applySelection')}</p>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-medium text-gray-700">{t('recharge.payment.methodsTitle')}</div>
        {!enableEcpay && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
            {t('recharge.ecpayUnavailable')}
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <button
            type="button"
            onClick={handlePayWithEcpay}
            disabled={!selectedPackage || !enableEcpay || submitting}
            className="inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-white shadow hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-80 sm:w-auto"
          >
            {submitting ? t('recharge.processingPayment') : t('recharge.payWithEcpay')}
          </button>
          {selectedPackage?.nowPaymentsUrl && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-gray-700">{t('recharge.payment.cryptoTitle')}</div>
              <a
                href={selectedPackage.nowPaymentsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex w-full items-center sm:w-auto"
                aria-label={t('recharge.payment.payWithNowPayments')}
              >
                <img
                  src="https://nowpayments.io/images/embeds/payment-button-black.svg"
                  alt={t('recharge.payment.payWithNowPayments')}
                  className="h-11 w-auto"
                />
              </a>
            </div>
          )}
        </div>
        {selectedPackage?.nowPaymentsUrl && (
          <p className="text-xs text-gray-500">{t('recharge.payment.cryptoDescription')}</p>
        )}
      </div>
    </div>
  );
}
