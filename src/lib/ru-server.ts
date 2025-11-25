import { getServerRuDownloadBase } from './ru-domain';

export type RuServerBindings = {
  RU_SERVER_API_BASE?: string;
  RU_SERVER_API_TOKEN?: string;
  RU_DOWNLOAD_BASE_URL?: string;
};

type UploadTicketResponse = {
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
};

export type RuPublishFile = {
  id?: string | null;
  platform: 'apk' | 'ipa';
  key: string;
  size: number;
  title?: string | null;
  bundleId?: string | null;
  version?: string | null;
  contentType?: string | null;
};

export type RuPublishLinkPayload = {
  link: {
    id: string;
    code: string;
    ownerId: string;
    title: string | null;
    bundleId: string | null;
    apkVersion: string | null;
    ipaVersion: string | null;
    language: string;
    isActive: boolean;
    createdAt: number;
  };
  files: RuPublishFile[];
};

type RuServerConfig = {
  baseUrl: string;
  token: string;
};

export type RuTestFileResponse = {
  ok: boolean;
  key?: string;
  filePath?: string;
  fileUrl?: string;
  exists?: boolean;
  size?: number;
  error?: string;
};

const normalizeApiBase = (value: string | undefined | null) => {
  if (!value) return '';
  return value.trim().replace(/\/+$/, '');
};

const getRuServerConfig = (bindings: RuServerBindings): RuServerConfig => {
  const baseUrl = normalizeApiBase(bindings.RU_SERVER_API_BASE);
  const token = (bindings.RU_SERVER_API_TOKEN ?? '').trim();
  if (!baseUrl || !token) {
    throw new Error('RU_SERVER_NOT_CONFIGURED');
  }
  return { baseUrl, token };
};

const ruRequest = async (
  bindings: RuServerBindings,
  path: string,
  init: RequestInit = {}
) => {
  const { baseUrl, token } = getRuServerConfig(bindings);
  const target = new URL(path.replace(/^\//, ''), `${baseUrl}/`).toString();
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  const response = await fetch(target, { ...init, headers });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`RU_SERVER_REQUEST_FAILED:${response.status}:${message}`);
  }
  return response;
};

export const getRuDownloadBaseUrl = (bindings?: Partial<RuServerBindings>): string => {
  return getServerRuDownloadBase(bindings?.RU_DOWNLOAD_BASE_URL);
};

export const createRuUploadTicket = async (
  bindings: RuServerBindings,
  payload: {
    key: string;
    contentType: string;
    size: number;
    platform: 'apk' | 'ipa';
    linkId: string;
    ownerId: string;
  }
): Promise<UploadTicketResponse> => {
  const response = await ruRequest(bindings, '/api/uploads/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await response.json()) as {
    ok?: boolean;
    uploadUrl?: string;
    uploadHeaders?: Record<string, string>;
  };
  if (!json?.ok || !json.uploadUrl) {
    throw new Error('RU_UPLOAD_TICKET_FAILED');
  }
  return {
    uploadUrl: json.uploadUrl,
    uploadHeaders: json.uploadHeaders ?? {},
  };
};

export const publishRuLink = async (
  bindings: RuServerBindings,
  payload: RuPublishLinkPayload
): Promise<void> => {
  await ruRequest(bindings, '/api/links/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const deleteRuLink = async (
  bindings: RuServerBindings,
  payload: { linkId: string; code: string; keys: string[] }
): Promise<void> => {
  await ruRequest(bindings, '/api/links/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const cleanupRuUploads = async (
  bindings: RuServerBindings,
  keys: string[]
): Promise<void> => {
  const trimmed = keys.map((key) => key.replace(/^\/+/, '')).filter(Boolean);
  if (!trimmed.length) return;
  await ruRequest(bindings, '/api/uploads/cleanup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keys: trimmed }),
  });
};

export const createRuTestFile = async (
  bindings: RuServerBindings,
  fileName?: string
): Promise<RuTestFileResponse> => {
  const response = await ruRequest(bindings, '/api/debug/create-test-file', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName }),
  });
  const json = (await response.json()) as RuTestFileResponse;
  if (!json?.ok) {
    throw new Error(json?.error ?? 'RU_TEST_FILE_FAILED');
  }
  if (!json.exists) {
    throw new Error(json?.error ?? 'RU_TEST_FILE_NOT_CONFIRMED');
  }
  return json;
};
