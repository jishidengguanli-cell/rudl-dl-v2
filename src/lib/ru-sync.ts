import type { D1Database } from '@cloudflare/workers-types';
import { fetchDistributionById } from './distribution';
import { publishRuLink, type RuPublishLinkPayload, type RuServerBindings } from './ru-server';

export async function publishLinkToRuServer(DB: D1Database, env: RuServerBindings, linkId: string) {
  const link = await fetchDistributionById(DB, linkId);
  if (!link) {
    throw new Error('RU_LINK_NOT_FOUND');
  }
  if (!link.ownerId) {
    throw new Error('RU_LINK_OWNER_MISSING');
  }
  const files: RuPublishLinkPayload['files'] = (link.files ?? [])
    .filter((file) => {
      const platform = (file.platform ?? '').toLowerCase();
      return Boolean(file.r2Key) && (platform === 'apk' || platform === 'ipa');
    })
    .map((file) => {
      const normalizedPlatform: 'apk' | 'ipa' =
        (file.platform ?? 'apk').toLowerCase() === 'ipa' ? 'ipa' : 'apk';
      return {
        id: file.id,
        platform: normalizedPlatform,
        key: file.r2Key ?? '',
        size: Number(file.size ?? 0),
        title: file.title ?? null,
        bundleId: file.bundleId ?? null,
        version: file.version ?? null,
        contentType: file.contentType ?? null,
      };
    })
    .filter((file) => file.key);

  const payload: RuPublishLinkPayload = {
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

  await publishRuLink(env, payload);
}
