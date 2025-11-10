'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';

type MonitorLink = {
  id: string;
  code: string;
  title: string | null;
  createdAt: number;
};

type MonitorType = 'points' | 'downloads';
type DownloadMetric = 'total' | 'apk' | 'ipa';

type FormState = {
  type: MonitorType | null;
  pointsThreshold: string;
  downloadLinkId: string;
  downloadMetric: DownloadMetric;
  downloadThreshold: string;
  notifyChannel: 'telegram';
  message: string;
  messageEdited: boolean;
  targetChatId: string;
};

type SavedMonitor =
  | {
      id: string;
      type: 'points';
      threshold: number;
      message: string;
      target: string;
    }
  | {
      id: string;
      type: 'downloads';
      linkCode: string;
      metric: DownloadMetric;
      threshold: number;
      message: string;
      target: string;
    };

type Props = {
  links: MonitorLink[];
};

const metricKeys: Record<DownloadMetric, string> = {
  total: 'monitor.settings.download.metric.total',
  apk: 'monitor.settings.download.metric.apk',
  ipa: 'monitor.settings.download.metric.ipa',
};

const downloadMetrics: DownloadMetric[] = ['total', 'apk', 'ipa'];

export default function MonitorSettingsClient({ links }: Props) {
  const { t } = useI18n();
  const buildDefaultForm = useCallback(
    (): FormState => ({
      type: null,
      pointsThreshold: '',
      downloadLinkId: '',
      downloadMetric: 'total',
      downloadThreshold: '',
      notifyChannel: 'telegram',
      message: '',
      messageEdited: false,
      targetChatId: '',
    }),
    []
  );

  const [monitors, setMonitors] = useState<SavedMonitor[]>([]);
  const [form, setForm] = useState<FormState>(() => buildDefaultForm());
  const [modalOpen, setModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [saving, setSaving] = useState(false);

  const metricLabel = useCallback(
    (metric: DownloadMetric) => t(metricKeys[metric] ?? metric),
    [t]
  );

  useEffect(() => {
    if (form.messageEdited) return;

    let nextMessage = '';
    if (form.type === 'points') {
      const threshold = form.pointsThreshold || '0';
      nextMessage = t('monitor.settings.message.defaultPoints').replace('{threshold}', threshold);
    } else if (form.type === 'downloads') {
      const selectedLink = links.find((link) => link.id === form.downloadLinkId);
      const code = selectedLink?.code ?? '----';
      const threshold = form.downloadThreshold || '0';
      const label = metricLabel(form.downloadMetric);
      nextMessage = t('monitor.settings.message.defaultDownloads')
        .replace('{code}', code)
        .replace('{metric}', label)
        .replace('{threshold}', threshold);
    }

    if (nextMessage !== form.message) {
      setForm((prev) => ({ ...prev, message: nextMessage }));
    }
  }, [
    form.type,
    form.pointsThreshold,
    form.downloadLinkId,
    form.downloadMetric,
    form.downloadThreshold,
    form.message,
    form.messageEdited,
    links,
    metricLabel,
    t,
  ]);

  const resetForm = useCallback(() => {
    setForm(buildDefaultForm());
    setStatusMessage(null);
  }, [buildDefaultForm]);

  const openModal = () => {
    resetForm();
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    resetForm();
  };

  const handleMessageChange = (value: string) => {
    setForm((prev) => ({ ...prev, message: value, messageEdited: true }));
  };

  const handleSave = async () => {
    const errors: string[] = [];
    if (!form.type) {
      errors.push('type');
    }

    if (form.type === 'points') {
      const threshold = Number(form.pointsThreshold);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        errors.push('pointsThreshold');
      }
    }

    if (form.type === 'downloads') {
      const threshold = Number(form.downloadThreshold);
      if (!form.downloadLinkId) {
        errors.push('link');
      }
      if (!form.downloadMetric) {
        errors.push('metric');
      }
      if (!Number.isFinite(threshold) || threshold <= 0) {
        errors.push('downloadThreshold');
      }
    }

    if (!form.targetChatId.trim()) {
      errors.push('target');
    }

    if (errors.length > 0 || !form.type) {
      setStatusMessage({
        type: 'error',
        text: t('monitor.settings.toast.error'),
      });
      return;
    }

    const payload: Record<string, unknown> = {
      type: form.type,
      threshold:
        form.type === 'points' ? Number(form.pointsThreshold) : Number(form.downloadThreshold),
      message: form.message.trim(),
      targetChatId: form.targetChatId.trim(),
    };

    if (form.type === 'downloads') {
      payload.linkId = form.downloadLinkId;
      payload.metric = form.downloadMetric;
    }

    try {
      setSaving(true);
      const response = await fetch('/api/monitor/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; monitor?: SavedMonitor }
        | null;

      if (!response.ok || !data?.ok) {
        setStatusMessage({
          type: 'error',
          text: data?.error
            ? `${t('monitor.settings.toast.error')} (${data.error})`
            : t('monitor.settings.toast.error'),
        });
        return;
      }

      if (data.monitor) {
        setMonitors((prev) => [data.monitor as SavedMonitor, ...prev]);
      }

      setStatusMessage({
        type: 'success',
        text: t('monitor.settings.toast.saved'),
      });
      setModalOpen(false);
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage({
        type: 'error',
        text: `${t('monitor.settings.toast.error')} (${message})`,
      });
    } finally {
      setSaving(false);
    }
  };

  const renderModal = () => {
    if (!modalOpen) return null;
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
        <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{t('monitor.settings.modal.title')}</h3>
              <p className="text-sm text-gray-600">{t('monitor.settings.typeLabel')}</p>
            </div>
            <button
              type="button"
              onClick={closeModal}
              className="rounded-full border border-gray-200 p-2 text-gray-500 hover:text-gray-700"
              aria-label={t('monitor.settings.modal.close')}
            >
              ×
            </button>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, type: 'points' }))}
              className={`rounded-xl border p-4 text-left ${form.type === 'points' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-400'}`}
            >
              <div className="font-semibold text-gray-900">{t('monitor.settings.type.points')}</div>
              <p className="mt-1 text-sm text-gray-600">{t('monitor.settings.type.pointsHint')}</p>
            </button>
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, type: 'downloads' }))}
              className={`rounded-xl border p-4 text-left ${form.type === 'downloads' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-400'}`}
            >
              <div className="font-semibold text-gray-900">{t('monitor.settings.type.downloads')}</div>
              <p className="mt-1 text-sm text-gray-600">{t('monitor.settings.type.downloadsHint')}</p>
            </button>
          </div>

          {form.type === 'points' && (
            <div className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm text-gray-700">{t('monitor.settings.points.thresholdLabel')}</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={form.pointsThreshold}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, pointsThreshold: event.target.value }))
                  }
                />
                <span className="text-sm text-gray-600">
                  {t('monitor.settings.points.thresholdSuffix')}
                </span>
              </div>
            </div>
          )}

          {form.type === 'downloads' && (
            <div className="mt-6 space-y-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {t('monitor.settings.download.linkLabel')}
                </p>
                {links.length === 0 && (
                  <p className="mt-2 rounded-md border border-dashed border-gray-300 bg-white px-3 py-2 text-sm text-gray-500">
                    {t('monitor.settings.download.linkEmpty')}
                  </p>
                )}
                {links.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {links.map((link) => (
                      <button
                        key={link.id}
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            downloadLinkId: link.id,
                          }))
                        }
                        className={`rounded-md border px-3 py-1 text-sm font-mono ${form.downloadLinkId === link.id ? 'border-blue-500 bg-blue-100 text-blue-800' : 'border-gray-200 bg-white text-gray-700 hover:border-blue-400'}`}
                      >
                        {link.code}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {form.downloadLinkId && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-700">
                    {t('monitor.settings.download.metricLabel')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {downloadMetrics.map((metric) => (
                      <button
                        key={metric}
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            downloadMetric: metric,
                          }))
                        }
                        className={`rounded-md border px-3 py-1 text-sm ${form.downloadMetric === metric ? 'border-blue-500 bg-blue-100 text-blue-800' : 'border-gray-200 bg-white text-gray-700 hover:border-blue-400'}`}
                      >
                        {metricLabel(metric)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {form.downloadLinkId && (
                <div className="space-y-2">
                  <label className="text-sm text-gray-700">
                    {t('monitor.settings.download.thresholdLabel').replace(
                      '{metric}',
                      metricLabel(form.downloadMetric)
                    )}
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={form.downloadThreshold}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, downloadThreshold: event.target.value }))
                    }
                  />
                </div>
              )}
            </div>
          )}

          {(form.type === 'points' || form.type === 'downloads') && (
            <>
              <div className="mt-6 space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    {t('monitor.settings.notify.title')}
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="inline-flex items-center rounded-md border border-blue-500 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                      {t('monitor.settings.notify.telegram')}
                    </span>
                    <span className="text-xs text-gray-500">
                      {t('monitor.settings.target.placeholder')}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="monitor-message">
                    {t('monitor.settings.message.label')}
                  </label>
                  <textarea
                    id="monitor-message"
                    rows={3}
                    className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={form.message}
                    onChange={(event) => handleMessageChange(event.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {t('monitor.settings.message.helper')}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="monitor-target">
                    {t('monitor.settings.target.label')}
                  </label>
                  <input
                    id="monitor-target"
                    type="text"
                    className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder={t('monitor.settings.target.placeholder')}
                    value={form.targetChatId}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, targetChatId: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="inline-flex items-center justify-center rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300"
                >
                  {t('monitor.settings.actions.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving
                    ? t('monitor.settings.actions.saving') ?? t('monitor.settings.actions.save')
                    : t('monitor.settings.actions.save')}
                </button>
              </div>

              {statusMessage && (
                <p
                  className={`mt-3 text-sm ${
                    statusMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {statusMessage.text}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const monitorCards = useMemo(() => {
    if (monitors.length === 0) {
      return (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          {t('monitor.settings.empty')}
        </div>
      );
    }

    return (
      <div className="mt-6 space-y-4">
        {monitors.map((monitor) => {
          const summary =
            monitor.type === 'points'
              ? t('monitor.settings.summary.points').replace(
                  '{threshold}',
                  monitor.threshold.toString()
                )
              : t('monitor.settings.summary.downloads')
                  .replace('{code}', monitor.linkCode)
                  .replace('{metric}', metricLabel(monitor.metric))
                  .replace('{threshold}', monitor.threshold.toString());
          const channel = t('monitor.settings.summary.channel').replace(
            '{target}',
            monitor.target
          );
          return (
            <div key={monitor.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-gray-900">{summary}</p>
                  <p className="mt-1 text-sm text-gray-600">{monitor.message}</p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-blue-600">
                    {channel}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }, [metricLabel, monitors, t]);

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-600">{t('monitor.settings.listTitle')}</p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500"
        >
          {t('monitor.settings.addButton')}
        </button>
      </div>

      {monitorCards}
      {renderModal()}
    </div>
  );
}
