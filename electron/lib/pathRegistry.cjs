const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'avif',
  'svg',
  'bmp',
  'mp4',
  'webm',
  'mov',
  'm4v',
  'mkv',
  'ogv',
]);

const approvedProjectPaths = new Set();
const approvedMediaPaths = new Set();

/**
 * Normalizes a filesystem path into a canonical lookup key (case-folded on Windows).
 * @param {string} filePath
 * @returns {string}
 */
function normalizePathKey(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return '';
  const resolved = path.resolve(filePath.trim());
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Extracts a normalized lowercase file extension without the leading dot.
 * @param {string} filePath
 * @returns {string}
 */
function getExtension(filePath) {
  return path.extname(String(filePath || '')).toLowerCase().replace(/^\./, '');
}

/**
 * Checks whether a file extension is in the supported media whitelist.
 * @param {string} filePath
 * @returns {boolean}
 */
function isSupportedMediaExtension(filePath) {
  const ext = getExtension(filePath);
  return SUPPORTED_MEDIA_EXTENSIONS.has(ext);
}

/**
 * Approves a project file path for subsequent direct saves in this session.
 * @param {string} filePath
 * @returns {string | null} Resolved path if valid, otherwise null.
 */
function approveProjectPath(filePath) {
  const key = normalizePathKey(filePath);
  if (!key) return null;
  const resolved = path.resolve(filePath.trim());
  approvedProjectPaths.add(key);
  return resolved;
}

/**
 * Returns true if the given project path was explicitly approved via dialog, launch argv, or save.
 * @param {string} filePath
 * @returns {boolean}
 */
function isApprovedProjectPath(filePath) {
  const key = normalizePathKey(filePath);
  return Boolean(key && approvedProjectPaths.has(key));
}

/**
 * Approves a media file path after checking extension whitelist and file existence.
 * @param {string} filePath
 * @returns {string | null} Resolved path if approved, otherwise null.
 */
function approveMediaPath(filePath) {
  const key = normalizePathKey(filePath);
  if (!key) return null;
  const resolved = path.resolve(filePath.trim());
  if (!isSupportedMediaExtension(resolved)) return null;
  try {
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  approvedMediaPaths.add(key);
  return resolved;
}

/**
 * Checks whether a media file path was approved and still exists as a supported media file.
 * @param {string} filePath
 * @returns {boolean}
 */
function isApprovedMediaPath(filePath) {
  const key = normalizePathKey(filePath);
  if (!key || !approvedMediaPaths.has(key)) return false;
  const resolved = path.resolve(filePath.trim());
  if (!isSupportedMediaExtension(resolved)) return false;
  try {
    return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
  } catch {
    return false;
  }
}

/**
 * Clears all approved project and media paths (intended for tests).
 */
function resetRegistry() {
  approvedProjectPaths.clear();
  approvedMediaPaths.clear();
}

module.exports = {
  SUPPORTED_MEDIA_EXTENSIONS,
  normalizePathKey,
  isSupportedMediaExtension,
  approveProjectPath,
  isApprovedProjectPath,
  approveMediaPath,
  isApprovedMediaPath,
  resetRegistry,
};
