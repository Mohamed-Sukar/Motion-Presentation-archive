import assert from 'node:assert/strict';
import { createDefaultSettings, createDefaultTransition, createSlideNode } from '../src/core/domain/defaults';
import { MediaAsset, SlideNode } from '../src/core/domain/types';
import {
  DEFAULT_REVERSE_CACHE_MAX_BYTES,
  MAX_CACHED_IMAGES,
  MAX_WARMED_VIDEOS,
  StagePlaybackEngine,
} from '../src/core/engine/StagePlaybackEngine';
import { PresentationStore } from '../src/core/state/PresentationStore';

function makeMockCanvasFrames(count: number, width: number, height: number) {
  return Array.from({ length: count }, () => ({
    width,
    height,
    getContext: () => null,
  })) as unknown as HTMLCanvasElement[];
}

function makeMockBitmapFrames(count: number, width: number, height: number) {
  const closedFlags: boolean[] = Array.from({ length: count }, () => false);
  const frames = closedFlags.map((_, idx) => ({
    width,
    height,
    close: () => {
      closedFlags[idx] = true;
    },
  })) as unknown as ImageBitmap[];
  return { frames, closedFlags };
}

function makeTestAsset(
  id: string,
  kind: 'image' | 'video',
  name: string,
  overrides: Partial<MediaAsset> = {}
): MediaAsset {
  return {
    id,
    name,
    kind,
    mimeType: kind === 'video' ? 'video/mp4' : 'image/png',
    extension: kind === 'video' ? 'mp4' : 'png',
    objectUrl: `blob:memtest/${id}`,
    fileSize: 2048,
    width: 1920,
    height: 1080,
    durationSec: kind === 'video' ? 4.0 : 0,
    thumbnailUrl: `blob:memtest/${id}`,
    ...overrides,
  };
}

export async function runMemoryBudgetTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING PHASE 2: MEMORY & RESOURCE BUDGET SUITE ---');
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

  await test('MEM-01', 'Byte-budgeted LRU reverse cache evicts oldest canvases and zeroes backing memory', () => {
    StagePlaybackEngine.clearGlobalReverseFrameCache();
    StagePlaybackEngine.resetCacheLimits();
    try {
      assert.equal(DEFAULT_REVERSE_CACHE_MAX_BYTES, 256 * 1024 * 1024);
      // 10 MB cap; each entry = 4 frames * 1024 * 256 * 4 bytes = 4 MB
      const MB = 1024 * 1024;
      StagePlaybackEngine.setReverseCacheMaxBytes(10 * MB);

      const framesA = makeMockCanvasFrames(4, 1024, 256);
      const framesB = makeMockCanvasFrames(4, 1024, 256);
      const framesC = makeMockCanvasFrames(4, 1024, 256);

      assert.equal(StagePlaybackEngine.computeFrameArrayBytes(framesA), 4 * MB);

      StagePlaybackEngine.cacheReverseFrames('entryA', framesA);
      StagePlaybackEngine.cacheReverseFrames('entryB', framesB);
      assert.equal(StagePlaybackEngine.getReverseCacheStats().totalBytes, 8 * MB);
      assert.equal(StagePlaybackEngine.getReverseCacheStats().entryCount, 2);

      // Access entryA so entryB becomes the least-recently-used entry
      assert.equal(StagePlaybackEngine.getReverseFrames('entryA'), framesA);

      // Caching entryC pushes total to 12 MB > 10 MB -> entryB must be evicted and zeroed
      StagePlaybackEngine.cacheReverseFrames('entryC', framesC);
      const stats = StagePlaybackEngine.getReverseCacheStats();
      assert.equal(stats.entryCount, 2);
      assert.equal(stats.totalBytes, 8 * MB);
      assert.equal(StagePlaybackEngine.getReverseFrames('entryB'), undefined);
      assert.equal(StagePlaybackEngine.getReverseFrames('entryA'), framesA);
      assert.equal(StagePlaybackEngine.getReverseFrames('entryC'), framesC);
      assert.ok(framesB.every((c) => c.width === 0 && c.height === 0));
      assert.ok(framesA.every((c) => c.width === 1024 && c.height === 256));
    } finally {
      StagePlaybackEngine.clearGlobalReverseFrameCache();
      StagePlaybackEngine.resetCacheLimits();
    }
  });

  await test('MEM-02', 'Pass-2 LRU eviction bounds active multi-slide decks strictly under byte budget', () => {
    StagePlaybackEngine.clearGlobalReverseFrameCache();
    StagePlaybackEngine.resetCacheLimits();
    try {
      const MB = 1024 * 1024;
      StagePlaybackEngine.setReverseCacheMaxBytes(8 * MB);
      const allActiveKeys = new Set<string>(['s0', 's1', 's2']);

      const s0 = makeMockBitmapFrames(4, 1024, 256); // 4 MB
      const s1 = makeMockBitmapFrames(4, 1024, 256); // 4 MB
      const s2 = makeMockBitmapFrames(4, 1024, 256); // 4 MB

      StagePlaybackEngine.cacheReverseFrames('s0', s0.frames, allActiveKeys);
      StagePlaybackEngine.cacheReverseFrames('s1', s1.frames, allActiveKeys);
      assert.equal(StagePlaybackEngine.getReverseCacheStats().totalBytes, 8 * MB);

      // Touch s0 so s1 is evicted in Pass 2 despite being in allActiveKeys
      assert.equal(StagePlaybackEngine.getReverseFrames('s0'), s0.frames);
      StagePlaybackEngine.cacheReverseFrames('s2', s2.frames, allActiveKeys);

      const stats = StagePlaybackEngine.getReverseCacheStats();
      assert.equal(stats.totalBytes, 8 * MB);
      assert.equal(StagePlaybackEngine.getReverseFrames('s1'), undefined);
      assert.ok(s1.closedFlags.every(Boolean), 'Evicted ImageBitmaps must have close() called');
      assert.ok(s0.closedFlags.every((c) => !c), 'Pinned/recently-used frames must stay open');
      assert.ok(s2.closedFlags.every((c) => !c));
    } finally {
      StagePlaybackEngine.clearGlobalReverseFrameCache();
      StagePlaybackEngine.resetCacheLimits();
    }
  });

  await test('MEM-03', 'Shared alias keys deduplicate byte accounting and defer disposal until last alias', () => {
    StagePlaybackEngine.clearGlobalReverseFrameCache();
    StagePlaybackEngine.resetCacheLimits();
    try {
      const MB = 1024 * 1024;
      const shared = makeMockBitmapFrames(4, 1024, 256); // 4 MB

      StagePlaybackEngine.cacheReverseFrames('tr_1', shared.frames);
      StagePlaybackEngine.cacheReverseFrames('vid_1', shared.frames, undefined, new Set(['tr_1', 'vid_1']));

      const stats = StagePlaybackEngine.getReverseCacheStats();
      assert.equal(stats.entryCount, 2);
      assert.equal(stats.uniqueArrayCount, 1);
      assert.equal(stats.totalBytes, 4 * MB);

      // Invalidating tr_1 leaves vid_1 intact and frames unclosed
      StagePlaybackEngine.invalidateReverseFrames(['tr_1']);
      assert.equal(StagePlaybackEngine.getReverseFrames('tr_1'), undefined);
      assert.equal(StagePlaybackEngine.getReverseFrames('vid_1'), shared.frames);
      assert.ok(shared.closedFlags.every((c) => !c));

      // Invalidating final alias disposes the frames cleanly
      StagePlaybackEngine.invalidateReverseFrames(['vid_1']);
      assert.equal(StagePlaybackEngine.getReverseFrames('vid_1'), undefined);
      assert.ok(shared.closedFlags.every(Boolean));
    } finally {
      StagePlaybackEngine.clearGlobalReverseFrameCache();
      StagePlaybackEngine.resetCacheLimits();
    }
  });

  await test('MEM-04', 'StagePlaybackEngine caps warmed <video> decoders and cached images via LRU eviction', async () => {
    StagePlaybackEngine.clearGlobalReverseFrameCache();
    StagePlaybackEngine.resetCacheLimits();

    const g = globalThis as unknown as Record<string, unknown>;
    const origWindow = g.window;
    const origDocument = g.document;
    const origImage = g.Image;
    const createdVideos: Array<{
      src: string;
      pauseCalls: number;
      removeAttrCalls: string[];
      loadCalls: number;
    }> = [];

    try {
      assert.equal(MAX_WARMED_VIDEOS, 8);
      assert.equal(MAX_CACHED_IMAGES, 48);
      StagePlaybackEngine.setMaxWarmedVideos(3);
      StagePlaybackEngine.setMaxCachedImages(4);

      g.window = {
        setTimeout: (fn: (...args: unknown[]) => void, ms?: number) => setTimeout(fn, ms),
        clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      };

      class MockImage {
        complete = false;
        naturalWidth = 0;
        naturalHeight = 0;
        crossOrigin = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private _src = '';
        get src() {
          return this._src;
        }
        set src(val: string) {
          this._src = val;
          if (val) {
            this.complete = true;
            this.naturalWidth = 1280;
            this.naturalHeight = 720;
            queueMicrotask(() => this.onload?.());
          }
        }
      }

      class MockVideoElement {
        preload = 'auto';
        playsInline = true;
        muted = true;
        volume = 1;
        playbackRate = 1;
        readyState = 4;
        currentTime = 0;
        duration = 3;
        error: unknown = null;
        crossOrigin = '';
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private listeners = new Map<string, Set<() => void>>();
        private _src = '';
        private tracker = { src: '', pauseCalls: 0, removeAttrCalls: [] as string[], loadCalls: 0 };

        constructor() {
          createdVideos.push(this.tracker);
        }
        get src() {
          return this._src;
        }
        set src(val: string) {
          this._src = val;
          this.tracker.src = val;
        }
        addEventListener(type: string, fn: () => void) {
          if (!this.listeners.has(type)) this.listeners.set(type, new Set());
          this.listeners.get(type)!.add(fn);
        }
        removeEventListener(type: string, fn: () => void) {
          this.listeners.get(type)?.delete(fn);
        }
        pause() {
          this.tracker.pauseCalls++;
        }
        removeAttribute(attr: string) {
          this.tracker.removeAttrCalls.push(attr);
          if (attr === 'src') {
            this._src = '';
            this.tracker.src = '';
          }
        }
        load() {
          this.tracker.loadCalls++;
          if (this._src) {
            queueMicrotask(() => {
              for (const fn of Array.from(this.listeners.get('loadeddata') ?? [])) {
                fn();
              }
            });
          }
        }
      }

      g.Image = MockImage;
      g.document = {
        createElement: (tag: string) => {
          if (tag === 'video') return new MockVideoElement();
          return { width: 0, height: 0, getContext: () => ({}) };
        },
      };

      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
          fillStyle: '#000',
          fillRect: () => {},
          clearRect: () => {},
          drawImage: () => {},
        }),
      } as unknown as HTMLCanvasElement;

      const engine = new StagePlaybackEngine(mockCanvas, {
        ...createDefaultSettings(),
        preloadStrategy: 'eager',
      });

      const slides: SlideNode[] = Array.from({ length: 6 }, (_, idx) => {
        const img = makeTestAsset(`img_${idx}`, 'image', `s_${idx}.png`);
        const vid = makeTestAsset(`vid_${idx}`, 'video', `v_${idx}.mp4`);
        const slide = createSlideNode(img, idx, 'crossfade', 0);
        slide.transitionToNext = createDefaultTransition('crossfade', vid, 0);
        return slide;
      });

      await engine.loadProject(slides, { ...createDefaultSettings(), preloadStrategy: 'eager' }, 0);
      await new Promise((r) => setTimeout(r, 20));

      assert.ok(
        engine.getWarmedVideoCount() <= 3,
        `loadProject eager preload must respect video cap (got ${engine.getWarmedVideoCount()})`
      );
      assert.ok(
        engine.getCachedImageCount() <= 4,
        `loadProject eager preload must respect image cap (got ${engine.getCachedImageCount()})`
      );

      // Navigating across later slides must continue evicting old video decoders and release src
      engine.jumpToSlide(4, false);
      await new Promise((r) => setTimeout(r, 25));
      engine.jumpToSlide(5, false);
      await new Promise((r) => setTimeout(r, 25));

      assert.ok(engine.getWarmedVideoCount() <= 3);
      assert.ok(engine.getCachedImageCount() <= 4);
      const releasedDecoders = createdVideos.filter(
        (v) => v.removeAttrCalls.includes('src') && v.pauseCalls > 0 && v.loadCalls >= 2
      );
      assert.ok(
        releasedDecoders.length >= 1,
        'Evicted <video> decoders must call pause(), removeAttribute("src"), and load()'
      );

      engine.destroy();
    } finally {
      if (origWindow === undefined) delete g.window;
      else g.window = origWindow;
      if (origDocument === undefined) delete g.document;
      else g.document = origDocument;
      if (origImage === undefined) delete g.Image;
      else g.Image = origImage;
      StagePlaybackEngine.clearGlobalReverseFrameCache();
      StagePlaybackEngine.resetCacheLimits();
    }
  });

  await test('MEM-05', 'PresentationStore undo revives rawFile blob URLs cleanly and prunes dropped history tracking', () => {
    const revokedUrls: string[] = [];
    let nextBlobCounter = 1;
    const origRevoke = URL.revokeObjectURL;
    const origCreate = URL.createObjectURL;

    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (url: string) => {
      revokedUrls.push(url);
    };
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => {
      return `blob:memtest/revived_${nextBlobCounter++}`;
    };

    try {
      const vidBlob = new Blob(['mock-mp4'], { type: 'video/mp4' });
      const imgBlob0 = new Blob(['mock-png-0'], { type: 'image/png' });
      const imgBlob1 = new Blob(['mock-png-1'], { type: 'image/png' });

      const sharedVideo = makeTestAsset('vid_shared', 'video', 'shared.mp4', {
        objectUrl: 'blob:memtest/vid_orig',
        thumbnailUrl: 'blob:memtest/vid_orig',
        rawFile: vidBlob,
        durationSec: 6.0,
      });

      const s0 = createSlideNode(
        makeTestAsset('img_0', 'image', 's0.png', {
          objectUrl: 'blob:memtest/img0_orig',
          thumbnailUrl: 'blob:memtest/img0_orig',
          rawFile: imgBlob0,
        }),
        0,
        'crossfade',
        0
      );
      s0.transitionToNext = {
        ...createDefaultTransition('crossfade', sharedVideo, 0),
        startTimeSec: 0,
        endTimeSec: 3,
      };

      const s1 = createSlideNode(
        makeTestAsset('img_1', 'image', 's1.png', {
          objectUrl: 'blob:memtest/img1_orig',
          thumbnailUrl: 'blob:memtest/img1_orig',
          rawFile: imgBlob1,
        }),
        1,
        'crossfade',
        0
      );
      s1.transitionToNext = {
        ...createDefaultTransition('crossfade', sharedVideo, 0),
        startTimeSec: 3,
        endTimeSec: 6,
      };

      const store = new PresentationStore();
      store.loadProjectFromManifest({ title: 'Undo Blob Test', slides: [s0, s1] });

      // Deleting all slides via deleteMultipleItems records history and revokes unreferenced blobs immediately
      store.deleteMultipleItems([s0.id, s1.id], []);
      assert.equal(store.getSlides().length, 0);
      assert.ok(revokedUrls.includes('blob:memtest/img0_orig'));
      assert.ok(revokedUrls.includes('blob:memtest/img1_orig'));
      assert.ok(revokedUrls.includes('blob:memtest/vid_orig'));

      // Undoing restores both slides and revives their blob URLs (with shared video deduplicated!)
      const didUndo = store.undo();
      assert.equal(didUndo, true);
      const restored = store.getSlides();
      assert.equal(restored.length, 2);
      assert.notEqual(restored[0].imageAsset.objectUrl, 'blob:memtest/img0_orig');
      assert.equal(restored[0].imageAsset.objectUrl, restored[0].imageAsset.thumbnailUrl);
      assert.notEqual(restored[1].imageAsset.objectUrl, 'blob:memtest/img1_orig');

      const revivedVid0 = restored[0].transitionToNext.videoAsset?.objectUrl;
      const revivedVid1 = restored[1].transitionToNext.videoAsset?.objectUrl;
      assert.ok(revivedVid0 && revivedVid0.startsWith('blob:memtest/revived_'));
      assert.equal(revivedVid0, revivedVid1, 'Shared reel video must revive to a single shared blob URL');

      // Redoing drops the revived URLs cleanly back into revoked state
      const didRedo = store.redo();
      assert.equal(didRedo, true);
      assert.equal(store.getSlides().length, 0);
      assert.ok(revokedUrls.includes(revivedVid0));

      store.clearHistory();
      assert.equal(store.canUndo(), false);
      assert.equal(store.canRedo(), false);
    } finally {
      (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = origRevoke;
      (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = origCreate;
    }
  });

  console.log(`\nMemory Budget Suite Summary: ${passed}/${passed + failed} passed.`);
  return { passed, failed };
}
