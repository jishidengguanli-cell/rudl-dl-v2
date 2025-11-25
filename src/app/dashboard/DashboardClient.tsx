'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { isLanguageCode } from '@/lib/language';
import { useI18n } from '@/i18n/provider';
import type { DashboardLink, DashboardPage } from '@/lib/dashboard';
import type { Locale } from '@/i18n/dictionary';
import { getPublicCnDownloadDomain } from '@/lib/cn-domain';
import { getPublicRuDownloadDomain } from '@/lib/ru-domain';
import type { NetworkArea } from '@/lib/network-area';
import AddDistributionModal from './AddDistributionModal';
import LinkStatsModal from './LinkStatsModal';

type Props = {
  initialData: DashboardPage;
  initialLocale: Locale;
  fetchUrl?: string;
  allowManage?: boolean;
  showBalance?: boolean;
};

const formatDate = (value: number) => {
  if (!value) return '';
  const date = new Date(value * 1000);
  return date.toLocaleString();
};

const formatSize = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const formatCount = (value: number | null | undefined) => {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (safe >= 1000) {
    const formatted = (safe / 1000).toFixed(1);
    return `${formatted}K`;
  }
  return String(safe);
};

const CN_DOWNLOAD_DOMAIN = getPublicCnDownloadDomain();
const RU_DOWNLOAD_DOMAIN = getPublicRuDownloadDomain();

const getShareUrl = (code: string, area: NetworkArea, hydrated: boolean) => {
  if (area === 'CN') {
    return `${CN_DOWNLOAD_DOMAIN}/d/${code}`;
  }
  if (area === 'RU') {
    return `${RU_DOWNLOAD_DOMAIN}/d/${code}`;
  }
  if (hydrated && typeof window !== 'undefined') {
    return `${window.location.origin}/d/${code}`;
  }
  return `/d/${code}`;
};

const fallbackCopy = (text: string) => {
  if (typeof document === 'undefined') {
    throw new Error('UNAVAILABLE');
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
};

export default function DashboardClient({
  initialData,
  initialLocale,
  fetchUrl = '/api/dashboard/links',
  allowManage = true,
  showBalance = true,
}: Props) {
  const { t, locale, setLocale: setProviderLocale } = useI18n();
  const [data, setData] = useState<DashboardPage>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingLink, setEditingLink] = useState<DashboardLink | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DashboardLink | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'pending'>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [statsLink, setStatsLink] = useState<DashboardLink | null>(null);
  const [testPending, setTestPending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    setIsHydrated(true);
    if (isLanguageCode(initialLocale)) {
      setProviderLocale(initialLocale);
    }
  }, [initialLocale, setProviderLocale]);

  const rechargeHref = locale === 'en' ? '/recharge' : `/${locale}/recharge`;

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data.total ?? 0) / data.pageSize)),
    [data.total, data.pageSize]
  );

  const fetchPage = async (pageNumber: number) => {
    const safePage = Math.min(Math.max(pageNumber, 1), totalPages || 1);
    setLoading(true);
    setError(null);
    try {
      const target = `${fetchUrl}?page=${safePage}&pageSize=${data.pageSize}`;
      const res = await fetch(target, { cache: 'no-store' });
      const json: { ok: boolean; error?: string } & DashboardPage = await res.json();
      if (!json.ok) {
        throw new Error(json.error ?? 'UNKNOWN_ERROR');
      }
      setData(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = async (nextPage: number) => {
    if (nextPage === data.page || nextPage < 1 || nextPage > totalPages) return;
    await fetchPage(nextPage);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingLink(null);
  };

  const openStatsModal = (link: DashboardLink) => {
    setStatsLink(link);
  };

  const closeStatsModal = () => {
    setStatsLink(null);
  };

  const openCreateModal = () => {
    if (!allowManage) return;
    setModalMode('create');
    setEditingLink(null);
    setModalOpen(true);
  };

  const openEditModal = (link: DashboardLink) => {
    if (!allowManage) return;
    setModalMode('edit');
    setEditingLink(link);
    setModalOpen(true);
  };

  const handleCreated = async () => {
    if (!allowManage) return;
    await fetchPage(1);
    closeModal();
    setToast(t('dashboard.toastCreated'));
    setTimeout(() => setToast(null), 5000);
  };

  const handleUpdated = async (linkId: string) => {
    if (!allowManage) return;
    const code = data.links.find((item) => item.id === linkId)?.code;
    await fetchPage(data.page);
    closeModal();
    setToast(code ? `${t('dashboard.toastUpdated')} (${code})` : t('dashboard.toastUpdated'));
    setTimeout(() => setToast(null), 5000);
  };

  const handleModalError = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  };

  const requestDelete = (link: DashboardLink) => {
    if (!allowManage) return;
    setDeleteTarget(link);
    setDeleteStatus('idle');
  };

  const cancelDelete = () => {
    if (!allowManage) return;
    if (deleteStatus === 'pending') return;
    setDeleteTarget(null);
    setDeleteStatus('idle');
  };

  const confirmDelete = async () => {
    if (!allowManage || !deleteTarget || deleteStatus === 'pending') return;
    setDeleteStatus('pending');
    try {
      const res = await fetch(`/api/distributions/${deleteTarget.id}`, { method: 'DELETE' });
      const json: { ok: boolean; error?: string } = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `HTTP_${res.status}`);
      }
      await fetchPage(1);
      setToast(t('dashboard.toastDeleted'));
      setTimeout(() => setToast(null), 5000);
      setDeleteTarget(null);
      setDeleteStatus('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToast(message);
      setTimeout(() => setToast(null), 5000);
      setDeleteStatus('idle');
    }
  };

  const copyLinkToClipboard = async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    fallbackCopy(text);
  };

  const handleCopyLink = async (code: string, area: NetworkArea) => {
    const url = getShareUrl(code, area, true);
    try {
      await copyLinkToClipboard(url);
      setToast(t('dashboard.toastLinkCopied'));
    } catch {
      try {
        fallbackCopy(url);
        setToast(t('dashboard.toastLinkCopied'));
      } catch {
        setToast(t('dashboard.toastLinkCopyFailed'));
      }
    }
    setTimeout(() => setToast(null), 5000);
  };

  const triggerRuTestFile = async () => {
    const now = new Date();
    const timestamp = now.toISOString();
    const sanitizedTimestamp = timestamp.replace(/[:.]/g, '-');
    const fileName = `debug/manual-test-${sanitizedTimestamp}.ini`;
    console.log('[ru-test-file] start', { timestamp, fileName });
    setTestPending(true);
    setTestResult(null);
    setTestError(null);
    try {
      console.log('[ru-test-file] calling /api/debug/ru/create-test-file');
      const response = await fetch('/api/debug/ru/create-test-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName }),
      });
      console.log('[ru-test-file] response status', response.status);
      const payload: {
        ok: boolean;
        error?: string;
        result?: {
          ok?: boolean;
          exists?: boolean;
          fileUrl?: string | null;
          key?: string | null;
          size?: number | null;
          error?: string | null;
        };
      } = await response.json();
      console.log('[ru-test-file] payload', payload);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? `HTTP_${response.status}`);
      }
      const result = payload.result;
      if (!result?.ok || !result.exists) {
        throw new Error(result?.error ?? 'RU_FILE_NOT_CONFIRMED');
      }
      const createdPath = result.fileUrl ?? result.key ?? '';
      const sizeLabel =
        typeof result.size === 'number' && Number.isFinite(result.size)
          ? ` (${result.size} bytes)`
          : '';
      setTestResult((createdPath || 'FILE_CREATED') + sizeLabel);
      console.log('[ru-test-file] success', {
        createdPath: createdPath || '(no url returned)',
        size: result.size,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTestError(message);
      console.error('[ru-test-file] failed', { error: message });
    } finally {
      setTestPending(false);
      console.log('[ru-test-file] finished');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">{t('dashboard.title')}</h2>
            {showBalance ? (
              <p className="text-sm text-gray-600">
                {t('dashboard.balanceLabel')}: <span className="font-semibold text-gray-900">{data.balance ?? 0}</span>
              </p>
            ) : null}
          </div>
          {allowManage ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Link
                href={rechargeHref}
                className="inline-flex items-center justify-center rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                {t('recharge.title')}
              </Link>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded bg-black px-3 py-1 text-sm font-medium text-white transition hover:bg-gray-800"
                onClick={openCreateModal}
              >
                {t('dashboard.addDistribution')}
              </button>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={triggerRuTestFile}
                  disabled={testPending}
                  className="inline-flex items-center justify-center rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {testPending ? '建立測試檔案中…' : 'RU 測試寫檔'}
                </button>
                {(testResult || testError) && (
                  <span className={`text-xs ${testError ? 'text-red-600' : 'text-green-600'}`}>
                    {testError ? `測試失敗：${testError}` : `測試成功：${testResult}`}
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        {error && (
          <p className="mb-3 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700">
            {t('status.unreadable')}: {error}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">{t('table.code')}</th>
                <th className="py-2 pr-4">{t('table.title')}</th>
                <th className="py-2 pr-4">{t('dashboard.table.files')}</th>
                <th className="py-2 pr-4">{t('table.language')}</th>
                <th className="py-2 pr-4">{t('dashboard.table.networkArea')}</th>
                <th className="py-2 pr-4">{t('table.active')}</th>
                <th className="py-2 pr-4">{t('table.downloads')}</th>
                <th className="py-2 pr-4">{t('dashboard.table.createdAt')}</th>
                <th className="py-2 pr-4">{t('table.actions')}</th>
                <th className="py-2 pr-4">{t('table.link')}</th>
              </tr>
            </thead>
            <tbody>
              {data.links.map((link) => {
                const shareUrl = getShareUrl(link.code, link.networkArea, isHydrated);
                return (
                  <tr key={link.id} className="border-b last:border-none">
                    <td className="py-2 pr-4 font-mono text-xs sm:text-sm whitespace-nowrap">{link.code}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{link.title ?? '-'}</td>
                    <td className="py-2 pr-4">
                      {link.files.length ? (
                        <ul className="space-y-1">
                          {link.files.map((file) => (
                            <li key={file.id} className="text-xs text-gray-600">
                              <span className="font-medium text-gray-800">{file.platform.toUpperCase()}</span>{' '}
                              · {file.version ?? '-'} · {formatSize(file.size)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-gray-500">-</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">{t(`language.name.${link.language}`)}</td>
                    <td className="py-2 pr-4">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {t(
                          link.networkArea === 'CN'
                            ? 'networkArea.cn'
                            : link.networkArea === 'RU'
                            ? 'networkArea.ru'
                            : 'networkArea.global'
                        )}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          link.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {link.isActive ? t('dashboard.activeOn') : t('dashboard.activeOff')}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <div className="space-y-1 text-xs text-gray-600 min-w-[200px]">
                        <div className="whitespace-nowrap">
                          <span className="font-semibold text-gray-700">{t('dashboard.downloadsToday')}:</span>{' '}
                          {formatCount(link.todayTotalDl)}{' '}
                          <span className="text-gray-500">
                            ({t('dashboard.downloadsApk')} {formatCount(link.todayApkDl)} / {t('dashboard.downloadsIpa')} {formatCount(link.todayIpaDl)})
                          </span>
                        </div>
                        <div className="whitespace-nowrap">
                          <span className="font-semibold text-gray-700">{t('dashboard.downloadsTotal')}:</span>{' '}
                          {formatCount(link.totalTotalDl)}{' '}
                          <span className="text-gray-500">
                            ({t('dashboard.downloadsApk')} {formatCount(link.totalApkDl)} / {t('dashboard.downloadsIpa')} {formatCount(link.totalIpaDl)})
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-600 whitespace-nowrap">
                      {isHydrated ? formatDate(link.createdAt) : ''}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="rounded border border-blue-200 px-2 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => openStatsModal(link)}
                          disabled={loading}
                        >
                          {t('dashboard.actionInfo')}
                        </button>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => allowManage && openEditModal(link)}
                          disabled={loading || !allowManage}
                          title={!allowManage ? t('dashboard.viewOnly') ?? undefined : undefined}
                        >
                          {t('dashboard.actionEdit')}
                        </button>
                        <button
                          type="button"
                          className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => allowManage && requestDelete(link)}
                          disabled={loading || !allowManage}
                          title={!allowManage ? t('dashboard.viewOnly') ?? undefined : undefined}
                        >
                          {t('dashboard.actionDelete')}
                        </button>
                      </div>
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          className="max-w-[220px] truncate text-xs text-blue-600 underline"
                          href={shareUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={shareUrl}
                        >
                          {shareUrl}
                        </a>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => handleCopyLink(link.code, link.networkArea)}
                          disabled={loading}
                        >
                          {t('dashboard.copyLink')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!data.links.length && (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={10}>
                    {loading ? t('status.loading') : t('status.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <div>
            {t('dashboard.paginationSummary')
              .replace('{page}', String(data.page))
              .replace('{pages}', String(totalPages))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              onClick={() => handlePageChange(data.page - 1)}
              disabled={loading || data.page <= 1}
            >
              {t('pagination.previous')}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              onClick={() => handlePageChange(data.page + 1)}
              disabled={loading || data.page >= totalPages}
            >
              {t('pagination.next')}
            </button>
          </div>
        </div>
      </div>

      {allowManage && modalOpen && (
        <AddDistributionModal
          open={modalOpen}
          mode={modalMode}
          initialLink={modalMode === 'edit' ? editingLink : null}
          onClose={closeModal}
          onCreated={handleCreated}
          onUpdated={handleUpdated}
          onError={handleModalError}
        />
      )}
      {statsLink ? <LinkStatsModal open={Boolean(statsLink)} link={statsLink} onClose={closeStatsModal} /> : null}

      {allowManage && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">{t('dashboard.confirmDeleteTitle')}</h3>
            <p className="mt-2 text-sm text-gray-600">
              {t('dashboard.confirmDeleteMessage').replace('{code}', deleteTarget.code)}
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={cancelDelete}
                disabled={deleteStatus === 'pending'}
              >
                {t('dashboard.cancelDelete')}
              </button>
              <button
                type="button"
                className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={confirmDelete}
                disabled={deleteStatus === 'pending'}
              >
                {deleteStatus === 'pending' ? t('status.loading') : t('dashboard.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <div className="rounded bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow">
            {t('status.loading')}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded bg-black px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
