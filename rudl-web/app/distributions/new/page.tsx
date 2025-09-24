// rudl-web/app/distributions/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { apiMyFiles, apiUploadFile, apiCreateLinks } from "@/lib/api";

type Platform = "apk" | "ipa";
type FileRow = {
  id: string;
  platform: Platform;
  package_name: string | null;
  version: string | null;
  size: number;
  r2_key: string;
  created_at: number;
};

const LANGS = [
  { v: "en", label: "English" },
  { v: "zh-TW", label: "繁體中文" },
  { v: "zh-CN", label: "简体中文" },
  { v: "ja", label: "日本語" },
  { v: "ko", label: "한국어" },
];

export default function NewDistributionPage() {
  const [title, setTitle] = useState("");
  const [pkg, setPkg] = useState("com.example.app");
  const [ver, setVer] = useState("1.0.0");
  const [locale, setLocale] = useState("en");
  const [cnDirect, setCnDirect] = useState(false);

  // 本機檔
  const [apkLocal, setApkLocal] = useState<File | null>(null);
  const [ipaLocal, setIpaLocal] = useState<File | null>(null);

  // 已上傳清單
  const [files, setFiles] = useState<FileRow[]>([]);
  const [apkId, setApkId] = useState<string>("");
  const [ipaId, setIpaId] = useState<string>("");

  const apkList = useMemo(() => files.filter((f) => f.platform === "apk"), [files]);
  const ipaList = useMemo(() => files.filter((f) => f.platform === "ipa"), [files]);

  const loadFiles = async () => {
    const r = await apiMyFiles(200);
    setFiles(r.files || []);
  };

  useEffect(() => {
    loadFiles().catch(console.error);
  }, []);

  const upload = async (platform: Platform) => {
    const file = platform === "apk" ? apkLocal : ipaLocal;
    if (!file) {
      alert("請先選擇檔案");
      return;
    }
    await apiUploadFile(file, platform, pkg, ver);
    await loadFiles();
    // 自動選新上傳的那一筆
    const latest = files
      .filter((f) => f.platform === platform)
      .sort((a, b) => b.created_at - a.created_at)[0];
    if (latest) {
      platform === "apk" ? setApkId(latest.id) : setIpaId(latest.id);
    }
    alert("上傳完成");
  };

  const create = async () => {
    if (!apkId && !ipaId) {
      alert("請至少選擇一個平台的檔案（APK 或 IPA）");
      return;
    }
    const r = await apiCreateLinks({
      title: title.trim(),
      cn_direct: cnDirect,
      locale,
      apk: apkId ? { file_id: apkId } : null,
      ios: ipaId ? { file_id: ipaId } : null,
    });
    alert(`建立成功！分發碼：${r.code}\n下載頁： https://dl.dataruapp.com/dl/${r.code}`);
    // 可導回列表頁
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-xl font-semibold">新增分發</h1>

      {/* 顯示欄位（僅顯示，不影響安裝） */}
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block mb-1">標題（顯示用，可選）</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-700"
            placeholder="例如：My App"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block mb-1">版本（顯示用，可選）</label>
            <input
              value={ver}
              onChange={(e) => setVer(e.target.value)}
              className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-700"
              placeholder="1.0.0"
            />
          </div>
          <div>
            <label className="block mb-1">Bundle ID（顯示用，可選）</label>
            <input
              value={pkg}
              onChange={(e) => setPkg(e.target.value)}
              className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-700"
              placeholder="com.example.app"
            />
          </div>
        </div>

        <div>
          <label className="block mb-1">預覽語系（下載頁）</label>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-700"
          >
            {LANGS.map((l) => (
              <option key={l.v} value={l.v}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={cnDirect} onChange={(e) => setCnDirect(e.target.checked)} />
          <span>中國直連（cn_direct）</span>
        </label>
      </div>

      {/* APK 區塊 */}
      <section className="space-y-3">
        <h2 className="font-medium">APK 檔（Android）</h2>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".apk"
            onChange={(e) => setApkLocal(e.target.files?.[0] ?? null)}
            className="block"
          />
          <button
            onClick={() => upload("apk")}
            className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500"
          >
            Upload
          </button>
        </div>
        <div>
          <label className="block mb-1">已上傳檔案</label>
          <select
            value={apkId}
            onChange={(e) => setApkId(e.target.value)}
            className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-700"
          >
            <option value="">（請選擇）</option>
            {apkList.map((f) => (
              <option key={f.id} value={f.id}>
                {f.package_name || "(unknown)"} {f.version || ""} — {f.r2_key.split("/").at(-1)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* IPA 區塊 */}
      <section className="space-y-3">
        <h2 className="font-medium">IPA 檔（iOS）</h2>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".ipa"
            onChange={(e) => setIpaLocal(e.target.files?.[0] ?? null)}
            className="block"
          />
          <button
            onClick={() => upload("ipa")}
            className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500"
          >
            Upload
          </button>
        </div>
        <div>
          <label className="block mb-1">已上傳檔案</label>
          <select
            value={ipaId}
            onChange={(e) => setIpaId(e.target.value)}
            className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-700"
          >
            <option value="">（請選擇）</option>
            {ipaList.map((f) => (
              <option key={f.id} value={f.id}>
                {f.package_name || "(unknown)"} {f.version || ""} — {f.r2_key.split("/").at(-1)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className="pt-2">
        <button onClick={create} className="px-4 py-2 rounded bg-green-600 hover:bg-green-500">
          建立
        </button>
      </div>
    </div>
  );
}
