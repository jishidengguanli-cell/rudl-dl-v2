"use client";

import React, { useRef, useState } from "react";
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

async function uploadOne(file: File, platform: "apk" | "ipa") {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("platform", platform);

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/me/upload`, {
    method: "POST",
    body: fd,
    credentials: "include", // 必要：帶 cookie
  });
  const j = await res.json();
  if (!res.ok || !j?.ok) {
    throw new Error(j?.error || "上傳失敗");
  }
  return j.file.id as string; // 後端會回 { ok: true, file: { id } }
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

  const [busy, setBusy] = useState(false);

  // 建立分發
  const handleCreate = async () => {
  try {
    const apkFile = apkRef.current?.files?.[0] ?? null;
    const ipaFile = ipaRef.current?.files?.[0] ?? null;

    if (!apkFile && !ipaFile) {
      alert("請至少上傳一個平台的檔案（APK 或 IPA）再建立。");
      return;
    }

    setBusy(true);

    // 1) 依平台各自上傳，拿 file_id
    const apkId = apkFile ? await uploadOne(apkFile, "apk") : null;
    const ipaId = ipaFile ? await uploadOne(ipaFile, "ipa") : null;

    // 2) 建立分發（同一 code，後端會自動產生 4 碼英數）
    const payload = {
      title: title?.trim() || null,         // 顯示用（可空）
      version: version?.trim() || null,     // 顯示用（可空），也可用後端解析檔案
      bundle_id: bundleId?.trim() || null,  // 顯示用（可空）
      lang,                                 // 下載頁預設語系
      cn_direct: cnDirect ? 1 : 0,          // 是否中國直連
      file_apk_id: apkId,
      file_ipa_id: ipaId,
    };

    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/me/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok || !j?.ok) throw new Error(j?.error || "建立分發失敗");

    // 成功
    alert(`建立完成！分發碼：${j.link.code}`);
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
        />
      </div>

      {/* IPA 檔（iOS） */}
      <div className="space-y-2">
        <label className="block text-sm">IPA 檔（iOS）</label>
        <input
          ref={ipaRef}
          type="file"
          accept=".ipa,application/octet-stream"
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-gray-700 file:px-3 file:py-2 file:text-white"
        />
      </div>

      <div>
        <button
          onClick={handleCreate}
          disabled={busy}
          className="rounded bg-green-700 px-4 py-2 text-white disabled:opacity-60"
        >
          {busy ? "處理中…" : "建立"}
        </button>
      </div>
    </div>
  );
}
