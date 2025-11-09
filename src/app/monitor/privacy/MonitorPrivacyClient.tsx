'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/provider';

export type TelegramSettings = {
  telegramBotToken: string | null;
};

type Props = {
  initialData: TelegramSettings;
};

type StatusState =
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }
  | null;

const sanitize = (value: string | null) => value?.trim() ?? '';

export default function MonitorPrivacyClient({ initialData }: Props) {
  const { t } = useI18n();
  const [values, setValues] = useState<TelegramSettings>(initialData);
  const [draft, setDraft] = useState<TelegramSettings>(initialData);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<StatusState>(null);
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    setEditing(true);
    setDraft(values);
    setStatus(null);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft(values);
  };

  const handleInputChange = (rawValue: string) => {
    setDraft({ telegramBotToken: rawValue });
  };

  const submitDraft = async () => {
    setSaving(true);
    setStatus(null);
    const payload: TelegramSettings = {
      telegramBotToken: sanitize(draft.telegramBotToken ?? null) || null,
    };

    try {
      const response = await fetch('/api/monitor/privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; data: TelegramSettings }
        | { ok: false; error?: string }
        | null;
      if (!response.ok || !data || !('ok' in data) || !data.ok) {
        const errorMessage =
          (data && 'error' in data && data.error) || t('monitor.privacy.status.error');
        throw new Error(errorMessage);
      }
      setValues(data.data);
      setDraft(data.data);
      setEditing(false);
      setStatus({ type: 'success', message: t('monitor.privacy.status.saved') });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('monitor.privacy.status.error');
      setStatus({ type: 'error', message });
    } finally {
      setSaving(false);
    }
  };

  const renderActions = () => {
    if (editing) {
      return (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow disabled:opacity-50"
            disabled={saving}
            onClick={submitDraft}
          >
            {saving ? t('monitor.privacy.actions.saving') : t('monitor.privacy.actions.save')}
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            disabled={saving}
            onClick={cancelEditing}
          >
            {t('monitor.privacy.actions.cancel')}
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-blue-400 hover:text-blue-600"
        onClick={startEditing}
      >
        {t('monitor.privacy.actions.edit')}
      </button>
    );
  };

  const renderValue = (value: string | null) => {
    if (!value || !value.trim().length) {
      return <span className="text-sm text-gray-400">{t('monitor.privacy.emptyValue')}</span>;
    }
    return (
      <span className="font-mono text-sm text-gray-900 break-all" aria-label={t('monitor.privacy.maskedValueLabel')}>
        {'**********'}
      </span>
    );
  };

  return (
    <div className="mt-6">
      <div className="rounded-lg border border-gray-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {t('monitor.privacy.telegramBot.title')}
            </h3>
            <p className="text-sm text-gray-600">
              {t('monitor.privacy.telegramBot.description')}
            </p>
          </div>
          {renderActions()}
        </div>
        <dl className="mt-4 space-y-4">
          <div>
            <dt className="text-sm font-medium text-gray-500">
              {t('monitor.privacy.telegramBot.token')}
            </dt>
            <dd className="mt-1">
              {editing ? (
                <textarea
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={2}
                  value={draft.telegramBotToken ?? ''}
                  onChange={(event) => handleInputChange(event.target.value)}
                  placeholder={t('monitor.privacy.telegramBot.tokenPlaceholder')}
                />
              ) : (
                renderValue(values.telegramBotToken)
              )}
            </dd>
          </div>
        </dl>
      </div>
      {status ? (
        <div
          className={
            status.type === 'success'
              ? 'rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800'
              : 'rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'
          }
        >
          {status.message}
        </div>
      ) : null}
    </div>
  );
}
