'use client';

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import JSZip from 'jszip';
import plist from 'plist';
import { parseBuffer as parseBinaryPlist } from 'bplist-parser';
import { Buffer } from 'buffer';
import { useI18n } from '@/i18n/provider';

const DEFAULT_TITLE = 'APP';

type Platform = 'apk' | 'ipa';

type FileMeta = {
  title?: string | null;
  bundleId?: string | null;
  version?: string | null;
};

type FileState = {
  file: File | null;
  metadata: FileMeta | null;
};

type UploadProgressMap = Record<Platform, number>;

type SubmitState = 'idle' | 'submitting' | 'success';

type BinaryXmlAttributeRaw = {
  name?: string;
  nodeName?: string;
  value?: string;
};

type BinaryXmlNodeRaw = {
  nodeName?: string;
  attributes?: BinaryXmlAttributeRaw[];
  childNodes?: BinaryXmlNodeRaw[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  onError: (message: string) => void;
};

type PresignResponse = {
  ok: boolean;
  linkId: string;
  uploads: Record<
    Platform,
    { key: string; url: string; headers?: Record<string, string> } | undefined
  >;
  error?: string;
};

type FinalizeResponse = {
  ok: boolean;
  linkId?: string;
  code?: string;
  error?: string;
};

async function parseGradleMetadata(zip: JSZip): Promise<FileMeta | null> {
  const metadataPaths = [
    'META-INF/com/android/build/gradle/app-metadata.properties',
    'BUNDLE-METADATA/com.android.tools.build.gradle/app-metadata.properties',
  ];

  for (const path of metadataPaths) {
    const entry = zip.file(path);
    if (!entry) continue;
    const raw = await entry.async('text');
    const map = new Map<string, string>();
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        const idx = line.indexOf('=');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key) map.set(key, value);
      });

    const bundleId =
      map.get('applicationId') ??
      map.get('packageId') ??
      map.get('package') ??
      map.get('appId') ??
      '';
    const version =
      map.get('versionName') ??
      map.get('bundleVersion') ??
      map.get('version') ??
      map.get('versionNameMajor') ??
      '';
    const title =
      map.get('appName') ??
      map.get('bundleName') ??
      map.get('displayName') ??
      map.get('applicationLabel') ??
      null;

    if (bundleId || version || title) {
      return {
        title: title || null,
        bundleId: bundleId || null,
        version: version || null,
      };
    }
  }

  return null;
}

async function parseApkManifest(zip: JSZip): Promise<FileMeta | null> {
  const manifestEntry = zip.file('AndroidManifest.xml');
  if (!manifestEntry) return null;
  const manifestBuffer = Buffer.from(await manifestEntry.async('arraybuffer'));
  const BinaryXmlParserModule = await import('binary-xml');
  const BinaryXmlParserCtor =
    (BinaryXmlParserModule.default ?? BinaryXmlParserModule) as new (
      buffer: Buffer,
      options?: { debug?: boolean }
    ) => { parse(): unknown };
  const parser = new BinaryXmlParserCtor(manifestBuffer);
  const document = parser.parse() as BinaryXmlNodeRaw | null;
  if (!document) return null;

  const findAttribute = (node: BinaryXmlNodeRaw | null | undefined, name: string): string | null => {
    if (!node?.attributes) return null;
    for (const attr of node.attributes) {
      const attrName =
        typeof attr?.name === 'string'
          ? attr.name
          : typeof attr?.nodeName === 'string'
            ? attr.nodeName
            : '';
      if (
        attrName === name ||
        attrName === `android:${name}` ||
        (name.startsWith('android:') && attrName === name.replace('android:', ''))
      ) {
        if (typeof attr?.value === 'string') return attr.value;
      }
    }
    return null;
  };

  const bundleId = findAttribute(document, 'package') ?? '';
  const version =
    findAttribute(document, 'android:versionName') ??
    findAttribute(document, 'versionName') ??
    findAttribute(document, 'android:versionCode') ??
    findAttribute(document, 'versionCode') ??
    '';

  const application =
    document.childNodes?.find((child) => child?.nodeName === 'application') ?? null;
  const title =
    findAttribute(application, 'android:label') ??
    findAttribute(application, 'label') ??
    null;

  if (!bundleId && !version && !title) return null;
  return {
    bundleId: bundleId || null,
    version: version || null,
    title,
  };
}

async function parseApkMetadata(file: File): Promise<FileMeta | null> {
  try {
    const zip = await JSZip.loadAsync(file);
    const gradle = await parseGradleMetadata(zip);
    if (gradle) return gradle;
    const manifest = await parseApkManifest(zip);
    if (manifest) return manifest;
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

function sanitizeFileName(value: string, fallback: string): string {
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '') || fallback;
}

type PresignFileRequest = {
  platform: Platform;
  fileName: string;
  contentType?: string;
};

async function requestPresign(body: { files: PresignFileRequest[] }): Promise<PresignResponse> {
  const res = await fetch('/api/distributions/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as PresignResponse;
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `HTTP_${res.status}`);
  }
  return json;
}

type UploadInfo = {
  key: string;
  url: string;
  headers?: Record<string, string>;
};

async function uploadWithProgress(
  info: UploadInfo,
  file: File,
  onProgress: (value: number) => void
) {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', info.url);
    if (info.headers) {
      for (const [header, value] of Object.entries(info.headers)) {
        if (value) {
          xhr.setRequestHeader(header, value);
        }
      }
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`UPLOAD_FAILED_${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('NETWORK_ERROR'));
    xhr.send(file);
  });
}

type FinalizeUploadPayload = {
  platform: Platform;
  key: string;
  size: number;
  title: string | null;
  bundleId: string | null;
  version: string | null;
  contentType: string;
};

async function finalizeDistribution(body: {
  linkId: string;
  title: string;
  bundleId: string;
  apkVersion: string;
  ipaVersion: string;
  autofill: boolean;
  uploads: FinalizeUploadPayload[];
}) {
  const res = await fetch('/api/distributions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as FinalizeResponse;
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `HTTP_${res.status}`);
  }
  return json;
}

export default function AddDistributionModal({
  open,
  onClose,
  onCreated,
  onError,
}: Props) {
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
  const [toast, setToast] = useState<string | null>(null);
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
      setToast(null);
      setUploadProgress({ apk: 0, ipa: 0 });
    }
  }, [open]);

  const selectedPlatforms = useMemo(() => {
    const list: Platform[] = [];
    if (apkState.file) list.push('apk');
    if (ipaState.file) list.push('ipa');
    return list;
  }, [apkState.file, ipaState.file]);

  const updateProgress = useCallback((platform: Platform, value: number) => {
    setUploadProgress((prev) => ({
      ...prev,
      [platform]: Math.max(0, Math.min(1, value)),
    }));
  }, []);

  const handleFileChange = async (platform: Platform, files: FileList | null) => {
    const file = files && files[0] ? files[0] : null;
    const setter = platform === 'apk' ? setApkState : setIpaState;
    setter({ file, metadata: null });
    if (!file) return;

    try {
      const metadata = platform === 'apk' ? await parseApkMetadata(file) : await parseIpaMetadata(file);
      setter({ file, metadata });
      if (autofill) {
        if (platform === 'ipa' && metadata?.title && (!title || title === DEFAULT_TITLE)) {
          setTitle(metadata.title);
        }
        if (!bundleId && metadata?.bundleId) {
          setBundleId(metadata.bundleId);
        }
        if (platform === 'apk' && !apkVersion && metadata?.version) {
          setApkVersion(metadata.version);
        }
        if (platform === 'ipa' && !ipaVersion && metadata?.version) {
          setIpaVersion(metadata.version);
        }
      }
    } catch (err) {
      console.warn(`Failed to parse ${platform} metadata`, err);
    }
  };

  const handleAutofillToggle = (checked: boolean) => {
    setAutofill(checked);
    if (!checked) return;
    if (ipaState.metadata?.title && (!title || title === DEFAULT_TITLE)) {
      setTitle(ipaState.metadata.title);
    }
    if (!bundleId && (apkState.metadata?.bundleId || ipaState.metadata?.bundleId)) {
      setBundleId(apkState.metadata?.bundleId ?? ipaState.metadata?.bundleId ?? '');
    }
    if (!apkVersion && apkState.metadata?.version) {
      setApkVersion(apkState.metadata.version);
    }
    if (!ipaVersion && ipaState.metadata?.version) {
      setIpaVersion(ipaState.metadata.version);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const platforms = selectedPlatforms;
    if (!platforms.length) {
      const message = t('dashboard.errorNoFiles');
      setError(message);
      onError(message);
      return;
    }

    const apkBundle = apkState.metadata?.bundleId?.trim();
    const ipaBundle = ipaState.metadata?.bundleId?.trim();
    if (autofill && apkBundle && ipaBundle && apkBundle !== ipaBundle) {
      const message = t('dashboard.errorAutofillMismatch');
      setError(message);
      onError(message);
      return;
    }

    try {
      setSubmitState('submitting');
      setUploadProgress({ apk: 0, ipa: 0 });
      setToast(null);

      const presign = await requestPresign({
        files: platforms.map((platform) => {
          const state = platform === 'apk' ? apkState : ipaState;
          const file = state.file!;
          return {
            platform,
            fileName: sanitizeFileName(file.name, `${platform}.bin`),
            contentType: file.type || 'application/octet-stream',
          };
        }),
      });

      const uploadsPayload: FinalizeUploadPayload[] = [];
      for (const platform of platforms) {
        const state = platform === 'apk' ? apkState : ipaState;
        const file = state.file;
        const info = presign.uploads[platform];
        if (!file || !info?.url || !info?.key) {
          throw new Error('MISSING_UPLOAD_INFO');
        }

        updateProgress(platform, 0);
        await uploadWithProgress(info, file, (ratio) => updateProgress(platform, ratio));
        updateProgress(platform, 1);

        uploadsPayload.push({
          platform,
          key: info.key,
          size: file.size,
          title: state.metadata?.title ?? null,
          bundleId: state.metadata?.bundleId ?? null,
          version: state.metadata?.version ?? null,
          contentType: file.type || 'application/octet-stream',
        });
      }

      const finalize = await finalizeDistribution({
        linkId: presign.linkId,
        title: title.trim(),
        bundleId: bundleId.trim(),
        apkVersion: apkVersion.trim(),
        ipaVersion: ipaVersion.trim(),
        autofill,
        uploads: uploadsPayload,
      });

      if (finalize.ok) {
        setToast(t('dashboard.toastCreated'));
        setSubmitState('success');
        const maybePromise = onCreated();
        if (maybePromise instanceof Promise) {
          await maybePromise;
        }
        setTimeout(() => setToast(null), 5000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onError(message);
      setSubmitState('idle');
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
    if (!summaries.length) {
      return <p className="text-xs text-gray-500">{t('dashboard.progressPlaceholder')}</p>;
    }
    return (
      <ul className="space-y-1 text-xs text-gray-600">
        {summaries.map(({ platform, state }) => {
          const progress = uploadProgress[platform] ?? 0;
          const percent = Math.round(progress * 100);
          const label =
            state.metadata?.title ??
            state.file?.name ??
            `${platform.toUpperCase()} ${t('dashboard.progressPlaceholder')}`;

          return (
            <li key={platform}>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-gray-700">
                  {platform.toUpperCase()} · {label}
                </span>
                <span>{percent}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-black transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
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

          {toast && (
            <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {toast}
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

