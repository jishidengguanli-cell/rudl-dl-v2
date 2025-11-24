const express = require('express');
const {
  sanitizeKey,
  writeLinkMetadata,
  deleteLinkMetadata,
  deleteFileByKey,
  readLinkMetadata,
  deleteLinkDirectory,
} = require('../lib/storage');
const config = require('../config');

const router = express.Router();

const requireAdmin = (req, res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!config.adminToken || token !== config.adminToken) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
  return next();
};

router.post('/api/links/publish', requireAdmin, async (req, res) => {
  const { link, files } = req.body ?? {};
  if (!link || !link.code || !link.id || !link.ownerId) {
    return res.status(400).json({ ok: false, error: 'INVALID_LINK' });
  }
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ ok: false, error: 'NO_FILES' });
  }
  const normalizedFiles = files
    .map((file) => {
      const platform = (file.platform ?? '').toLowerCase();
      if (!['apk', 'ipa'].includes(platform)) return null;
      const key = sanitizeKey(file.key);
      if (!key) return null;
      return {
        id: file.id ?? null,
        platform,
        key,
        size: Number(file.size ?? 0),
        title: file.title ?? null,
        bundleId: file.bundleId ?? null,
        version: file.version ?? null,
        contentType: file.contentType ?? 'application/octet-stream',
      };
    })
    .filter(Boolean);

  if (!normalizedFiles.length) {
    return res.status(400).json({ ok: false, error: 'FILES_INVALID' });
  }

  await writeLinkMetadata(link.code, {
    link: {
      id: link.id,
      code: link.code,
      ownerId: link.ownerId,
      title: link.title ?? null,
      bundleId: link.bundleId ?? null,
      apkVersion: link.apkVersion ?? null,
      ipaVersion: link.ipaVersion ?? null,
      language: link.language ?? 'en',
      isActive: Boolean(link.isActive),
      createdAt: Number(link.createdAt ?? Date.now()),
    },
    files: normalizedFiles,
  });

  return res.json({ ok: true });
});

router.post('/api/links/delete', requireAdmin, async (req, res) => {
  const { code, keys } = req.body ?? {};
  if (!code) {
    return res.status(400).json({ ok: false, error: 'INVALID_CODE' });
  }
  const meta = await readLinkMetadata(code).catch(() => null);
  await deleteLinkMetadata(code).catch(() => null);
  if (Array.isArray(keys) && keys.length) {
    await Promise.all(keys.map((key) => deleteFileByKey(key).catch(() => null)));
  }
  const ownerId = meta?.link?.ownerId;
  const linkId = meta?.link?.id;
  if (ownerId && linkId) {
    await deleteLinkDirectory(ownerId, linkId).catch(() => null);
  }
  return res.json({ ok: true });
});

module.exports = router;
