const crypto = require('crypto');
const { operationError } = require('./operation-result');

function createId(prefix = 'book') {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

function sanitizeName(name, fallback = 'Book') {
  const safe = String(name || fallback).trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  return safe || fallback;
}

function extensionForMimeType(mimeType, fallback = '.bin') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('gif')) return '.gif';
  if (normalized.includes('svg')) return '.svg';
  if (normalized.includes('webm')) return '.webm';
  if (normalized.includes('ogg')) return '.ogg';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return '.mp3';
  if (normalized.includes('mp4') || normalized.includes('aac')) return '.m4a';
  if (normalized.includes('wav')) return '.wav';
  return fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function getBase64DecodedByteLength(base64) {
  const normalized = String(base64 || '').replace(/\s/g, '');
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function decodeBase64DataUrl(dataUrl, options) {
  const {
    allowedMime,
    maxBytes,
    invalidCode,
    invalidMessage,
    tooLargeMessage
  } = options;
  const match = String(dataUrl || '').match(/^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i);
  const mimeType = String(match?.[1] || '').toLowerCase();
  if (!match || !allowedMime(mimeType)) {
    return { ok: false, error: operationError(invalidCode, invalidMessage) };
  }

  const byteLength = getBase64DecodedByteLength(match[2]);
  if (byteLength > maxBytes) {
    return { ok: false, error: operationError('ASSET_TOO_LARGE', tooLargeMessage) };
  }

  return {
    ok: true,
    mimeType,
    buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  };
}

module.exports = {
  createId,
  sanitizeName,
  extensionForMimeType,
  clampNumber,
  getBase64DecodedByteLength,
  decodeBase64DataUrl
};
