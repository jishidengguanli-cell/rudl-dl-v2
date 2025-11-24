import type { D1Database } from '@cloudflare/workers-types';
import { publishLinkToCnServer } from './cn-sync';
import { publishLinkToRuServer } from './ru-sync';
import {
  cleanupCnUploads,
  deleteCnLink,
  getCnDownloadBaseUrl,
  type CnServerBindings,
} from './cn-server';
import {
  cleanupRuUploads,
  deleteRuLink,
  getRuDownloadBaseUrl,
  type RuServerBindings,
} from './ru-server';
import type { RegionalNetworkArea } from './network-area';

export type RegionalServerBindings = CnServerBindings & RuServerBindings;

export const isRegionalServerConfigured = (
  area: RegionalNetworkArea | null | undefined,
  bindings?: Partial<RegionalServerBindings>
): area is RegionalNetworkArea => {
  if (!area) return false;
  if (area === 'CN') {
    return Boolean(
      bindings &&
        bindings.CN_SERVER_API_BASE &&
        bindings.CN_SERVER_API_TOKEN
    );
  }
  return Boolean(
    bindings &&
      bindings.RU_SERVER_API_BASE &&
      bindings.RU_SERVER_API_TOKEN
  );
};

export const getRegionalDownloadBaseUrl = (
  area: RegionalNetworkArea,
  bindings?: Partial<RegionalServerBindings>
) => (area === 'CN' ? getCnDownloadBaseUrl(bindings) : getRuDownloadBaseUrl(bindings));

export const cleanupRegionalUploads = (
  area: RegionalNetworkArea,
  bindings: RegionalServerBindings,
  keys: string[]
) =>
  area === 'CN' ? cleanupCnUploads(bindings, keys) : cleanupRuUploads(bindings, keys);

export const deleteRegionalLink = (
  area: RegionalNetworkArea,
  bindings: RegionalServerBindings,
  payload: { linkId: string; code: string; keys: string[] }
) => (area === 'CN' ? deleteCnLink(bindings, payload) : deleteRuLink(bindings, payload));

export const publishLinkToRegionalServer = (
  area: RegionalNetworkArea,
  DB: D1Database,
  bindings: RegionalServerBindings,
  linkId: string
) =>
  area === 'CN'
    ? publishLinkToCnServer(DB, bindings, linkId)
    : publishLinkToRuServer(DB, bindings, linkId);
