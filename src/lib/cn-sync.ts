import type { D1Database } from '@cloudflare/workers-types';
import { fetchDistributionById } from './distribution';
import { publishCnLink, type CnPublishLinkPayload, type CnServerBindings } from './cn-server';

export async function publishLinkToCnServer(DB: D1Database, env: CnServerBindings, linkId: string) {
  const link = await fetchDistributionById(DB, linkId);
  if (!link) {
    throw new Error('CN_LINK_NOT_FOUND');
  }
  if (!link.ownerId) {
    throw new Error('CN_LINK_OWNER_MISSING');
  }
  const files: CnPublishLinkPayload['files'] = (link.files ?? [])
    .filter((file) => {
      const platform = (file.platform ?? '').toLowerCase();
      return Boolean(file.r2Key) && (platform === 'apk' || platform === 'ipa');
    })
    .map((file) => ({
      id: file.id,
      platform: (file.platform ?? 'apk').toLowerCase() === 'ipa' ? 'ipa' : 'apk',
      key: file.r2Key ?? '',
      size: Number(file.size ?? 0),
      title: file.title,
      bundleId: file.bundleId,
      version: file.version,
      contentType: file.contentType,
    }))
    .filter((file) => file.key);

  const payload: CnPublishLinkPayload = {
    link: {
      id: link.id,
      code: link.code,
      ownerId: link.ownerId,
      title: link.title,
      bundleId: link.bundleId,
      apkVersion: link.apkVersion,
      ipaVersion: link.ipaVersion,
      language: link.language,
      isActive: link.isActive,
      createdAt: link.createdAt,
    },
    files,
  };

  await publishCnLink(env, payload);
}
