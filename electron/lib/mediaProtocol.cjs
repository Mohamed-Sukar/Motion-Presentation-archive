const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { extractEntryToFile, inferMimeType } = require('./bundleIndex.cjs');

const activeArchives = new Map(); // projectToken -> { filePath, entries, cacheDir, extractedCache: Map }
const activeMediaFiles = new Map(); // mediaToken -> { filePath, fileName, mimeType, size }

let baseCacheDir = path.join(os.tmpdir(), 'motion-presentation-media-cache');

function setCacheBaseDir(dirPath) {
  if (typeof dirPath === 'string' && dirPath.trim()) {
    baseCacheDir = path.resolve(dirPath.trim());
  }
}

function makeToken() {
  return nodeCrypto.randomBytes(12).toString('hex');
}

function encodeArchivePathForUrl(archivePath) {
  return String(archivePath)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * Registers an indexed `.mpres` archive under a random session token and returns `mpres://` URLs.
 * @param {string} filePath
 * @param {{ entries: Map<string, any> }} bundleIndexResult
 * @returns {{ projectToken: string, assets: Array<{ archivePath: string, url: string, size: number, mimeType: string }> }}
 */
function registerArchiveToken(filePath, bundleIndexResult) {
  const projectToken = makeToken();
  const resolvedPath = path.resolve(filePath);
  const entryMap = new Map(bundleIndexResult.entries || []);

  activeArchives.set(projectToken, {
    filePath: resolvedPath,
    entries: entryMap,
    cacheDir: path.join(baseCacheDir, projectToken),
    extractedCache: new Map(),
  });

  const assets = [];
  for (const [archivePath, meta] of entryMap.entries()) {
    assets.push({
      archivePath,
      url: `mpres://archive/${projectToken}/${encodeArchivePathForUrl(archivePath)}`,
      size: meta.size,
      mimeType: meta.mimeType,
    });
  }

  return { projectToken, assets };
}

/**
 * Updates an existing archive token in-place after saving so existing `mpres://` URLs stay valid.
 * @param {string} projectToken
 * @param {string} filePath
 * @param {{ entries: Map<string, any> }} bundleIndexResult
 */
function updateArchiveToken(projectToken, filePath, bundleIndexResult) {
  if (!projectToken || !activeArchives.has(projectToken)) {
    return registerArchiveToken(filePath, bundleIndexResult);
  }
  const existing = activeArchives.get(projectToken);
  existing.filePath = path.resolve(filePath);
  existing.entries = new Map(bundleIndexResult.entries || []);
  existing.extractedCache.clear();

  const assets = [];
  for (const [archivePath, meta] of existing.entries.entries()) {
    assets.push({
      archivePath,
      url: `mpres://archive/${projectToken}/${encodeArchivePathForUrl(archivePath)}`,
      size: meta.size,
      mimeType: meta.mimeType,
    });
  }
  return { projectToken, assets };
}

/**
 * Looks up an open archive session and entry metadata (used by streaming save when copying archive assets).
 * @param {string} projectToken
 * @param {string} archivePath
 */
function getArchiveEntryRef(projectToken, archivePath) {
  const rec = activeArchives.get(projectToken);
  if (!rec) return null;
  const entry = rec.entries.get(archivePath);
  if (!entry) return null;
  return {
    bundlePath: rec.filePath,
    archiveEntry: archivePath,
    dataOffset: entry.dataOffset,
    size: entry.size,
    compressionMethod: entry.compressionMethod,
  };
}

/**
 * Releases an archive token and removes any fallback extracted cache directory.
 * @param {string} projectToken
 */
async function closeArchiveToken(projectToken) {
  const rec = activeArchives.get(projectToken);
  if (!rec) return;
  activeArchives.delete(projectToken);
  try {
    if (fs.existsSync(rec.cacheDir)) {
      await fs.promises.rm(rec.cacheDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Registers an approved media file on disk and returns its opaque `mpres://file/...` descriptor.
 * @param {string} filePath
 * @returns {Promise<{ token: string, path: string, url: string, fileName: string, mimeType: string, size: number }>}
 */
async function registerMediaFile(filePath) {
  const resolved = path.resolve(filePath);
  const st = await fs.promises.stat(resolved);
  const fileName = path.basename(resolved);
  const mimeType = inferMimeType(fileName);
  const token = makeToken();
  activeMediaFiles.set(token, {
    filePath: resolved,
    fileName,
    mimeType,
    size: st.size,
  });
  return {
    token,
    path: resolved,
    url: `mpres://file/${token}/${encodeURIComponent(fileName)}`,
    fileName,
    mimeType,
    size: st.size,
  };
}

/**
 * Parses an HTTP Range header (e.g. `bytes=0-99` or `bytes=100-` or `bytes=-500`).
 * @param {string | null | undefined} rangeHeader
 * @param {number} totalSize
 * @returns {{ start: number, end: number } | 'unsatisfiable' | null}
 */
function parseByteRange(rangeHeader, totalSize) {
  if (!rangeHeader || typeof rangeHeader !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;

  if (totalSize === 0) {
    return 'unsatisfiable';
  }

  const rawStart = match[1];
  const rawEnd = match[2];

  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    const suffixLen = Number(rawEnd);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return 'unsatisfiable';
    start = Math.max(0, totalSize - suffixLen);
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? totalSize - 1 : Math.min(totalSize - 1, Number(rawEnd));
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start >= totalSize ||
    end < start
  ) {
    return 'unsatisfiable';
  }

  return { start, end };
}

function buildHeaders(extraHeaders) {
  return {
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  };
}

function notFoundResponse(message = 'Not found') {
  return new Response(message, {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Handles `mpres://` requests with full HTTP Range (206) streaming and CORS support.
 * Pure enough to be unit-tested directly against standard Fetch Request/Response objects.
 *
 * @param {{ url: string, method?: string, headers?: { get?: (k: string) => string | null } | Record<string, string> }} request
 * @returns {Promise<Response>}
 */
async function handleMpresRequest(request) {
  let parsedUrl;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    return notFoundResponse('Malformed mpres URL');
  }

  if (parsedUrl.protocol !== 'mpres:') {
    return notFoundResponse('Unsupported protocol');
  }

  const method = (request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: buildHeaders({
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
      }),
    });
  }

  const host = parsedUrl.hostname;
  const rawSegments = parsedUrl.pathname
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));

  if (rawSegments.length < 2) {
    return notFoundResponse('Invalid mpres path');
  }

  let sourceFilePath;
  let baseOffset;
  let totalSize;
  let mimeType;

  if (host === 'archive') {
    const projectToken = rawSegments[0];
    const archivePath = rawSegments.slice(1).join('/');
    const rec = activeArchives.get(projectToken);
    if (!rec) return notFoundResponse('Unknown project token');

    const entry = rec.entries.get(archivePath);
    if (!entry) return notFoundResponse('Unknown archive entry');

    mimeType = entry.mimeType || inferMimeType(archivePath);
    totalSize = entry.size;

    if (entry.compressionMethod === 0) {
      sourceFilePath = rec.filePath;
      baseOffset = entry.dataOffset;
    } else {
      // Compressed entry fallback: extract once per token to cacheDir
      let cachedPath = rec.extractedCache.get(archivePath);
      if (!cachedPath || !fs.existsSync(cachedPath)) {
        const safeRel = archivePath.replace(/[^a-zA-Z0-9._/-]/g, '_');
        cachedPath = path.join(rec.cacheDir, ...safeRel.split('/'));
        await extractEntryToFile(rec.filePath, archivePath, cachedPath);
        rec.extractedCache.set(archivePath, cachedPath);
      }
      sourceFilePath = cachedPath;
      baseOffset = 0;
    }
  } else if (host === 'file') {
    const mediaToken = rawSegments[0];
    const rec = activeMediaFiles.get(mediaToken);
    if (!rec || !fs.existsSync(rec.filePath)) {
      return notFoundResponse('Unknown media file token');
    }
    const st = await fs.promises.stat(rec.filePath);
    sourceFilePath = rec.filePath;
    baseOffset = 0;
    totalSize = st.size;
    mimeType = rec.mimeType || inferMimeType(rec.fileName);
  } else {
    return notFoundResponse('Unknown mpres host');
  }

  const getHeader = (name) => {
    if (!request.headers) return null;
    if (typeof request.headers.get === 'function') return request.headers.get(name);
    return request.headers[name] || request.headers[name.toLowerCase()] || null;
  };

  const rangeHeader = getHeader('range');
  const parsedRange = parseByteRange(rangeHeader, totalSize);

  if (parsedRange === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: buildHeaders({
        'Content-Range': `bytes */${totalSize}`,
      }),
    });
  }

  if (parsedRange) {
    const { start, end } = parsedRange;
    const chunkLen = end - start + 1;
    const headers = buildHeaders({
      'Content-Type': mimeType,
      'Content-Length': String(chunkLen),
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
    });

    if (method === 'HEAD') {
      return new Response(null, { status: 206, headers });
    }

    const nodeStream = fs.createReadStream(sourceFilePath, {
      start: baseOffset + start,
      end: baseOffset + end,
    });
    return new Response(Readable.toWeb(nodeStream), { status: 206, headers });
  }

  const headers = buildHeaders({
    'Content-Type': mimeType,
    'Content-Length': String(totalSize),
  });

  if (method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  if (totalSize === 0) {
    return new Response(new Uint8Array(0), { status: 200, headers });
  }

  const nodeStream = fs.createReadStream(sourceFilePath, {
    start: baseOffset,
    end: baseOffset + totalSize - 1,
  });
  return new Response(Readable.toWeb(nodeStream), { status: 200, headers });
}

function resetMediaProtocolState() {
  activeArchives.clear();
  activeMediaFiles.clear();
}

module.exports = {
  setCacheBaseDir,
  registerArchiveToken,
  updateArchiveToken,
  getArchiveEntryRef,
  closeArchiveToken,
  registerMediaFile,
  parseByteRange,
  handleMpresRequest,
  resetMediaProtocolState,
};
