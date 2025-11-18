export type NetworkArea = 'global' | 'CN';

export const NETWORK_AREA_OPTIONS: ReadonlyArray<{ value: NetworkArea; labelKey: string }> = [
  { value: 'global', labelKey: 'networkArea.global' },
  { value: 'CN', labelKey: 'networkArea.cn' },
];

export function normalizeNetworkArea(input: string | null | undefined): NetworkArea {
  return input === 'CN' ? 'CN' : 'global';
}
