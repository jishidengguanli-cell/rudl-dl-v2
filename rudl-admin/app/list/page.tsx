"use client";
import { useEffect, useState } from "react";

const API_BASE_DEFAULT = "https://api.dataruapp.com";
type Row = Record<string, any>;

/* === localStorage helpers === */
function useToken() {
  const [t, setT] = useState("");
  useEffect(() => { setT(localStorage.getItem("ADMIN_TOKEN") || ""); }, []);
  return { token: t, set(v: string) { localStorage.setItem("ADMIN_TOKEN", v); setT(v); } };
}
function useBase() {
  const [b, setB] = useState(API_BASE_DEFAULT);
  useEffect(() => { const v = localStorage.getItem("API_BASE"); if (v) setB(v); }, []);
  return { base: b, set(v: string) { localStorage.setItem("API_BASE", v); setB(v); } };
}

/* === API helpers === */
async function apiGET(base: string, token: string, path: string) {
  const res = await fetch(base + path, { headers: { "x-admin-token": token } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPATCH(base: string, token: string, path: string, body: any) {
  const res = await fetch(base + path, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-admin-token": token },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiDELETE(base: string, token: string, path: string) {
  const res = await fetch(base + path, { method: "DELETE", headers: { "x-admin-token": token } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* === UI === */
export default function ListPage() {
  const { token, set: setToken } = useToken();
  const { base, set: setBase } = useBase();

  return (
    <div className="space-y-8">
      <div className="card">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label">API Base</label>
            <input value={base} onChange={e => setBase(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="label">管理 Token</label>
            <input value={token} onChange={e => setToken(e.target.value)} />
          </div>
        </div>
      </div>

      <UsersCard base={base} token={token} />
      <FilesCard base={base} token={token} />
      <LinksCard base={base} token={token} />
    </div>
  );
}

/* === Users (list only, with paging) === */
function UsersCard({ base, token }: { base: string; token: string }) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([0]); // offset stack

  const load = async (ofs = 0) => {
    const data = await apiGET(base, token, `/admin/users?q=${encodeURIComponent(q)}&limit=${limit}&offset=${ofs}`);
    setRows(data.items || []);
    setNext(data.nextOffset ?? null);
  };

  const onSearch = async () => { setHistory([0]); await load(0); };
  const onNext = async () => { if (next != null) { setHistory(h => [...h, next]); await load(next); } };
  const onPrev = async () => {
    setHistory(h => {
      if (h.length <= 1) return h;
      const nh = h.slice(0, -1);
      load(nh[nh.length - 1]);
      return nh;
    });
  };

  return (
    <div className="card">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-medium mb-2">Users</h2>
          <input placeholder="Email keyword" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label">Limit</label>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option>20</option><option>50</option><option>100</option>
          </select>
        </div>
        <button onClick={onPrev} disabled={!token || history.length <= 1}>Prev</button>
        <button onClick={onSearch} disabled={!token}>Search</button>
        <button onClick={onNext} disabled={!token || next == null}>Next</button>
      </div>

      <Table
        header={["id", "email", "balance", "created_at"]}
        rows={rows.map(r => [r.id, r.email, r.balance, r.created_at])}
      />
    </div>
  );
}

/* === Files (editable + delete + paging) === */
function FilesCard({ base, token }: { base: string; token: string }) {
  const [ownerId, setOwnerId] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([0]);

  const load = async (ofs = 0) => {
    const qs = new URLSearchParams({ limit: String(limit), offset: String(ofs) });
    if (ownerId) qs.set("ownerId", ownerId);
    if (q) qs.set("q", q);
    const data = await apiGET(base, token, `/admin/files?${qs.toString()}`);
    setRows(data.items || []);
    setNext(data.nextOffset ?? null);
  };

  const onSearch = async () => { setHistory([0]); await load(0); };
  const onNext = async () => { if (next != null) { setHistory(h => [...h, next]); await load(next); } };
  const onPrev = async () => {
    setHistory(h => {
      if (h.length <= 1) return h;
      const nh = h.slice(0, -1);
      load(nh[nh.length - 1]);
      return nh;
    });
  };

  const save = async () => {
    if (!editing) return;
    const body: any = {
      ownerId: editing.owner_id,
      r2_key: editing.r2_key,
      package_name: editing.package_name,
      version: editing.version,
      size: editing.size ? Number(editing.size) : null
    };
    await apiPATCH(base, token, `/admin/files/${editing.id}`, body);
    setEditing(null);
    await load(history[history.length - 1]);
    alert("File updated");
  };

  const doDelete = async (id: string) => {
    if (!confirm("確定刪除這個檔案嗎？（若仍有連結會被拒絕）")) return;
    try {
      await apiDELETE(base, token, `/admin/files/${id}`);
      await load(history[history.length - 1]);
      alert("File deleted");
    } catch (e: any) {
      if (String(e.message).includes("has_links")) {
        alert("此檔案仍有連結指向，請先刪除相關連結後再刪。");
      } else {
        alert(e.message || "Delete failed");
      }
    }
  };

  return (
    <div className="card">
      <h2 className="text-lg font-medium mb-2">Files</h2>
      <div className="grid md:grid-cols-4 gap-3">
        <div><label className="label">OwnerId</label><input value={ownerId} onChange={e => setOwnerId(e.target.value)} /></div>
        <div className="md:col-span-2"><label className="label">Keyword</label><input value={q} onChange={e => setQ(e.target.value)} placeholder="package / version / r2_key" /></div>
        <div>
          <label className="label">Limit</label>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option>20</option><option>50</option><option>100</option>
          </select>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={onPrev} disabled={!token || history.length <= 1}>Prev</button>
        <button onClick={onSearch} disabled={!token}>Search</button>
        <button onClick={onNext} disabled={!token || next == null}>Next</button>
      </div>

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead><tr className="text-zinc-400">
            <th className="text-left p-2">id</th><th className="text-left p-2">owner</th><th className="text-left p-2">pkg</th>
            <th className="text-left p-2">ver</th><th className="text-left p-2">size</th><th className="text-left p-2">r2_key</th><th className="text-left p-2">actions</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-zinc-800">
                <td className="p-2">{r.id}</td>
                <td className="p-2">{r.owner_id}</td>
                <td className="p-2">{r.package_name}</td>
                <td className="p-2">{r.version}</td>
                <td className="p-2">{r.size}</td>
                <td className="p-2">{r.r2_key}</td>
                <td className="p-2">
                  <button className="mr-2" onClick={() => setEditing(r)}>Edit</button>
                  <button className="bg-red-600 hover:bg-red-500" onClick={() => doDelete(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="mt-4 border border-zinc-800 rounded-xl p-4">
          <h3 className="font-medium mb-2">Edit File: {editing.id}</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div><label className="label">OwnerId</label><input value={editing.owner_id||""} onChange={e => setEditing({ ...editing, owner_id: e.target.value })} /></div>
            <div><label className="label">Package</label><input value={editing.package_name||""} onChange={e => setEditing({ ...editing, package_name: e.target.value })} /></div>
            <div><label className="label">Version</label><input value={editing.version||""} onChange={e => setEditing({ ...editing, version: e.target.value })} /></div>
            <div><label className="label">Size</label><input type="number" value={editing.size||""} onChange={e => setEditing({ ...editing, size: e.target.value })} /></div>
            <div className="md:col-span-2"><label className="label">R2 Key</label><input value={editing.r2_key||""} onChange={e => setEditing({ ...editing, r2_key: e.target.value })} /></div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={save}>Save</button>
            <button className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* === Links (editable + delete + paging) === */
function LinksCard({ base, token }: { base: string; token: string }) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([0]);

  const load = async (ofs = 0) => {
    const data = await apiGET(base, token, `/admin/links?q=${encodeURIComponent(q)}&limit=${limit}&offset=${ofs}`);
    setRows(data.items || []);
    setNext(data.nextOffset ?? null);
  };
  const onSearch = async () => { setHistory([0]); await load(0); };
  const onNext = async () => { if (next != null) { setHistory(h => [...h, next]); await load(next); } };
  const onPrev = async () => {
    setHistory(h => {
      if (h.length <= 1) return h;
      const nh = h.slice(0, -1);
      load(nh[nh.length - 1]);
      return nh;
    });
  };

  const save = async () => {
    if (!editing) return;
    const body: any = {
      title: editing.title ?? "",
      is_active: editing.is_active ? 1 : 0,
      cn_direct: editing.cn_direct ? 1 : 0,
      code: editing.code,
      fileId: editing.file_id
    };
    await apiPATCH(base, token, `/admin/links/${editing.id}`, body);
    setEditing(null);
    await load(history[history.length - 1]);
    alert("Link updated");
  };

  const doDelete = async (id: string) => {
    if (!confirm("確定刪除此連結嗎？")) return;
    await apiDELETE(base, token, `/admin/links/${id}`);
    await load(history[history.length - 1]);
    alert("Link deleted");
  };

  return (
    <div className="card">
      <h2 className="text-lg font-medium mb-2">Links</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <div className="md:col-span-2"><label className="label">Keyword (code/title)</label><input value={q} onChange={e => setQ(e.target.value)} /></div>
        <div>
          <label className="label">Limit</label>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option>20</option><option>50</option><option>100</option>
          </select>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={onPrev} disabled={!token || history.length <= 1}>Prev</button>
        <button onClick={onSearch} disabled={!token}>Search</button>
        <button onClick={onNext} disabled={!token || next == null}>Next</button>
      </div>

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead><tr className="text-zinc-400">
            <th className="text-left p-2">id</th><th className="text-left p-2">code</th><th className="text-left p-2">title</th>
            <th className="text-left p-2">file_id</th><th className="text-left p-2">active</th><th className="text-left p-2">cn_direct</th><th className="text-left p-2">actions</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-zinc-800">
                <td className="p-2">{r.id}</td>
                <td className="p-2">{r.code}</td>
                <td className="p-2">{r.title}</td>
                <td className="p-2">{r.file_id}</td>
                <td className="p-2">{r.is_active ? "1" : "0"}</td>
                <td className="p-2">{r.cn_direct ? "1" : "0"}</td>
                <td className="p-2">
                  <button className="mr-2" onClick={() => setEditing(r)}>Edit</button>
                  <button className="bg-red-600 hover:bg-red-500" onClick={() => doDelete(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="mt-4 border border-zinc-800 rounded-xl p-4">
          <h3 className="font-medium mb-2">Edit Link: {editing.id}</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div><label className="label">Code</label><input value={editing.code||""} onChange={e => setEditing({ ...editing, code: e.target.value })} /></div>
            <div><label className="label">Title</label><input value={editing.title||""} onChange={e => setEditing({ ...editing, title: e.target.value })} /></div>
            <div><label className="label">FileId</label><input value={editing.file_id||""} onChange={e => setEditing({ ...editing, file_id: e.target.value })} /></div>
            <div className="flex items-center gap-4">
              <label className="label">Active</label>
              <input type="checkbox" checked={!!editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })} />
              <label className="label ml-6">CN Direct</label>
              <input type="checkbox" checked={!!editing.cn_direct} onChange={e => setEditing({ ...editing, cn_direct: e.target.checked ? 1 : 0 })} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={save}>Save</button>
            <button className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- 小的表格元件 --- */
function Table({ header, rows }: { header: string[]; rows: (string | number | null)[][] }) {
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-zinc-400">
            {header.map(h => <th key={h} className="text-left p-2">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-zinc-800">
              {r.map((c, j) => <td key={j} className="p-2">{c ?? ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
