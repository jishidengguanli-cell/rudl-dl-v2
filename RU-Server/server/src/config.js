const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const resolvePath = (input, fallback) => {
  if (!input) return fallback;
  if (path.isAbsolute(input)) return input;
  return path.resolve(ROOT_DIR, input);
};

const config = {
  port: Number(process.env.PORT ?? 4000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? 'https://ru-d.dataruapp.com').replace(/\/+$/, ''),
  storageRoot: resolvePath(process.env.STORAGE_ROOT, path.join(ROOT_DIR, '..', 'storage')),
  adminToken: process.env.ADMIN_API_TOKEN ?? '',
  nextApiBase: (process.env.NEXT_API_BASE ?? 'https://app.dataruapp.com').replace(/\/+$/, ''),
  nextApiToken: process.env.NEXT_API_TOKEN ?? '',
};

if (!config.adminToken) {
  console.warn('[config] ADMIN_API_TOKEN is not set - admin endpoints will reject requests.');
}
if (!config.nextApiToken) {
  console.warn('[config] NEXT_API_TOKEN is not set - download callbacks will be skipped.');
}

module.exports = config;
