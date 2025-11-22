import { listActiveAnalyticsWatchers, type AnalyticsWatcher } from '../../../src/lib/analytics-watchers';
import { getTableInfo, type TableInfo } from '../../../src/lib/distribution';

const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

type WorkerEnv = {
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  CF_ACCOUNT_ID?: string;
  DOWNLOAD_PATH_PREFIX?: string;
  DOWNLOAD_HANDLER_PREFIX?: string;
  LOOKBACK_MINUTES?: string;
  HTTP_MIN_REQUESTS?: string;
  HTTP_ERROR_RATE_THRESHOLD?: string;
  WEB_VITALS_URL_FILTER?: string;
  LCP_P75_THRESHOLD_MS?: string;
  INP_P75_THRESHOLD_MS?: string;
  DB?: D1Database;
  ['rudl-app']?: D1Database;
};

type GraphQLResult<T> = {
  viewer?: T;
};

type HttpRequestGroup = {
  count?: number;
  dimensions?: {
    clientRequestPath?: string;
    clientCountryName?: string;
    edgeResponseStatus?: number;
  };
};

type HttpRequestResponse = {
  zones?: Array<{
    httpRequestsAdaptiveGroups?: HttpRequestGroup[];
  }>;
};

type RumWebVitalsGroup = {
  quantiles?: {
    valueP75?: number;
    valueP90?: number;
  };
  dimensions?: {
    metricName?: string;
    urlHost?: string;
    urlPath?: string;
    country?: string;
    deviceType?: string;
  };
};

type RumWebVitalsResponse = {
  accounts?: Array<{
    rumWebVitalsEventsAdaptiveGroups?: RumWebVitalsGroup[];
  }>;
};

type HttpAlertEvent = {
  kind: 'http' | 'button';
  code: string | null;
  path: string;
  total: number;
  errors: number;
  rate: number;
  statuses: string;
  countries: string;
  qualifies: boolean;
  failureReason?: string;
};

type WebVitalAlertEvent = {
  kind: 'lcp' | 'inp';
  code: string | null;
  url: string;
  metricName: 'LCP' | 'INP';
  p75: number;
  p90?: number | null;
  threshold: number;
  country?: string | null;
  device?: string | null;
  qualifies: boolean;
  failureReason?: string;
};

type AlertEvent = HttpAlertEvent | WebVitalAlertEvent;

type NotificationBucket = {
  ownerId: string;
  token: string;
  chatId: string;
  messages: string[];
};

const HTTP_REQUESTS_QUERY = `
  query DownloadPathErrors($zoneTag: String!, $since: Time!, $until: Time!, $pathPrefix: String!) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        httpRequestsAdaptiveGroups(
          limit: 5000
          filter: {
            datetime_geq: $since
            datetime_lt: $until
            requestSource: "eyeball"
            clientRequestPath_starts_with: $pathPrefix
          }
        ) {
          count
          dimensions {
            clientRequestPath
            clientCountryName
            edgeResponseStatus
          }
        }
      }
    }
  }
`;

const RUM_WEB_VITALS_QUERY = `
  query WebVitals(
    $accountTag: String!
    $since: Time!
    $until: Time!
    $metricNames: [String!]!
    $urlFilter: String!
  ) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        rumWebVitalsEventsAdaptiveGroups(
          limit: 200
          filter: {
            datetime_geq: $since
            datetime_lt: $until
            metricName_in: $metricNames
            url_contains: $urlFilter
          }
        ) {
          quantiles {
            valueP75
            valueP90
          }
          dimensions {
            metricName
            urlHost
            urlPath
            deviceType
            country
          }
        }
      }
    }
  }
`;

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const log = (...args: unknown[]) => console.log('[analytics-worker]', ...args);

const getDB = (env: WorkerEnv): D1Database | null => env.DB ?? env['rudl-app'] ?? null;

async function cfGraphQL<T>(env: WorkerEnv, query: string, variables: Record<string, unknown>): Promise<T> {
  if (!env.CF_API_TOKEN) {
    throw new Error('Missing CF_API_TOKEN for GraphQL request');
  }

  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!res.ok || json.errors || !json.data) {
    console.warn('[analytics-worker] GraphQL error payload', json.errors || json);
    throw new Error('Cloudflare GraphQL API error');
  }

  return json.data;
}

const summarizeHttpGroups = (groups: HttpRequestGroup[]): Map<string, HttpAlertEvent> => {
  const summary = new Map<string, HttpAlertEvent>();

  for (const group of groups) {
    const path = group.dimensions?.clientRequestPath;
    if (!path) continue;

    const status = Number(group.dimensions?.edgeResponseStatus ?? 0);
    const country = group.dimensions?.clientCountryName || 'Unknown';
    const count = Number(group.count ?? 0);

    if (!summary.has(path)) {
      summary.set(path, {
        kind: 'http',
        code: extractCodeFromPath(path),
        path,
        total: 0,
        errors: 0,
        rate: 0,
        statuses: '',
        countries: '',
        qualifies: false,
      });
    }

    const stats = summary.get(path)!;
    stats.total += count;
    if (status >= 400) {
      stats.errors += count;
      stats.statuses = stats.statuses ? `${stats.statuses}, ${status}` : `${status}`;
    }

    stats.countries = stats.countries ? `${stats.countries}, ${country}` : country;
  }

  return summary;
};

const normalizeCode = (value: string | null | undefined): string => (value ? value.trim().toLowerCase() : '');

const extractCodeFromPath = (path: string): string | null => {
  const match = path.match(/\/(?:d|dl)\/([^/?]+)/i);
  return match ? match[1] : null;
};

const formatCountries = (value: string): string => {
  const list = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set(list)).slice(0, 4).join(', ');
};

const formatStatusList = (value: string): string => {
  const counts = new Map<string, number>();
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((status) => counts.set(status, (counts.get(status) ?? 0) + 1));
  return Array.from(counts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([code, total]) => `${code} (${total})`)
    .join(', ');
};

const buildRumUrl = (dimensions: RumWebVitalsGroup['dimensions']): string => {
  const path = dimensions?.urlPath || '';
  const host = dimensions?.urlHost;
  if (host) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `https://${host}${normalizedPath}`;
  }
  return path || '';
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const formatMs = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${Math.round(value)}ms`;
};

const telegramColumnCandidates = ['telegram_bot_token', 'TELEGRAM_BOT_TOKEN'];
let telegramColumnCache: string | null | undefined;

const findColumn = (info: TableInfo, candidates: string[]): string | null => {
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    for (const column of info.columns) {
      if (column === candidate || column.toLowerCase() === lower) {
        return column;
      }
    }
  }
  return null;
};

const getTelegramColumn = async (DB: D1Database): Promise<string | null> => {
  if (telegramColumnCache !== undefined) return telegramColumnCache;
  const info = await getTableInfo(DB, 'users');
  telegramColumnCache = findColumn(info, telegramColumnCandidates);
  return telegramColumnCache;
};

const fetchTelegramTokens = async (DB: D1Database, ownerIds: string[]): Promise<Map<string, string>> => {
  const unique = Array.from(new Set(ownerIds.map((id) => id.trim()).filter(Boolean)));
  if (!unique.length) return new Map();

  const column = await getTelegramColumn(DB);
  if (!column) {
    console.warn('[analytics-worker] Telegram token column missing in users table');
    return new Map();
  }

  const placeholders = unique.map(() => '?').join(', ');
  const statement = `SELECT id, ${column} as token FROM users WHERE id IN (${placeholders})`;
  const result = await DB.prepare(statement)
    .bind(...unique)
    .all<{ id?: string; token?: string }>()
    .catch(() => null);
  const rows = result?.results ?? [];
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!row?.id || !row.token) continue;
    const token = row.token.trim();
    if (token) {
      map.set(row.id.trim(), token);
    }
  }
  return map;
};

const sendTelegram = async (token: string, chatId: string, text: string) => {
  if (!token || !chatId || !text) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    console.warn('[analytics-worker] Telegram API error', res.status, await res.text());
  }
};

const collectHttpEvents = async (
  env: WorkerEnv,
  sinceIso: string,
  untilIso: string,
  pathPrefix: string,
  kind: 'http' | 'button'
): Promise<HttpAlertEvent[]> => {
  if (!env.CF_ZONE_ID) {
    console.warn('[analytics-worker] Missing CF_ZONE_ID; skip HTTP check');
    return [];
  }

  const data = await cfGraphQL<GraphQLResult<HttpRequestResponse>>(env, HTTP_REQUESTS_QUERY, {
    zoneTag: env.CF_ZONE_ID,
    since: sinceIso,
    until: untilIso,
    pathPrefix,
  });
  const groups = data.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
  const stats = summarizeHttpGroups(groups);
  const minHits = parseNumber(env.HTTP_MIN_REQUESTS, 10);
  const threshold = parseNumber(env.HTTP_ERROR_RATE_THRESHOLD, 0.05);

  const events: HttpAlertEvent[] = [];
  for (const entry of stats.values()) {
    if (!entry.errors) continue;
    const rate = entry.errors / entry.total;
    let qualifies = true;
    let failureReason: string | undefined;
    if (entry.total < minHits) {
      qualifies = false;
      failureReason = `請求 ${entry.total} 次低於門檻 ${minHits}`;
    } else if (rate < threshold) {
      qualifies = false;
      failureReason = `錯誤率 ${(rate * 100).toFixed(1)}% 低於門檻 ${(threshold * 100).toFixed(1)}%`;
    }
    events.push({
      ...entry,
      kind,
      rate,
      statuses: formatStatusList(entry.statuses),
      countries: formatCountries(entry.countries),
      qualifies,
      failureReason,
    });
    log('http-event', {
      kind,
      code: entry.code,
      path: entry.path,
      total: entry.total,
      errors: entry.errors,
      rate,
      qualifies,
      failureReason,
    });
  }
  return events;
};

const checkDownloadErrors = (env: WorkerEnv, sinceIso: string, untilIso: string) => {
  const prefix = env.DOWNLOAD_PATH_PREFIX || '/d/';
  return collectHttpEvents(env, sinceIso, untilIso, prefix, 'http');
};

const checkDownloadButtonErrors = (env: WorkerEnv, sinceIso: string, untilIso: string) => {
  const prefix = env.DOWNLOAD_HANDLER_PREFIX || '/dl/';
  return collectHttpEvents(env, sinceIso, untilIso, prefix, 'button');
};

const checkWebVitals = async (
  env: WorkerEnv,
  sinceIso: string,
  untilIso: string
): Promise<WebVitalAlertEvent[]> => {
  if (!env.CF_ACCOUNT_ID) {
    console.warn('[analytics-worker] Missing CF_ACCOUNT_ID; skip Web Vitals check');
    return [];
  }

  const metricNames = ['LCP', 'INP'];
  const urlFilter = env.WEB_VITALS_URL_FILTER || '/d/';
  const lcpThreshold = parseNumber(env.LCP_P75_THRESHOLD_MS, 4000);
  const inpThreshold = parseNumber(env.INP_P75_THRESHOLD_MS, 400);
  const thresholds: Record<string, number> = { LCP: lcpThreshold, INP: inpThreshold };

  const data = await cfGraphQL<GraphQLResult<RumWebVitalsResponse>>(env, RUM_WEB_VITALS_QUERY, {
    accountTag: env.CF_ACCOUNT_ID,
    since: sinceIso,
    until: untilIso,
    metricNames,
    urlFilter,
  });

  const groups = data.viewer?.accounts?.[0]?.rumWebVitalsEventsAdaptiveGroups ?? [];
  const events: WebVitalAlertEvent[] = [];

  for (const group of groups) {
    const metricName = group.dimensions?.metricName;
    if (!metricName) continue;
    const threshold = thresholds[metricName];
    if (!threshold) continue;

    const p75 = toNumber(group.quantiles?.valueP75);
    if (p75 === null) continue;
    const p90 = toNumber(group.quantiles?.valueP90);
    const qualifies = p75 > threshold;
    const failureReason = qualifies ? undefined : `P75 ${formatMs(p75) ?? `${p75}ms`} 未超過門檻 ${threshold}ms`;
    const url = buildRumUrl(group.dimensions);
    const code = extractCodeFromPath(group.dimensions?.urlPath || '');

    events.push({
      kind: metricName === 'LCP' ? 'lcp' : 'inp',
      code,
      url: url || (code ? `/d/${code}` : ''),
      metricName: metricName as 'LCP' | 'INP',
      p75,
      p90,
      threshold,
      country: group.dimensions?.country,
      device: group.dimensions?.deviceType,
      qualifies,
      failureReason,
    });
    log('web-vitals-event', {
      metricName,
      code,
      url,
      p75,
      threshold,
      qualifies,
      failureReason,
    });
  }

  return events;
};

const isEventAllowed = (watcher: AnalyticsWatcher, event: AlertEvent): boolean => {
  if (event.kind === 'http') return watcher.settings.httpErrors;
  if (event.kind === 'button') return watcher.settings.buttonErrors;
  if (event.kind === 'lcp') return watcher.settings.lcp;
  if (event.kind === 'inp') return watcher.settings.inp;
  return false;
};

type MessageOptions = { test?: boolean };

const formatHttpMessage = (event: HttpAlertEvent, code: string, options?: MessageOptions): string => {
  const title = event.kind === 'http' ? '下載頁 HTTP 錯誤' : '下載按鈕觸發失敗';
  const icon = options?.test ? '🧪' : '🚨';
  const lines = [
    `${icon} *${title}*`,
    `CODE: \`${code}\``,
    `路徑: \`${event.path}\``,
    `總請求 ${event.total}，錯誤 ${event.errors} (${(event.rate * 100).toFixed(1)}%)`,
    event.statuses ? `主要狀態碼: ${event.statuses}` : null,
    event.countries ? `來源: ${event.countries}` : null,
  ];
  return lines.filter(Boolean).join('\n');
};

const formatHttpTestMessage = (event: HttpAlertEvent, code: string): string => {
  const reason = event.failureReason || '未達警報門檻';
  const lines = [
    `🧪 *測試模式：${event.kind === 'http' ? '下載頁' : '下載按鈕'} 錯誤*`,
    `CODE: \`${code}\``,
    `路徑: \`${event.path}\``,
    `總請求 ${event.total}，錯誤 ${event.errors} (${(event.rate * 100).toFixed(1)}%)`,
    event.statuses ? `主要狀態碼: ${event.statuses}` : null,
    event.countries ? `來源: ${event.countries}` : null,
    `原因: ${reason}`,
  ];
  return lines.filter(Boolean).join('\n');
};

const formatWebVitalMessage = (
  event: WebVitalAlertEvent,
  code: string,
  options?: MessageOptions
): string => {
  const p75Text = formatMs(event.p75);
  const p90Text = formatMs(event.p90 ?? null);
  const icon = options?.test ? '🧪' : '⚠️';
  const lines = [
    `${icon} *Web Vitals：${event.metricName}*`,
    `CODE: \`${code}\``,
    event.url ? `頁面: ${event.url}` : null,
    p75Text ? `P75: ${p75Text} > ${event.threshold}ms` : null,
    p90Text ? `P90: ${p90Text}` : null,
    event.country ? `國家: ${event.country}` : null,
    event.device ? `裝置: ${event.device}` : null,
  ];
  return lines.filter(Boolean).join('\n');
};

const formatWebVitalTestMessage = (event: WebVitalAlertEvent, code: string): string => {
  const p75Text = formatMs(event.p75) ?? `${event.p75}ms`;
  const p90Text = formatMs(event.p90 ?? null);
  const reason = event.failureReason || '未達警報門檻';
  const lines = [
    `🧪 *測試模式：Web Vitals ${event.metricName}*`,
    `CODE: \`${code}\``,
    event.url ? `頁面: ${event.url}` : null,
    `P75: ${p75Text}`,
    p90Text ? `P90: ${p90Text}` : null,
    `門檻: ${event.threshold}ms`,
    event.country ? `國家: ${event.country}` : null,
    event.device ? `裝置: ${event.device}` : null,
    `原因: ${reason}`,
  ];
  return lines.filter(Boolean).join('\n');
};

const queueNotification = (
  buckets: Map<string, NotificationBucket>,
  watcher: AnalyticsWatcher,
  token: string,
  message: string
) => {
  if (!message) return;
  const key = `${watcher.ownerId}:${watcher.chatId}`;
  const bucket =
    buckets.get(key) ??
    {
      ownerId: watcher.ownerId,
      token,
      chatId: watcher.chatId,
      messages: [],
    };
  bucket.messages.push(message);
  buckets.set(key, bucket);
};

export default {
  async scheduled(event: ScheduledController, env: WorkerEnv) {
    const DB = getDB(env);
    if (!DB) {
      console.error('[analytics-worker] Missing D1 binding; abort run');
      return;
    }

    const watchers = await listActiveAnalyticsWatchers(DB);
    if (!watchers.length) {
      console.log('[analytics-worker] No analytics watchers configured; skip.');
      return;
    }

    log(
      'watchers-loaded',
      watchers.map((watcher) => ({
        owner: watcher.ownerId,
        code: watcher.linkCode,
        chat: watcher.chatId,
        testMode: Boolean(watcher.settings.testMode),
      }))
    );

    const ownerIds = watchers.map((watcher) => watcher.ownerId).filter(Boolean);
    const tokens = await fetchTelegramTokens(DB, ownerIds);
    if (!tokens.size) {
      console.warn('[analytics-worker] No Telegram bot tokens available; skip run.');
      return;
    }

    const watchersByCode = new Map<string, AnalyticsWatcher[]>();
    for (const watcher of watchers) {
      const codeKey = normalizeCode(watcher.linkCode);
      if (!codeKey) continue;
      const list = watchersByCode.get(codeKey) ?? [];
      list.push(watcher);
      watchersByCode.set(codeKey, list);
    }

    const now = new Date();
    const lookbackMinutes = parseNumber(env.LOOKBACK_MINUTES, 1);
    const until = now.toISOString();
    const since = new Date(now.getTime() - lookbackMinutes * 60 * 1000).toISOString();

    const events: AlertEvent[] = [];

    try {
      events.push(...(await checkDownloadErrors(env, since, until)));
    } catch (error) {
      console.error('[analytics-worker] checkDownloadErrors failed', error);
    }

    try {
      events.push(...(await checkDownloadButtonErrors(env, since, until)));
    } catch (error) {
      console.error('[analytics-worker] checkDownloadButtonErrors failed', error);
    }

    try {
      events.push(...(await checkWebVitals(env, since, until)));
    } catch (error) {
      console.error('[analytics-worker] checkWebVitals failed', error);
    }

    if (!events.length) {
      log('events-collected', []);
      return;
    }

    log(
      'events-collected',
      events.map((event) => ({
        kind: event.kind,
        code: event.code,
        qualifies: event.qualifies,
        failureReason: event.failureReason,
      }))
    );

    const buckets = new Map<string, NotificationBucket>();

    for (const eventData of events) {
      const codeKey = normalizeCode(eventData.code);
      if (!codeKey) continue;
      const candidates = watchersByCode.get(codeKey);
      if (!candidates?.length) continue;

      for (const watcher of candidates) {
        if (!isEventAllowed(watcher, eventData)) continue;
        const token = tokens.get(watcher.ownerId);
        if (!token) {
          console.warn('[analytics-worker] Telegram token missing for owner', watcher.ownerId);
          continue;
        }

        const isTestWatcher = Boolean(watcher.settings.testMode);
        if (!eventData.qualifies && !isTestWatcher) {
          log('event-skipped', {
            code: eventData.code,
            kind: eventData.kind,
            reason: eventData.failureReason || '未達門檻',
            watcher: watcher.chatId,
          });
          continue;
        }

        const message =
          eventData.kind === 'http' || eventData.kind === 'button'
            ? eventData.qualifies
              ? formatHttpMessage(eventData, watcher.linkCode, { test: isTestWatcher })
              : formatHttpTestMessage(eventData, watcher.linkCode)
            : eventData.qualifies
            ? formatWebVitalMessage(eventData as WebVitalAlertEvent, watcher.linkCode, {
                test: isTestWatcher,
              })
            : formatWebVitalTestMessage(eventData as WebVitalAlertEvent, watcher.linkCode);

        queueNotification(buckets, watcher, token, message);
        log('event-queued', {
          code: eventData.code,
          kind: eventData.kind,
          watcher: watcher.chatId,
          qualifies: eventData.qualifies,
          testMode: isTestWatcher,
        });
      }
    }

    if (!buckets.size) return;

    const header = `監控時間：${since} ~ ${until}\n\n`;
    for (const bucket of buckets.values()) {
      const body = header + bucket.messages.join('\n\n');
      log('sending-telegram', { chatId: bucket.chatId, messageCount: bucket.messages.length });
      await sendTelegram(bucket.token, bucket.chatId, body);
    }
  },
};
