const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  json: 'application/json; charset=utf-8',
};

/**
 * Infers a standard MIME type from filename or archive path extension.
 * @param {string} nameOrPath
 * @returns {string}
 */
function inferMimeType(nameOrPath) {
  const ext = path.extname(String(nameOrPath || '')).toLowerCase().replace(/^\./, '');
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/**
 * Reads the first 4 bytes of a file to check for the ZIP local file header magic (`PK\x03\x04`).
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function isZipFileMagic(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await fh.read(header, 0, 4, 0);
    return (
      bytesRead >= 4 &&
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      header[2] === 0x03 &&
      header[3] === 0x04
    );
  } finally {
    await fh.close();
  }
}

/**
 * Collects a readable stream into a single Buffer.
 * @param {import('node:stream').Readable} stream
 * @returns {Promise<Buffer>}
 */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Ensures a yauzl ZipFile and its underlying file descriptor are completely closed before returning.
 * @param {yauzl.ZipFile} zipfile
 * @returns {Promise<void>}
 */
function closeZipFileAndWait(zipfile) {
  if (!zipfile) return Promise.resolve();
  const reader = zipfile.reader;
  if (!zipfile.isOpen && (!reader || reader.refCount === 0)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (reader && typeof reader.once === 'function') {
      reader.once('close', done);
      reader.once('error', done);
    }
    zipfile.close();
    if (!reader || reader.refCount === 0) {
      // Fallback timer in case close event already fired synchronously
      setImmediate(done);
    }
  });
}

/**
 * Validates that a manifest string parses as JSON with a valid slides array.
 * @param {string} manifestText
 */
function validateManifestJson(manifestText) {
  const parsed = JSON.parse(manifestText);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.slides)) {
    throw new Error('Project manifest is missing a valid slides array.');
  }
  return parsed;
}

/**
 * Indexes an `.mpres` ZIP archive or legacy `.mpres.json` manifest without loading media bytes into RAM.
 * For ZIP bundles, records each entry's byte offset, size, and compression method from the central
 * directory and local file headers, and extracts only `manifest.json`.
 *
 * @param {string} filePath
 * @returns {Promise<{
 *   format: 'mpres-bundle' | 'manifest-json',
 *   filePath: string,
 *   manifestJson: string,
 *   entries: Map<string, {
 *     archivePath: string,
 *     size: number,
 *     compressedSize: number,
 *     compressionMethod: number,
 *     dataOffset: number,
 *     crc32: number,
 *     mimeType: string
 *   }>,
 *   fileSize: number,
 *   mtimeMs: number
 * }>}
 */
async function indexBundle(filePath) {
  const resolved = path.resolve(filePath);
  const stat = await fs.promises.stat(resolved);
  const isZip = await isZipFileMagic(resolved);

  if (!isZip) {
    const manifestJson = await fs.promises.readFile(resolved, 'utf-8');
    validateManifestJson(manifestJson);
    return {
      format: 'manifest-json',
      filePath: resolved,
      manifestJson,
      entries: new Map(),
      fileSize: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }

  const zipfile = await yauzl.openPromise(resolved, { autoClose: false });
  const entries = new Map();
  let manifestJson = null;

  try {
    for await (const entry of zipfile.eachEntry()) {
      if (/\/$/.test(entry.fileName)) {
        continue;
      }

      if (entry.fileName === 'manifest.json') {
        const readStream = await zipfile.openReadStreamPromise(entry);
        const buf = await streamToBuffer(readStream);
        manifestJson = buf.toString('utf-8');
        continue;
      }

      const localHeader = await zipfile.readLocalFileHeaderPromise(entry, { minimal: true });
      entries.set(entry.fileName, {
        archivePath: entry.fileName,
        size: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
        compressionMethod: entry.compressionMethod,
        dataOffset: localHeader.fileDataStart,
        crc32: entry.crc32,
        mimeType: inferMimeType(entry.fileName),
      });
    }
  } finally {
    await closeZipFileAndWait(zipfile);
  }

  if (manifestJson === null) {
    throw new Error('Project archive is missing manifest.json.');
  }
  validateManifestJson(manifestJson);

  return {
    format: 'mpres-bundle',
    filePath: resolved,
    manifestJson,
    entries,
    fileSize: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

/**
 * Extracts a single entry from a ZIP file to a destination file on disk (used for compressed legacy entries).
 * @param {string} archiveFilePath
 * @param {string} entryName
 * @param {string} destFilePath
 * @returns {Promise<void>}
 */
async function extractEntryToFile(archiveFilePath, entryName, destFilePath) {
  await fs.promises.mkdir(path.dirname(destFilePath), { recursive: true });
  const zipfile = await yauzl.openPromise(path.resolve(archiveFilePath), { autoClose: false });
  let found = false;

  try {
    for await (const entry of zipfile.eachEntry()) {
      if (entry.fileName !== entryName) continue;
      found = true;
      const readStream = await zipfile.openReadStreamPromise(entry);
      const writeStream = fs.createWriteStream(destFilePath);
      await new Promise((resolve, reject) => {
        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        readStream.pipe(writeStream);
      });
      break;
    }
  } finally {
    await closeZipFileAndWait(zipfile);
  }

  if (!found) {
    throw new Error(`Archive entry not found: ${entryName}`);
  }
}

module.exports = {
  inferMimeType,
  isZipFileMagic,
  indexBundle,
  extractEntryToFile,
  closeZipFileAndWait,
};
