// rudl-web/app/distributions/new/page.tsx
"use client";

import { useState } from "react";
import { apiUploadFile, apiMyFiles, apiCreateLinks } from "@/lib/api";

type Platform = "apk" | "ipa";

const LANGS = [
  { v: "en", label: "English" },
  { v: "zh-TW", label: "繁體中文" },
  { v: "zh-CN", label: "简体中文" },
  { v: "ja", label: "日本語" },
  { v: "ko", label: "한국어" },
];

type FileRow = {
  id: string;
  platform: Platform;
  package_name: string | null;
  version: string | null;
  size: number;
  r2_key: string;       // 例如 apps/demo/1.0.0/app-release.apk
  created_at: number;   // epoch (ms)
};

export default function NewDistributionPage() {
  // 顯示用欄位（不影響安裝）
  const [title, setTitle] = useState("");
  const [pkg, setPkg] = useState("com.example.app");
  const [ver, setVer] = useState("1.0.0");
  const [locale, setLocale] = useState("en");
  const [cnDirect, setCnDirect] = useState(false);

  // 檔案挑選
  const [apkLocal, setApkLocal] = useState<File | null>(null);
  const [ipaLocal, setIpaLocal] = useState<File | null>(null);

  // 上傳狀態 & 取得到的 file_id
  const [apkUploading, setApkUploading] = useState(false);
  const [ipaUploading, setIpaUploading] = useState(false);
  const [apkFileId, setApkFileId] = useState<string>("");
  const [ipaFileId, setIpaFileId] = useState<string>("");

  // 共用：上傳 + 取得 file_id
  const doUpload = async (platform: Platform) => {
    const picked = platform === "apk" ? apkLocal : ipaLocal;
    if (!picked) {
      alert("請先選擇檔案");
      return;
    }

    platform === "apk" ? setApkUploading(true) : setIpaUploading(true);
    try {
      // 傳入 pkg/ver 只是讓後端可做紀錄或解析時參考；真正安裝資訊仍以檔案為準
      const res: any = await apiUploadFile(picked, platform, pkg, ver);

      // 1) 優先使用上傳 API 回傳的 id
      let fileId: string | undefined = res?.id;

      // 2) 若沒回傳 id，回頭查詢自己最近上傳的同平台檔案，且檔名吻合者
      if (!fileId) {
        const list = await apiMyFiles(50); // 取 50 筆內找最近的
        const nowName = picked.name.toLowerCase();
        const best: FileRow | undefined = (list?.files || [])
          .filter((f: FileRow) => f.platform === platform)
          .sort((a: FileRow, b: FileRow) => b.created_at - a.created_at)
          .find((f: FileRow) => f.r2_key?.toLowerCase().endsWith(nowName));
        if (best) fileId = best.id;
      }

      if (!fileId) {
        alert("上傳完成，但找不到檔案編號，請再試一次。");
        return;
      }

      if (platform === "apk") {
        setApkFileId(fileId);
      } else {
        setIpaFileId(fileId);
      }

      alert(`${platform.toUpperCase()} 上傳完成`);
    } catch (err: any) {
      console.error(err);
      alert(`上傳失敗：${err?.message || err}`);
    } finally {
      platform === "apk" ? setApkUploading(false) : setIpaUploading(false);
    }
  };

  // 建立分發（至少要有一個平台有檔）
  const createDistribution = async () => {
    if (!apkFileId && !ipaFileId) {
      alert("請至少上傳一個平台的檔案（APK 或 IPA）再建立。");
      return;
    }
    if (apkUploading || ipaUploading) {
      alert("檔案仍在上傳中，請稍候…");
      return;
    }

    try {
      const res = await apiCreateLinks({
        // 顯示設定
        title: title.trim(),
        locale,
        cn_direct: cnDirect,
        // 分發檔
        apk: apkFileId ? { file_id: apkFileId } : null,
        ios: ipaFileId ? { file_id: ipaFileId } : null,
        // 額外顯示用字串（若後端有欄位可存，可傳；沒有也不影響）
        // version: ver,
        // bundle_id: pkg,
      });

      // 後端會回 code
      const code = res?.code || "(unknown)";
      alert(`建立成功！\n分發碼：${code}\n下載頁： https://dl.dataruapp.com/dl/${code}`);
      // TODO: 可導回分發列表頁
    } catch (err: any) {
      console.error(err);
      alert(`建立失敗：${err?.message || err}`);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-xl font-semibold">新增分發</h1>

      {/* 顯示用欄位（不影響安裝） */}
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

      {/* APK 上傳 */}
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
            onClick={() => doUpload("apk")}
            disabled={apkUploading || !apkLocal}
            className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-60"
          >
            {apkUploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        {apkFileId && (
          <p className="text-sm text-green-400">
            已上傳 APK，file_id：<code className="break-all">{apkFileId}</code>
          </p>
        )}
      </section>

      {/* IPA 上傳 */}
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
            onClick={() => doUpload("ipa")}
            disabled={ipaUploading || !ipaLocal}
            className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-60"
          >
            {ipaUploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        {ipaFileId && (
          <p className="text-sm text-green-400">
            已上傳 IPA，file_id：<code className="break-all">{ipaFileId}</code>
          </p>
        )}
      </section>

      <div className="pt-2">
        <button
          onClick={createDistribution}
          className="px-4 py-2 rounded bg-green-600 hover:bg-green-500"
        >
          建立
        </button>
      </div>
    </div>
  );
}
