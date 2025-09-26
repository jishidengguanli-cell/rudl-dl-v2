"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Platform = "apk" | "ipa";

async function api(path: string, method: string = "GET", body?: any) {
  const opt: RequestInit = { method, credentials: "include", headers: {} };
  if (body && !(body instanceof FormData)) {
    (opt.headers as any)["content-type"] = "application/json";
    opt.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    opt.body = body;
  }
  const res = await fetch(path, opt);
  const txt = await res.text();
  let data: any = null;
  try { data = JSON.parse(txt); } catch {}
  return { ok: res.ok, status: res.status, data: data ?? txt };
}

export default function NewDistributionPage() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [bundleId, setBundleId] = useState("com.example.app");
  const [lang, setLang] = useState("en");
  const [cnDirect, setCnDirect] = useState(false);

  const apkRef = useRef<HTMLInputElement>(null);
  const ipaRef = useRef<HTMLInputElement>(null);

  type UpState = {
    file?: File | null;
    tmpKey?: string | null;
    progress: number;        // 0..100
    uploading: boolean;
  };
  const [apk, setApk] = useState<UpState>({ progress: 0, uploading: false });
  const [ios, setIos] = useState<UpState>({ progress: 0, uploading: false });
  const busy = apk.uploading || ios.uploading;

  // 取得預簽 URL 並上傳（直傳 R2）
  async function startUpload(file: File, platform: Platform) {
    // 若有舊 tmpKey 先 abort
    const state = platform === "apk" ? apk : ios;
    if (state.tmpKey) await api("/me/upload-abort", "POST", { tmp_key: state.tmpKey }).catch(() => {});

    // 1) 先向後端換預簽 URL
    const u = await api("/me/upload-url", "POST", { platform, filename: file.name });
    if (!u.ok || !u.data?.upload_url) {
      alert(`取得上傳網址失敗：${u.data?.error || u.status}`);
      return;
    }
    const tmpKey = u.data.tmp_key as string;
    const uploadUrl = u.data.upload_url as string;

    // 2) 直傳 R2（XHR 可拿到進度）
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      // **不要再加 content-type/其他 header**，因為我們只簽 host；多送 header 會導致簽名不符
      xhr.upload.onprogress = (e) => {
        const p = e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : (apk.uploading || ios.uploading ? 99 : 0);
        if (platform === "apk") setApk(s => ({ ...s, progress: p }));
        else setIos(s => ({ ...s, progress: p }));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (platform === "apk") setApk(s => ({ ...s, uploading: false, progress: 100, tmpKey, file }));
          else setIos(s => ({ ...s, uploading: false, progress: 100, tmpKey, file }));
          resolve();
        } else {
          reject(new Error(`R2 回應 ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("上傳失敗（網路錯誤）"));
      // 標記開始
      if (platform === "apk") setApk({ file, tmpKey: null, progress: 0, uploading: true });
      else setIos({ file, tmpKey: null, progress: 0, uploading: true });

      xhr.send(file);
    }).catch((err: any) => {
      if (platform === "apk") setApk(s => ({ ...s, uploading: false }));
      else setIos(s => ({ ...s, uploading: false }));
      alert(err?.message || "上傳失敗");
    });
  }

  const onPick = (platform: Platform) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (!f) return;
    startUpload(f, platform);
  };

  // 建立：先 commit → 再建 links
  async function handleCreate() {
    if (!apk.tmpKey && !ios.tmpKey) {
      alert("請至少上傳一個平台的檔案（APK 或 IPA）再建立。");
      return;
    }
    if (busy) return;

    // 1) 提交檔案成正式物件與 DB
    const payload: any = {};
    if (apk.tmpKey) payload.apk = { tmp_key: apk.tmpKey, package_name: bundleId, version };
    if (ios.tmpKey) payload.ios = { tmp_key: ios.tmpKey, package_name: bundleId, version };

    const commit = await api("/me/commit-files", "POST", payload);
    if (!commit.ok) {
      alert(`提交檔案失敗：${commit.data || commit.status}`);
      return;
    }

    // 2) 建立分發（沿用你原本 /me/links 的設計與語系保存）
    const body = {
      title: title || "",
      cn_direct: cnDirect ? 1 : 0,
      locale: lang,               // 你後端會存 KV: link_lang:{code}
      apk: commit.data.apk ? { file_id: commit.data.apk.id } : null,
      ios: commit.data.ios ? { file_id: commit.data.ios.id } : null,
    };
    const res = await api("/me/links", "POST", body);
    if (!res.ok) {
      alert(`建立分發失敗：${res.data || res.status}`);
      return;
    }

    // 成功 → 跳分發列表（或跳到該 code 頁）
    router.push("/distributions");
  }

  const createDisabled =
    busy || (!apk.tmpKey && !ios.tmpKey);

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-semibold">新增分發</h2>

      <div className="space-y-3">
        <div>
          <label className="block text-sm mb-1">標題（顯示用，可選）</label>
          <input className="w-full bg-black/30 border rounded px-3 py-2"
                 placeholder="例如：My App"
                 value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">版本（顯示用，可選）</label>
            <input className="w-full bg-black/30 border rounded px-3 py-2"
                   value={version} onChange={e => setVersion(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Bundle ID（顯示用，可選）</label>
            <input className="w-full bg-black/30 border rounded px-3 py-2"
                   value={bundleId} onChange={e => setBundleId(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1">預覽語系（下載頁）</label>
          <select className="bg-black/30 border rounded px-3 py-2"
                  value={lang} onChange={e => setLang(e.target.value)}>
            <option value="en">English</option>
            <option value="zh-TW">繁體中文</option>
            <option value="zh-CN">简体中文</option>
            <option value="ja">日本語</option>
          </select>
        </div>

        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={cnDirect} onChange={e => setCnDirect(e.target.checked)} />
          <span>中國直連（cn_direct）</span>
        </label>
      </div>

      {/* APK 區 */}
      <div className="space-y-2">
        <div className="font-medium">APK 檔（Android）</div>
        <input type="file" accept=".apk" ref={apkRef} onChange={onPick("apk")} />
        <div className="h-2 bg-white/10 rounded overflow-hidden">
          <div className="h-full bg-blue-500" style={{ width: `${apk.progress}%` }} />
        </div>
        <div className="text-xs opacity-70">
          {apk.file ? apk.file.name : "未選擇檔案"} {apk.uploading ? "（上傳中…）" : apk.progress === 100 ? "（已上傳）" : ""}
        </div>
      </div>

      {/* IPA 區 */}
      <div className="space-y-2">
        <div className="font-medium">IPA 檔（iOS）</div>
        <input type="file" accept=".ipa" ref={ipaRef} onChange={onPick("ipa")} />
        <div className="h-2 bg-white/10 rounded overflow-hidden">
          <div className="h-full bg-blue-500" style={{ width: `${ios.progress}%` }} />
        </div>
        <div className="text-xs opacity-70">
          {ios.file ? ios.file.name : "未選擇檔案"} {ios.uploading ? "（上傳中…）" : ios.progress === 100 ? "（已上傳）" : ""}
        </div>
      </div>

      <button className={`px-4 py-2 rounded bg-emerald-600 disabled:opacity-50`}
              disabled={createDisabled}
              onClick={handleCreate}>
        建立
      </button>
    </div>
  );
}
