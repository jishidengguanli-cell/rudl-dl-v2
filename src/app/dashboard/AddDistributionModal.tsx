'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import plist from 'plist';
import { parseBuffer as parseBinaryPlist } from 'bplist-parser';
import { Buffer } from 'buffer';
import { useI18n } from '@/i18n/provider';

const DEFAULT_TITLE = 'APP';
const APK_METADATA_PATHS = [
  'META-INF/com/android/build/gradle/app-metadata.properties',
  'BUNDLE-METADATA/com.android.tools.build.gradle/app-metadata.properties',
];

type Platform = 'apk' | 'ipa';

type FileMeta = {
  title?: string | null;
  bundleId?: string | null;
  version?: string | null;
  sha256?: string | null;
};

type FileState = {
  file: File | null;
  metadata: FileMeta | null;
};

type UploadProgressMap = Record<Platform, number>;

type SubmitState = 'idle' | 'submitting' | 'success';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  onError: (message: string) => void;
};

async function computeSha256(file: File) {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseProperties(text: string): Map<string, string> {
  const map = new Map<string, string>();
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => {
      const index = line.indexOf('=');
      if (index === -1) return;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key) map.set(key, value);
    });
  return map;
}

function normalizeMeta(meta: FileMeta | null): FileMeta | null {
  if (!meta) return null;
  const normalized: FileMeta = { ...meta };
  if (typeof normalized.title === 'string') {
    const value = normalized.title.trim();
    normalized.title = value || null;
  }
  if (typeof normalized.bundleId === 'string') {
    const value = normalized.bundleId.trim();
    normalized.bundleId = value || null;
  }
  if (typeof normalized.version === 'string') {
    const value = normalized.version.trim();
    normalized.version = value || null;
  }
  if (typeof normalized.sha256 === 'string') {
    const value = normalized.sha256.trim();
    normalized.sha256 = value || undefined;
  }
  return normalized;
}

async function parseApkMetadata(file: File): Promise<FileMeta | null> {
  try {
    const zip = await JSZip.loadAsync(file);
    for (const path of APK_METADATA_PATHS) {
      const entry = zip.file(path);
      if (!entry) continue;

      const content = await entry.async('text');
      const props = parseProperties(content);
      const bundleId =
        props.get('applicationId') ??
        props.get('packageId') ??
        props.get('package') ??
        props.get('appId') ??
        '';
      const version =
        props.get('versionName') ??
        props.get('bundleVersion') ??
        props.get('version') ??
        props.get('versionNameMajor') ??
        '';
      const title =
        props.get('appName') ??
        props.get('bundleName') ??
        props.get('displayName') ??
        props.get('applicationLabel') ??
        null;
      if (bundleId || version || title) {
        return {
          title: title || null,
          bundleId: bundleId || null,
          version: version || null,
        };
      }
    }
  } catch (error) {
    console.warn('Failed to parse APK metadata', error);
  }
  return null;
}

function decodeUtf8Loose(input: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(input);
  } catch {
    return '';
  }
}

function tryParsePlistFromUint8(data: Uint8Array): Record<string, string> | null {
  if (!data.length) return null;
  const header = decodeUtf8Loose(data.slice(0, 6));
  const isBinary = header === 'bplist';
  try {
    if (!isBinary) {
      const asText = decodeUtf8Loose(data).trim();
      if (asText.startsWith('<?xml') || asText.startsWith('<plist')) {
        return plist.parse(asText) as Record<string, string>;
      }
    }
  } catch (error) {
    console.warn('IPA metadata XML parse failed, falling back to binary plist', error);
  }
  try {
    const buffer = Buffer.from(data);
    const parsed = parseBinaryPlist(buffer);
    if (Array.isArray(parsed)) {
      return (parsed[0] ?? null) as Record<string, string> | null;
    }
    return parsed as unknown as Record<string, string>;
  } catch (error) {
    console.warn('IPA metadata binary parse failed', error);
    return null;
  }
}

async function parseIpaMetadata(file: File): Promise<FileMeta | null> {
  try {
    const zip = await JSZip.loadAsync(file);
    const plistEntry = Object.keys(zip.files).find((name) =>
      /Payload\/[^/]+\.app\/Info\.plist$/i.test(name)
    );
    if (!plistEntry) return null;
    const plistBytes = await zip.file(plistEntry)!.async('uint8array');
    const info = tryParsePlistFromUint8(plistBytes);
    if (!info) return null;
    return {
      title:
        info.CFBundleDisplayName ??
        info.CFBundleName ??
        info.CFBundleExecutable ??
        DEFAULT_TITLE,
      bundleId: info.CFBundleIdentifier ?? '',
      version: info.CFBundleShortVersionString ?? info.CFBundleVersion ?? '',
    };
  } catch (error) {
    console.warn('Failed to parse IPA metadata', error);
    return null;
  }
}

function formatBytes(size: number | null | undefined) {
  if (!size || Number.isNaN(size)) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AddDistributionModal({ open, onClose, onCreated, onError }: Props) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [bundleId, setBundleId] = useState('');
  const [apkVersion, setApkVersion] = useState('');
  const [ipaVersion, setIpaVersion] = useState('');
  const [autofill, setAutofill] = useState(true);
  const [apkState, setApkState] = useState<FileState>({ file: null, metadata: null });
  const [ipaState, setIpaState] = useState<FileState>({ file: null, metadata: null });
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressMap>({ apk: 0, ipa: 0 });

  useEffect(() => {
    if (!open) {
      setTitle('');
      setBundleId('');
      setApkVersion('');
      setIpaVersion('');
      setAutofill(true);
      setApkState({ file: null, metadata: null });
      setIpaState({ file: null, metadata: null });
      setSubmitState('idle');
      setError(null);
      setUploadProgress({ apk: 0, ipa: 0 });
    }
  }, [open]);

  const selectedPlatforms = useMemo(() => {
    const list: Platform[] = [];
    if (apkState.file) list.push('apk');
    if (ipaState.file) list.push('ipa');
    return list;
  }, [apkState.file, ipaState.file]);

  const updateProgress = (platform: Platform, value: number) => {
    setUploadProgress((prev) => {
      const next = Math.max(0, Math.min(1, value));
      if (prev[platform] === next) return prev;
      return { ...prev, [platform]: next };
    });
  };

  if (!open) return null;

  const resolveErrorMessage = (code: string | undefined | null) => {
    if (!code) return t('status.unreadable');
    switch (code) {
      case 'NO_FILES':
        return t('dashboard.errorNoFiles');
      case 'AUTOFILL_MISMATCH':
        return t('dashboard.errorAutofillMismatch');
      case 'UNAUTHENTICATED':
        return t('auth.login.required');
      default:
        return code;
    }
  };

  const applyMetadataToFields = (platform: Platform, metadata: FileMeta | null) => {
    if (!autofill || !metadata) return;
    if ((!title || title === DEFAULT_TITLE) && metadata.title) {
      setTitle(metadata.title);
    }
    if (!bundleId && metadata.bundleId) {
      setBundleId(metadata.bundleId);
    }
    if (platform === 'apk' && !apkVersion && metadata.version) {
      setApkVersion(metadata.version);
    }
    if (platform === 'ipa' && !ipaVersion && metadata.version) {
      setIpaVersion(metadata.version);
    }
  };

  const handleFileChange = async (platform: Platform, list: FileList | null) => {
    const file = list && list[0] ? list[0] : null;
    const setter = platform === 'apk' ? setApkState : setIpaState;
    setter({ file, metadata: null });

    if (!file) return;

    try {
      const metadata =
        platform === 'ipa' ? await parseIpaMetadata(file) : await parseApkMetadata(file);
      const normalized = normalizeMeta(metadata);
      setter({ file, metadata: normalized });
      applyMetadataToFields(platform, normalized);
      setError(null);
    } catch (err) {
      console.warn(`Failed to process ${platform} file`, err);
    }
  };

  const handleAutofillToggle = (next: boolean) => {
    setAutofill(next);
    if (!next) return;
    applyMetadataToFields('apk', apkState.metadata);
    applyMetadataToFields('ipa', ipaState.metadata);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPlatforms.length) {
      const message = t('dashboard.errorNoFiles');
      setError(message);
      onError(message);
      return;
    }

    const apkBundle = apkState.metadata?.bundleId?.trim();
    const ipaBundle = ipaState.metadata?.bundleId?.trim();
    const apkTitleMeta = apkState.metadata?.title?.trim();
    const ipaTitleMeta = ipaState.metadata?.title?.trim();
    if (
      autofill &&
      ((apkBundle && ipaBundle && apkBundle !== ipaBundle) ||
        (apkTitleMeta && ipaTitleMeta && apkTitleMeta !== ipaTitleMeta))
    ) {
      const message = t('dashboard.errorAutofillMismatch');
      setError(message);
      onError(message);
      return;
    }

    const platformUploadOrder: Platform[] = [];
    const sizeByPlatform: UploadProgressMap = { apk: 0, ipa: 0 };

    try {
      setSubmitState('submitting');
      setError(null);
      setUploadProgress({ apk: 0, ipa: 0 });
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('bundle_id', bundleId.trim());
      formData.append('apk_version', apkVersion.trim());
      formData.append('ipa_version', ipaVersion.trim());
      formData.append('autofill', autofill ? 'true' : 'false');

      const appendFile = async (platform: Platform, state: FileState) => {
        if (!state.file) return;
        platformUploadOrder.push(platform);
        sizeByPlatform[platform] = state.file.size;
        updateProgress(platform, 0);
        formData.append(platform, state.file, state.file.name);

        const meta: FileMeta = { ...state.metadata };
        if (!meta.sha256) {
          try {
            meta.sha256 = await computeSha256(state.file);
          } catch (error) {
            console.warn(`Failed to compute SHA-256 for ${platform}`, error);
          }
        }
        if (Object.keys(meta).length) {
          formData.append(`${platform}_meta`, JSON.stringify(meta));
        }
      };

      await appendFile('apk', apkState);
      await appendFile('ipa', ipaState);

      const totalBytes = platformUploadOrder.reduce(
        (sum, platform) => sum + (sizeByPlatform[platform] ?? 0),
        0
      );

      const json = await new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/distributions');
        xhr.responseType = 'text';
        xhr.onload = () => {
          const text = xhr.responseText ?? '';
          let payload: { ok: boolean; error?: string } = { ok: false };
          try {
            payload = text ? (JSON.parse(text) as typeof payload) : { ok: xhr.status < 400 };
          } catch {
            reject(new Error('INVALID_RESPONSE'));
            return;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(payload);
          } else {
            reject(new Error(resolveErrorMessage(payload.error ?? `HTTP_${xhr.status}`)));
          }
        };
        xhr.onerror = () => reject(new Error('NETWORK_ERROR'));
        if (xhr.upload && platformUploadOrder.length) {
          xhr.upload.onprogress = (event) => {
            const effectiveTotal =
              (event.lengthComputable && event.total ? event.total : totalBytes) || totalBytes;
            if (!effectiveTotal) {
              platformUploadOrder.forEach((platform) => updateProgress(platform, 0));
              return;
            }

            const safeLoaded = Math.min(
              event.loaded ?? 0,
              effectiveTotal,
              totalBytes || effectiveTotal
            );

            let accumulated = 0;
            platformUploadOrder.forEach((platform) => {
              const size = sizeByPlatform[platform] ?? 0;
              if (!size) {
                updateProgress(platform, 1);
                return;
              }
              const fileStart = accumulated;
              const fileEnd = fileStart + size;
              let loadedForFile = 0;
              if (safeLoaded <= fileStart) {
                loadedForFile = 0;
              } else if (safeLoaded >= fileEnd) {
                loadedForFile = size;
              } else {
                loadedForFile = safeLoaded - fileStart;
              }
              updateProgress(platform, loadedForFile / size);
              accumulated = fileEnd;
            });
          };
          xhr.upload.onload = () => {
            platformUploadOrder.forEach((platform) => updateProgress(platform, 1));
          };
        }
        xhr.send(formData);
      });

      if (!json.ok) {
        throw new Error(resolveErrorMessage(json.error));
      }

      platformUploadOrder.forEach((platform) => updateProgress(platform, 1));

      setSubmitState('success');
      const maybePromise = onCreated();
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        await maybePromise;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : resolveErrorMessage(String(err));
      setError(message);
      setSubmitState('idle');
      onError(message);
      platformUploadOrder.forEach((platform) => updateProgress(platform, 0));
    }
  };

  const closeDisabled = submitState === 'submitting';

const summaries = [
  { platform: 'apk' as const, state: apkState },
  { platform: 'ipa' as const, state: ipaState },
].filter((item) => item.state.file);

const renderSummaryContent = () => {
  if (submitState === 'success') {
    return <p className="text-sm text-green-600">{t('dashboard.toastCreated')}</p>;
  }
  if (submitState === 'submitting' && summaries.length) {
    return (
      <div className="space-y-3">
        {summaries.map(({ platform, state }) => {
          const progress = uploadProgress[platform] ?? 0;
          const label =
            state.metadata?.title ??
            state.file?.name ??
            `${platform.toUpperCase()} ${t('dashboard.progressPlaceholder')}`;
          return (
            <div key={platform}>
              <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                <span className="font-medium text-gray-700">
                  {platform.toUpperCase()} · {label}
                </span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-black transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, Math.round(progress * 100)))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  if (!summaries.length) {
    return <p className="text-xs text-gray-500">{t('dashboard.progressPlaceholder')}</p>;
  }
    return (
      <ul className="space-y-1 text-xs text-gray-600">
        {summaries.map(({ platform, state }) => {
          const file = state.file!;
          const meta = state.metadata;
          const parts: string[] = [];
          parts.push(platform.toUpperCase());
          const label = meta?.title ?? file.name;
          if (label) parts.push(label);
          if (meta?.bundleId) parts.push(meta.bundleId);
          if (meta?.version) parts.push(`v${meta.version}`);
          parts.push(formatBytes(file.size));
          return (
            <li key={platform}>
              <span className="font-semibold text-gray-700">{parts.shift()}</span>
              <span> · {parts.join(' · ')}</span>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8"
      role="presentation"
      onClick={() => {
        if (!closeDisabled) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-xl rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">{t('dashboard.addDistribution')}</h3>
          <p className="mt-1 text-sm text-gray-600">{t('dashboard.addDistributionDesc')}</p>
        </div>

        <form className="space-y-4 px-6 py-6" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('form.title')}
              <input
                className="mt-1 rounded border px-3 py-2 text-sm outline-none focus:border-black"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={DEFAULT_TITLE}
                disabled={submitState === 'submitting'}
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('form.bundleId')}
              <input
                className="mt-1 rounded border px-3 py-2 text-sm outline-none focus:border-black"
                value={bundleId}
                onChange={(event) => setBundleId(event.target.value)}
                placeholder="com.example.app"
                disabled={submitState === 'submitting'}
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('form.apkVersion')}
              <input
                className="mt-1 rounded border px-3 py-2 text-sm outline-none focus:border-black"
                value={apkVersion}
                onChange={(event) => setApkVersion(event.target.value)}
                placeholder="1.0.0"
                disabled={submitState === 'submitting'}
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('form.ipaVersion')}
              <input
                className="mt-1 rounded border px-3 py-2 text-sm outline-none focus:border-black"
                value={ipaVersion}
                onChange={(event) => setIpaVersion(event.target.value)}
                placeholder="1.0.0"
                disabled={submitState === 'submitting'}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={autofill}
              onChange={(event) => handleAutofillToggle(event.target.checked)}
              disabled={submitState === 'submitting'}
            />
            {t('dashboard.autofill')}
          </label>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              {t('form.apkUpload')}
              <input
                type="file"
                accept=".apk"
                className="mt-1 w-full text-sm"
                disabled={submitState === 'submitting'}
                onChange={(event) => handleFileChange('apk', event.target.files)}
              />
              <p className="mt-1 text-xs text-gray-500">
                {apkState.file ? apkState.file.name : t('dashboard.progressPlaceholder')}
              </p>
            </label>

            <label className="block text-sm font-medium text-gray-700">
              {t('form.ipaUpload')}
              <input
                type="file"
                accept=".ipa"
                className="mt-1 w-full text-sm"
                disabled={submitState === 'submitting'}
                onChange={(event) => handleFileChange('ipa', event.target.files)}
              />
              <p className="mt-1 text-xs text-gray-500">
                {ipaState.file ? ipaState.file.name : t('dashboard.progressPlaceholder')}
              </p>
            </label>
          </div>

          <div className="rounded border border-dashed border-gray-300 px-3 py-2">
            {renderSummaryContent()}
          </div>

          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                if (!closeDisabled) onClose();
              }}
              className="rounded border px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={closeDisabled}
            >
              {t('form.cancel')}
            </button>
            <button
              type="submit"
              className="rounded bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitState === 'submitting'}
            >
              {submitState === 'submitting' ? t('status.loading') : t('form.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
