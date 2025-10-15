"use client";

import { FormEvent, useMemo, useState } from "react";
import JSZip from "jszip";
import plist from "plist";
import { useI18n } from "@/i18n/provider";

const DEFAULT_TITLE = "APP";
const PLATFORM_ORDER: Array<"apk" | "ipa"> = ["apk", "ipa"];

type FileMeta = {
  title?: string | null;
  bundleId?: string | null;
  version?: string | null;
  sha256?: string | null;
};

type FileState = {
  file: File | null;
  metadata: FileMeta | null;
  uploading: boolean;
  uploadedKey?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  onError?: (message: string) => void;
};

async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function parseIpaMetadata(file: File) {
  try {
    const zip = await JSZip.loadAsync(file);
    const plistEntry = Object.keys(zip.files).find((name) =>
      /Payload\/[^/]+\.app\/Info\.plist$/i.test(name)
    );
    if (!plistEntry) return null;
    const plistContent = await zip.file(plistEntry)!.async("text");
    const info = plist.parse(plistContent) as Record<string, string>;
    return {
      title:
        info.CFBundleDisplayName ??
        info.CFBundleName ??
        info.CFBundleExecutable ??
        DEFAULT_TITLE,
      bundleId: info.CFBundleIdentifier ?? "",
      version: info.CFBundleShortVersionString ?? info.CFBundleVersion ?? "",
    };
  } catch (error) {
    console.warn("Failed to parse IPA metadata", error);
    return null;
  }
}

export default function AddDistributionModal({ open, onClose, onCreated, onError }: Props) {
  const { t } = useI18n();
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [bundleId, setBundleId] = useState("");
  const [apkVersion, setApkVersion] = useState("");
  const [ipaVersion, setIpaVersion] = useState("");
  const [autofill, setAutofill] = useState(true);
  const [apkState, setApkState] = useState<FileState>({ file: null, metadata: null, uploading: false });
  const [ipaState, setIpaState] = useState<FileState>({ file: null, metadata: null, uploading: false });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedPlatforms = useMemo(() => {
    const list: Array<"apk" | "ipa"> = [];
    if (apkState.file) list.push("apk");
    if (ipaState.file) list.push("ipa");
    return list;
  }, [apkState.file, ipaState.file]);

  if (!open) return null;

  const updateFileState = (platform: "apk" | "ipa", updater: (prev: FileState) => FileState) => {
    if (platform === "apk") {
      setApkState((prev) => updater(prev));
    } else {
      setIpaState((prev) => updater(prev));
    }
  };

  const handleFileChange = async (platform: "apk" | "ipa", list: FileList | null) => {
    const file = list && list[0] ? list[0] : null;
    updateFileState(platform, (prev) => ({ ...prev, file, metadata: null, uploadedKey: undefined }));

    if (file && autofill) {
      const metadata = platform === "ipa" ? await parseIpaMetadata(file) : null;
      if (metadata) {
        updateFileState(platform, (prev) => ({
          ...prev,
          metadata: { ...prev.metadata, ...metadata },
        }));
        if (!title || title === DEFAULT_TITLE) setTitle(metadata.title ?? DEFAULT_TITLE);
        if (!bundleId) setBundleId(metadata.bundleId ?? "");
        if (platform === "apk" && !apkVersion) setApkVersion(metadata.version ?? "");
        if (platform === "ipa" && !ipaVersion) setIpaVersion(metadata.version ?? "");
      }
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPlatforms.length) {
      const text = t("dashboard.errorNoFiles");
      setMessage(text);
      onError?.(text);
      return;
    }
    if (autofill && apkState.metadata && ipaState.metadata) {
      const apkBundle = apkState.metadata.bundleId ?? "";
      const ipaBundle = ipaState.metadata.bundleId ?? "";
      if (apkBundle && ipaBundle && apkBundle !== ipaBundle) {
        const text = t("dashboard.errorAutofillMismatch");
        setMessage(text);
        onError?.(text);
        return;
      }
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const initRes = await fetch("/api/distributions/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platforms: selectedPlatforms }),
      });
      const initJson = await initRes.json();
      if (!initJson.ok) {
        throw new Error(initJson.error ?? "INIT_FAILED");
      }

      const filesPayload: Array<{
        platform: "apk" | "ipa";
        key: string;
        size: number;
        contentType: string;
        title: string;
        bundleId: string;
        version: string;
        sha256: string;
      }> = [];

      for (const platform of PLATFORM_ORDER) {
        if (!selectedPlatforms.includes(platform)) continue;
        const state = platform === "apk" ? apkState : ipaState;
        if (!state.file) continue;
        const uploadInfo = initJson.uploads?.[platform];
        if (!uploadInfo?.url || !uploadInfo?.key) {
          throw new Error("MISSING_UPLOAD_INFO");
        }

        updateFileState(platform, (prev) => ({ ...prev, uploading: true }));

        const uploadResponse = await fetch(uploadInfo.url, {
          method: "PUT",
          body: state.file,
          headers: { "content-type": state.file.type || "application/octet-stream" },
        });
        if (!uploadResponse.ok) {
          throw new Error("UPLOAD_FAILED");
        }

        const sha256 = await computeSha256(state.file);
        const meta = state.metadata ?? {};
        const finalTitle = (autofill ? meta.title : title) || DEFAULT_TITLE;
        const finalBundle = (autofill ? meta.bundleId : bundleId) || "";
        const finalVersion =
          autofill && meta.version ? meta.version : platform === "apk" ? apkVersion : ipaVersion;

        filesPayload.push({
          platform,
          key: uploadInfo.key,
          size: state.file.size,
          contentType: state.file.type || "application/octet-stream",
          title: finalTitle,
          bundleId: finalBundle,
          version: finalVersion,
          sha256,
        });

        updateFileState(platform, (prev) => ({
          ...prev,
          uploading: false,
          uploadedKey: uploadInfo.key,
          metadata: { ...prev.metadata, title: finalTitle, bundleId: finalBundle, version: finalVersion, sha256 },
        }));
      }

      const finalizeRes = await fetch("/api/distributions/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          linkId: initJson.linkId,
          title,
          bundleId,
          apkVersion,
          ipaVersion,
          autofill,
          files: filesPayload,
        }),
      });
      const finalizeJson = await finalizeRes.json();
      if (!finalizeJson.ok) {
        throw new Error(finalizeJson.error ?? "FINALIZE_FAILED");
      }

      await onCreated();
      setTitle(DEFAULT_TITLE);
      setBundleId("");
      setApkVersion("");
      setIpaVersion("");
      setApkState({ file: null, metadata: null, uploading: false });
      setIpaState({ file: null, metadata: null, uploading: false });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message === "AUTOFILL_MISMATCH"
            ? t("dashboard.errorAutofillMismatch")
            : error.message
          : String(error);
      setMessage(message);
      onError?.(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{t("dashboard.addDistribution")}</h3>
            <p className="text-sm text-gray-600">{t("dashboard.addDistributionDesc")}</p>
          </div>
          <button
            type="button"
            className="text-sm text-gray-500 transition hover:text-gray-700"
            onClick={onClose}
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t("form.title")}</span>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder={DEFAULT_TITLE}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={submitting}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t("form.bundleId")}</span>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={bundleId}
                onChange={(event) => setBundleId(event.target.value)}
                disabled={submitting}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t("form.apkVersion")}</span>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={apkVersion}
                onChange={(event) => setApkVersion(event.target.value)}
                disabled={submitting}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t("form.ipaVersion")}</span>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={ipaVersion}
                onChange={(event) => setIpaVersion(event.target.value)}
                disabled={submitting}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={autofill}
              onChange={(event) => setAutofill(event.target.checked)}
              disabled={submitting}
            />
            {t("dashboard.autofill")}
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t("form.apkUpload")}</span>
              <input
                type="file"
                accept=".apk"
                className="block w-full text-sm text-gray-700"
                onChange={(event) => handleFileChange("apk", event.target.files)}
                disabled={submitting}
              />
              {apkState.metadata?.bundleId && (
                <p className="mt-1 text-xs text-gray-500">
                  {apkState.metadata.title} · {apkState.metadata.bundleId}
                  {apkState.metadata.version ? ` · v${apkState.metadata.version}` : ""}
                </p>
              )}
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">{t("form.ipaUpload")}</span>
              <input
                type="file"
                accept=".ipa"
                className="block w-full text-sm text-gray-700"
                onChange={(event) => handleFileChange("ipa", event.target.files)}
                disabled={submitting}
              />
              {ipaState.metadata?.bundleId && (
                <p className="mt-1 text-xs text-gray-500">
                  {ipaState.metadata.title} · {ipaState.metadata.bundleId}
                  {ipaState.metadata.version ? ` · v${ipaState.metadata.version}` : ""}
                </p>
              )}
            </label>
          </div>

          {message && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {message}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm text-gray-600 transition hover:bg-gray-50"
              onClick={onClose}
              disabled={submitting}
            >
              {t("form.cancel")}
            </button>
            <button
              type="submit"
              className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
              disabled={submitting}
            >
              {submitting ? t("status.loading") : t("form.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
