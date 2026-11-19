import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveStreamingAssets } = require('../electron/lib/streamingAssets.cjs') as {
  resolveStreamingAssets: (
    rawAssetsInput: unknown,
    deps?: {
      isApprovedMediaPath?: (filePath: string) => boolean;
      getArchiveEntryRef?: (
        projectToken: string,
        archiveEntry: string
      ) => null | {
        bundlePath: string;
        archiveEntry: string;
        dataOffset: number;
        size: number;
        compressionMethod: number;
      };
    }
  ) => {
    missingFiles: Array<{ archivePath: string; fileName: string; path: string }>;
    resolvedAssets: Array<Record<string, unknown>>;
  };
};

/**
 * The real guards live in the main process (`pathRegistry` / `bundleTokens`), so they are injected
 * here. This locks the contract that manual save and autosave both depend on: an unapproved file
 * must surface as a missing source instead of silently producing a bundle without that media.
 */
export async function runStreamingAssetsTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function runCase(id: string, title: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ [${id}] ${title}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [${id}] ${title}:`, err);
      failed++;
    }
  }

  const approved = (p: string) => p.startsWith('C:\\approved\\');
  const archiveRef = (token: string, entry: string) =>
    token === 'tok-ok'
      ? {
          bundlePath: 'C:\\decks\\deck.mpres',
          archiveEntry: entry,
          dataOffset: 4096,
          size: 8192,
          compressionMethod: 0,
        }
      : null;
  const deps = { isApprovedMediaPath: approved, getArchiveEntryRef: archiveRef };

  await runCase('STREAM-01', 'Approved file source resolves to a plain file descriptor', () => {
    const { missingFiles, resolvedAssets } = resolveStreamingAssets(
      [{ archivePath: 'assets/a.png', source: 'file', path: 'C:\\approved\\a.png' }],
      deps
    );
    assert.equal(missingFiles.length, 0);
    assert.deepEqual(resolvedAssets, [
      { archivePath: 'assets/a.png', source: 'file', path: 'C:\\approved\\a.png' },
    ]);
  });

  await runCase('STREAM-02', 'Unapproved file source is reported as missing, not silently dropped', () => {
    const { missingFiles, resolvedAssets } = resolveStreamingAssets(
      [{ archivePath: 'assets/b.png', source: 'file', path: 'D:\\elsewhere\\b.png' }],
      deps
    );
    assert.equal(resolvedAssets.length, 0);
    assert.equal(missingFiles.length, 1);
    assert.equal(missingFiles[0].archivePath, 'assets/b.png');
    assert.equal(missingFiles[0].fileName, 'b.png');
    assert.equal(missingFiles[0].path, 'D:\\elsewhere\\b.png');
  });

  await runCase('STREAM-03', 'File source with an empty path is missing (never a zero-byte entry)', () => {
    const { missingFiles } = resolveStreamingAssets(
      [{ archivePath: 'assets/c.png', source: 'file', path: '' }],
      deps
    );
    assert.equal(missingFiles.length, 1);
    assert.equal(missingFiles[0].path, '');
  });

  await runCase('STREAM-04', 'Known archive token resolves to byte-range offsets for the writer', () => {
    const { missingFiles, resolvedAssets } = resolveStreamingAssets(
      [
        {
          archivePath: 'assets/v.mp4',
          source: 'archive',
          projectToken: 'tok-ok',
          archiveEntry: 'assets/v.mp4',
        },
      ],
      deps
    );
    assert.equal(missingFiles.length, 0);
    assert.deepEqual(resolvedAssets[0], {
      archivePath: 'assets/v.mp4',
      source: 'archive',
      bundlePath: 'C:\\decks\\deck.mpres',
      archiveEntry: 'assets/v.mp4',
      dataOffset: 4096,
      size: 8192,
      compressionMethod: 0,
    });
  });

  await runCase('STREAM-05', 'Expired/unknown archive token reports a missing source', () => {
    const { missingFiles, resolvedAssets } = resolveStreamingAssets(
      [
        {
          archivePath: 'assets/v.mp4',
          source: 'archive',
          projectToken: 'tok-expired',
          archiveEntry: 'assets/v.mp4',
        },
      ],
      deps
    );
    assert.equal(resolvedAssets.length, 0);
    assert.equal(missingFiles.length, 1);
    assert.equal(missingFiles[0].archivePath, 'assets/v.mp4');
    assert.equal(missingFiles[0].fileName, 'v.mp4');
  });

  await runCase('STREAM-06', 'Byte sources pass through untouched (newly imported media)', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { missingFiles, resolvedAssets } = resolveStreamingAssets(
      [{ archivePath: 'assets/new.png', source: 'bytes', bytes }],
      deps
    );
    assert.equal(missingFiles.length, 0);
    assert.equal(resolvedAssets[0].source, 'bytes');
    assert.equal(resolvedAssets[0].bytes, bytes);
  });

  await runCase('STREAM-07', 'Malformed descriptors are skipped instead of throwing', () => {
    const { missingFiles, resolvedAssets } = resolveStreamingAssets(
      [null, {}, { archivePath: 42 }, { archivePath: 'assets/x.png', source: 'nope' }],
      deps
    );
    assert.equal(missingFiles.length, 0);
    assert.equal(resolvedAssets.length, 0);
  });

  await runCase('STREAM-08', 'A non-array payload yields empty results (defensive main-process call)', () => {
    for (const bad of [undefined, null, 'nope', 7, {}]) {
      const { missingFiles, resolvedAssets } = resolveStreamingAssets(bad, deps);
      assert.deepEqual(missingFiles, []);
      assert.deepEqual(resolvedAssets, []);
    }
  });

  await runCase('STREAM-09', 'Missing dependency functions fail closed (treated as untrusted)', () => {
    const fileOnly = resolveStreamingAssets(
      [{ archivePath: 'assets/a.png', source: 'file', path: 'C:\\approved\\a.png' }],
      {}
    );
    assert.equal(fileOnly.resolvedAssets.length, 0);
    assert.equal(fileOnly.missingFiles.length, 1);

    const archiveOnly = resolveStreamingAssets(
      [
        {
          archivePath: 'assets/v.mp4',
          source: 'archive',
          projectToken: 'tok-ok',
          archiveEntry: 'assets/v.mp4',
        },
      ],
      {}
    );
    assert.equal(archiveOnly.resolvedAssets.length, 0);
    assert.equal(archiveOnly.missingFiles.length, 1);
  });

  console.log(`\nStreaming Assets Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
