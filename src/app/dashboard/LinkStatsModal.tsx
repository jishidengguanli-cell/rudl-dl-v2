'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardLink } from '@/lib/dashboard';
import { useI18n } from '@/i18n/provider';

type Frequency = 'year' | 'month' | 'day' | 'hour';

type StatsPoint = {
  bucket: string;
  apk: number;
  ipa: number;
  total: number;
};

type StatsSummary = {
  totalApk: number;
  totalIpa: number;
  total: number;
  from: string;
  to: string;
  bucketCount: number;
};

type StatsResponse =
  | { ok: true; points: StatsPoint[]; summary: StatsSummary }
  | { ok: false; error: string };

const FREQUENCY_OPTIONS: Frequency[] = ['day', 'hour', 'month', 'year'];
const DISABLED_FREQUENCIES = new Set<Frequency>(['hour']);

const CHART_COLORS: Record<'apk' | 'ipa' | 'total', string> = {
  apk: '#0ea5e9',
  ipa: '#f97316',
  total: '#10b981',
};

const PLATFORM_ORDER: Array<'apk' | 'ipa' | 'total'> = ['apk', 'ipa', 'total'];

const toLocalInputValue = (date: Date) => {
  const value = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return value.toISOString().slice(0, 16);
};

const fromLocalInputValue = (value: string) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const formatterOptions: Record<Frequency, Intl.DateTimeFormatOptions> = {
  year: { year: 'numeric' },
  month: { year: 'numeric', month: 'short' },
  day: { year: 'numeric', month: 'short', day: 'numeric' },
  hour: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit' },
};

type LineChartSeries = {
  key: 'apk' | 'ipa' | 'total';
  color: string;
  label: string;
};

function LineChart({
  data,
  series,
  locale,
  frequency,
  ariaLabel,
}: {
  data: StatsPoint[];
  series: LineChartSeries[];
  locale: string;
  frequency: Frequency;
  ariaLabel: string;
}) {
  const viewWidth = 960;
  const viewHeight = 360;
  const paddingX = 72;
  const paddingY = 56;
  const innerWidth = viewWidth - paddingX * 2;
  const innerHeight = viewHeight - paddingY * 2;

  const maxValue = Math.max(
    1,
    ...series.map((s) => Math.max(...data.map((point) => point[s.key]))),
  );

  const xForIndex = (index: number) => {
    if (data.length <= 1 || innerWidth <= 0) return paddingX;
    const ratio = index / (data.length - 1);
    return paddingX + ratio * innerWidth;
  };

  const yForValue = (value: number) => {
    if (maxValue === 0 || innerHeight <= 0) return viewHeight - paddingY;
    const ratio = value / maxValue;
    return viewHeight - paddingY - ratio * innerHeight;
  };

  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, formatterOptions[frequency]),
    [locale, frequency],
  );

  const tickIndices = useMemo(() => {
    if (data.length === 0) return [];
    if (data.length <= 6) return data.map((_, index) => index);
    const step = Math.max(1, Math.floor(data.length / 6));
    const indices: number[] = [];
    for (let idx = 0; idx < data.length; idx += step) {
      indices.push(idx);
    }
    if (indices[indices.length - 1] !== data.length - 1) {
      indices[indices.length - 1] = data.length - 1;
    }
    return indices;
  }, [data]);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        role="img"
        aria-label={ariaLabel}
        className="block w-full"
        height={viewHeight}
      >
        <title>{ariaLabel}</title>
        <rect
          x={paddingX}
          y={paddingY}
          width={innerWidth}
          height={innerHeight}
          fill="#f8fafc"
          stroke="#dbeafe"
          strokeWidth={1}
          rx={14}
        />

        {series.map((serie) => {
          const path = data
            .map((point, index) => {
              const x = xForIndex(index);
              const y = yForValue(point[serie.key]);
              return `${index === 0 ? 'M' : 'L'}${x},${y}`;
            })
            .join(' ');

          return (
            <g key={serie.key}>
              <path
                d={path}
                fill="none"
                stroke={serie.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {data.map((point, index) => {
                const value = point[serie.key];
                const x = xForIndex(index);
                const y = yForValue(value);
                return (
                  <circle
                    key={`${serie.key}-${point.bucket}`}
                    cx={x}
                    cy={y}
                    r={value > 0 ? 3 : 2}
                    fill={serie.color}
                    opacity={value > 0 ? 0.9 : 0.5}
                  />
                );
              })}
            </g>
          );
        })}

        <line
          x1={paddingX}
          x2={paddingX}
          y1={paddingY}
          y2={viewHeight - paddingY}
          stroke="#94a3b8"
          strokeWidth={1.25}
        />
        <line
          x1={paddingX}
          x2={viewWidth - paddingX}
          y1={viewHeight - paddingY}
          y2={viewHeight - paddingY}
          stroke="#94a3b8"
          strokeWidth={1.25}
        />

        {tickIndices.map((index) => {
          const point = data[index];
          const x = xForIndex(index);
          const label = formatter.format(new Date(point.bucket));
          return (
            <g key={`tick-${point.bucket}`} transform={`translate(${x},${viewHeight - paddingY})`}>
              <line y2={8} stroke="#94a3b8" strokeWidth={1} />
              <text
                y={26}
                fill="#475569"
                fontSize={12}
                textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
              >
                {label}
              </text>
            </g>
          );
        })}

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = Math.round(maxValue * ratio);
          const y = yForValue(value);
          return (
            <g key={`grid-${ratio}`} transform={`translate(0,${y})`}>
              <line
                x1={paddingX}
                x2={viewWidth - paddingX}
                stroke="#e2e8f0"
                strokeWidth={1}
                strokeDasharray="6 6"
              />
              <text
                x={paddingX - 10}
                fill="#475569"
                fontSize={12}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {value.toLocaleString(locale)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type Props = {
  open: boolean;
  link: DashboardLink;
  onClose: () => void;
};

export default function LinkStatsModal({ open, link, onClose }: Props) {
  const { t, locale } = useI18n();
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('day');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Array<'apk' | 'ipa' | 'total'>>([
    'apk',
    'ipa',
    'total',
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsPoint[]>([]);
  const [summary, setSummary] = useState<StatsSummary | null>(null);

  const resetState = useCallback(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    setFromValue(toLocalInputValue(weekAgo));
    setToValue(toLocalInputValue(now));
    setFrequency('day');
    setSelectedPlatforms(['apk', 'ipa', 'total']);
    setStats([]);
    setSummary(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (open) {
      resetState();
    }
  }, [open, resetState, link.id]);

  const fetchStats = useCallback(async () => {
    const fromDate = fromLocalInputValue(fromValue);
    const toDate = fromLocalInputValue(toValue);
    if (!fromDate || !toDate) {
      setError('INVALID_RANGE');
      return;
    }
    if (fromDate.getTime() > toDate.getTime()) {
      setError('INVALID_RANGE');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        frequency,
      });
      const res = await fetch(`/api/distributions/${encodeURIComponent(link.id)}/stats?${params.toString()}`, {
        cache: 'no-store',
      });
      const json = (await res.json()) as StatsResponse;
      if (!json.ok) {
        setError(json.error ?? 'UNKNOWN');
        setStats([]);
        setSummary(null);
        return;
      }
      setStats(json.points);
      setSummary(json.summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStats([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [fromValue, toValue, frequency, link.id]);

  useEffect(() => {
    if (open) {
      fetchStats();
    }
  }, [open, fetchStats]);

  const frequencyLabels = useMemo(
    () =>
      ({
        year: t('dashboard.linkInfo.frequency.year'),
        month: t('dashboard.linkInfo.frequency.month'),
        day: t('dashboard.linkInfo.frequency.day'),
        hour: t('dashboard.linkInfo.frequency.hour'),
      }) as Record<Frequency, string>,
    [t],
  );

  const activeSeries: LineChartSeries[] = useMemo(
    () =>
      PLATFORM_ORDER.filter((key) => selectedPlatforms.includes(key)).map((key) => ({
        key,
        color: CHART_COLORS[key],
        label:
          key === 'total'
            ? t('dashboard.downloadsTotal')
            : key === 'apk'
            ? t('dashboard.downloadsApk')
            : t('dashboard.downloadsIpa'),
      })),
    [selectedPlatforms, t],
  );

  const summaryItems = useMemo(() => {
    if (!summary) return [];
    return [
      {
        key: 'apk' as const,
        label: t('dashboard.downloadsApk'),
        value: summary.totalApk,
      },
      {
        key: 'ipa' as const,
        label: t('dashboard.downloadsIpa'),
        value: summary.totalIpa,
      },
      {
        key: 'total' as const,
        label: t('dashboard.downloadsTotal'),
        value: summary.total,
      },
    ];
  }, [summary, t]);

  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, formatterOptions[frequency]),
    [locale, frequency],
  );

  const errorMessage = useMemo(() => {
    if (!error) return null;
    if (error === 'RANGE_TOO_LARGE') return t('dashboard.linkInfo.rangeTooLarge');
    if (error === 'INVALID_RANGE') return t('dashboard.linkInfo.error');
    return t('dashboard.linkInfo.error');
  }, [error, t]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 transition ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={t('dashboard.linkInfo.title')}
    >
      <div className="relative flex w-full max-w-7xl flex-col gap-6 rounded-xl bg-white p-6 shadow-2xl max-h-full overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{t('dashboard.linkInfo.title')}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {t('table.code')}: <span className="font-mono text-gray-700">{link.code}</span>
            </p>
            {link.title ? (
              <p className="text-sm text-gray-500">
                {t('table.title')}: <span className="font-semibold text-gray-700">{link.title}</span>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-full border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            onClick={onClose}
          >
            <span className="sr-only">Close</span>
            &times;
          </button>
        </div>

        <div className="grid gap-4 rounded-lg border border-gray-200 p-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('dashboard.linkInfo.timeRange')}</label>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-gray-500" htmlFor="stats-from">
                {t('dashboard.linkInfo.from')}
              </label>
              <input
                id="stats-from"
                type="datetime-local"
                value={fromValue}
                onChange={(event) => setFromValue(event.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-gray-500" htmlFor="stats-to">
                {t('dashboard.linkInfo.to')}
              </label>
              <input
                id="stats-to"
                type="datetime-local"
                value={toValue}
                onChange={(event) => setToValue(event.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="stats-frequency">
                {t('dashboard.linkInfo.frequency')}
              </label>
              <select
                id="stats-frequency"
                className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                value={frequency}
                onChange={(event) => {
                  const next = event.target.value as Frequency;
                  if (DISABLED_FREQUENCIES.has(next)) return;
                  setFrequency(next);
                }}
              >
                {FREQUENCY_OPTIONS.map((option) => {
                  const disabled = DISABLED_FREQUENCIES.has(option);
                  return (
                    <option key={option} value={option} disabled={disabled}>
                      {frequencyLabels[option]}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-gray-700">{t('dashboard.linkInfo.platforms')}</span>
              <div className="flex flex-wrap gap-3">
                {PLATFORM_ORDER.map((platform) => {
                  const label =
                    platform === 'total'
                      ? t('dashboard.downloadsTotal')
                      : platform === 'apk'
                      ? t('dashboard.downloadsApk')
                      : t('dashboard.downloadsIpa');
                  const checked = selectedPlatforms.includes(platform);
                  return (
                    <label key={platform} className="flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedPlatforms((current) => {
                            if (checked) {
                              const next = current.filter((item) => item !== platform);
                              return next.length ? next : current;
                            }
                            return [...current, platform];
                          });
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={fetchStats}
              className="inline-flex items-center justify-center rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading}
            >
              {loading ? t('status.loading') : t('dashboard.linkInfo.apply')}
            </button>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}

        <div className="rounded-lg border border-gray-200 p-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500">{t('status.loading')}</div>
          ) : stats.length && activeSeries.length ? (
            <LineChart
              data={stats}
              series={activeSeries}
              locale={locale}
              frequency={frequency}
              ariaLabel={t('dashboard.linkInfo.title')}
            />
          ) : (
            <div className="py-10 text-center text-sm text-gray-500">{t('dashboard.linkInfo.noData')}</div>
          )}
        </div>

        <div className="grid gap-4 rounded-lg border border-gray-200 p-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">{t('dashboard.linkInfo.totalDownloads')}</h3>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {summaryItems.map((item) => (
                <div key={item.key} className="flex items-center justify-between rounded bg-gray-50 px-3 py-2 text-sm">
                  <span className="font-medium text-gray-600">{item.label}</span>
                  <span className="font-mono text-gray-900">{item.value.toLocaleString(locale)}</span>
                </div>
              ))}
            </div>
            {summary ? (
              <p className="mt-3 text-xs text-gray-500">
                {formatter.format(new Date(summary.from))} &rarr; {formatter.format(new Date(summary.to))}{' '}
                {t('dashboard.linkInfo.table.selected').replace(
                  '{count}',
                  summary.bucketCount.toLocaleString(locale)
                )}
              </p>
            ) : null}
          </div>

          <div className="max-h-64 overflow-y-auto overflow-x-auto pr-1">
            <table className="min-w-full table-fixed text-left text-xs text-gray-600">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-2 py-1 font-semibold text-gray-700">{t('dashboard.linkInfo.table.time')}</th>
                  {activeSeries.map((seriesItem) => (
                    <th key={seriesItem.key} className="px-2 py-1 font-semibold text-gray-700">
                      {seriesItem.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((point) => {
                  const formatted = formatter.format(new Date(point.bucket));
                  return (
                    <tr key={point.bucket} className="border-b border-gray-100 last:border-0">
                      <td className="px-2 py-1 font-medium text-gray-700">{formatted}</td>
                      {activeSeries.map((seriesItem) => (
                        <td key={`${point.bucket}-${seriesItem.key}`} className="px-2 py-1 text-gray-600">
                          {point[seriesItem.key].toLocaleString(locale)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {stats.length ? (
              <p className="mt-2 text-right text-xs text-gray-500">
                {t('dashboard.linkInfo.table.selected').replace('{count}', stats.length.toString())}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
