import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  writeAtomic,
  writeBufferAtomic,
  cleanupStaleTmpFiles,
} = require('../electron/lib/atomicWrite.cjs') as {
  writeAtomic: (
    targetPath: string,
    writeFn: (tmpPath: string) => Promise<void>,
    options?: {
      keepBackup?: boolean;
      verifyFn?: ((tmpPath: string) => Promise<void>) | null;
      renameFn?: (from: string, to: string) => Promise<void>;
      maxAttempts?: number;
      baseDelayMs?: number;
    }
  ) => Promise<string>;
  writeBufferAtomic: (
    targetPath: string,
    buffer: Uint8Array,
    options?: Record<string, unknown>
  ) => Promise<string>;
  cleanupStaleTmpFiles: (targetPath: string) => Promise<void>;
};

export async function runAtomicWriteTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING PHASE 1: ATOMIC WRITE & BACKUP SUITE ---');
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

  await test('ATOMIC-01', 'Normal write creates target file cleanly with no leftover .tmp files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-atomic-01-'));
    try {
      const target = path.join(tmpDir, 'deck.mpres');
      const finalPath = await writeBufferAtomic(target, Buffer.from('v1-content', 'utf-8'));
      assert.equal(finalPath, path.resolve(target));
      assert.equal(fs.readFileSync(target, 'utf-8'), 'v1-content');
      assert.equal(fs.existsSync(`${target}.bak`), false);
      const files = fs.readdirSync(tmpDir);
      assert.deepEqual(files, ['deck.mpres']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('ATOMIC-02', 'Failed writeFn leaves existing target untouched and cleans temp file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-atomic-02-'));
    try {
      const target = path.join(tmpDir, 'deck.mpres');
      await writeBufferAtomic(target, Buffer.from('original-good-data', 'utf-8'));

      await assert.rejects(
        () =>
          writeAtomic(target, async (tmpPath) => {
            await fs.promises.writeFile(tmpPath, 'corrupted-partial-write');
            throw new Error('Simulated crash mid-write');
          }),
        /Simulated crash mid-write/
      );

      assert.equal(fs.readFileSync(target, 'utf-8'), 'original-good-data');
      assert.equal(fs.existsSync(`${target}.bak`), false);
      assert.deepEqual(fs.readdirSync(tmpDir), ['deck.mpres']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('ATOMIC-03', 'Overwrite with keepBackup=true preserves previous version in .bak', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-atomic-03-'));
    try {
      const target = path.join(tmpDir, 'deck.mpres');
      await writeBufferAtomic(target, Buffer.from('version-1', 'utf-8'));
      await writeBufferAtomic(target, Buffer.from('version-2', 'utf-8'), { keepBackup: true });

      assert.equal(fs.readFileSync(target, 'utf-8'), 'version-2');
      assert.equal(fs.readFileSync(`${target}.bak`, 'utf-8'), 'version-1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('ATOMIC-04', 'Failed verifyFn aborts replacement and preserves existing target', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-atomic-04-'));
    try {
      const target = path.join(tmpDir, 'deck.mpres');
      await writeBufferAtomic(target, Buffer.from('stable-v1', 'utf-8'));

      await assert.rejects(
        () =>
          writeAtomic(
            target,
            async (tmpPath) => {
              await fs.promises.writeFile(tmpPath, 'bad-new-bundle');
            },
            {
              verifyFn: async () => {
                throw new Error('Verification failed');
              },
            }
          ),
        /Verification failed/
      );

      assert.equal(fs.readFileSync(target, 'utf-8'), 'stable-v1');
      assert.equal(fs.existsSync(`${target}.bak`), false);
      assert.deepEqual(fs.readdirSync(tmpDir), ['deck.mpres']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('ATOMIC-05', 'Transient EPERM/EBUSY rename locks retry and stale tmp cleanup preserves .mpres/.bak', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-atomic-05-'));
    try {
      const target = path.join(tmpDir, 'deck.mpres');
      await writeBufferAtomic(target, Buffer.from('v1', 'utf-8'));

      let renameAttempts = 0;
      await writeAtomic(
        target,
        async (tmpPath) => {
          await fs.promises.writeFile(tmpPath, 'v2-after-eperm');
        },
        {
          keepBackup: true,
          baseDelayMs: 5,
          maxAttempts: 6,
          renameFn: async (from, to) => {
            renameAttempts++;
            if (renameAttempts <= 2) {
              const err = new Error('Simulated Windows AV lock') as Error & { code?: string };
              err.code = renameAttempts === 1 ? 'EPERM' : 'EBUSY';
              throw err;
            }
            await fs.promises.rename(from, to);
          },
        }
      );

      assert.ok(renameAttempts >= 3);
      assert.equal(fs.readFileSync(target, 'utf-8'), 'v2-after-eperm');
      assert.equal(fs.readFileSync(`${target}.bak`, 'utf-8'), 'v1');

      const staleTmp = `${target}.tmp-99999-stale`;
      fs.writeFileSync(staleTmp, 'orphan');
      await cleanupStaleTmpFiles(target);
      assert.equal(fs.existsSync(staleTmp), false);
      assert.equal(fs.existsSync(target), true);
      assert.equal(fs.existsSync(`${target}.bak`), true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  console.log(`\nAtomic Write Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
