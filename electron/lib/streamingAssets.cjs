const path = require('node:path');

/**
 * Maps the renderer's declarative asset descriptors onto concrete file paths or archive byte
 * ranges for the streaming ZIP writer (`.mpres` bundles).
 *
 * Shared by the manual save flow and the autosave snapshot so both always produce identical
 * archives. The two trust checks live in the main process, so they are injected:
 *
 * @param {Array<object>|undefined} rawAssetsInput
 * @param {{
 *   isApprovedMediaPath: (filePath: string) => boolean,
 *   getArchiveEntryRef: (projectToken: string, archiveEntry: string) => null | {
 *     bundlePath: string, archiveEntry: string, dataOffset: number, size: number,
 *     compressionMethod: number
 *   }
 * }} deps
 * @returns {{ missingFiles: Array<object>, resolvedAssets: Array<object> }}
 */
function resolveStreamingAssets(rawAssetsInput, deps) {
  const { isApprovedMediaPath, getArchiveEntryRef } = deps || {};
  const rawAssets = Array.isArray(rawAssetsInput) ? rawAssetsInput : [];
  const missingFiles = [];
  const resolvedAssets = [];

  for (const item of rawAssets) {
    if (!item || typeof item.archivePath !== 'string') continue;

    if (item.source === 'file') {
      if (!item.path || typeof isApprovedMediaPath !== 'function' || !isApprovedMediaPath(item.path)) {
        missingFiles.push({
          archivePath: item.archivePath,
          fileName: item.fileName || path.basename(String(item.path || item.archivePath)),
          path: item.path || '',
        });
        continue;
      }
      resolvedAssets.push({
        archivePath: item.archivePath,
        source: 'file',
        path: item.path,
      });
      continue;
    }

    if (item.source === 'archive') {
      const ref =
        typeof getArchiveEntryRef === 'function'
          ? getArchiveEntryRef(item.projectToken, item.archiveEntry)
          : null;
      if (!ref) {
        missingFiles.push({
          archivePath: item.archivePath,
          fileName: item.fileName || path.basename(String(item.archiveEntry || item.archivePath)),
          path: '',
        });
        continue;
      }
      resolvedAssets.push({
        archivePath: item.archivePath,
        source: 'archive',
        bundlePath: ref.bundlePath,
        archiveEntry: ref.archiveEntry,
        dataOffset: ref.dataOffset,
        size: ref.size,
        compressionMethod: ref.compressionMethod,
      });
      continue;
    }

    if (item.source === 'bytes') {
      resolvedAssets.push({
        archivePath: item.archivePath,
        source: 'bytes',
        bytes: item.bytes,
      });
    }
  }

  return { missingFiles, resolvedAssets };
}

module.exports = { resolveStreamingAssets };
