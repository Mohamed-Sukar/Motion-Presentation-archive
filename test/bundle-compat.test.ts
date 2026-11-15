import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import {
  createDefaultTransition,
  createEmptyProject,
  createSlideNode,
} from '../src/core/domain/defaults';
import { MediaAsset } from '../src/core/domain/types';
import { ProjectSerializer } from '../src/core/services/ProjectSerializer';
import { PresentationStore } from '../src/core/state/PresentationStore';

function findAppDir(): string {
  if (fs.existsSync(path.resolve('src/main.ts'))) return path.resolve('.');
  if (fs.existsSync(path.resolve('app/src/main.ts'))) return path.resolve('app');
  return path.resolve('.');
}

function makeBytesAsset(
  id: string,
  kind: 'image' | 'video',
  name: string,
  bytes: Uint8Array,
  durationSec = 0
): MediaAsset {
  const mimeType = kind === 'image' ? 'image/png' : 'video/mp4';
  return {
    id,
    name,
    kind,
    mimeType,
    extension: kind === 'image' ? 'png' : 'mp4',
    objectUrl: kind === 'image' ? 'data:image/png;base64,AA==' : `blob:compat/${id}`,
    fileSize: bytes.byteLength,
    width: 1920,
    height: 1080,
    durationSec,
    thumbnailUrl: 'data:image/png;base64,AA==',
    hasAudio: false,
    rawFile: new Blob([bytes], { type: mimeType }),
  };
}

/**
 * Verifies every local file header in a ZIP buffer uses compression method 0 (STORE).
 */
function assertAllZipEntriesStoredUncompressed(zipBytes: Uint8Array): void {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let offset = 0;
  let localHeaderCount = 0;
  while (offset + 30 <= zipBytes.byteLength) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break; // Stop at central directory (0x02014b50)
    localHeaderCount++;
    const flags = view.getUint16(offset + 6, true);
    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    assert.equal(compressionMethod, 0, `ZIP entry at ${offset} must use STORE (method 0), got ${compressionMethod}`);
    // Handle data descriptor (bit 3) if set
    offset += 30 + fileNameLen + extraLen + compressedSize;
    if ((flags & 0x08) !== 0 && offset + 12 <= zipBytes.byteLength) {
      const ddSig = view.getUint32(offset, true);
      offset += ddSig === 0x08074b50 ? 16 : 12;
    }
  }
  assert.ok(localHeaderCount > 0, 'ZIP archive must contain at least one local file header');
}

export async function runBundleCompatTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING PHASE 0: BUNDLE COMPATIBILITY SUITE ---');
  console.log('======================================================');

  let passed = 0;
  let failed = 0;

  const test = async (id: string, name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ [${id}] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [${id}] ${name}`);
      console.error(`    Error: ${err?.message || String(err)}`);
      if (err?.stack) {
        const stackLines = err.stack.split('\n').slice(1, 4).join('\n');
        console.error(`    ${stackLines}`);
      }
      failed++;
    }
  };

  await test('COMPAT-01', 'buildBundleBytes -> parseProjectBytes round-trip preserves Arabic metadata, trims, easing, idle loop, and AI meta', async () => {
    const img1Bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const img2Bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6, 7, 8]);
    const trBytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 11, 22, 33]);
    const loopBytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 44, 55, 66]);

    const trVid = makeBytesAsset('c_tr1', 'video', '01-02_transition.mp4', trBytes, 3.2);
    const loopVid = makeBytesAsset('c_loop1', 'video', '01_loop.mp4', loopBytes, 4.5);

    const s1 = createSlideNode(makeBytesAsset('c_img1', 'image', 'slide_a.png', img1Bytes), 0, 'zoom-morph', 450);
    s1.title = 'شريحة العرض الأولى';
    s1.notes = 'تفاصيل الشرح بالعربية';
    s1.holdDurationSec = 6.5;
    s1.idleLoopAsset = loopVid;
    s1.sourceMeta = {
      slideCodeFile: 'src/s1.js',
      idleLoopCodeFile: 'src/l1.js',
      exitPointsSec: [0, 1.5, 3.0],
    };
    s1.transitionToNext = {
      ...createDefaultTransition('zoom-morph', trVid, 450, 'ease-in-out'),
      startTimeSec: 0.25,
      endTimeSec: 2.75,
      playbackSpeed: 1.5,
      muted: true,
    };

    const s2 = createSlideNode(makeBytesAsset('c_img2', 'image', 'slide_b.png', img2Bytes), 1, 'slide-push', 600);
    s2.title = 'الشريحة الثانية';
    s2.notes = 'Second slide note';
    s2.holdDurationSec = null;

    const project = createEmptyProject('عرض اختبار التوافق الكامل');
    project.id = 'compat_roundtrip_1';
    project.aiSourceMeta = {
      skillName: 'new-motion-presentation',
      projectRootPath: 'E:\\Mock\\Proj',
      creativeDirection: 'Minimal Kinetic',
    };
    project.slides = [s1, s2];

    const bytes = await ProjectSerializer.buildBundleBytes(project);
    assert.equal(ProjectSerializer.isZipBundleBytes(bytes), true);

    const parsed = ProjectSerializer.parseProjectBytes(bytes);
    assert.equal(parsed.format, 'mpres-bundle');
    assert.equal(parsed.projectData.projectId, 'compat_roundtrip_1');
    assert.equal(parsed.projectData.title, 'عرض اختبار التوافق الكامل');
    assert.deepEqual(parsed.projectData.aiSourceMeta, project.aiSourceMeta);
    assert.equal(parsed.projectData.slidesData.length, 2);

    const pd1 = parsed.projectData.slidesData[0];
    assert.equal(pd1.title, 'شريحة العرض الأولى');
    assert.equal(pd1.notes, 'تفاصيل الشرح بالعربية');
    assert.equal(pd1.holdDurationSec, 6.5);
    assert.equal(pd1.idleLoopFileName, '01_loop.mp4');
    assert.equal(pd1.idleLoopDurationSec, 4.5);
    assert.deepEqual(pd1.sourceMeta, s1.sourceMeta);
    assert.equal(pd1.transitionToNext?.hasCustomVideo, true);
    assert.equal(pd1.transitionToNext?.videoFileName, '01-02_transition.mp4');
    assert.equal(pd1.transitionToNext?.startTimeSec, 0.25);
    assert.equal(pd1.transitionToNext?.endTimeSec, 2.75);
    assert.equal(pd1.transitionToNext?.playbackSpeed, 1.5);
    assert.equal(pd1.transitionToNext?.muted, true);
    assert.equal(pd1.transitionToNext?.easing, 'ease-in-out');

    assert.equal(parsed.imageAssets.size, 2);
    assert.equal(parsed.videoAssets.size, 2);
    const extractedTr = Array.from(parsed.videoAssets.values()).find((v) => v.fileName === '01-02_transition.mp4');
    assert.ok(extractedTr);
    assert.deepEqual(Array.from(extractedTr.bytes), Array.from(trBytes));
  });

  await test('COMPAT-02', 'ZIP layout uses manifest.json, assets/images/slide_NNN.*, assets/videos/video_NNN.*, and STORE level 0', async () => {
    const imgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]);
    const vidBytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 9, 9]);
    const s1 = createSlideNode(makeBytesAsset('layout_img', 'image', 'hero.png', imgBytes), 0);
    s1.transitionToNext = createDefaultTransition('cut', makeBytesAsset('layout_vid', 'video', 'clip.mp4', vidBytes, 2), 0);

    const project = createEmptyProject('Layout Spec');
    project.slides = [s1];

    const bytes = await ProjectSerializer.buildBundleBytes(project);
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
    assert.equal(bytes[2], 0x03);
    assert.equal(bytes[3], 0x04);
    assertAllZipEntriesStoredUncompressed(bytes);

    const entries = unzipSync(bytes);
    const keys = Object.keys(entries).sort();
    assert.deepEqual(keys, [
      'assets/images/slide_001.png',
      'assets/videos/video_001.mp4',
      'manifest.json',
    ]);
    const manifestObj = JSON.parse(strFromU8(entries['manifest.json']));
    assert.equal(manifestObj.slides[0].imageArchivePath, 'assets/images/slide_001.png');
    assert.equal(manifestObj.slides[0].transitionToNext.videoArchivePath, 'assets/videos/video_001.mp4');
  });

  await test('COMPAT-03', 'Asset deduplication stores a shared video across 2 slides only once', async () => {
    const img1 = makeBytesAsset('d_i1', 'image', 'a.png', new Uint8Array([1, 2, 3]));
    const img2 = makeBytesAsset('d_i2', 'image', 'b.png', new Uint8Array([4, 5, 6]));
    const sharedVid = makeBytesAsset('d_shared_vid', 'video', 'shared.mp4', new Uint8Array([9, 8, 7, 6]), 8.0);

    const s1 = createSlideNode(img1, 0);
    s1.transitionToNext = { ...createDefaultTransition('cut', sharedVid, 0), startTimeSec: 0, endTimeSec: 4 };
    const s2 = createSlideNode(img2, 1);
    s2.transitionToNext = { ...createDefaultTransition('cut', sharedVid, 0), startTimeSec: 4, endTimeSec: 8 };

    const project = createEmptyProject('Dedup Test');
    project.slides = [s1, s2];

    const bytes = await ProjectSerializer.buildBundleBytes(project);
    const entries = unzipSync(bytes);
    const videoKeys = Object.keys(entries).filter((k) => k.startsWith('assets/videos/'));
    assert.equal(videoKeys.length, 1, 'Shared video should produce exactly 1 archive entry');

    const parsed = ProjectSerializer.parseProjectBytes(bytes);
    assert.equal(parsed.videoAssets.size, 1);
    assert.equal(
      parsed.projectData.slidesData[0].transitionToNext?.videoArchivePath,
      parsed.projectData.slidesData[1].transitionToNext?.videoArchivePath
    );
  });

  await test('COMPAT-04', 'Legacy fixture files (.mpres bundle and .mpres.json manifest) load cleanly through Serializer and Store', async () => {
    const fixturesDir = path.join(findAppDir(), 'test', 'fixtures');
    const bundlePath = path.join(fixturesDir, 'legacy-v1.1.1.mpres');
    const manifestPath = path.join(fixturesDir, 'legacy-manifest.mpres.json');

    assert.ok(fs.existsSync(bundlePath), `Missing fixture: ${bundlePath}`);
    assert.ok(fs.existsSync(manifestPath), `Missing fixture: ${manifestPath}`);

    const bundleBytes = new Uint8Array(fs.readFileSync(bundlePath));
    const parsedBundle = ProjectSerializer.parseProjectBytes(bundleBytes);
    assert.equal(parsedBundle.format, 'mpres-bundle');
    assert.equal(parsedBundle.projectData.title, 'عرض تقديمي تجريبي');
    assert.equal(parsedBundle.projectData.slidesData.length, 3);
    assert.equal(parsedBundle.imageAssets.size, 3);
    assert.equal(parsedBundle.videoAssets.size, 2);

    const storeFromBundle = new PresentationStore();
    storeFromBundle.loadProjectFromManifest(parsedBundle.projectData, { skipCacheHydration: true });
    assert.equal(storeFromBundle.getProject().title, 'عرض تقديمي تجريبي');
    assert.equal(storeFromBundle.getSlides().length, 3);
    assert.equal(storeFromBundle.getSlides()[0].title, 'المقدمة الرئيسية');
    assert.equal(storeFromBundle.getSlides()[1].title, 'تدفق النظام');
    assert.equal(storeFromBundle.getSlides()[2].title, 'الخاتمة');

    const jsonBytes = new Uint8Array(fs.readFileSync(manifestPath));
    const parsedManifest = ProjectSerializer.parseProjectBytes(jsonBytes);
    assert.equal(parsedManifest.format, 'manifest-json');
    assert.equal(parsedManifest.projectData.title, 'عرض تقديمي تجريبي');
    assert.equal(parsedManifest.projectData.slidesData.length, 3);

    const storeFromJson = new PresentationStore();
    storeFromJson.loadProjectFromManifest(parsedManifest.projectData, { skipCacheHydration: true });
    assert.equal(storeFromJson.getSlides().length, 3);
    assert.equal(storeFromJson.getSlides()[0].expectedIdleLoopFileName, '01_loop.mp4');
    assert.equal(storeFromJson.getSlides()[0].transitionToNext.expectedVideoFileName, '01_to_02.mp4');
  });

  await test('COMPAT-05', 'Manifest version selection writes 1.1.0 for basic decks and 1.2.0 when v1.2 features are present', async () => {
    const basicProject = createEmptyProject('Basic v1.1 Deck');
    basicProject.slides = [
      createSlideNode(makeBytesAsset('v11_img', 'image', 's1.png', new Uint8Array([1, 2])), 0),
    ];
    const m11 = ProjectSerializer.buildManifestObject(basicProject);
    assert.equal(m11.version, '1.1.0');

    const v12WithAi = createEmptyProject('v1.2 AI Deck');
    v12WithAi.slides = [
      createSlideNode(makeBytesAsset('v12_img', 'image', 's1.png', new Uint8Array([1, 2])), 0),
    ];
    v12WithAi.aiSourceMeta = { skillName: 'create-new' };
    assert.equal(ProjectSerializer.buildManifestObject(v12WithAi).version, '1.2.0');

    const v12WithIdle = createEmptyProject('v1.2 Idle Deck');
    const idleSlide = createSlideNode(makeBytesAsset('v12_img2', 'image', 's1.png', new Uint8Array([1, 2])), 0);
    idleSlide.expectedIdleLoopFileName = '01_loop.mp4';
    v12WithIdle.slides = [idleSlide];
    assert.equal(ProjectSerializer.buildManifestObject(v12WithIdle).version, '1.2.0');
  });

  console.log(`\nBundle Compatibility Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
