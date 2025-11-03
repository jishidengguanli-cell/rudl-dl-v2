'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardLink } from '@/lib/dashboard';
import { useI18n } from '@/i18n/provider';

type Frequency = 'year' | 'month' | 'day' | 'hour' | 'minute';

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

const FREQUENCY_OPTIONS: Frequency[] = ['day', 'hour', 'minute', 'month', 'year'];

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
  minute: {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
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
  const width = 720;
  const height = 260;
  const padding = 40;

  const maxValue = Math.max(
    1,
    ...series.map((s) => Math.max(...data.map((point) => point[s.key]))),
  );

  const xForIndex = (index: number) => {
    if (data.length <= 1) return padding;
    const ratio = index / (data.length - 1);
    return padding + ratio * (width - padding * 2);
  };

  const yForValue = (value: number) => {
    if (maxValue === 0) return height - padding;
    const ratio = value / maxValue;
    return height - padding - ratio * (height - padding * 2);
  };

  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, formatterOptions[frequency]),
    [locale, frequency],
  );

  const tickIndices = useMemo(() => {
    if (data.length === 0) return [];
    if (data.length <= 4) return data.map((_, index) => index);
    const step = Math.max(1, Math.floor(data.length / 4));
    const indices = [];
    for (let idx = 0; idx < data.length; idx += step) {
      indices.push(idx);
    }
    if (indices[indices.length - 1] !== data.length - 1) {
      indices[indices.length - 1] = data.length - 1;
    }
    return indices;
  }, [data]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className="h-60 w-full"
    >
      <rect
        x={padding}
        y={padding}
        width={width - padding * 2}
        height={height - padding * 2}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={1}
      />
      {series.map((item) => {
        const path = data
          .map((point, index) => {
            const x = xForIndex(index);
            const y = yForValue(point[item.key]);
            return `${index === 0 ? 'M' : 'L'}${x},${y}`;
          })
          .join(' ');
        return (
          <g key={item.key}>
            <path d={path} fill="none" stroke={item.color} strokeWidth={2} />
            {data.map((point, index) => {
              const value = point[item.key];
              const x = xForIndex(index);
              const y = yForValue(value);
              return (
                <circle
                  key={`${item.key}-${index}`}
                  cx={x}
                  cy={y}
                  r={value > 0 ? 2.5 : 1.5}
                  fill={item.color}
                  opacity={value > 0 ? 0.9 : 0.4}
                />
              );
            })}
          </g>
        );
      })}

      <line
        x1={padding}
        x2={width - padding}
        y1={height - padding}
        y2={height - padding}
        stroke="#9ca3af"
        strokeWidth={1}
      />
      {tickIndices.map((index) => {
        const bucket = data[index];
        const label = formatter.format(new Date(bucket.bucket));
        const x = xForIndex(index);
        return (
          <g key={`tick-${index}`} transform={`translate(${x},${height - padding})`}>
            <line y2={6} stroke="#9ca3af" strokeWidth={1} />
            <text
              y={20}
              fill="#4b5563"
              fontSize={10}
              textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
            >
              {label}
            </text>
          </g>
        );
      })}

      <line
        x1={padding}
        x2={padding}
        y1={padding}
        y2={height - padding}
        stroke="#9ca3af"
        strokeWidth={1}
      />
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const value = Math.round(maxValue * ratio);
        const y = yForValue(value);
        return (
          <g key={`grid-${ratio}`} transform={`translate(0,${y})`}>
            <line
              x1={padding}
              x2={width - padding}
              stroke="#e5e7eb"
              strokeWidth={0.5}
              strokeDasharray="4 4"
            />
            <text x={padding - 8} fill="#4b5563" fontSize={10} textAnchor="end" dominantBaseline="middle">
              {value.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
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
  const [minuteInterval, setMinuteInterval] = useState(15);
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
    setMinuteInterval(15);
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
      if (frequency === 'minute') {
        params.set('minuteInterval', String(Math.max(1, Math.min(240, minuteInterval))));
      }
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
  }, [fromValue, toValue, frequency, minuteInterval, link.id]);

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
        minute: t('dashboard.linkInfo.frequency.minute'),
      }) as Record<Frequency, string>,
    [t],
  );

  const isMinuteFrequency = frequency === 'minute';

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
      <div className="relative flex w-full max-w-5xl flex-col gap-6 rounded-xl bg-white p-6 shadow-2xl max-h-full overflow-y-auto">
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
                onChange={(event) => setFrequency(event.target.value as Frequency)}
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {frequencyLabels[option]}
                  </option>
                ))}
              </select>
            </div>

            {frequency === 'minute' ? (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-gray-500" htmlFor="stats-minute-step">
                  {t('dashboard.linkInfo.minuteInterval')}
                </label>
                <input
                  id="stats-minute-step"
                  type="number"
                  min={1}
                  max={240}
                  value={minuteInterval}
                  onChange={(event) => setMinuteInterval(Number(event.target.value) || 1)}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  disabled
                />
              </div>
            ) : null}

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
              disabled={loading || isMinuteFrequency}
              title={isMinuteFrequency ? t('dashboard.linkInfo.minuteDisabled') : undefined}
            >
              {loading ? t('status.loading') : t('dashboard.linkInfo.apply')}
            </button>
            {isMinuteFrequency ? (
              <p className="text-xs text-gray-500">{t('dashboard.linkInfo.minuteDisabled')}</p>
            ) : null}
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

          <div className="overflow-x-auto">
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
                {stats.slice(-10).map((point) => {
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
            {stats.length > 10 ? (
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
