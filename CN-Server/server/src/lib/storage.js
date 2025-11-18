const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('../config');

const FILES_DIR = path.join(config.storageRoot, 'files');
const LINKS_DIR = path.join(config.storageRoot, 'links');

const sanitizeKey = (value) => {
  if (!value) return '';
  return value
    .replace(/\\/g, '/')
    .replace(/\.\.+/g, '')
    .replace(/^\//, '')
    .replace(/\/+/g, '/');
};

const ensureDir = async (dirPath) => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const getFilePathForKey = (key) => path.join(FILES_DIR, sanitizeKey(key));

const deleteFileByPath = async (filePath) => {
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
};

const deleteFileByKey = async (key) => {
  const filePath = getFilePathForKey(key);
  await deleteFileByPath(filePath);
};

const readJson = async (filePath) => {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const writeJson = async (filePath, data) => {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

const getMetadataPath = (code) => path.join(LINKS_DIR, `${code}.json`);

const readLinkMetadata = async (code) => {
  const filePath = getMetadataPath(code);
  return readJson(filePath);
};

const writeLinkMetadata = async (code, data) => {
  const filePath = getMetadataPath(code);
  await writeJson(filePath, data);
  return filePath;
};

const deleteLinkMetadata = async (code) => {
  const filePath = getMetadataPath(code);
  await deleteFileByPath(filePath);
};

const initStorage = async () => {
  await ensureDir(FILES_DIR);
  await ensureDir(LINKS_DIR);
};

module.exports = {
  initStorage,
  getFilePathForKey,
  sanitizeKey,
  deleteFileByKey,
  deleteFileByPath,
  readLinkMetadata,
  writeLinkMetadata,
  deleteLinkMetadata,
};
