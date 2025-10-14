'use client';

import { useState, useMemo } from 'react';
import { useI18n } from '@/i18n/provider';
import type { DashboardLink, DashboardPage } from '@/lib/dashboard';
import AddDistributionModal from './AddDistributionModal';

type Props = {
  initialData: DashboardPage;
};

const formatDate = (value: number) => {
  if (!value) return '';
  const date = new Date(value * 1000);
  return date.toLocaleString();
};

const toPlatformChips = (platform: string) =>
  platform
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

export default function DashboardClient({ initialData }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<DashboardPage>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data.total ?? 0) / data.pageSize)),
    [data.total, data.pageSize]
  );

  const handlePageChange = async (nextPage: number) => {
    if (nextPage === data.page || nextPage < 1 || nextPage > totalPages) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/links?page=${nextPage}&pageSize=${data.pageSize}`, {
        cache: 'no-store',
      });
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

  const renderPlatform = (link: DashboardLink) => {
    const chips = toPlatformChips(link.platform);
    if (!chips.length) return '-';
    return (
      <div className="flex flex-wrap gap-1">
        {chips.map((chip) => (
          <span
            key={chip}
            className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
          >
            {chip.toUpperCase()}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">{t('dashboard.title')}</h2>
            <p className="text-sm text-gray-600">
              {t('dashboard.balanceLabel')}:{' '}
              <span className="font-semibold text-gray-900">{data.balance ?? 0}</span>
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded bg-black px-3 py-1 text-sm font-medium text-white transition hover:bg-gray-800"
            onClick={() => setShowModal(true)}
          >
            {t('dashboard.addDistribution')}
          </button>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        {error && (
          <p className="mb-3 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700">
            {t('status.unreadable')}: {error}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">{t('table.code')}</th>
                <th className="py-2 pr-4">{t('table.title')}</th>
                <th className="py-2 pr-4">{t('dashboard.table.files')}</th>
                <th className="py-2 pr-4">{t('table.platform')}</th>
                <th className="py-2 pr-4">{t('table.active')}</th>
                <th className="py-2 pr-4">{t('dashboard.table.createdAt')}</th>
                <th className="py-2 pr-4">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.links.map((link) => (
                <tr key={link.id} className="border-b last:border-none">
                  <td className="py-2 pr-4 font-mono text-xs sm:text-sm">{link.code}</td>
                  <td className="py-2 pr-4">{link.title ?? '-'}</td>
                  <td className="py-2 pr-4">
                    {link.files.length ? (
                      <ul className="space-y-1">
                        {link.files.map((file) => (
                          <li key={file.id} className="text-xs text-gray-600">
                            <span className="font-medium text-gray-800">{file.platform.toUpperCase()}</span>{' '}
                            · {file.version ?? '-'} ·{' '}
                            {typeof file.size === 'number'
                              ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                              : '-'}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-gray-500">-</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{renderPlatform(link)}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        link.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {link.isActive ? 'ON' : 'OFF'}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs text-gray-600">{formatDate(link.createdAt)}</td>
                  <td className="py-2 pr-4">
                    <a
                      className="text-blue-600 underline"
                      href={`/dl/${link.code}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('action.download')}
                    </a>
                  </td>
                </tr>
              ))}

              {!data.links.length && (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={7}>
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

      {showModal && <AddDistributionModal open={showModal} onClose={() => setShowModal(false)} />}

      {loading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <div className="rounded bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow">
            {t('status.loading')}
          </div>
        </div>
      )}
    </div>
  );
}
