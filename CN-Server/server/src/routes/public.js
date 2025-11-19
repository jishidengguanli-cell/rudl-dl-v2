const express = require('express');
const { readLinkMetadata } = require('../lib/storage');
const { renderDownloadPage } = require('../lib/render');
const { pickLocale } = require('../lib/i18n');
const config = require('../config');

const router = express.Router();

const notifyDownload = async (meta, platform) => {
  if (!config.nextApiToken || typeof fetch !== 'function') return;
  try {
    await fetch(`${config.nextApiBase}/api/cn/download`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.nextApiToken}`,
      },
      body: JSON.stringify({
        linkId: meta.link.id,
        linkCode: meta.link.code,
        ownerId: meta.link.ownerId,
        platform,
      }),
    });
  } catch (error) {
    console.warn('[notify] failed to notify upstream download', error);
  }
};

const ensureActiveLink = (meta) => meta && meta.link && meta.link.isActive;

router.get('/healthz', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

router.get('/d/:code', async (req, res) => {
  const code = String(req.params.code ?? '').trim();
  if (!code) return res.status(404).send('Not Found');
  const meta = await readLinkMetadata(code);
  if (!ensureActiveLink(meta)) {
    return res.status(404).send('Not Found');
  }
  const locale = pickLocale(req.query.lang ?? meta.link.language, req.headers['accept-language']);
  const html = renderDownloadPage({ meta, locale, publicBaseUrl: config.publicBaseUrl });
  res.set('content-type', 'text/html; charset=utf-8');
  res.send(html);
});

router.get('/m/:code', async (req, res) => {
  const code = String(req.params.code ?? '').trim();
  if (!code) return res.status(404).send('Not Found');
  const meta = await readLinkMetadata(code);
  if (!ensureActiveLink(meta)) {
    return res.status(404).send('Not Found');
  }
  const ipa =
    (meta.files || []).find((file) => (file.platform ?? '').toLowerCase() === 'ipa' && file.key) ?? null;
  if (!ipa) {
    return res.status(404).send('Not Found');
  }
  const bundleId = ipa.bundleId || meta.link.bundleId || `com.unknown.${meta.link.code}`;
  const version = ipa.version || meta.link.ipaVersion || meta.link.apkVersion || '1.0';
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>items</key>
    <array>
      <dict>
        <key>assets</key>
        <array>
          <dict>
            <key>kind</key><string>software-package</string>
            <key>url</key><string>${escapeXml(`${config.publicBaseUrl}/files/${encodeURIComponent(ipa.key)}`)}</string>
          </dict>
        </array>
        <key>metadata</key>
        <dict>
          <key>bundle-identifier</key><string>${escapeXml(bundleId)}</string>
          <key>bundle-version</key><string>${escapeXml(version)}</string>
          <key>kind</key><string>software</string>
          <key>title</key><string>${escapeXml(meta.link.title ?? ipa.title ?? 'App')}</string>
        </dict>
      </dict>
    </array>
  </dict>
</plist>`;
  res.set('content-type', 'application/x-plist; charset=utf-8');
  res.send(manifest);
});

router.get('/dl/:code', async (req, res) => {
  const code = String(req.params.code ?? '').trim();
  if (!code) return res.status(404).send('Not Found');
  const meta = await readLinkMetadata(code);
  if (!ensureActiveLink(meta)) {
    return res.status(404).send('Not Found');
  }
  const files = (meta.files || []).filter((file) => file.key);
  if (!files.length) {
    return res.status(404).send('Not Found');
  }
  const query = (req.query.p || req.query.platform || '').toString().toLowerCase();
  const platforms = new Set(files.map((file) => (file.platform || '').toLowerCase()));
  const resolvePlatform = () => {
    if (query === 'ipa' || query === 'ios') return 'ipa';
    if (query === 'apk' || query === 'android') return 'apk';
    if (platforms.has('apk') && !platforms.has('ipa')) return 'apk';
    if (!platforms.has('apk') && platforms.has('ipa')) return 'ipa';
    return 'apk';
  };
  const platform = resolvePlatform();
  const findByPlatform = (p) => files.find((file) => (file.platform ?? '').toLowerCase() === p) ?? null;
  let selected = findByPlatform(platform) ?? files[0] ?? null;
  if (!selected) {
    return res.status(404).send('Not Found');
  }

  await notifyDownload(meta, platform).catch(() => null);

  if (platform === 'apk') {
    return res.redirect(`${config.publicBaseUrl}/files/${encodeURIComponent(selected.key)}`);
  }
  const manifestUrl = `${config.publicBaseUrl}/m/${encodeURIComponent(meta.link.code)}`;
  const destination = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
  return res.redirect(destination);
});

const escapeXml = (input) =>
  String(input ?? '').replace(/[<>&"]/g, (match) => {
    switch (match) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return match;
    }
  });

module.exports = router;
