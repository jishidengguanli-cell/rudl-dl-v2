'use client';

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import JSZip from 'jszip';
import plist from 'plist';
import { parseBuffer as parseBinaryPlist } from 'bplist-parser';
import { Buffer } from 'buffer';
import { useI18n } from '@/i18n/provider';
import type { DashboardFile, DashboardLink } from '@/lib/dashboard';

const DEFAULT_TITLE = 'APP';

type Platform = 'apk' | 'ipa';

type LangCode = 'en' | 'ru' | 'vi' | 'zh-TW' | 'zh-CN';

const LANGUAGE_OPTIONS: Array<{ value: LangCode; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Russian' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'zh-TW', label: 'Traditional Chinese' },
  { value: 'zh-CN', label: 'Simplified Chinese' },
];

const LANGUAGE_SET = new Set<LangCode>(LANGUAGE_OPTIONS.map((item) => item.value));

const normalizeLang = (input: string | null | undefined): LangCode => {
  if (!input) return 'en';
  const trimmed = input.trim();
  if (LANGUAGE_SET.has(trimmed as LangCode)) {
    return trimmed as LangCode;
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'zh-tw') return 'zh-TW';
  if (lower === 'zh-cn') return 'zh-CN';
  if (lower === 'en' || lower === 'ru' || lower === 'vi') {
    return lower as LangCode;
  }
  return 'en';
};

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

const createEmptyExistingFiles = (): Record<Platform, DashboardFile | null> => ({
  apk: null,
  ipa: null,
});

const trimValue = (value: string | null | undefined) => (value ? value.trim() : '');

type Props = {
  open: boolean;
  mode?: 'create' | 'edit';
  initialLink?: DashboardLink | null;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  onUpdated?: (linkId: string) => Promise<void> | void;
  onError: (message: string) => void;
};

type FinalizeResponse = {
  ok: boolean;
  linkId?: string;
  code?: string;
  error?: string;
};

type UpdateResponse = {
  ok: boolean;
  linkId?: string;
  code?: string;
  error?: string;
};

type UploadSuccessResponse = {
  ok: true;
  linkId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  upload: FinalizeUploadPayload;
};

type UploadErrorResponse = {
  ok: false;
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

type FinalizeUploadPayload = {
  platform: Platform;
  key: string;
  size: number;
  title: string | null;
  bundleId: string | null;
  version: string | null;
  contentType: string;
  sha256: string | null;
};

async function finalizeDistribution(body: {
  linkId: string;
  title: string;
  bundleId: string;
  apkVersion: string;
  ipaVersion: string;
  autofill: boolean;
  lang: LangCode;
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

async function patchDistribution(
  linkId: string,
  body: {
    title: string;
    bundleId: string;
    apkVersion: string;
    ipaVersion: string;
    autofill: boolean;
    lang: LangCode;
    uploads: FinalizeUploadPayload[];
  }
) {
  const res = await fetch(`/api/distributions/${linkId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as UpdateResponse;
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `HTTP_${res.status}`);
  }
  return json;
}

export default function AddDistributionModal({
  open,
  mode = 'create',
  initialLink,
  onClose,
  onCreated,
  onUpdated,
  onError,
}: Props) {
  const { t } = useI18n();
  const isEdit = mode === 'edit';
  const fileInputRefs = useRef<Record<Platform, HTMLInputElement | null>>({
    apk: null,
    ipa: null,
  });
  const lastInitializedId = useRef<string | null>(null);
  const [title, setTitle] = useState('');
  const [bundleId, setBundleId] = useState('');
  const [apkVersion, setApkVersion] = useState('');
  const [ipaVersion, setIpaVersion] = useState('');
  const [language, setLanguage] = useState<LangCode>('en');
  const [autofill, setAutofill] = useState(true);
  const [apkState, setApkState] = useState<FileState>({ file: null, metadata: null });
  const [ipaState, setIpaState] = useState<FileState>({ file: null, metadata: null });
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressMap>({ apk: 0, ipa: 0 });
  const [existingFiles, setExistingFiles] = useState<Record<Platform, DashboardFile | null>>(
    createEmptyExistingFiles
  );

  const modalTitle = t(isEdit ? 'dashboard.editDistribution' : 'dashboard.addDistribution');
  const modalDescription = t(
    isEdit ? 'dashboard.editDistributionDesc' : 'dashboard.addDistributionDesc'
  );
  const submitLabel =
    submitState === 'submitting'
      ? t('status.loading')
      : t(isEdit ? 'form.update' : 'form.submit');

  const applyAutofillFromState = useCallback(() => {
    const apkMetaBundle =
      trimValue(apkState.metadata?.bundleId) || trimValue(existingFiles.apk?.bundleId);
    const ipaMetaBundle =
      trimValue(ipaState.metadata?.bundleId) || trimValue(existingFiles.ipa?.bundleId);
    const chosenBundle = ipaMetaBundle || apkMetaBundle;
    if (chosenBundle) {
      setBundleId(chosenBundle);
    }

    const apkMetaVersion =
      trimValue(apkState.metadata?.version) || trimValue(existingFiles.apk?.version);
    if (apkMetaVersion) {
      setApkVersion(apkMetaVersion);
    }

    const ipaMetaVersion =
      trimValue(ipaState.metadata?.version) || trimValue(existingFiles.ipa?.version);
    if (ipaMetaVersion) {
      setIpaVersion(ipaMetaVersion);
    }

    const ipaMetaTitle =
      trimValue(ipaState.metadata?.title) || trimValue(existingFiles.ipa?.title);
    if (ipaMetaTitle) {
      setTitle(ipaMetaTitle);
    }
  }, [apkState.metadata, ipaState.metadata, existingFiles]);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setBundleId('');
      setApkVersion('');
      setIpaVersion('');
      setLanguage('en');
      setAutofill(true);
      setApkState({ file: null, metadata: null });
      setIpaState({ file: null, metadata: null });
      setSubmitState('idle');
      setError(null);
      setToast(null);
      setUploadProgress({ apk: 0, ipa: 0 });
      setExistingFiles(createEmptyExistingFiles());
      lastInitializedId.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !isEdit || !initialLink) return;
    if (lastInitializedId.current === initialLink.id) return;

    setTitle(initialLink.title ?? DEFAULT_TITLE);
    setBundleId(initialLink.bundleId ?? '');
    setApkVersion(initialLink.apkVersion ?? '');
    setIpaVersion(initialLink.ipaVersion ?? '');
    setLanguage(normalizeLang(initialLink.language));
    setAutofill(true);
    setApkState({ file: null, metadata: null });
    setIpaState({ file: null, metadata: null });
    setSubmitState('idle');
    setError(null);
    setToast(null);
    setUploadProgress({ apk: 0, ipa: 0 });

    const mapped = createEmptyExistingFiles();
    for (const file of initialLink.files) {
      const platform = (file.platform ?? '').toLowerCase();
      if (platform === 'apk') mapped.apk = file;
      if (platform === 'ipa') mapped.ipa = file;
    }
    setExistingFiles(mapped);

    lastInitializedId.current = initialLink.id;
  }, [open, isEdit, initialLink]);

  useEffect(() => {
    if (autofill) {
      applyAutofillFromState();
    }
  }, [autofill, apkState.metadata, ipaState.metadata, existingFiles, applyAutofillFromState]);

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

    if (isEdit && !initialLink) {
      const message = 'INVALID_LINK';
      setError(message);
      onError(message);
      return;
    }

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
    const existingApk = existingFiles.apk;
    const existingIpa = existingFiles.ipa;
    if (!title || title === DEFAULT_TITLE) {
      if (ipaState.metadata?.title) {
        setTitle(ipaState.metadata.title);
      } else if (existingIpa?.title) {
        setTitle(existingIpa.title);
      } else if (existingApk?.title) {
        setTitle(existingApk.title);
      }
    }
    if (!bundleId) {
      setBundleId(
        apkState.metadata?.bundleId ??
          ipaState.metadata?.bundleId ??
          existingApk?.bundleId ??
          existingIpa?.bundleId ??
          ''
      );
    }
    if (!apkVersion) {
      setApkVersion(apkState.metadata?.version ?? existingApk?.version ?? '');
    }
    if (!ipaVersion) {
      setIpaVersion(ipaState.metadata?.version ?? existingIpa?.version ?? '');
    }
  };

  const renderFileSection = (platform: Platform) => {
    const state = platform === 'apk' ? apkState : ipaState;
    const setter = platform === 'apk' ? setApkState : setIpaState;
    const existing = existingFiles[platform];
    const disabled = submitState === 'submitting';
    const handleClick = () => {
      const ref = fileInputRefs.current[platform];
      if (ref) {
        ref.value = '';
        ref.click();
      }
    };
    const handleClear = () => {
      const ref = fileInputRefs.current[platform];
      if (ref) ref.value = '';
      setter({ file: null, metadata: null });
    };
    const chooseLabel = state.file
      ? t('form.replaceFile')
      : isEdit
        ? t('form.chooseUpdate')
        : t('form.chooseFile');
    const accept = platform === 'apk' ? '.apk' : '.ipa';

    return (
      <div key={platform} className="space-y-2">
        <p className="text-sm font-medium text-gray-700">
          {t(
            isEdit
              ? platform === 'apk'
                ? 'form.updateApk'
                : 'form.updateIpa'
              : platform === 'apk'
              ? 'form.apkUpload'
              : 'form.ipaUpload'
          )}
        </p>
        <input
          ref={(node) => {
            fileInputRefs.current[platform] = node;
          }}
          type="file"
          accept={accept}
          className="hidden"
          disabled={disabled}
          onChange={(event) => handleFileChange(platform, event.target.files)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleClick}
            disabled={disabled}
          >
            {chooseLabel}
          </button>
          {state.file && (
            <button
              type="button"
              className="rounded border px-3 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={handleClear}
              disabled={disabled}
            >
              {t('form.clearOverride')}
            </button>
          )}
        </div>
        {state.file ? (
          <p className="text-xs text-gray-600">{state.file.name}</p>
        ) : existing ? (
          <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
            <div className="font-semibold text-gray-700">{existing.title ?? DEFAULT_TITLE}</div>
            <div>
              {t('form.currentVersion')}: {existing.version ?? '-'}
            </div>
            <div>
              {t('form.currentSize')}:{' '}
              {typeof existing.size === 'number'
                ? `${(existing.size / (1024 * 1024)).toFixed(1)} MB`
                : '-'}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500">{t('dashboard.progressPlaceholder')}</p>
        )}
      </div>
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const platforms = selectedPlatforms;
    const hasUploads = platforms.length > 0;
    if (!hasUploads && !isEdit) {
      const message = t('dashboard.errorNoFiles');
      setError(message);
      onError(message);
      return;
    }

    const existingApkBundle = trimValue(existingFiles.apk?.bundleId);
    const existingIpaBundle = trimValue(existingFiles.ipa?.bundleId);
    const newApkBundle = apkState.file ? trimValue(apkState.metadata?.bundleId) : '';
    const newIpaBundle = ipaState.file ? trimValue(ipaState.metadata?.bundleId) : '';
    const compareApkBundle = apkState.file ? newApkBundle : existingApkBundle;
    const compareIpaBundle = ipaState.file ? newIpaBundle : existingIpaBundle;

    if (autofill && compareApkBundle && compareIpaBundle && compareApkBundle !== compareIpaBundle) {
      const message = t('dashboard.errorAutofillMismatch');
      setError(message);
      onError(message);
      return;
    }

    try {
      setSubmitState('submitting');
      setUploadProgress({ apk: 0, ipa: 0 });
      setToast(null);

      let linkId: string | null = isEdit && initialLink ? initialLink.id : null;
      const uploadsPayload: FinalizeUploadPayload[] = [];

      const uploadPlatform = async (
        platform: Platform,
        existingLinkId: string | null
      ): Promise<{ linkId: string; upload: FinalizeUploadPayload }> => {
        const state = platform === 'apk' ? apkState : ipaState;
        const file = state.file!;
        const contentType = file.type || 'application/octet-stream';
        const baseMetadata = {
          title: state.metadata?.title?.trim() || null,
          bundleId: state.metadata?.bundleId?.trim() || null,
          version: state.metadata?.version?.trim() || null,
        };

        const initRes = await fetch('/api/distributions/upload', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            platform,
            linkId: existingLinkId,
            fileName: file.name,
            size: file.size,
            contentType,
            title: baseMetadata.title,
            bundleId: baseMetadata.bundleId,
            version: baseMetadata.version,
          }),
        });
        let initParsed: UploadSuccessResponse | UploadErrorResponse;
        try {
          initParsed = (await initRes.json()) as UploadSuccessResponse | UploadErrorResponse;
        } catch {
          throw new Error(`HTTP_${initRes.status}`);
        }
        if (!initParsed.ok) {
          throw new Error(initParsed.error ?? `HTTP_${initRes.status}`);
        }

        const uploadHeaders: Record<string, string> = {
          'Content-Type': contentType,
          ...(initParsed.uploadHeaders ?? {}),
        };

        updateProgress(platform, 0.01);

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', initParsed.uploadUrl);
          Object.entries(uploadHeaders).forEach(([header, value]) => {
            try {
              xhr.setRequestHeader(header, value);
            } catch {
              // Ignore browsers that disallow setting certain headers.
            }
          });
          xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || event.total === 0) return;
            const ratio = event.loaded / event.total;
            updateProgress(platform, Math.min(0.99, ratio));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(xhr.responseText || `UPLOAD_FAILED_${xhr.status}`));
            }
          };
          xhr.onerror = () => {
            reject(new Error('NETWORK_ERROR'));
          };
          xhr.send(file);
        });

        updateProgress(platform, 1);
        return { linkId: initParsed.linkId, upload: { ...initParsed.upload, size: file.size } };
      };

      for (const platform of platforms) {
        const state = platform === 'apk' ? apkState : ipaState;
        if (!state.file) continue;
        const result = await uploadPlatform(platform, linkId);
        linkId = result.linkId;
        uploadsPayload.push({
          platform: result.upload.platform,
          key: result.upload.key,
          size: result.upload.size,
          title: result.upload.title,
          bundleId: result.upload.bundleId,
          version: result.upload.version,
          contentType: result.upload.contentType,
          sha256: result.upload.sha256 ?? null,
        });
      }

      if (!linkId) {
        throw new Error('UPLOAD_MISSING');
      }

      if (isEdit) {
        const update = await patchDistribution(linkId, {
          title: title.trim(),
          bundleId: bundleId.trim(),
          apkVersion: apkVersion.trim(),
          ipaVersion: ipaVersion.trim(),
          autofill,
          lang: language,
          uploads: uploadsPayload,
        });
        if (update.ok) {
          setToast(t('dashboard.toastUpdated'));
          setSubmitState('success');
          const maybePromise = onUpdated?.(linkId);
          if (maybePromise instanceof Promise) {
            await maybePromise;
          }
          setTimeout(() => setToast(null), 4000);
        }
      } else {
        const finalize = await finalizeDistribution({
          linkId,
          title: title.trim(),
          bundleId: bundleId.trim(),
          apkVersion: apkVersion.trim(),
          ipaVersion: ipaVersion.trim(),
          autofill,
          lang: language,
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
      return (
        <p className="text-sm text-green-600">
          {t(isEdit ? 'dashboard.toastUpdated' : 'dashboard.toastCreated')}
        </p>
      );
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
                  {platform.toUpperCase()} 繚 {label}
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
          <h3 className="text-lg font-semibold text-gray-900">{modalTitle}</h3>
          <p className="mt-1 text-sm text-gray-600">{modalDescription}</p>
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
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('form.language')}
              <select
                className="mt-1 rounded border px-3 py-2 text-sm outline-none focus:border-black"
                value={language}
                onChange={(event) => setLanguage(normalizeLang(event.target.value))}
                disabled={submitState === 'submitting'}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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

          <div className="space-y-4">
            {(['apk', 'ipa'] as Platform[]).map((platform) => renderFileSection(platform))}
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
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
