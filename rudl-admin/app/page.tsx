"use client";
import { useEffect, useMemo, useState } from "react";

const API_BASE_DEFAULT = "https://api.dataruapp.com";

type Json = Record<string, any>;

function useAdminToken() {
  const [token, setToken] = useState("");
  useEffect(() => {
    const t = localStorage.getItem("ADMIN_TOKEN") || "";
    setToken(t);
  }, []);
  const save = (t: string) => {
    setToken(t);
    localStorage.setItem("ADMIN_TOKEN", t);
  };
  return { token, save };
}

function useApiBase() {
  const [base, setBase] = useState(API_BASE_DEFAULT);
  useEffect(() => {
    const b = localStorage.getItem("API_BASE");
    if (b) setBase(b);
  }, []);
  const save = (b: string) => {
    setBase(b);
    localStorage.setItem("API_BASE", b);
  };
  return { base, save };
}

async function callApi(
  base: string,
  token: string,
  path: string,
  body?: Json,
  method = "POST"
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-admin-token": token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(typeof data === "string" ? data : data?.error || res.statusText);
  }
  return data;
}

export default function Page() {
  const { token, save: saveToken } = useAdminToken();
  const { base, save: saveBase } = useApiBase();

  const [userId, setUserId] = useState("");
  const [fileId, setFileId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const busying = useMemo(() => !!busy, [busy]);

  const onHealth = async () => {
    setBusy("health");
    try {
      const data = await callApi(base, token, "/health", undefined, "GET");
      alert("API HEALTH OK: " + JSON.stringify(data));
    } catch (e: any) {
      alert("HEALTH FAIL: " + e.message);
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-8">
      {/* 設定列 */}
      <div className="card">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label">API Base</label>
            <input value={base} onChange={e => saveBase(e.target.value)} placeholder="https://api.dataruapp.com" />
            <p className="hint mt-1">通常不需要改動</p>
          </div>
          <div className="md:col-span-2">
            <label className="label">管理 Token</label>
            <input value={token} onChange={e => saveToken(e.target.value)} placeholder="請貼上 rudl-api 的 ADMIN_TOKEN" />
            <p className="hint mt-1">瀏覽器本機儲存，不會上傳</p>
          </div>
        </div>
        <div className="mt-3">
          <button onClick={onHealth} disabled={!token || busying}>測試連線</button>
        </div>
      </div>

      {/* 1. 建使用者 */}
      <CreateUserCard
        base={base} token={token}
        onCreated={(id) => setUserId(id)}
        busy={busying} setBusy={setBusy}
      />

      {/* 2. 充值 */}
      <RechargeCard
        base={base} token={token} userId={userId}
        busy={busying} setBusy={setBusy}
      />

      {/* 3. 建檔案 */}
      <CreateFileCard
        base={base} token={token} userId={userId}
        onCreated={(fid) => setFileId(fid)}
        busy={busying} setBusy={setBusy}
      />

      {/* 4. 建連結 */}
      <CreateLinkCard
        base={base} token={token} fileId={fileId}
        busy={busying} setBusy={setBusy}
      />
    </div>
  );
}

function CreateUserCard({
  base, token, onCreated, busy, setBusy,
}: { base: string; token: string; onCreated: (id: string) => void; busy: boolean; setBusy: (s: string | null) => void }) {
  const [email, setEmail] = useState("owner1@example.com");
  const [init, setInit] = useState(10000);

  const onSubmit = async () => {
    setBusy("create-user");
    try {
      const data = await callApi(base, token, "/admin/users", { email, initialBalance: init });
      onCreated(data.id);
      alert(`建立成功：userId=${data.id}，餘額=${data.balance}`);
    } catch (e: any) {
      alert("建立失敗：" + e.message);
    } finally { setBusy(null); }
  };

  return (
    <div className="card">
      <h2 className="text-lg font-medium mb-3">1) 建使用者</h2>
      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="label">Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">初始點數</label>
          <input type="number" value={init} onChange={e => setInit(parseInt(e.target.value || "0"))} />
        </div>
        <div className="flex items-end">
          <button onClick={onSubmit} disabled={!token || busy}>建立</button>
        </div>
      </div>
    </div>
  );
}

function RechargeCard({
  base, token, userId, busy, setBusy,
}: { base: string; token: string; userId: string; busy: boolean; setBusy: (s: string | null) => void }) {
  const [uid, setUid] = useState("");
  const [pkg, setPkg] = useState("P5");
  useEffect(() => { if (userId) setUid(userId); }, [userId]);

  const onSubmit = async () => {
    setBusy("recharge");
    try {
      const data = await callApi(base, token, "/admin/recharge", { userId: uid, packageId: pkg });
      alert(`充值成功：餘額=${data.balance}`);
    } catch (e: any) {
      alert("充值失敗：" + e.message);
    } finally { setBusy(null); }
  };

  return (
    <div className="card">
      <h2 className="text-lg font-medium mb-3">2) 充值</h2>
      <div className="grid md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <label className="label">User ID</label>
          <input value={uid} onChange={e => setUid(e.target.value)} placeholder="貼使用者 ID" />
          <p className="hint mt-1">可接續上一個步驟自動帶入</p>
        </div>
        <div>
          <label className="label">方案</label>
          <select value={pkg} onChange={e => setPkg(e.target.value)}>
            <option value="P1">P1 (500)</option>
            <option value="P5">P5 (3000)</option>
            <option value="P15">P15 (20000)</option>
            <option value="P35">P35 (50000)</option>
            <option value="P100">P100 (150000)</option>
            <option value="P300">P300 (500000)</option>
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={onSubmit} disabled={!token || busy}>充值</button>
        </div>
      </div>
    </div>
  );
}

function CreateFileCard({
  base, token, userId, onCreated, busy, setBusy,
}: { base: string; token: string; userId: string; onCreated: (fid: string) => void; busy: boolean; setBusy: (s: string | null) => void }) {
  const [ownerId, setOwnerId] = useState("");
  const [platform, setPlatform] = useState<"apk"|"ipa">("apk");
  const [r2key, setR2key] = useState("apps/demo/1.0.0/app-release.apk");
  const [pkgName, setPkgName] = useState("com.example.demo");
  const [version, setVersion] = useState("1.0.0");
  const [size, setSize] = useState<number | ''>(112970000);

  useEffect(() => { if (userId) setOwnerId(userId); }, [userId]);

  const onSubmit = async () => {
    setBusy("create-file");
    try {
      const body: any = { ownerId, platform, r2_key: r2key, package_name: pkgName, version, size: size || null };
      const data = await callApi(base, token, "/admin/files", body);
      onCreated(data.id);
      alert(`檔案建立成功：fileId=${data.id}`);
    } catch (e: any) {
      alert("建立失敗：" + e.message);
    } finally { setBusy(null); }
  };

  return (
    <div className="card">
      <h2 className="text-lg font-medium mb-3">3) 建檔案（R2 物件）</h2>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <label className="label">Owner ID（必為 UserId）</label>
          <input value={ownerId} onChange={e => setOwnerId(e.target.value)} />
          <p className="hint mt-1">請勿填錯（不是 ledgerId）</p>
        </div>
        <div>
          <label className="label">平台</label>
          <select value={platform} onChange={e => setPlatform(e.target.value as any)}>
            <option value="apk">apk</option>
            <option value="ipa">ipa</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">R2 Key</label>
          <input value={r2key} onChange={e => setR2key(e.target.value)} />
          <p className="hint mt-1">例：apps/demo/1.0.0/app-release.apk</p>
        </div>
        <div>
          <label className="label">版本</label>
          <input value={version} onChange={e => setVersion(e.target.value)} />
        </div>
        <div>
          <label className="label">Package Name（可空）</label>
          <input value={pkgName} onChange={e => setPkgName(e.target.value)} />
        </div>
        <div>
          <label className="label">Size（bytes，可空）</label>
          <input type="number" value={size} onChange={e => setSize(e.target.value ? parseInt(e.target.value) : '')} />
        </div>
        <div className="flex items-end">
          <button onClick={onSubmit} disabled={!token || busy}>建立</button>
        </div>
      </div>
    </div>
  );
}

function CreateLinkCard({
  base, token, fileId, busy, setBusy,
}: { base: string; token: string; fileId: string; busy: boolean; setBusy: (s: string | null) => void }) {
  const [fid, setFid] = useState("");
  const [title, setTitle] = useState("Demo APK 1.0.0");
  const [code, setCode] = useState("apk03");
  const [cnDirect, setCnDirect] = useState(false);

  useEffect(() => { if (fileId) setFid(fileId); }, [fileId]);

  const onSubmit = async () => {
    setBusy("create-link");
    try {
      const data = await callApi(base, token, "/admin/links", {
        fileId: fid, title, code, cn_direct: cnDirect ? 1 : 0
      });
      alert(`連結建立成功：code=${data.code}`);
    } catch (e: any) {
      alert("建立失敗：" + e.message);
    } finally { setBusy(null); }
  };

  return (
    <div className="card">
      <h2 className="text-lg font-medium mb-3">4) 建分發連結</h2>
      <div className="grid md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <label className="label">File ID</label>
          <input value={fid} onChange={e => setFid(e.target.value)} />
        </div>
        <div>
          <label className="label">Code（可自訂）</label>
          <input value={code} onChange={e => setCode(e.target.value)} />
        </div>
        <div>
          <label className="label">中國直出</label>
          <div className="flex items-center h-10">
            <input type="checkbox" checked={cnDirect} onChange={e => setCnDirect(e.target.checked)} />
            <span className="ml-2 text-sm text-zinc-300">先紀錄旗標，之後再實作直出</span>
          </div>
        </div>
        <div className="md:col-span-3">
          <label className="label">標題（可空）</label>
          <input value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="flex items-end">
          <button onClick={onSubmit} disabled={!token || busy}>建立</button>
        </div>
      </div>
    </div>
  );
}
