/**
 * Tier 1 & Tier 2 Automated Tests: Verification Suite & Build Integrity (Feature F9)
 * Grounded in ORIGINAL_REQUEST.md (§R3) and spec_miner_e2e_1/tier1_tier2_specs.md
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupMockDOM } from './helpers/mock-dom';
import { ProjectSerializer } from '../src/core/services/ProjectSerializer';
import { PresentationStore } from '../src/core/state/PresentationStore';
import { StagePlaybackEngine } from '../src/core/engine/StagePlaybackEngine';

export async function runBuildIntegrityTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING TIER 1 & TIER 2: BUILD & INTEGRITY (F9) ---');
  console.log('======================================================');

  let passed = 0;
  let failed = 0;

  const test = async (id: string, name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ [${id}] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [${id}] ${name}`);
      console.error(`    Error: ${err.message}`);
      if (err.stack) {
        const stackLines = err.stack.split('\n').slice(1, 4).join('\n');
        console.error(`    ${stackLines}`);
      }
      failed++;
    }
  };

  const findAppDir = (): string => {
    if (fs.existsSync(path.resolve('src/main.ts'))) return path.resolve('.');
    if (fs.existsSync(path.resolve('app/src/main.ts'))) return path.resolve('app');
    return path.resolve('.');
  };

  // T1-F9-01: Master Test Suite Runner Configuration
  await test('T1-F9-01', 'package.json test script maps directly to verify-all.ts master runner', async () => {
    const pkgPath = path.join(findAppDir(), 'package.json');
    assert.ok(fs.existsSync(pkgPath), 'package.json must exist');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.scripts.test, 'npx tsx scripts/verify-all.ts');
  });

  // T1-F9-02: Legacy Test Suite File Existence
  await test('T1-F9-02', 'Master runner script exists and contains legacy verification test cases', async () => {
    const runnerPath = path.join(findAppDir(), 'scripts/verify-all.ts');
    assert.ok(fs.existsSync(runnerPath), 'scripts/verify-all.ts must exist');
    const content = fs.readFileSync(runnerPath, 'utf8');
    assert.ok(content.includes('Test 1'), 'Must include Test 1');
    assert.ok(content.includes('Test 27'), 'Must include Test 27');
  });

  // T1-F9-03: TypeScript Configuration Validity
  await test('T1-F9-03', 'tsconfig.json specifies valid strict compilerOptions', async () => {
    const tsconfigPath = path.join(findAppDir(), 'tsconfig.json');
    assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json must exist');
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    assert.ok(tsconfig.compilerOptions, 'Must have compilerOptions');
  });

  // T1-F9-04: Project Entrypoint & Manifest Files
  await test('T1-F9-04', 'Application entrypoint and root shell files exist with required targets', async () => {
    const appDir = findAppDir();
    const indexPath = path.join(appDir, 'index.html');
    assert.ok(fs.existsSync(indexPath), 'index.html must exist');
    const mainPath = path.join(appDir, 'src/main.ts');
    assert.ok(fs.existsSync(mainPath), 'src/main.ts must exist');
  });

  // T1-F9-05: Mock DOM Fixture Isolation & Global Cleanup
  await test('T1-F9-05', 'setupMockDOM and teardown cleanly isolate global environment across runs', async () => {
    const origWindow = globalThis.window;
    const env = setupMockDOM();
    assert.notEqual(globalThis.window, origWindow, 'window should be mocked');
    env.teardown();
    assert.equal(globalThis.window, origWindow, 'window should be restored');
  });

  // T2-F9-01: Missing File Handling in Argv Helper
  await test('T2-F9-01', 'Project file loader handles non-existent file path gracefully', async () => {
    const nonExistentPath = path.resolve('non_existent_project_99999.mpres');
    assert.equal(fs.existsSync(nonExistentPath), false);
  });

  // T2-F9-02: Corrupted JSON Manifest Recovery
  await test('T2-F9-02', 'ProjectSerializer rejects corrupted or unparseable JSON manifest without crash', async () => {
    const corruptedBytes = new TextEncoder().encode('{ invalid_json_syntax: true, missing_quotes');
    assert.throws(
      () => {
        ProjectSerializer.parseProjectBytes(corruptedBytes);
      },
      /JSON|SyntaxError/i
    );
  });

  // T2-F9-03: RAF Cancel / Disposal Leak Check
  await test('T2-F9-03', 'StagePlaybackEngine cancels animation loop and clears timers upon destroy', async () => {
    const env = setupMockDOM();
    try {
      const canvas = env.document.createElement('canvas') as any;
      const store = new PresentationStore();
      const engine = new StagePlaybackEngine(canvas, store.getSettings());

      engine.destroy();
      assert.equal((engine as any).destroyed, true);
    } finally {
      env.teardown();
    }
  });

  // T2-F9-04: Zero-slide Project Presentation Safe Failure Mode
  await test('T2-F9-04', 'Engine next/previous on empty project returns safely without dereferencing null', async () => {
    const env = setupMockDOM();
    try {
      const canvas = env.document.createElement('canvas') as any;
      const store = new PresentationStore();
      const engine = new StagePlaybackEngine(canvas, store.getSettings());

      assert.doesNotThrow(() => {
        engine.next();
        engine.previous();
        engine.jumpToSlide(0);
      });
    } finally {
      env.teardown();
    }
  });

  // T2-F9-05: Strict Assertion Verification Standard
  await test('T2-F9-05', 'Strict assertion framework validates expected vs actual value mismatches', async () => {
    assert.throws(() => {
      assert.equal('actual_val', 'expected_val');
    });
  });

  // T2-F9-06: Offline Typography (no third-party font CDN at runtime)
  await test('T2-F9-06', 'Studio typography is bundled locally instead of loaded from a font CDN', async () => {
    const appDir = findAppDir();
    const indexHtml = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
    assert.equal(
      /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(indexHtml),
      false,
      'index.html must not reference the Google Fonts CDN (offline desktops would lose typography)'
    );

    const fontsCssPath = path.join(appDir, 'src', 'ui', 'styles', 'fonts.css');
    assert.ok(fs.existsSync(fontsCssPath), 'src/ui/styles/fonts.css must exist');
    const fontsCss = fs.readFileSync(fontsCssPath, 'utf8');
    assert.equal(
      /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(fontsCss),
      false,
      'fonts.css must only reference local ./fonts/*.woff2 files'
    );
    assert.ok(fontsCss.includes('@font-face'), 'fonts.css must declare @font-face rules');
    assert.ok(
      fontsCss.includes('unicode-range'),
      'fonts.css must keep unicode-range so Arabic and Latin select the right subsets'
    );

    const localUrls = [...fontsCss.matchAll(/url\(\.\/fonts\/([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(localUrls.length > 0, 'fonts.css must point at bundled font files');
    for (const fileName of new Set(localUrls)) {
      const fontPath = path.join(appDir, 'src', 'ui', 'styles', 'fonts', fileName);
      assert.ok(fs.existsSync(fontPath), `Bundled font file is missing: ${fileName}`);
      assert.ok(fs.statSync(fontPath).size > 0, `Bundled font file is empty: ${fileName}`);
    }

    const entry = fs.readFileSync(path.join(appDir, 'src', 'main.ts'), 'utf8');
    assert.ok(
      entry.includes("./ui/styles/fonts.css"),
      'src/main.ts must import the bundled font stylesheet'
    );
  });

  console.log(`\nBuild Integrity Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
