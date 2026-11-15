const fs = require('node:fs');
const path = require('node:path');

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Renames a file with bounded exponential backoff for transient Windows AV/indexer locks.
 * @param {string} fromPath
 * @param {string} toPath
 * @param {{ renameFn?: typeof fs.promises.rename, maxAttempts?: number, baseDelayMs?: number }} [options]
 */
async function renameWithRetry(fromPath, toPath, options = {}) {
  const renameFn = options.renameFn || fs.promises.rename;
  const maxAttempts = options.maxAttempts ?? 8;
  const baseDelayMs = options.baseDelayMs ?? 50;

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await renameFn(fromPath, toPath);
      return;
    } catch (err) {
      lastErr = err;
      const code = err && typeof err === 'object' ? err.code : '';
      if (!RETRYABLE_RENAME_CODES.has(code) || attempt === maxAttempts) {
        throw err;
      }
      const delay = Math.min(400, baseDelayMs * Math.pow(2, attempt - 1));
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Best-effort cleanup of stale temporary files next to a target file.
 * @param {string} targetPath
 */
async function cleanupStaleTmpFiles(targetPath) {
  const dir = path.dirname(targetPath);
  const prefix = `${path.basename(targetPath)}.tmp-`;
  try {
    const names = await fs.promises.readdir(dir);
    for (const name of names) {
      if (name.startsWith(prefix)) {
        try {
          await fs.promises.unlink(path.join(dir, name));
        } catch {
          // Ignore locked or already-removed temp files
        }
      }
    }
  } catch {
    // Ignore directory read errors
  }
}

/**
 * Atomically writes/replaces targetPath via a same-directory temp file, fsync, optional verification,
 * optional .bak backup rotation, and retry-protected rename.
 *
 * @param {string} targetPath
 * @param {(tmpPath: string) => Promise<void>} writeFn
 * @param {{
 *   keepBackup?: boolean,
 *   verifyFn?: ((tmpPath: string) => Promise<void>) | null,
 *   renameFn?: typeof fs.promises.rename,
 *   maxAttempts?: number,
 *   baseDelayMs?: number
 * }} [options]
 * @returns {Promise<string>} Resolved final target path.
 */
async function writeAtomic(targetPath, writeFn, options = {}) {
  const resolvedTarget = path.resolve(targetPath);
  const dir = path.dirname(resolvedTarget);
  await fs.promises.mkdir(dir, { recursive: true });

  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = `${resolvedTarget}.tmp-${suffix}`;
  const bakPath = `${resolvedTarget}.bak`;
  const keepBackup = options.keepBackup !== false;
  let movedTargetToBackup = false;

  try {
    await writeFn(tmpPath);

    if (typeof options.verifyFn === 'function') {
      await options.verifyFn(tmpPath);
    }

    const targetExists = fs.existsSync(resolvedTarget);
    if (targetExists && keepBackup) {
      try {
        await renameWithRetry(resolvedTarget, bakPath, options);
        movedTargetToBackup = true;
      } catch {
        // Fallback: copy backup before overwriting target in-place via rename
        await fs.promises.copyFile(resolvedTarget, bakPath);
      }
    }

    try {
      await renameWithRetry(tmpPath, resolvedTarget, options);
    } catch (renameErr) {
      if (movedTargetToBackup && !fs.existsSync(resolvedTarget) && fs.existsSync(bakPath)) {
        try {
          await renameWithRetry(bakPath, resolvedTarget, options);
        } catch {
          // Leave bakPath intact if rollback rename fails
        }
      }
      throw renameErr;
    }

    await cleanupStaleTmpFiles(resolvedTarget);
    return resolvedTarget;
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Atomically writes an in-memory Buffer with explicit fsync before replacement.
 * @param {string} targetPath
 * @param {Buffer | Uint8Array} buffer
 * @param {Parameters<typeof writeAtomic>[2]} [options]
 * @returns {Promise<string>}
 */
async function writeBufferAtomic(targetPath, buffer, options = {}) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return writeAtomic(
    targetPath,
    async (tmpPath) => {
      const fh = await fs.promises.open(tmpPath, 'w');
      try {
        await fh.writeFile(data);
        await fh.sync();
      } finally {
        await fh.close();
      }
    },
    options
  );
}

module.exports = {
  writeAtomic,
  writeBufferAtomic,
  renameWithRetry,
  cleanupStaleTmpFiles,
};
