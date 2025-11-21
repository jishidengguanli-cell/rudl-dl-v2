// analytics-alert-worker

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

// ===== 工具：呼叫 Cloudflare GraphQL API =====
async function cfGraphQL(env, query, variables) {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    console.warn("GraphQL error:", JSON.stringify(json.errors || json, null, 2));
    throw new Error("Cloudflare GraphQL API error");
  }
  return json.data;
}

// ===== 工具：Telegram 通知 =====
async function sendTelegram(env, text) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: "Markdown",
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn("Telegram error:", await res.text());
  }
}

// ===== A + B：監控 /d/xxxx 下載頁 HTTP 錯誤 =====
// 包含：
// 1) 是否有用戶打到 /d/xxxx 出現 4xx/5xx
// 2) 可以看出是哪個 status code（404, 500...）
// 3) 也可視為下載按鈕按了之後，後端是否正常回應
async function checkDownloadErrors(env, sinceIso, untilIso) {
  const query = `
    query ($zoneTag: string!, $since: Time!, $until: Time!, $pathPrefix: string!) {
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

  const data = await cfGraphQL(env, query, {
    zoneTag: env.CF_ZONE_ID,
    since: sinceIso,
    until: untilIso,
    pathPrefix: env.DOWNLOAD_PATH_PREFIX || "/d/",
  });

  const groups =
    data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];

  // 以路徑分組，計算錯誤率
  const statsByPath = new Map();

  for (const row of groups) {
    const path = row.dimensions.clientRequestPath;
    const status = row.dimensions.edgeResponseStatus;
    const country = row.dimensions.clientCountryName;
    const count = row.count || 0;

    const key = path; // 你也可以改成 `${path}|${country}` 針對國家分開看
    if (!statsByPath.has(key)) {
      statsByPath.set(key, {
        path,
        total: 0,
        errors: 0,
        byStatus: {},
        countries: new Set(),
      });
    }
    const st = statsByPath.get(key);
    st.total += count;
    st.byStatus[status] = (st.byStatus[status] || 0) + count;
    st.countries.add(country);

    if (status >= 400) {
      st.errors += count;
    }
  }

  const alerts = [];
  const MIN_HITS = 10;       // 至少有幾個 request 才算有意義
  const ERROR_RATE = 0.05;   // 錯誤率門檻：例如 5%

  for (const st of statsByPath.values()) {
    if (st.total < MIN_HITS) continue;

    const rate = st.errors / st.total;
    if (rate >= ERROR_RATE) {
      // 找出主要錯誤 code
      const topStatuses = Object.entries(st.byStatus)
        .filter(([code]) => parseInt(code, 10) >= 400)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([code, cnt]) => `${code} (${cnt})`)
        .join(", ");

      const countriesText = Array.from(st.countries).join(", ");

      alerts.push(
        `⚠️ *下載頁 HTTP 錯誤異常*\n` +
        `路徑: \`${st.path}\`\n` +
        `國家(近幾分鐘內): ${countriesText}\n` +
        `總請求: ${st.total}\n` +
        `錯誤請求(>=400): ${st.errors} (${(rate * 100).toFixed(1)}%)\n` +
        `主要錯誤碼: ${topStatuses}`
      );
    }
  }

  return alerts;
}

// ===== C：Web Vitals（LCP/INP）的監控骨架 =====
//
// 注意：RUM / Web Analytics 是「Account 範圍」，不是 Zone。
// 這部分會用 rumWebVitalsEventsAdaptiveGroups / rumPerformanceEventsAdaptiveGroups。
// 每個帳號的 availableFields 可能略有差異，
// 建議你先用 GraphQL Explorer 看一次 settings.availableFields 再把 query 補齊。
async function checkWebVitals(env, sinceIso, untilIso) {
  // 這裡先給一個簡易骨架，主要流程是：
  // 1. 呼叫 accounts(...) -> rumWebVitalsEventsAdaptiveGroups
  // 2. 過濾 url 包含 /d/（下載頁）
  // 3. 取出 LCP / INP 的 P75（或 P90）數值
  // 4. 若 LCP P75 > 4000ms 或 INP P75 > 某門檻 → 組裝 alert 訊息

  const query = `
  query GetAvailableFields($accountTag: string!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        settings {
          rumWebVitalsEventsAdaptiveGroups {
            availableFields
          }
          rumPerformanceEventsAdaptiveGroups {
            availableFields
          }
        }
      }
    }
  }
  `;
  // 看看有哪些 quantiles / dimensions 可以用，再把真正查詢寫進來。

  // 這裡先不寫死欄位名稱，避免 Schema 差異導致你一貼就錯。
  // 等你確認好欄位後，可以照「checkDownloadErrors」的模式寫一個：
  // - 按 URL 分組
  // - 取 LCP / INP 的 p75/p90
  // - 超過門檻才 push 一條 alert 文字

  return []; // 先回空陣列，不影響 A+B 的運作
}

export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const LOOKBACK_MINUTES = 1;

    const until = now.toISOString();
    const since = new Date(now.getTime() - LOOKBACK_MINUTES * 60 * 1000).toISOString();

    const alerts = [];

    // A + B：/d/xxxx HTTP 錯誤率與 status code
    const downloadAlerts = await checkDownloadErrors(env, since, until);
    alerts.push(...downloadAlerts);

    // C：Web Vitals（待你補完 query 後再啟用）
    const webVitalsAlerts = await checkWebVitals(env, since, until);
    alerts.push(...webVitalsAlerts);

    if (alerts.length > 0) {
      const message =
        `⏰ 監控時間範圍：\n` +
        `${since} ~ ${until}\n\n` +
        alerts.join("\n\n");
      await sendTelegram(env, message);
    }
  },
};
