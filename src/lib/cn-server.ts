import { DEFAULT_CN_DOWNLOAD_BASE, getServerCnDownloadBase } from './cn-domain';
export { getPublicCnDownloadDomain } from './cn-domain';

export type CnServerBindings = {
  CN_SERVER_API_BASE?: string;
  CN_SERVER_API_TOKEN?: string;
  CN_DOWNLOAD_BASE_URL?: string;
};

type UploadTicketResponse = {
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
};

export type CnPublishFile = {
  id?: string | null;
  platform: 'apk' | 'ipa';
  key: string;
  size: number;
  title?: string | null;
  bundleId?: string | null;
  version?: string | null;
  contentType?: string | null;
};

export type CnPublishLinkPayload = {
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
  files: CnPublishFile[];
};

type CnServerConfig = {
  baseUrl: string;
  token: string;
};

const normalizeApiBase = (value: string | undefined | null) => {
  if (!value) return '';
  return value.trim().replace(/\/+$/, '');
};

const getCnServerConfig = (bindings: CnServerBindings): CnServerConfig => {
  const baseUrl = normalizeApiBase(bindings.CN_SERVER_API_BASE);
  const token = (bindings.CN_SERVER_API_TOKEN ?? '').trim();
  if (!baseUrl || !token) {
    throw new Error('CN_SERVER_NOT_CONFIGURED');
  }
  return { baseUrl, token };
};

const cnRequest = async (
  bindings: CnServerBindings,
  path: string,
  init: RequestInit = {}
) => {
  const { baseUrl, token } = getCnServerConfig(bindings);
  const target = new URL(path.replace(/^\//, ''), `${baseUrl}/`).toString();
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  const response = await fetch(target, { ...init, headers });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`CN_SERVER_REQUEST_FAILED:${response.status}:${message}`);
  }
  return response;
};

export const getCnDownloadBaseUrl = (bindings?: CnServerBindings): string => {
  return getServerCnDownloadBase(bindings?.CN_DOWNLOAD_BASE_URL);
};

export const createCnUploadTicket = async (
  bindings: CnServerBindings,
  payload: {
    key: string;
    contentType: string;
    size: number;
    platform: 'apk' | 'ipa';
    linkId: string;
    ownerId: string;
  }
): Promise<UploadTicketResponse> => {
  const response = await cnRequest(bindings, '/api/uploads/presign', {
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
    throw new Error('CN_UPLOAD_TICKET_FAILED');
  }
  return {
    uploadUrl: json.uploadUrl,
    uploadHeaders: json.uploadHeaders ?? {},
  };
};

export const publishCnLink = async (
  bindings: CnServerBindings,
  payload: CnPublishLinkPayload
): Promise<void> => {
  await cnRequest(bindings, '/api/links/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const deleteCnLink = async (
  bindings: CnServerBindings,
  payload: { linkId: string; code: string; keys: string[] }
): Promise<void> => {
  await cnRequest(bindings, '/api/links/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const cleanupCnUploads = async (
  bindings: CnServerBindings,
  keys: string[]
): Promise<void> => {
  const trimmed = keys.map((key) => key.replace(/^\/+/, '')).filter(Boolean);
  if (!trimmed.length) return;
  await cnRequest(bindings, '/api/uploads/cleanup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keys: trimmed }),
  });
};
