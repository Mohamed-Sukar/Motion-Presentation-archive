import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  isSupportedMediaExtension,
  approveProjectPath,
  isApprovedProjectPath,
  approveMediaPath,
  isApprovedMediaPath,
  resetRegistry,
} = require('../electron/lib/pathRegistry.cjs') as {
  isSupportedMediaExtension: (filePath: string) => boolean;
  approveProjectPath: (filePath: string) => string | null;
  isApprovedProjectPath: (filePath: string) => boolean;
  approveMediaPath: (filePath: string) => string | null;
  isApprovedMediaPath: (filePath: string) => boolean;
  resetRegistry: () => void;
};

export async function runPathRegistryTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING PHASE 1: PATH REGISTRY SECURITY SUITE ---');
  console.log('======================================================');

  let passed = 0;
  let failed = 0;

  const test = async (id: string, name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ [${id}] ${name}`);
      passed++;
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`  ✗ [${id}] ${name}`);
      console.error(`    Error: ${e.message}`);
      failed++;
    }
  };

  await test('REG-01', 'Arbitrary unapproved project & media paths are rejected', () => {
    resetRegistry();
    assert.equal(isApprovedProjectPath('C:\\Temp\\unapproved.mpres'), false);
    assert.equal(isApprovedProjectPath(''), false);
    assert.equal(isApprovedMediaPath('C:\\Temp\\video.mp4'), false);
  });

  await test('REG-02', 'Approved project paths normalize slashes and case on Windows', () => {
    resetRegistry();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-reg-02-'));
    try {
      const projectPath = path.join(tmpDir, 'MyDeck.mpres');
      const approved = approveProjectPath(projectPath);
      assert.ok(approved);
      assert.equal(isApprovedProjectPath(projectPath), true);

      const forwardSlashVariant = projectPath.replace(/\\/g, '/');
      assert.equal(isApprovedProjectPath(forwardSlashVariant), true);

      if (process.platform === 'win32') {
        assert.equal(isApprovedProjectPath(projectPath.toUpperCase()), true);
      }

      assert.equal(isApprovedProjectPath(path.join(tmpDir, 'OtherDeck.mpres')), false);
    } finally {
      resetRegistry();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('REG-03', 'Media allowlist enforces supported extensions and real files on disk', () => {
    resetRegistry();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-reg-03-'));
    try {
      const validMp4 = path.join(tmpDir, 'clip.mp4');
      const validPng = path.join(tmpDir, 'slide.PNG');
      const unsafeExe = path.join(tmpDir, 'script.exe');
      const missingMp4 = path.join(tmpDir, 'missing.mp4');

      fs.writeFileSync(validMp4, 'mp4-bytes');
      fs.writeFileSync(validPng, 'png-bytes');
      fs.writeFileSync(unsafeExe, 'mz');

      assert.equal(isSupportedMediaExtension(validMp4), true);
      assert.equal(isSupportedMediaExtension(validPng), true);
      assert.equal(isSupportedMediaExtension(unsafeExe), false);

      assert.ok(approveMediaPath(validMp4));
      assert.ok(approveMediaPath(validPng));
      assert.equal(approveMediaPath(unsafeExe), null);
      assert.equal(approveMediaPath(missingMp4), null);
      assert.equal(approveMediaPath(tmpDir), null); // directory rejected

      assert.equal(isApprovedMediaPath(validMp4), true);
      assert.equal(isApprovedMediaPath(validPng), true);
      assert.equal(isApprovedMediaPath(unsafeExe), false);

      // Deleted file stops passing isApprovedMediaPath
      fs.unlinkSync(validMp4);
      assert.equal(isApprovedMediaPath(validMp4), false);
    } finally {
      resetRegistry();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  console.log(`\nPath Registry Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
