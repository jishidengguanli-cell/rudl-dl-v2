'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { isRegionalNetworkArea } from '@/lib/network-area';

type MonitorLink = {
  id: string;
  code: string;
  title: string | null;
  networkArea: string;
};

type AnalyticsWatcherSettings = {
  httpErrors: boolean;
  buttonErrors: boolean;
  lcp: boolean;
  inp: boolean;
  testMode: boolean;
};

type AnalyticsWatcher = {
  id: string;
  linkId: string;
  linkCode: string;
  linkTitle: string | null;
  linkNetworkArea: string;
  linkIsActive: boolean;
  chatId: string;
  isActive: boolean;
  settings: AnalyticsWatcherSettings;
};

type FormState = {
  linkId: string;
  chatId: string;
  httpErrors: boolean;
  buttonErrors: boolean;
  lcp: boolean;
  inp: boolean;
  isActive: boolean;
  testMode: boolean;
};

type Props = {
  links: MonitorLink[];
};

const defaultForm = (): FormState => ({
  linkId: '',
  chatId: '',
  httpErrors: true,
  buttonErrors: true,
  lcp: true,
  inp: true,
  isActive: true,
  testMode: false,
});

const metricBadges = (
  settings: AnalyticsWatcherSettings,
  t: ReturnType<typeof useI18n>['t']
): string[] => {
  const badges: string[] = [];
  if (settings.httpErrors) badges.push(t('monitor.analytics.metric.http'));
  if (settings.buttonErrors) badges.push(t('monitor.analytics.metric.button'));
  if (settings.lcp) badges.push(t('monitor.analytics.metric.lcp'));
  if (settings.inp) badges.push(t('monitor.analytics.metric.inp'));
  if (settings.testMode) badges.push(t('monitor.analytics.metric.testMode'));
  return badges;
};

export default function MonitorAnalyticsClient({ links }: Props) {
  const { t } = useI18n();
  const [watchers, setWatchers] = useState<AnalyticsWatcher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => defaultForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const allowedLinks = useMemo(
    () => links.filter((link) => !isRegionalNetworkArea(link.networkArea)),
    [links]
  );
  const blockedLinks = useMemo(
    () => links.filter((link) => isRegionalNetworkArea(link.networkArea)),
    [links]
  );

  const loadWatchers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/monitor/analytics', {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; watchers?: AnalyticsWatcher[] }
        | null;
      if (response.ok && data?.ok && Array.isArray(data.watchers)) {
        setWatchers(data.watchers);
      } else {
        setError(data?.error ?? 'UNKNOWN_ERROR');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWatchers();
  }, [loadWatchers]);

  const resetForm = useCallback(() => {
    setForm(defaultForm());
    setEditingId(null);
    setStatus(null);
  }, []);

  const startEdit = (watcher: AnalyticsWatcher) => {
    setEditingId(watcher.id);
    setForm({
      linkId: watcher.linkId,
      chatId: watcher.chatId,
      httpErrors: watcher.settings.httpErrors,
      buttonErrors: watcher.settings.buttonErrors,
      lcp: watcher.settings.lcp,
      inp: watcher.settings.inp,
      isActive: watcher.isActive,
      testMode: watcher.settings.testMode ?? false,
    });
    setStatus(null);
  };

  const handleInputChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const selectableLinks = useMemo(() => {
    if (editingId && form.linkId) {
      const existing = links.find((link) => link.id === form.linkId);
      if (existing && !allowedLinks.some((link) => link.id === existing.id)) {
        return [...allowedLinks, existing];
      }
    }
    return allowedLinks;
  }, [allowedLinks, editingId, form.linkId, links]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const payload: Record<string, unknown> = {
        chatId: form.chatId,
        httpErrors: form.httpErrors,
        buttonErrors: form.buttonErrors,
        lcp: form.lcp,
        inp: form.inp,
        isActive: form.isActive,
        testMode: form.testMode,
      };
      let method: 'POST' | 'PATCH' = 'POST';
      if (editingId) {
        method = 'PATCH';
        payload.id = editingId;
      } else {
        payload.linkId = form.linkId;
        if (!payload.linkId) {
          setSaving(false);
          setStatus({
            type: 'error',
            text: t('monitor.analytics.missingLink'),
          });
          return;
        }
      }

      const response = await fetch('/api/monitor/analytics', {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; watcher?: AnalyticsWatcher }
        | null;

      if (response.ok && data?.ok && data.watcher) {
        setWatchers((prev) => {
          if (editingId) {
            return prev.map((item) => (item.id === editingId ? data.watcher! : item));
          }
          return [data.watcher!, ...prev];
        });
        setStatus({ type: 'success', text: t('monitor.analytics.status.success') });
        if (!editingId) {
          setForm(defaultForm());
        } else {
          setEditingId(null);
          setForm(defaultForm());
        }
      } else {
        const detail = data?.error ?? 'UNKNOWN_ERROR';
        setStatus({
          type: 'error',
          text: t('monitor.analytics.status.error').replace('{error}', detail),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({
        type: 'error',
        text: t('monitor.analytics.status.error').replace('{error}', message),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (watcher: AnalyticsWatcher) => {
    setDeletingId(watcher.id);
    setStatus(null);
    try {
      const response = await fetch('/api/monitor/analytics', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ id: watcher.id }),
      });
      if (response.ok) {
        setWatchers((prev) => prev.filter((item) => item.id !== watcher.id));
        setStatus({ type: 'success', text: t('monitor.analytics.deleteSuccess') });
        if (editingId === watcher.id) {
          resetForm();
        }
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        const detail = data?.error ?? 'UNKNOWN_ERROR';
        setStatus({
          type: 'error',
          text: t('monitor.analytics.deleteError').replace('{error}', detail),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({
        type: 'error',
        text: t('monitor.analytics.deleteError').replace('{error}', message),
      });
    } finally {
      setDeletingId(null);
    }
  };

  const renderWatcherCard = (watcher: AnalyticsWatcher) => {
    const labels = metricBadges(watcher.settings, t).join(', ');
    const linkLabel = watcher.linkTitle
      ? `${watcher.linkTitle} (${watcher.linkCode})`
      : watcher.linkCode;
    return (
      <div key={watcher.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-gray-900">{linkLabel}</p>
            <p className="text-sm text-gray-600">
              {t('monitor.analytics.badge.chat').replace('{chatId}', watcher.chatId)}
            </p>
            <p className="text-xs text-gray-500">
              {t('monitor.analytics.badge.metrics').replace('{metrics}', labels || '-')}
            </p>
            {watcher.settings.testMode && (
              <p className="mt-1 inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                {t('monitor.analytics.testModeBadge')}
              </p>
            )}
            {!watcher.linkIsActive && (
              <p className="mt-1 text-xs text-orange-500">
                {t('monitor.analytics.linkInactive')}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => startEdit(watcher)}
              className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900"
            >
              {t('monitor.analytics.actions.edit')}
            </button>
            <button
              type="button"
              onClick={() => handleDelete(watcher)}
              disabled={deletingId === watcher.id}
              className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deletingId === watcher.id
                ? t('monitor.analytics.deleting')
                : t('monitor.analytics.actions.delete')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-6 space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-semibold text-gray-900">
              {editingId
                ? t('monitor.analytics.editTitle')
                : t('monitor.analytics.createTitle')}
            </p>
            <p className="text-sm text-gray-600">{t('monitor.analytics.description')}</p>
          </div>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              {t('monitor.analytics.actions.cancelEdit')}
            </button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col text-sm font-medium text-gray-700">
            {t('monitor.analytics.linkLabel')}
            <select
              value={form.linkId}
              onChange={(event) => handleInputChange('linkId', event.target.value)}
              disabled={Boolean(editingId) || selectableLinks.length === 0}
              className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">{t('monitor.analytics.linkPlaceholder')}</option>
              {selectableLinks.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.title ? `${link.title} (${link.code})` : link.code}
                </option>
              ))}
            </select>
            {selectableLinks.length === 0 && (
              <span className="mt-1 text-xs text-red-500">
                {t('monitor.analytics.noEligibleLinks')}
              </span>
            )}
          </label>

          <label className="flex flex-col text-sm font-medium text-gray-700">
            {t('monitor.analytics.chatLabel')}
            <input
              type="text"
              value={form.chatId}
              onChange={(event) => handleInputChange('chatId', event.target.value)}
              className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder={t('monitor.analytics.chatPlaceholder')}
              required
            />
            <span className="mt-1 text-xs text-gray-500">
              {t('monitor.analytics.chatHelp')}
            </span>
          </label>
        </div>

        <fieldset className="space-y-2 rounded-lg border border-gray-100 p-4">
          <legend className="text-sm font-medium text-gray-700">
            {t('monitor.analytics.metricsLabel')}
          </legend>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.httpErrors}
              onChange={(event) => handleInputChange('httpErrors', event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t('monitor.analytics.metric.http')}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.buttonErrors}
              onChange={(event) => handleInputChange('buttonErrors', event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t('monitor.analytics.metric.button')}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.lcp}
              onChange={(event) => handleInputChange('lcp', event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t('monitor.analytics.metric.lcp')}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.inp}
              onChange={(event) => handleInputChange('inp', event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t('monitor.analytics.metric.inp')}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => handleInputChange('isActive', event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t('monitor.analytics.metric.enabled')}
          </label>
        </fieldset>

        <div className="rounded-lg border border-dashed border-gray-200 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={form.testMode}
              onChange={(event) => handleInputChange('testMode', event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t('monitor.analytics.testModeLabel')}
          </label>
          <p className="mt-1 text-xs text-gray-500">{t('monitor.analytics.testModeHint')}</p>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={resetForm}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300"
          >
            {t('monitor.analytics.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving || (!form.linkId && !editingId)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving
              ? t('monitor.analytics.saving')
              : editingId
              ? t('monitor.analytics.saveEdit')
              : t('monitor.analytics.save')}
          </button>
        </div>

        {status && (
          <p
            className={`text-sm ${
              status.type === 'success' ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {status.text}
          </p>
        )}
      </form>

      {blockedLinks.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p>{t('monitor.analytics.unsupportedLink')}</p>
          <ul className="mt-1 list-disc pl-5">
            {blockedLinks.map((link) => (
              <li key={link.id}>
                {t('monitor.analytics.blockedLink').replace('{code}', link.code)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-900">{t('monitor.analytics.listTitle')}</p>
          <button
            type="button"
            onClick={loadWatchers}
            className="text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            {t('monitor.analytics.refresh')}
          </button>
        </div>
        {loading && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            {t('monitor.analytics.loading')}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {t('monitor.analytics.loadError').replace('{error}', error)}
          </div>
        )}
        {!loading && !error && watchers.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
            {t('monitor.analytics.empty')}
          </div>
        )}
        {!loading && !error && watchers.length > 0 && (
          <div className="space-y-4">{watchers.map(renderWatcherCard)}</div>
        )}
      </div>
    </div>
  );
}
