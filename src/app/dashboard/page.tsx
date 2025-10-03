import { getRequestContext } from "@cloudflare/next-on-pages";
export const runtime = "edge";

type LinkRow = {
  id: string;
  code: string;
  title: string | null;
  is_active: number;
  platform: string | null;
  created_at: number | null;
};

export default async function Dashboard() {
  const { env } = getRequestContext();
  const rows = await env.DB.prepare(
    `SELECT id, code, title, is_active, platform, created_at
     FROM links ORDER BY created_at DESC LIMIT 50`
  ).all<LinkRow>().then(r => r.results ?? []);

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 text-lg font-medium">Links（最近 50 筆）</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Code</th>
              <th className="py-2 pr-4">Title</th>
              <th className="py-2 pr-4">Platform</th>
              <th className="py-2 pr-4">Active</th>
              <th className="py-2 pr-4">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b last:border-none">
                <td className="py-2 pr-4 font-mono">{r.code}</td>
                <td className="py-2 pr-4">{r.title ?? "-"}</td>
                <td className="py-2 pr-4">{r.platform ?? "-"}</td>
                <td className="py-2 pr-4">{r.is_active ? "YES" : "NO"}</td>
                <td className="py-2 pr-4">
                  <a className="text-blue-600 underline" href={`/dl/${r.code}`} target="_blank">下載</a>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td className="py-4 text-gray-500" colSpan={5}>沒有資料</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
