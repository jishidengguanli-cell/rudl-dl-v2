const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const { pipeline } = require('stream/promises');
const config = require('../config');
const {
  getFilePathForKey,
  sanitizeKey,
  deleteFileByKey,
} = require('../lib/storage');

const router = express.Router();
const uploadTickets = new Map();

const requireAdmin = (req, res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!config.adminToken || token !== config.adminToken) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
  return next();
};

const ensureParentDir = async (filePath) => {
  await fsp.mkdir(require('path').dirname(filePath), { recursive: true });
};

router.post('/api/uploads/presign', requireAdmin, async (req, res) => {
  const { key, contentType, size, platform, linkId, ownerId } = req.body ?? {};
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ ok: false, error: 'INVALID_KEY' });
  }
  if (!platform || !['apk', 'ipa'].includes(String(platform).toLowerCase())) {
    return res.status(400).json({ ok: false, error: 'INVALID_PLATFORM' });
  }
  if (!linkId || !ownerId) {
    return res.status(400).json({ ok: false, error: 'INVALID_LINK_OR_OWNER' });
  }
  const numericSize = Number(size);
  if (!Number.isFinite(numericSize) || numericSize <= 0) {
    return res.status(400).json({ ok: false, error: 'INVALID_SIZE' });
  }
  const safeKey = sanitizeKey(key);
  const filePath = getFilePathForKey(safeKey);
  await ensureParentDir(filePath);
  await deleteFileByKey(safeKey).catch(() => null);

  const ticketId = crypto.randomUUID();
  const ticketToken = crypto.randomUUID();
  uploadTickets.set(ticketId, {
    key: safeKey,
    filePath,
    contentType: contentType || 'application/octet-stream',
    size: numericSize,
    token: ticketToken,
    createdAt: Date.now(),
  });

  return res.json({
    ok: true,
    uploadUrl: `${config.publicBaseUrl}/api/uploads/${ticketId}`,
    uploadHeaders: {
      'x-upload-token': ticketToken,
    },
  });
});

const corsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Upload-Token');
};

router.options('/api/uploads/:ticketId', (req, res) => {
  corsHeaders(res);
  res.status(204).end();
});

router.put('/api/uploads/:ticketId', async (req, res) => {
  corsHeaders(res);
  const ticketId = req.params.ticketId;
  const ticket = uploadTickets.get(ticketId);
  if (!ticket) {
    return res.status(404).json({ ok: false, error: 'TICKET_NOT_FOUND' });
  }
  const headerToken = req.headers['x-upload-token'];
  if (!headerToken || headerToken !== ticket.token) {
    return res.status(401).json({ ok: false, error: 'INVALID_UPLOAD_TOKEN' });
  }

  try {
    const writeStream = fs.createWriteStream(ticket.filePath, { flags: 'w' });
    await pipeline(req, writeStream);
    const stats = await fsp.stat(ticket.filePath).catch(() => null);
    if (!stats || stats.size <= 0) {
      await deleteFileByKey(ticket.key).catch(() => null);
      uploadTickets.delete(ticketId);
      return res.status(400).json({ ok: false, error: 'EMPTY_UPLOAD' });
    }
    uploadTickets.delete(ticketId);
    return res.json({ ok: true });
  } catch (error) {
    await deleteFileByKey(ticket.key).catch(() => null);
    uploadTickets.delete(ticketId);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/api/uploads/cleanup', requireAdmin, async (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  await Promise.all(
    keys.map((key) =>
      deleteFileByKey(key).catch(() => null)
    )
  );
  return res.json({ ok: true, cleaned: keys.length });
});

module.exports = router;
