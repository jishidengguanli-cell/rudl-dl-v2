const DEFAULT_CN_DOWNLOAD_BASE = 'https://cn-d.dataruapp.com';

export const normalizeCnDomain = (value: string | undefined | null) =>
  value?.trim().replace(/\/+$/, '') ?? '';

export const getServerCnDownloadBase = (value?: string | null) => {
  const normalized = normalizeCnDomain(value);
  return normalized || DEFAULT_CN_DOWNLOAD_BASE;
};

export const getPublicCnDownloadDomain = () => {
  const normalized = normalizeCnDomain(process.env.NEXT_PUBLIC_CN_DOWNLOAD_DOMAIN);
  return normalized || DEFAULT_CN_DOWNLOAD_BASE;
};

export { DEFAULT_CN_DOWNLOAD_BASE };
