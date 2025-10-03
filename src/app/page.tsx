import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

export default async function Page() {
  // 簡單 ping D1：取 links 計數（失敗就忽略）
  let linksCount: number | null = null;
  try {
    const { env } = getRequestContext();
    const r = await env.DB.prepare("SELECT COUNT(1) as c FROM links").first<{ c: number }>();
    linksCount = Number(r?.c ?? 0);
  } catch {
    linksCount = null;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-lg font-medium">環境檢查</h2>
        <ul className="list-disc pl-6 text-sm">
          <li>Next.js 15 + React 19（App Router）</li>
          <li>Adapter：@cloudflare/next-on-pages</li>
          <li>D1 綁定：<code>DB</code>（rudl-app）</li>
          <li>R2 以 CDN：<code>https://cdn.dataruapp.com/</code></li>
          <li>D1 links 計數：{linksCount ?? <span className="text-red-600">無法讀取</span>}</li>
        </ul>
      </div>
      <p className="text-sm text-gray-600">接下來我們會把登入、充值、分發管理逐步接上。</p>
    </div>
  );
}
