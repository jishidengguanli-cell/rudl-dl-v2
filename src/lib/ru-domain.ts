const DEFAULT_RU_DOWNLOAD_BASE = 'https://ru-d.dataruapp.com';

export const normalizeRuDomain = (value: string | undefined | null) =>
  value?.trim().replace(/\/+$/, '') ?? '';

export const getServerRuDownloadBase = (value?: string | null) => {
  const normalized = normalizeRuDomain(value);
  return normalized || DEFAULT_RU_DOWNLOAD_BASE;
};

export const getPublicRuDownloadDomain = () => {
  const normalized = normalizeRuDomain(process.env.NEXT_PUBLIC_RU_DOWNLOAD_DOMAIN);
  return normalized || DEFAULT_RU_DOWNLOAD_BASE;
};

export { DEFAULT_RU_DOWNLOAD_BASE };
