export type NetworkArea = 'global' | 'CN' | 'RU';
export type RegionalNetworkArea = Extract<NetworkArea, 'CN' | 'RU'>;

export const NETWORK_AREA_OPTIONS: ReadonlyArray<{ value: NetworkArea; labelKey: string }> = [
  { value: 'global', labelKey: 'networkArea.global' },
  { value: 'CN', labelKey: 'networkArea.cn' },
  { value: 'RU', labelKey: 'networkArea.ru' },
];

export function normalizeNetworkArea(input: string | null | undefined): NetworkArea {
  if (input === 'CN') return 'CN';
  if (input === 'RU') return 'RU';
  return 'global';
}

export function isRegionalNetworkArea(
  input: NetworkArea | string | null | undefined
): input is RegionalNetworkArea {
  return input === 'CN' || input === 'RU';
}
