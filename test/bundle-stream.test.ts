import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, strToU8, zipSync } from 'fflate';
import {
  createDefaultTransition,
  createEmptyProject,
  createSlideNode,
} from '../src/core/domain/defaults';
import { MediaAsset } from '../src/core/domain/types';
import {
  buildStreamingSavePayload,
  rebindSavedAssetSources,
} from '../src/core/services/ProjectFileService';
import { ProjectSerializer } from '../src/core/services/ProjectSerializer';

const require = createRequire(import.meta.url);
const { indexBundle, extractEntryToFile } = require('../electron/lib/bundleIndex.cjs') as {
  indexBundle: (filePath: string) => Promise<{
    format: 'mpres-bundle' | 'manifest-json';
    filePath: string;
    manifestJson: string;
    entries: Map<
      string,
      {
        archivePath: string;
        size: number;
        compressedSize: number;
        compressionMethod: number;
        dataOffset: number;
        mimeType: string;
      }
    >;
    fileSize: number;
    mtimeMs: number;
  }>;
  extractEntryToFile: (
    bundlePath: string,
    archiveEntry: string,
    destPath: string
  ) => Promise<void>;
};

const { writeBundleToFile } = require('../electron/lib/bundleWriter.cjs') as {
  writeBundleToFile: (
    outFilePath: string,
    bundleSpec: {
      manifestJson: string;
      assets: Array<Record<string, unknown>>;
    },
    onProgress?: (progress: {
      bytesWritten: number;
      totalBytes: number;
      currentFile: string;
    }) => void
  ) => Promise<void>;
};

const {
  setCacheBaseDir,
  registerArchiveToken,
  closeArchiveToken,
  registerMediaFile,
  handleMpresRequest,
  resetMediaProtocolState,
} = require('../electron/lib/mediaProtocol.cjs') as {
  setCacheBaseDir: (dirPath: string) => void;
  registerArchiveToken: (
    filePath: string,
    indexResult: unknown
  ) => {
    projectToken: string;
    assets: Array<{ archivePath: string; url: string; size: number; mimeType: string }>;
  };
  closeArchiveToken: (token: string) => Promise<void>;
  registerMediaFile: (filePath: string) => Promise<{
    token: string;
    path: string;
    url: string;
    fileName: string;
    mimeType: string;
    size: number;
  }>;
  handleMpresRequest: (request: {
    url: string;
    method?: string;
    headers?: Headers | Record<string, string>;
  }) => Promise<Response>;
  resetMediaProtocolState: () => void;
};

function findAppDir(): string {
  if (fs.existsSync(path.resolve('src/main.ts'))) return path.resolve('.');
  if (fs.existsSync(path.resolve('app/src/main.ts'))) return path.resolve('app');
  return path.resolve('.');
}

function makeTestAsset(
  id: string,
  kind: 'image' | 'video',
  name: string,
  size: number,
  options?: { source?: MediaAsset['source']; rawFile?: Blob }
): MediaAsset {
  return {
    id,
    name,
    kind,
    mimeType: kind === 'image' ? 'image/png' : 'video/mp4',
    extension: kind === 'image' ? 'png' : 'mp4',
    objectUrl: options?.rawFile ? 'data:image/png;base64,AA==' : `mpres://file/tok/${name}`,
    fileSize: size,
    width: 1920,
    height: 1080,
    durationSec: kind === 'video' ? 2.5 : 0,
    thumbnailUrl: 'data:image/png;base64,AA==',
    rawFile: options?.rawFile,
    source: options?.source,
  };
}

export async function runBundleStreamTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING PHASE 1: STREAMING ZIP & PROTOCOL SUITE ---');
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

  await test('STREAM-01', 'writeBundleToFile + indexBundle roundtrip streams file/bytes assets and parses via ProjectSerializer', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-stream-01-'));
    try {
      const imgFile = path.join(tmpDir, 'slide_01.png');
      const vidFile = path.join(tmpDir, 'trans_01.mp4');
      const imgPayload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);
      const vidPayload = Buffer.alloc(128 * 1024, 0xab);
      Buffer.from('0123456789ABCDEF').copy(vidPayload, 0);
      Buffer.from('TAIL-END-MARKER!').copy(vidPayload, vidPayload.length - 16);

      fs.writeFileSync(imgFile, imgPayload);
      fs.writeFileSync(vidFile, vidPayload);

      const extraMemBytes = new Uint8Array([9, 8, 7, 6, 5, 4]);
      const slideImg = makeTestAsset('s1_img', 'image', 'slide_01.png', imgPayload.length, {
        source: { kind: 'file', path: imgFile },
      });
      const memImg = makeTestAsset('s2_img', 'image', 'extracted.png', extraMemBytes.byteLength, {
        source: { kind: 'memory' },
        rawFile: new Blob([extraMemBytes], { type: 'image/png' }),
      });
      const vidAsset = makeTestAsset('v1', 'video', 'trans_01.mp4', vidPayload.length, {
        source: { kind: 'file', path: vidFile },
      });

      const s1 = createSlideNode(slideImg, 0);
      s1.title = 'الشريحة الأولى';
      s1.transitionToNext = createDefaultTransition('video', vidAsset, 0);
      const s2 = createSlideNode(memImg, 1);

      const project = createEmptyProject('عرض البث السريع');
      project.slides = [s1, s2];

      const built = await buildStreamingSavePayload(project);
      assert.equal(built.assets.length, 3);
      assert.equal(built.assets[0].source, 'file');
      assert.equal(built.assets[1].source, 'file');
      assert.equal(built.assets[2].source, 'bytes');

      const outBundle = path.join(tmpDir, 'streamed.mpres');
      const progressEvents: Array<{ bytesWritten: number; totalBytes: number }> = [];
      await writeBundleToFile(
        outBundle,
        {
          manifestJson: built.manifestJson,
          assets: built.assets,
        },
        (p) => progressEvents.push({ bytesWritten: p.bytesWritten, totalBytes: p.totalBytes })
      );

      assert.ok(progressEvents.length >= 2);
      for (let i = 1; i < progressEvents.length; i++) {
        assert.ok(progressEvents[i].bytesWritten >= progressEvents[i - 1].bytesWritten);
      }
      const lastP = progressEvents[progressEvents.length - 1];
      assert.equal(lastP.bytesWritten, lastP.totalBytes);

      const indexed = await indexBundle(outBundle);
      assert.equal(indexed.format, 'mpres-bundle');
      assert.equal(indexed.entries.size, 3);
      const vidEntry = indexed.entries.get('assets/videos/video_001.mp4');
      assert.ok(vidEntry);
      assert.equal(vidEntry.compressionMethod, 0);
      assert.equal(vidEntry.size, vidPayload.length);

      // Compatibility with browser fflate parser
      const parsedBySerializer = ProjectSerializer.parseProjectBytes(
        new Uint8Array(fs.readFileSync(outBundle))
      );
      assert.equal(parsedBySerializer.projectData.title, 'عرض البث السريع');
      assert.equal(parsedBySerializer.imageAssets.size, 2);
      assert.equal(parsedBySerializer.videoAssets.size, 1);
      assert.deepEqual(
        Buffer.from(parsedBySerializer.videoAssets.get('assets/videos/video_001.mp4')!.bytes),
        vidPayload
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('STREAM-02', 'Saving archive-sourced assets from bundle A into bundle B preserves exact bytes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-stream-02-'));
    try {
      const bundleA = path.join(tmpDir, 'bundleA.mpres');
      const bundleB = path.join(tmpDir, 'bundleB.mpres');
      const videoBuf = Buffer.alloc(64 * 1024, 0x3c);
      Buffer.from('ARCHIVE-COPY-CHECK').copy(videoBuf, 1024);

      const manifestA = JSON.stringify({
        version: '1.1.0',
        title: 'Bundle A',
        slides: [
          {
            index: 0,
            title: 'Slide 1',
            imageFileName: 's1.png',
            imageArchivePath: 'assets/images/slide_001.png',
          },
        ],
      });

      await writeBundleToFile(bundleA, {
        manifestJson: manifestA,
        assets: [{ archivePath: 'assets/images/slide_001.png', source: 'bytes', bytes: videoBuf }],
      });

      const idxA = await indexBundle(bundleA);
      const entryRef = idxA.entries.get('assets/images/slide_001.png')!;
      const manifestB = manifestA.replace('Bundle A', 'Bundle B');

      await writeBundleToFile(bundleB, {
        manifestJson: manifestB,
        assets: [
          {
            archivePath: 'assets/images/slide_001.png',
            source: 'archive',
            bundlePath: bundleA,
            archiveEntry: 'assets/images/slide_001.png',
            dataOffset: entryRef.dataOffset,
            size: entryRef.size,
            compressionMethod: entryRef.compressionMethod,
          },
        ],
      });

      const idxB = await indexBundle(bundleB);
      assert.equal(JSON.parse(idxB.manifestJson).title, 'Bundle B');
      const extracted = path.join(tmpDir, 'out.bin');
      await extractEntryToFile(bundleB, 'assets/images/slide_001.png', extracted);
      assert.deepEqual(fs.readFileSync(extracted), videoBuf);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('STREAM-03', 'indexBundle reads Phase 0 legacy fixture (.mpres & .mpres.json) without RAM media load', async () => {
    const fixturesDir = path.join(findAppDir(), 'test', 'fixtures');
    const legacyBundle = path.join(fixturesDir, 'legacy-v1.1.1.mpres');
    const legacyJson = path.join(fixturesDir, 'legacy-manifest.mpres.json');

    const bundleIdx = await indexBundle(legacyBundle);
    assert.equal(bundleIdx.format, 'mpres-bundle');
    assert.equal(JSON.parse(bundleIdx.manifestJson).title, 'عرض تقديمي تجريبي');
    assert.ok(bundleIdx.entries.has('assets/images/slide_001.png'));
    assert.ok(bundleIdx.entries.has('assets/videos/video_001.mp4'));

    const jsonIdx = await indexBundle(legacyJson);
    assert.equal(jsonIdx.format, 'manifest-json');
    assert.equal(jsonIdx.entries.size, 0);
    assert.equal(JSON.parse(jsonIdx.manifestJson).title, 'عرض تقديمي تجريبي');

    // Optional real project smoke check if sample file exists next to app/
    const workspaceSample = path.resolve(findAppDir(), '..', 'عرض Motion Graphics التفاعلي.mpres');
    if (fs.existsSync(workspaceSample)) {
      const sampleIdx = await indexBundle(workspaceSample);
      assert.equal(sampleIdx.format, 'mpres-bundle');
      assert.ok(sampleIdx.entries.size > 0);
    }
  });

  await test('STREAM-04', 'mediaProtocol serves 200, 206 byte-ranges, HEAD, CORS, 404/416, disk files, and deflated fallback', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-stream-04-'));
    try {
      resetMediaProtocolState();
      setCacheBaseDir(path.join(tmpDir, 'cache'));

      const storeBundle = path.join(tmpDir, 'proto-store.mpres');
      const vidPayload = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      await writeBundleToFile(storeBundle, {
        manifestJson: JSON.stringify({ version: '1.1.0', title: 'Proto Test', slides: [] }),
        assets: [
          { archivePath: 'assets/videos/video_001.mp4', source: 'bytes', bytes: vidPayload },
        ],
      });

      const idx = await indexBundle(storeBundle);
      const { projectToken, assets } = registerArchiveToken(storeBundle, idx);
      assert.equal(assets.length, 1);
      const videoUrl = assets[0].url;

      // Full 200 response
      const resp200 = await handleMpresRequest({ url: videoUrl, method: 'GET' });
      assert.equal(resp200.status, 200);
      assert.equal(resp200.headers.get('access-control-allow-origin'), '*');
      assert.equal(resp200.headers.get('accept-ranges'), 'bytes');
      const body200 = Buffer.from(await resp200.arrayBuffer());
      assert.deepEqual(body200, vidPayload);

      // Partial 206 slice bytes=4-15
      const resp206 = await handleMpresRequest({
        url: videoUrl,
        method: 'GET',
        headers: { range: 'bytes=4-15' },
      });
      assert.equal(resp206.status, 206);
      assert.equal(resp206.headers.get('content-range'), `bytes 4-15/${vidPayload.length}`);
      assert.equal(resp206.headers.get('content-length'), '12');
      const body206 = Buffer.from(await resp206.arrayBuffer());
      assert.deepEqual(body206, vidPayload.subarray(4, 16));

      // Tail suffix range bytes=-6
      const respTail = await handleMpresRequest({
        url: videoUrl,
        method: 'GET',
        headers: { range: 'bytes=-6' },
      });
      assert.equal(respTail.status, 206);
      assert.deepEqual(Buffer.from(await respTail.arrayBuffer()), vidPayload.subarray(vidPayload.length - 6));

      // HEAD request returns headers with empty body
      const respHead = await handleMpresRequest({ url: videoUrl, method: 'HEAD' });
      assert.equal(respHead.status, 200);
      assert.equal(respHead.headers.get('content-length'), String(vidPayload.length));
      assert.equal((await respHead.arrayBuffer()).byteLength, 0);

      // Unsatisfiable range -> 416
      const resp416 = await handleMpresRequest({
        url: videoUrl,
        method: 'GET',
        headers: { range: `bytes=${vidPayload.length + 50}-` },
      });
      assert.equal(resp416.status, 416);

      // Unknown token -> 404
      const resp404 = await handleMpresRequest({
        url: 'mpres://archive/nonexistent-token/assets/videos/video_001.mp4',
        method: 'GET',
      });
      assert.equal(resp404.status, 404);

      // Disk file streaming via mpres://file/...
      const diskMp4 = path.join(tmpDir, 'external.mp4');
      fs.writeFileSync(diskMp4, vidPayload);
      const regFile = await registerMediaFile(diskMp4);
      const disk206 = await handleMpresRequest({
        url: regFile.url,
        method: 'GET',
        headers: { range: 'bytes=10-19' },
      });
      assert.equal(disk206.status, 206);
      assert.deepEqual(Buffer.from(await disk206.arrayBuffer()), vidPayload.subarray(10, 20));

      // Compressed (Deflate) legacy archive fallback
      const deflatedBundle = path.join(tmpDir, 'deflated.mpres');
      const compressibleText = Buffer.from('REPEATED-PNG-HEADER-'.repeat(64));
      const zipBytes = zipSync(
        {
          'manifest.json': strToU8(JSON.stringify({ version: '1.0.0', title: 'Deflated', slides: [] })),
          'assets/images/slide_001.png': new Uint8Array(compressibleText),
        },
        { level: 6 }
      );
      fs.writeFileSync(deflatedBundle, zipBytes);
      const defIdx = await indexBundle(deflatedBundle);
      const defEntry = defIdx.entries.get('assets/images/slide_001.png');
      assert.ok(defEntry && defEntry.compressionMethod === 8);
      const defReg = registerArchiveToken(deflatedBundle, defIdx);
      const defResp = await handleMpresRequest({ url: defReg.assets[0].url, method: 'GET' });
      assert.equal(defResp.status, 200);
      assert.deepEqual(Buffer.from(await defResp.arrayBuffer()), compressibleText);

      await closeArchiveToken(projectToken);
      await closeArchiveToken(defReg.projectToken);
    } finally {
      resetMediaProtocolState();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('STREAM-05', 'rebindSavedAssetSources converts packed file/memory assets into archive sources', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-stream-05-'));
    try {
      const diskImg = path.join(tmpDir, 's1.png');
      fs.writeFileSync(diskImg, Buffer.from([1, 2, 3, 4]));
      const img = makeTestAsset('s1', 'image', 's1.png', 4, {
        source: { kind: 'file', path: diskImg },
      });
      const vid = makeTestAsset('v1', 'video', 'v1.mp4', 8, {
        source: { kind: 'memory' },
        rawFile: new Blob([new Uint8Array([5, 6, 7, 8])], { type: 'video/mp4' }),
      });
      const slide = createSlideNode(img, 0);
      slide.transitionToNext = createDefaultTransition('video', vid, 0);
      const project = createEmptyProject('Rebind Check');
      project.slides = [slide];

      const built = await buildStreamingSavePayload(project);
      rebindSavedAssetSources(project, 'new_tok_99', built.layout);

      assert.deepEqual(project.slides[0].imageAsset.source, {
        kind: 'archive',
        projectToken: 'new_tok_99',
        archiveEntry: 'assets/images/slide_001.png',
      });
      assert.deepEqual(project.slides[0].transitionToNext.videoAsset?.source, {
        kind: 'archive',
        projectToken: 'new_tok_99',
        archiveEntry: 'assets/videos/video_001.mp4',
      });
      assert.equal(strFromU8(strToU8(built.manifestJson)).includes('Rebind Check'), true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  console.log(`\nStreaming Bundle Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
