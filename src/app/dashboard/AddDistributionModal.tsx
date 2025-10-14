'use client';

import { FormEvent, useState } from 'react';
import { useI18n } from '@/i18n/provider';

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function AddDistributionModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const [autofill, setAutofill] = useState(true);

  if (!open) return null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    alert(t('dashboard.addDistributionComingSoon'));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{t('dashboard.addDistribution')}</h3>
            <p className="text-sm text-gray-600">{t('dashboard.addDistributionDesc')}</p>
          </div>
          <button
            type="button"
            className="text-sm text-gray-500 transition hover:text-gray-700"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t('form.title')}</span>
              <input
                name="title"
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="APP"
                defaultValue=""
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t('form.bundleId')}</span>
              <input name="bundle_id" className="w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t('form.apkVersion')}</span>
              <input name="apk_version" className="w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t('form.ipaVersion')}</span>
              <input name="ipa_version" className="w-full rounded border px-3 py-2 text-sm" />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={autofill}
              onChange={(event) => setAutofill(event.target.checked)}
            />
            {t('dashboard.autofill')}
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t('form.apkUpload')}</span>
              <input type="file" accept=".apk" className="block w-full text-sm text-gray-700" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t('form.ipaUpload')}</span>
              <input type="file" accept=".ipa" className="block w-full text-sm text-gray-700" />
            </label>
          </div>

          <div className="rounded border border-dashed p-3 text-xs text-gray-500">
            {t('dashboard.progressPlaceholder')}
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm text-gray-600 transition hover:bg-gray-50"
              onClick={onClose}
            >
              {t('form.cancel')}
            </button>
            <button
              type="submit"
              className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              {t('form.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
