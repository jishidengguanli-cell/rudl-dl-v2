"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type LinkRow = {
  id: string;
  code: string;
  title?: string | null;
  active: number;
  cn_direct: number;
  file_id: string;
  ver: string;
  platform: "apk" | "ipa";
  pkg: string;
  created_at: number;
};

export default function DistributionsPage() {
  const [items, setItems] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const data = await api("/me/links?limit=50");
      setItems(data.items || []);
    } catch (e:any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function del(id: string) {
    if (!confirm("Delete this link?")) return;
    await api(`/me/links/${id}`, { method: "DELETE" });
    await load();
  }

  async function saveEdit(id: string, patch: Partial<LinkRow>) {
    await api(`/me/links/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await load();
    alert("Saved");
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">My Distributions</h1>
        <a className="px-3 py-1 rounded bg-white/10 hover:bg-white/20" href="/distributions/new">+ New</a>
      </div>
      {loading && <div>Loading...</div>}
      {err && <div className="text-red-400">{err}</div>}
      {!loading && !err && (
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr>
              <th className="py-2">code</th>
              <th>title</th>
              <th>pkg/ver</th>
              <th>platform</th>
              <th>active</th>
              <th>cn_direct</th>
              <th>created</th>
              <th>actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(r => (
              <tr key={r.id} className="border-t border-white/10">
                <td className="py-2">{r.code}</td>
                <td>
                  <input defaultValue={r.title ?? ""} className="bg-black/30 px-2 py-1 rounded w-56"
                    onBlur={e => e.target.value !== (r.title ?? "") && saveEdit(r.id, { title: e.target.value })}/>
                </td>
                <td>{r.pkg} / {r.ver}</td>
                <td>{r.platform}</td>
                <td>
                  <input type="checkbox" defaultChecked={!!r.active}
                    onChange={e => saveEdit(r.id, { active: e.target.checked ? 1 : 0 })}/>
                </td>
                <td>
                  <input type="checkbox" defaultChecked={!!r.cn_direct}
                    onChange={e => saveEdit(r.id, { cn_direct: e.target.checked ? 1 : 0 })}/>
                </td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>
                  <button className="px-2 py-1 bg-red-600/70 rounded" onClick={() => del(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td className="py-6 text-white/50" colSpan={8}>No data</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
