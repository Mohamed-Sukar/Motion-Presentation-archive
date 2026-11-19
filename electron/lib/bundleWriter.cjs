const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { closeZipFileAndWait } = require('./bundleIndex.cjs');

const MAX_IN_MEMORY_ASSET_BYTES = 64 * 1024 * 1024; // 64 MB cap per raw buffer asset

/**
 * Opens a lazy ReadStream for an entry stored inside an existing ZIP archive.
 * Supports direct zero-copy range streaming for STORE (method 0) entries and
 * transparent decompression for deflated legacy entries.
 */
function openArchiveEntryStream(asset, cb) {
  if (
    asset.compressionMethod === 0 &&
    typeof asset.dataOffset === 'number' &&
    typeof asset.size === 'number' &&
    asset.size >= 0
  ) {
    if (asset.size === 0) {
      const { Readable } = require('node:stream');
      cb(null, Readable.from([]));
      return;
    }
    const stream = fs.createReadStream(asset.bundlePath, {
      start: asset.dataOffset,
      end: asset.dataOffset + asset.size - 1,
    });
    cb(null, stream);
    return;
  }

  // Fallback for compressed archive entries: stream through yauzl
  yauzl.open(asset.bundlePath, { lazyEntries: true, autoClose: false }, (openErr, zipfile) => {
    if (openErr || !zipfile) {
      cb(openErr || new Error('Failed to open source archive.'));
      return;
    }

    let matched = false;
    zipfile.on('error', (err) => {
      void closeZipFileAndWait(zipfile).finally(() => cb(err));
    });
    zipfile.on('end', () => {
      if (!matched) {
        void closeZipFileAndWait(zipfile).finally(() =>
          cb(new Error(`Archive entry not found: ${asset.archiveEntry}`))
        );
      }
    });
    zipfile.on('entry', (entry) => {
      if (entry.fileName !== asset.archiveEntry) {
        zipfile.readEntry();
        return;
      }
      matched = true;
      zipfile.openReadStream(entry, (streamErr, readStream) => {
        if (streamErr || !readStream) {
          void closeZipFileAndWait(zipfile).finally(() =>
            cb(streamErr || new Error('Failed to stream archive entry.'))
          );
          return;
        }
        const closeZip = () => {
          void closeZipFileAndWait(zipfile);
        };
        readStream.once('end', closeZip);
        readStream.once('close', closeZip);
        readStream.once('error', closeZip);
        cb(null, readStream);
      });
    });
    zipfile.readEntry();
  });
}

/**
 * Streams a complete `.mpres` ZIP64-capable archive into `outFilePath` without buffering media
 * payloads in RAM. Calls `fsync()` before resolving.
 *
 * @param {string} outFilePath
 * @param {{
 *   manifestJson: string,
 *   assets: Array<
 *     | { archivePath: string, source: 'file', path: string, size?: number }
 *     | { archivePath: string, source: 'archive', bundlePath: string, archiveEntry: string, dataOffset?: number, size: number, compressionMethod?: number }
 *     | { archivePath: string, source: 'bytes', bytes: Uint8Array | Buffer }
 *   >
 * }} bundleSpec
 * @param {(progress: { bytesWritten: number, totalBytes: number, currentFile: string }) => void} [onProgress]
 * @returns {Promise<void>}
 */
async function writeBundleToFile(outFilePath, bundleSpec, onProgress) {
  if (!bundleSpec || typeof bundleSpec.manifestJson !== 'string') {
    throw new Error('Missing manifestJson for bundle export.');
  }
  const assets = Array.isArray(bundleSpec.assets) ? bundleSpec.assets : [];
  const manifestBuf = Buffer.from(bundleSpec.manifestJson, 'utf-8');

  // Pre-resolve file sizes so progress totalBytes is accurate and EMFILE is avoided via lazy streams
  const prepared = [];
  let totalBytes = manifestBuf.byteLength;

  for (const item of assets) {
    if (!item || typeof item.archivePath !== 'string' || !item.archivePath) {
      throw new Error('Invalid archivePath in bundle assets.');
    }

    if (item.source === 'file') {
      const resolved = path.resolve(item.path);
      const st = await fs.promises.stat(resolved);
      if (!st.isFile()) {
        throw new Error(`Media source is not a file: ${resolved}`);
      }
      totalBytes += st.size;
      prepared.push({
        archivePath: item.archivePath,
        source: 'file',
        path: resolved,
        size: st.size,
      });
    } else if (item.source === 'archive') {
      if (typeof item.size !== 'number' || item.size < 0) {
        throw new Error(`Invalid archive entry size for ${item.archivePath}`);
      }
      totalBytes += item.size;
      prepared.push({
        archivePath: item.archivePath,
        source: 'archive',
        bundlePath: path.resolve(item.bundlePath),
        archiveEntry: item.archiveEntry,
        dataOffset: item.dataOffset,
        size: item.size,
        compressionMethod: item.compressionMethod ?? 0,
      });
    } else if (item.source === 'bytes') {
      const buf = Buffer.isBuffer(item.bytes) ? item.bytes : Buffer.from(item.bytes || []);
      if (buf.byteLength > MAX_IN_MEMORY_ASSET_BYTES) {
        throw new Error(
          `In-memory asset "${item.archivePath}" exceeds ${MAX_IN_MEMORY_ASSET_BYTES} byte limit.`
        );
      }
      totalBytes += buf.byteLength;
      prepared.push({
        archivePath: item.archivePath,
        source: 'bytes',
        buffer: buf,
        size: buf.byteLength,
      });
    } else {
      throw new Error(`Unsupported asset source type: ${String(item.source)}`);
    }
  }

  const zipfile = new yazl.ZipFile();
  let currentFile = prepared[0]?.archivePath || 'manifest.json';

  for (const asset of prepared) {
    if (asset.source === 'file') {
      zipfile.addReadStreamLazy(
        asset.archivePath,
        { compress: false, size: asset.size },
        (cb) => {
          currentFile = asset.archivePath;
          const stream = fs.createReadStream(asset.path);
          cb(null, stream);
        }
      );
    } else if (asset.source === 'archive') {
      zipfile.addReadStreamLazy(
        asset.archivePath,
        { compress: false, size: asset.size },
        (cb) => {
          currentFile = asset.archivePath;
          openArchiveEntryStream(asset, cb);
        }
      );
    } else {
      zipfile.addBuffer(asset.buffer, asset.archivePath, { compress: false });
    }
  }

  zipfile.addBuffer(manifestBuf, 'manifest.json', { compress: false });
  zipfile.end();

  const safeTotalBytes = Math.max(1, totalBytes);
  let bytesWritten = 0;
  let lastEmitMs = 0;

  const emitProgress = (force = false) => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (!force && now - lastEmitMs < 200) return;
    lastEmitMs = now;
    onProgress({
      bytesWritten: force ? safeTotalBytes : Math.min(bytesWritten, safeTotalBytes),
      totalBytes: safeTotalBytes,
      currentFile,
    });
  };

  await new Promise((resolve, reject) => {
    let settled = false;
    const writeStream = fs.createWriteStream(outFilePath);
    const fail = (err) => {
      if (settled) return;
      settled = true;
      writeStream.destroy();
      reject(err);
    };

    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        bytesWritten += chunk.length;
        emitProgress(false);
        callback(null, chunk);
      },
    });

    zipfile.on('error', fail);
    zipfile.outputStream.on('error', fail);
    meter.on('error', fail);
    writeStream.on('error', fail);
    writeStream.on('close', () => {
      if (settled) return;
      settled = true;
      resolve();
    });

    zipfile.outputStream.pipe(meter).pipe(writeStream);
  });

  emitProgress(true);

  const fh = await fs.promises.open(outFilePath, 'r+');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

module.exports = {
  writeBundleToFile,
  MAX_IN_MEMORY_ASSET_BYTES,
};
