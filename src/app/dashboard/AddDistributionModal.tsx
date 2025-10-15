'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
};

type SubmitState = 'idle' | 'submitting' | 'success';

export default function AddDistributionModal({ open, onClose, onCreated, onError }: Props) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [bundleId, setBundleId] = useState('');
  const [apkVersion, setApkVersion] = useState('');
  const [ipaVersion, setIpaVersion] = useState('');
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [ipaFile, setIpaFile] = useState<File | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setBundleId('');
      setApkVersion('');
      setIpaVersion('');
      setApkFile(null);
      setIpaFile(null);
      setSubmitState('idle');
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const humanFileName = (file: File | null) => file?.name ?? t('dashboard.progressPlaceholder');

  const resolveErrorMessage = (code: string | undefined | null) => {
    if (!code) return t('status.unreadable');
    switch (code) {
      case 'NO_FILES':
        return t('dashboard.errorNoFiles');
      case 'AUTOFILL_MISMATCH':
        return t('dashboard.errorAutofillMismatch');
      case 'UNAUTHENTICATED':
        return t('auth.login.required');
      default:
        return code;
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!apkFile && !ipaFile) {
      const message = t('dashboard.errorNoFiles');
      setError(message);
      onError(message);
      return;
    }

    try {
      setSubmitState('submitting');
      setError(null);
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('bundle_id', bundleId.trim());
      formData.append('apk_version', apkVersion.trim());
      formData.append('ipa_version', ipaVersion.trim());
      formData.append('autofill', 'false');
      if (apkFile) {
        formData.append('apk', apkFile, apkFile.name);
      }
      if (ipaFile) {
        formData.append('ipa', ipaFile, ipaFile.name);
      }

      const response = await fetch('/api/distributions', {
        method: 'POST',
        body: formData,
      });
      const json = (await response.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        throw new Error(resolveErrorMessage(json.error));
      }

      setSubmitState('success');
      onCreated();
    } catch (err) {
      const message = err instanceof Error ? err.message : resolveErrorMessage(String(err));
      setError(message);
      setSubmitState('idle');
      onError(message);
    }
  };

  const closeDisabled = submitState === 'submitting';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8"
      role="presentation"
      onClick={() => {
        if (!closeDisabled) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-xl rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">{t('dashboard.addDistribution')}</h3>
          <p className="mt-1 text-sm text-gray-600">{t('dashboard.addDistributionDesc')}</p>
        </div>

        <form className="space-y-4 px-6 py-6" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('form.title')}
              <input
                className="mt-1 rounded border px-3 py-2 text-sm outline-none focus:border-black"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="My App"
                disabled={submitState === 'submitting'}
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('form.bundleId')}
              <input
                className="mt-1 rounded border px-3 py-2 text-sm outline-none focus:border-black"
                value={bundleId}
                onChange={(event) => setBundleId(event.target.value)}
                placeholder="com.example.app"
                disabled={submitState === 'submitting'}
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('form.apkVersion')}
              <input
                className="mt-1 rounded border px-3 py-2 text-sm outline-none focus:border-black"
                value={apkVersion}
                onChange={(event) => setApkVersion(event.target.value)}
                placeholder="1.0.0"
                disabled={submitState === 'submitting'}
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('form.ipaVersion')}
              <input
                className="mt-1 rounded border px-3 py-2 text-sm outline-none focus:border-black"
                value={ipaVersion}
                onChange={(event) => setIpaVersion(event.target.value)}
                placeholder="1.0.0"
                disabled={submitState === 'submitting'}
              />
            </label>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              {t('form.apkUpload')}
              <input
                type="file"
                accept=".apk"
                className="mt-1 w-full text-sm"
                disabled={submitState === 'submitting'}
                onChange={(event) => setApkFile(event.target.files?.[0] ?? null)}
              />
              <p className="mt-1 text-xs text-gray-500">{humanFileName(apkFile)}</p>
            </label>

            <label className="block text-sm font-medium text-gray-700">
              {t('form.ipaUpload')}
              <input
                type="file"
                accept=".ipa"
                className="mt-1 w-full text-sm"
                disabled={submitState === 'submitting'}
                onChange={(event) => setIpaFile(event.target.files?.[0] ?? null)}
              />
              <p className="mt-1 text-xs text-gray-500">{humanFileName(ipaFile)}</p>
            </label>
          </div>

          <p className="rounded border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500">
            {t('dashboard.addDistributionComingSoon')}
          </p>

          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                if (!closeDisabled) onClose();
              }}
              className="rounded border px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={closeDisabled}
            >
              {t('form.cancel')}
            </button>
            <button
              type="submit"
              className="rounded bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitState === 'submitting'}
            >
              {submitState === 'submitting' ? t('status.loading') : t('form.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
