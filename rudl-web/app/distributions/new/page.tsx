"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api"; // 保留你本來的 api helper

// 語系清單（照你現有 UI）
const LANG_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "zh-CN", label: "简体中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

const BASE =
  (process.env.NEXT_PUBLIC_API_BASE || "https://api.dataruapp.com").replace(/\/$/, "");

/** 以 XHR 上傳暫存，支援進度條；回傳 temp_key */
function uploadTempWithProgress(
  file: File,
  platform: "apk" | "ipa",
  onProgress: (pct: number) => void
): Promise<{ temp_key: string; size: number }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("platform", platform);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/me/upload-temp`, true);
    xhr.withCredentials = true; // 必要：帶 cookie
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300 && data?.ok) {
          onProgress(100);
          resolve({ temp_key: data.temp_key, size: data.size });
        } else {
          reject(new Error(data?.error || `HTTP ${xhr.status}`));
        }
      } catch (err) {
        reject(err as any);
      }
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.send(fd);
  });
}

/** 丟棄暫存（冪等） */
async function discardTemp(temp_key: string) {
  try {
    await fetch(`${BASE}/me/upload-discard`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ temp_key }),
    });
  } catch {}
}

export default function NewDistributionPage() {
  const router = useRouter();

  // 表單欄位
  const [title, setTitle] = useState<string>("");
  const [version, setVersion] = useState<string>("1.0.0");
  const [bundleId, setBundleId] = useState<string>("com.example.app");
  const [lang, setLang] = useState<string>("en");
  const [cnDirect, setCnDirect] = useState<boolean>(false);

  // 直接以 ref 取檔案，避免 state 與 input onChange 時序問題
  const apkRef = useRef<HTMLInputElement | null>(null);
  const ipaRef = useRef<HTMLInputElement | null>(null);

  // 進度 / 暫存 key / 是否有選檔
  const [apkPct, setApkPct] = useState(0);
  const [ipaPct, setIpaPct] = useState(0);
  const [apkTemp, setApkTemp] = useState<string | null>(null);
  const [ipaTemp, setIpaTemp] = useState<string | null>(null);
  const [apkPicked, setApkPicked] = useState(false);
  const [ipaPicked, setIpaPicked] = useState(false);
  // 為避免「舊上傳晚回來覆蓋新狀態」，加 token
  const [apkToken, setApkToken] = useState(0);
  const [ipaToken, setIpaToken] = useState(0);

  const [busy, setBusy] = useState(false);

  // 建立按鈕是否可按
  const apkUploading = apkPct > 0 && apkPct < 100;
  const ipaUploading = ipaPct > 0 && ipaPct < 100;
  const canCreate =
    (apkPicked || ipaPicked) &&
    (!apkPicked || (apkTemp && apkPct === 100)) &&
    (!ipaPicked || (ipaTemp && ipaPct === 100));

  // 1) 新增兩個 ref 取代 state token
  const apkReqToken = useRef(0);
  const ipaReqToken = useRef(0);
  // APK 選檔 → 自動上傳暫存
  const onPickApk = async (f: File | null) => {
    setApkPicked(!!f);
    if (!f) {
        if (apkTemp) await discardTemp(apkTemp);
        setApkTemp(null);
        setApkPct(0);
        return;
    }
    if (apkTemp) await discardTemp(apkTemp);
    setApkTemp(null);
    setApkPct(0);

    const t = Date.now();
    apkReqToken.current = t;

    try {
        const r = await uploadTempWithProgress(f, "apk", (p) => {
        if (apkReqToken.current === t) setApkPct(p);   // ★ 用 ref 判斷
        });
        if (apkReqToken.current === t) setApkTemp(r.temp_key); // ★ 用 ref 判斷
    } catch (err: any) {
        if (apkReqToken.current === t) {
        setApkPct(0);
        setApkTemp(null);
        alert(err?.message || "APK 上傳失敗");
        }
    }
  };

  // IPA 選檔 → 自動上傳暫存
  const onPickIpa = async (f: File | null) => {
    setIpaPicked(!!f);
    if (!f) {
        if (ipaTemp) await discardTemp(ipaTemp);
        setIpaTemp(null);
        setIpaPct(0);
        return;
    }
    if (ipaTemp) await discardTemp(ipaTemp);
    setIpaTemp(null);
    setIpaPct(0);

    const t = Date.now();
    ipaReqToken.current = t;

    try {
        const r = await uploadTempWithProgress(f, "ipa", (p) => {
        if (ipaReqToken.current === t) setIpaPct(p);   // ★ 用 ref 判斷
        });
        if (ipaReqToken.current === t) setIpaTemp(r.temp_key); // ★ 用 ref 判斷
    } catch (err: any) {
        if (ipaReqToken.current === t) {
        setIpaPct(0);
        setIpaTemp(null);
        alert(err?.message || "IPA 上傳失敗");
        }
    }
    };

  // 離開頁面 / 重整時丟棄暫存（不入庫）
  useEffect(() => {
    const sendBeaconJson = (url: string, data: any) => {
      try {
        const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
        (navigator as any).sendBeacon?.(url, blob);
      } catch {}
    };
    const onUnload = () => {
      if (apkTemp) sendBeaconJson(`${BASE}/me/upload-discard`, { temp_key: apkTemp });
      if (ipaTemp) sendBeaconJson(`${BASE}/me/upload-discard`, { temp_key: ipaTemp });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      // 卸載時再做一次保險
      if (apkTemp) discardTemp(apkTemp);
      if (ipaTemp) discardTemp(ipaTemp);
    };
  }, [apkTemp, ipaTemp]);

  // 建立分發（用 temp_key 提交；後端會搬運到正式路徑並寫入 DB）
  const handleCreate = async () => {
    try {
      const apkFile = apkRef.current?.files?.[0] ?? null;
      const ipaFile = ipaRef.current?.files?.[0] ?? null;

      if (!apkFile && !ipaFile) {
        alert("請至少上傳一個平台的檔案（APK 或 IPA）再建立。");
        return;
      }
      // 理論上按鈕已禁用，這裡再保護一次
      if ((apkFile && apkPct < 100) || (ipaFile && ipaPct < 100)) return;

      setBusy(true);

      const payload = {
        title: title?.trim() || null,
        version: version?.trim() || null,
        bundle_id: bundleId?.trim() || null,
        locale: lang,                 // 後端期待的是 locale
        cn_direct: cnDirect ? 1 : 0,
        apk_temp_key: apkTemp || null,
        ios_temp_key: ipaTemp || null,
      };

      const res = await fetch(`${BASE}/me/links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "建立分發失敗");

      alert(`建立完成！分發碼：${j.code}`);
      // 成功清理暫存狀態
      setApkTemp(null);
      setIpaTemp(null);
      setApkPct(0);
      setIpaPct(0);
      setApkPicked(false);
      setIpaPicked(false);

      router.push("/distributions");
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-semibold">新增分發</h1>

      {/* 標題（顯示用，可選） */}
      <div className="space-y-2">
        <label className="block text-sm">標題（顯示用，可選）</label>
        <input
          className="w-full rounded border border-gray-600 bg-black/40 px-3 py-2"
          placeholder="例如：My App"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* 版本（顯示用，可選）＋ Bundle ID（顯示用，可選） */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-sm">版本（顯示用，可選）</label>
          <input
            className="w-full rounded border border-gray-600 bg-black/40 px-3 py-2"
            placeholder="例如：1.0.0"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="block text-sm">Bundle ID（顯示用，可選）</label>
          <input
            className="w-full rounded border border-gray-600 bg-black/40 px-3 py-2"
            placeholder="com.example.app"
            value={bundleId}
            onChange={(e) => setBundleId(e.target.value)}
          />
        </div>
      </div>

      {/* 預覽語系（下載頁） */}
      <div className="space-y-2">
        <label className="block text-sm">預覽語系（下載頁）</label>
        <select
          className="w-full rounded border border-gray-600 bg-black/40 px-3 py-2"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
        >
          {LANG_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* 中國直連 */}
      <div className="flex items-center space-x-2">
        <input
          id="cn_direct"
          type="checkbox"
          checked={cnDirect}
          onChange={(e) => setCnDirect(e.target.checked)}
        />
        <label htmlFor="cn_direct">中國直連（cn_direct）</label>
      </div>

      {/* APK 檔（Android） */}
      <div className="space-y-2">
        <label className="block text-sm">APK 檔（Android）</label>
        <input
          ref={apkRef}
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-gray-700 file:px-3 file:py-2 file:text-white"
          onChange={(e) => onPickApk(e.target.files?.[0] ?? null)}
        />
        {apkPicked && (
          <div className="mt-2 h-2 w-full bg-neutral-800 rounded">
            <div
              className="h-2 bg-blue-500 rounded"
              style={{ width: `${apkPct}%` }}
            />
          </div>
        )}
      </div>

      {/* IPA 檔（iOS） */}
      <div className="space-y-2">
        <label className="block text-sm">IPA 檔（iOS）</label>
        <input
          ref={ipaRef}
          type="file"
          accept=".ipa,application/octet-stream"
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-gray-700 file:px-3 file:py-2 file:text-white"
          onChange={(e) => onPickIpa(e.target.files?.[0] ?? null)}
        />
        {ipaPicked && (
          <div className="mt-2 h-2 w-full bg-neutral-800 rounded">
            <div
              className="h-2 bg-blue-500 rounded"
              style={{ width: `${ipaPct}%` }}
            />
          </div>
        )}
      </div>

      <div>
        <button
          onClick={handleCreate}
          disabled={busy || !canCreate}
          className="rounded bg-green-700 px-4 py-2 text-white disabled:opacity-60"
        >
          {busy ? "處理中…" : "建立"}
        </button>
      </div>
    </div>
  );
}
