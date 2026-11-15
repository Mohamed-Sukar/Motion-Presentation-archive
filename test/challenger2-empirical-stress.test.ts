import assert from 'node:assert/strict';

// Node.js environment polyfills for headless canvas/DOM mocks
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}

if (typeof (globalThis as any).requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(Date.now()), 16) as unknown as number;
  };
}

if (typeof (globalThis as any).cancelAnimationFrame === 'undefined') {
  (globalThis as any).cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
}

if (typeof (globalThis as any).Image === 'undefined') {
  (globalThis as any).Image = class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 1920;
    naturalHeight = 1080;
    complete = true;
    private _src = '';
    get src() {
      return this._src;
    }
    set src(val: string) {
      this._src = val;
      queueMicrotask(() => {
        if (this.onload) this.onload();
      });
    }
  };
}

import { PresentationStore } from '../src/core/state/PresentationStore';
import { createDefaultSettings, createEmptyProject } from '../src/core/domain/defaults';
import { MediaAsset, SlideNode } from '../src/core/domain/types';
import { StagePlaybackEngine } from '../src/core/engine/StagePlaybackEngine';

function createMockMediaAsset(id: string, name: string): MediaAsset {
  return {
    id,
    name,
    kind: 'image',
    mimeType: 'image/png',
    extension: 'png',
    objectUrl: `blob:http://localhost/${id}`,
    fileSize: 1024,
    width: 1920,
    height: 1080,
    durationSec: 0,
  };
}

function createMockCanvas(width = 1920, height = 1080) {
  const operations: string[] = [];
  const ctx = {
    fillStyle: '#000000',
    fillRect: (x: number, y: number, w: number, h: number) => {
      operations.push(`fillRect(${x},${y},${w},${h},fill=${ctx.fillStyle})`);
    },
    clearRect: (x: number, y: number, w: number, h: number) => {
      operations.push(`clearRect(${x},${y},${w},${h})`);
    },
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  };

  const canvas = {
    width,
    height,
    getContext: (type: string) => (type === '2d' ? ctx : null),
  } as unknown as HTMLCanvasElement;

  return { canvas, ctx, operations };
}

async function runEmpiricalStressTests(): Promise<void> {
  console.log('================================================================');
  console.log('CHALLENGER 2: EMPIRICAL STRESS & ADVERSARIAL VERIFICATION SUITE');
  console.log('================================================================\n');

  // ===========================================================================
  // TEST 1: PresentationStore.getSlideByIndex Boundary & Extreme Inputs
  // ===========================================================================
  console.log('[Test 1] PresentationStore.getSlideByIndex Boundary & Extreme Values');
  {
    // 1.1 Empty store (0 slides)
    const emptyStore = new PresentationStore(createEmptyProject('Empty Test'));
    assert.equal(emptyStore.getSlides().length, 0, 'Initial slides count must be 0');

    const boundaryIndices = [-99999, -1, 0, 1, 99999, NaN, Infinity, -Infinity, 0.5, -0.5, 1.5];
    for (const idx of boundaryIndices) {
      const res = emptyStore.getSlideByIndex(idx);
      assert.equal(res, undefined, `Empty store getSlideByIndex(${idx}) must return undefined`);
    }

    // 1.2 Single slide store (1 slide)
    const singleStore = new PresentationStore(createEmptyProject('Single Test'));
    const img1 = createMockMediaAsset('img_single', 'single.png');
    const singleSlide = singleStore.addSlideFromImage(img1);
    assert.equal(singleStore.getSlides().length, 1);

    assert.equal(singleStore.getSlideByIndex(0)?.id, singleSlide.id, 'Index 0 must return the single slide');
    assert.equal(singleStore.getSlideByIndex(-1), undefined, 'Index -1 must return undefined');
    assert.equal(singleStore.getSlideByIndex(1), undefined, 'Index 1 (length) must return undefined');
    assert.equal(singleStore.getSlideByIndex(999), undefined, 'Index 999 must return undefined');
    assert.equal(singleStore.getSlideByIndex(0.5), undefined, 'Float index 0.5 must return undefined');
    assert.equal(singleStore.getSlideByIndex(NaN), undefined, 'NaN must return undefined');
    assert.equal(singleStore.getSlideByIndex(Infinity), undefined, 'Infinity must return undefined');

    // 1.3 Multi-slide store (N = 10 slides)
    const multiStore = new PresentationStore(createEmptyProject('Multi Test'));
    const slides: SlideNode[] = [];
    for (let i = 0; i < 10; i++) {
      const img = createMockMediaAsset(`img_${i}`, `slide_${i}.png`);
      slides.push(multiStore.addSlideFromImage(img));
    }
    assert.equal(multiStore.getSlides().length, 10);

    // Exact boundaries
    assert.equal(multiStore.getSlideByIndex(0)?.id, slides[0].id, 'Index 0 must return first slide');
    assert.equal(multiStore.getSlideByIndex(9)?.id, slides[9].id, 'Index length-1 must return last slide');
    assert.equal(multiStore.getSlideByIndex(10), undefined, 'Index length must return undefined');
    assert.equal(multiStore.getSlideByIndex(11), undefined, 'Index length+1 must return undefined');
    assert.equal(multiStore.getSlideByIndex(-1), undefined, 'Index -1 must return undefined');
    assert.equal(multiStore.getSlideByIndex(-100), undefined, 'Negative index must return undefined');
    assert.equal(multiStore.getSlideByIndex(9999), undefined, 'Large index must return undefined');

    // Intermediate indices
    for (let i = 0; i < 10; i++) {
      assert.equal(multiStore.getSlideByIndex(i)?.id, slides[i].id, `Index ${i} must match slides[${i}]`);
    }

    // 1.4 Dynamic mutation: Delete a slide and verify indices adjust
    const deletedSlideId = slides[3].id;
    multiStore.deleteSlide(deletedSlideId);
    assert.equal(multiStore.getSlides().length, 9);
    assert.equal(multiStore.getSlideByIndex(3)?.id, slides[4].id, 'Index 3 must now return what was previously index 4');
    assert.equal(multiStore.getSlideByIndex(8)?.id, slides[9].id, 'Index 8 must now return what was previously index 9');
    assert.equal(multiStore.getSlideByIndex(9), undefined, 'Previous length index 9 must now return undefined');

    console.log('✓ PresentationStore.getSlideByIndex boundaries verified across 0, 1, and N slides');
  }

  // ===========================================================================
  // TEST 2: Selection Synchronization on Fullscreen Exit (0, 1, N slides)
  // ===========================================================================
  console.log('[Test 2] Selection Synchronization on Fullscreen Exit');
  {
    // 2.1 Fullscreen Exit with 0 slides
    {
      const store = new PresentationStore(createEmptyProject('0 Slides Exit'));
      assert.equal(store.getSlides().length, 0);
      assert.equal(store.getSelection().type, 'settings');

      // Simulate App.ts exitFullscreenPresentation logic with 0 slides:
      const lastIdx = 0;
      store.setActivePreviewIndex(lastIdx);
      const slide = store.getSlideByIndex(lastIdx);
      if (slide) {
        store.setSelection({ type: 'slide', slideId: slide.id });
      }

      // Selection must remain settings, no invalid slideId set
      assert.equal(store.getSelection().type, 'settings');
      assert.equal(store.getActivePreviewIndex(), 0);
    }

    // 2.2 Fullscreen Exit with 1 slide
    {
      const store = new PresentationStore(createEmptyProject('1 Slide Exit'));
      const s0 = store.addSlideFromImage(createMockMediaAsset('m_0', 'm0.png'));
      assert.equal(store.getSlides().length, 1);

      // Presenter was on slide 0
      const lastIdx = 0;
      store.setActivePreviewIndex(lastIdx);
      const slide = store.getSlideByIndex(lastIdx);
      assert.ok(slide, 'Slide at index 0 must exist');
      store.setSelection({ type: 'slide', slideId: slide.id });

      const sel = store.getSelection();
      assert.equal(sel.type, 'slide');
      if (sel.type === 'slide') {
        assert.equal(sel.slideId, s0.id, 'Selection must sync to single slide id');
      }
      assert.equal(store.getActivePreviewIndex(), 0);
    }

    // 2.3 Fullscreen Exit across arbitrary slide counts N (1 to 20 slides)
    for (const slideCount of [2, 5, 12, 20]) {
      const store = new PresentationStore(createEmptyProject(`N=${slideCount} Test`));
      const addedSlides: SlideNode[] = [];
      for (let i = 0; i < slideCount; i++) {
        addedSlides.push(store.addSlideFromImage(createMockMediaAsset(`asset_${i}`, `slide_${i}.png`)));
      }

      // Test exiting at every possible slide index
      for (let targetIdx = 0; targetIdx < slideCount; targetIdx++) {
        // Deliberately perturb selection to a different slide first to test synchronization
        const otherIdx = (targetIdx + 1) % slideCount;
        store.setSelection({ type: 'slide', slideId: addedSlides[otherIdx].id });
        store.setActivePreviewIndex(otherIdx);

        // Simulate exit from targetIdx
        store.setActivePreviewIndex(targetIdx);
        const slide = store.getSlideByIndex(targetIdx);
        assert.ok(slide);
        store.setSelection({ type: 'slide', slideId: slide.id });

        const currentSelection = store.getSelection();
        assert.equal(currentSelection.type, 'slide');
        if (currentSelection.type === 'slide') {
          assert.equal(
            currentSelection.slideId,
            addedSlides[targetIdx].id,
            `store.getSelection().slideId must match targetIdx=${targetIdx} (expected ${addedSlides[targetIdx].id}, got ${currentSelection.slideId})`
          );
        }
        assert.equal(store.getActivePreviewIndex(), targetIdx);
      }
    }

    // 2.4 Transitioning from non-slide selections ('settings' and 'transition')
    {
      const store = new PresentationStore(createEmptyProject('Non-slide Selection Test'));
      const s0 = store.addSlideFromImage(createMockMediaAsset('s0', 's0.png'));
      const s1 = store.addSlideFromImage(createMockMediaAsset('s1', 's1.png'));

      // Case A: Initial selection is 'settings'
      store.setSelection({ type: 'settings' });
      assert.equal(store.getSelection().type, 'settings');

      // Exit from slide 1
      const lastIdx1 = 1;
      store.setActivePreviewIndex(lastIdx1);
      const slide1 = store.getSlideByIndex(lastIdx1);
      if (slide1) {
        store.setSelection({ type: 'slide', slideId: slide1.id });
      }
      assert.equal(store.getSelection().type, 'slide');
      assert.equal((store.getSelection() as any).slideId, s1.id);

      // Case B: Initial selection is 'transition'
      store.setSelection({ type: 'transition', slideId: s0.id });
      assert.equal(store.getSelection().type, 'transition');

      // Exit from slide 0
      const lastIdx0 = 0;
      store.setActivePreviewIndex(lastIdx0);
      const slide0 = store.getSlideByIndex(lastIdx0);
      if (slide0) {
        store.setSelection({ type: 'slide', slideId: slide0.id });
      }
      assert.equal(store.getSelection().type, 'slide');
      assert.equal((store.getSelection() as any).slideId, s0.id);
    }

    console.log('✓ Fullscreen exit selection synchronization verified for 0, 1, and N slides');
  }

  // ===========================================================================
  // TEST 3: Slide Grid Modal Jump State Synchronization
  // ===========================================================================
  console.log('[Test 3] Slide Grid Modal Jump State Synchronization');
  {
    const store = new PresentationStore(createEmptyProject('Grid Jump Test'));
    const slides: SlideNode[] = [];
    for (let i = 0; i < 15; i++) {
      slides.push(store.addSlideFromImage(createMockMediaAsset(`grid_asset_${i}`, `g_${i}.png`)));
    }

    let changeEventCount = 0;
    store.subscribe(() => {
      changeEventCount++;
    });

    // Simulate modal card selection function from App.ts:
    const simulateModalCardSelection = (idx: number) => {
      store.setActivePreviewIndex(idx);
      const slide = store.getSlideByIndex(idx);
      if (slide) {
        store.setSelection({ type: 'slide', slideId: slide.id });
      }
    };

    // Test jumps to various card indices
    const testJumps = [0, 14, 7, 3, 11, 0, 14];
    for (const jumpIdx of testJumps) {
      const prevEvents = changeEventCount;
      simulateModalCardSelection(jumpIdx);

      const sel = store.getSelection();
      assert.equal(sel.type, 'slide');
      if (sel.type === 'slide') {
        assert.equal(
          sel.slideId,
          slides[jumpIdx].id,
          `Card jump to ${jumpIdx} must immediately update selection.slideId`
        );
      }
      assert.equal(store.getActivePreviewIndex(), jumpIdx, `Active preview index must update to ${jumpIdx}`);
      assert.ok(changeEventCount > prevEvents, 'Store must emit change event on selection update');
    }

    // Stress test: 100 rapid pseudorandom jumps
    for (let step = 0; step < 100; step++) {
      const randomIdx = Math.floor(Math.random() * slides.length);
      simulateModalCardSelection(randomIdx);
      const sel = store.getSelection();
      if (sel.type === 'slide') {
        assert.equal(sel.slideId, slides[randomIdx].id);
      }
      assert.equal(store.getActivePreviewIndex(), randomIdx);
    }

    console.log('✓ Slide Grid modal card jump synchronization verified across 100 rapid jumps');
  }

  // ===========================================================================
  // TEST 4: Engine Destruction in BLACKOUT / WHITEOUT Phase & Post-Destroy Resilience
  // ===========================================================================
  console.log('[Test 4] Engine Destruction in BLACKOUT / WHITEOUT & Post-Destroy Resilience');
  {
    const { canvas } = createMockCanvas();
    const settings = createDefaultSettings();

    // 4.1 Destroy in BLACKOUT phase
    {
      const engine = new StagePlaybackEngine(canvas, settings);
      let statusCallbackCalled: boolean;
      engine.onStatusChange(() => {
        statusCallbackCalled = true;
      });

      engine.toggleBlackout();
      assert.equal(engine.getStatus().phase, 'BLACKOUT');

      // Destroy while in BLACKOUT
      assert.doesNotThrow(() => {
        engine.destroy();
      }, 'destroy() while in BLACKOUT must not throw');

      // Post-destruction safety: methods must gracefully no-op without throwing
      assert.doesNotThrow(() => {
        engine.toggleBlackout();
        engine.toggleWhiteout();
        const res = engine.clearBlankScreen();
        assert.equal(res, false, 'clearBlankScreen after destroy must return false');
        engine.next();
        engine.previous();
        engine.pause();
        engine.syncCanvasResolution();
      }, 'Post-destroy method invocations must not throw');

      // Listeners should no longer fire
      statusCallbackCalled = false;
      engine.toggleBlackout();
      assert.equal(statusCallbackCalled, false, 'Destroyed engine must not emit status to listeners');
    }

    // 4.2 Destroy in WHITEOUT phase
    {
      const engine = new StagePlaybackEngine(canvas, settings);
      engine.toggleWhiteout();
      assert.equal(engine.getStatus().phase, 'WHITEOUT');

      assert.doesNotThrow(() => {
        engine.destroy();
      }, 'destroy() while in WHITEOUT must not throw');

      // Post-destruction safety
      assert.doesNotThrow(() => {
        engine.toggleWhiteout();
        engine.toggleBlackout();
        assert.equal(engine.clearBlankScreen(), false);
        engine.next();
        engine.previous();
      }, 'Post-destroy calls on whited-out engine must safely no-op');
    }

    // 4.3 Idempotent destroy: multiple sequential destroy calls
    {
      const engine = new StagePlaybackEngine(canvas, settings);
      engine.toggleWhiteout();
      for (let i = 0; i < 5; i++) {
        assert.doesNotThrow(() => {
          engine.destroy();
        }, `Sequential destroy() call ${i + 1} must be idempotent and not throw`);
      }
    }

    console.log('✓ StagePlaybackEngine destruction in blanked states verified and fully resilient');
  }

  // ===========================================================================
  // TEST 4B: Concurrent Engine Destruction during In-Flight loadProject
  // ===========================================================================
  console.log('[Test 4B] Concurrent Engine Destruction during In-Flight loadProject');
  {
    const { canvas } = createMockCanvas();
    const settings = createDefaultSettings();
    const store = new PresentationStore(createEmptyProject('Load In-Flight'));
    const slides: SlideNode[] = [];
    for (let i = 0; i < 5; i++) {
      slides.push(store.addSlideFromImage(createMockMediaAsset(`inflight_${i}`, `inf_${i}.png`)));
    }

    const engine = new StagePlaybackEngine(canvas, settings);
    // Fire loadProject (asynchronous)
    const loadPromise = engine.loadProject(slides, settings, 2);

    // Immediately toggle blackout and destroy while loadProject is resolving
    engine.toggleBlackout();
    engine.destroy();

    // Await loadPromise - must resolve cleanly without uncaught exception
    await assert.doesNotReject(async () => {
      await loadPromise;
    }, 'In-flight loadProject must resolve cleanly after destroy()');

    // Engine destroyed flag must remain true
    assert.equal(engine.clearBlankScreen(), false);
    console.log('✓ Concurrent destruction during in-flight loadProject verified');
  }

  // ===========================================================================
  // TEST 5: Rapid Fullscreen Enter/Exit Lifecycle Simulation
  // ===========================================================================
  console.log('[Test 5] Rapid Fullscreen Enter/Exit Lifecycle Simulation');
  {
    const store = new PresentationStore(createEmptyProject('Rapid Fullscreen Test'));
    const slides: SlideNode[] = [];
    for (let i = 0; i < 5; i++) {
      slides.push(store.addSlideFromImage(createMockMediaAsset(`rf_${i}`, `rf_${i}.png`)));
    }
    const settings = store.getSettings();

    // Simulate 50 rapid enter/exit cycles
    for (let cycle = 0; cycle < 50; cycle++) {
      // 1. Enter fullscreen
      const { canvas } = createMockCanvas();
      const presenterEngine = new StagePlaybackEngine(canvas, settings);
      await presenterEngine.loadProject(slides, settings, cycle % slides.length);

      // Random action during fullscreen: blank or advance
      if (cycle % 3 === 1) {
        presenterEngine.toggleBlackout();
      } else if (cycle % 3 === 2) {
        presenterEngine.toggleWhiteout();
      } else {
        presenterEngine.next();
      }

      // 2. Exit fullscreen
      const lastIdx = presenterEngine.getStatus().currentSlideIndex ?? 0;
      presenterEngine.destroy();

      // Synchronize store
      store.setActivePreviewIndex(lastIdx);
      const slide = store.getSlideByIndex(lastIdx);
      if (slide) {
        store.setSelection({ type: 'slide', slideId: slide.id });
      }

      // Verify store consistency
      const sel = store.getSelection();
      assert.equal(sel.type, 'slide');
      if (sel.type === 'slide') {
        assert.equal(sel.slideId, slides[lastIdx].id);
      }
      assert.equal(store.getActivePreviewIndex(), lastIdx);
    }

    console.log('✓ Rapid Fullscreen Enter/Exit 50-cycle simulation passed without leaks or state drift');
  }

  // ===========================================================================
  // TEST 6: Unblanking Invariance & Slide Position Preservation
  // ===========================================================================
  console.log('[Test 6] Unblanking Invariance & Slide Position Preservation');
  {
    const { canvas } = createMockCanvas();
    const settings = createDefaultSettings();
    const store = new PresentationStore(createEmptyProject('Unblank Test'));
    const slides: SlideNode[] = [];
    for (let i = 0; i < 4; i++) {
      slides.push(store.addSlideFromImage(createMockMediaAsset(`ub_${i}`, `ub_${i}.png`)));
    }

    const engine = new StagePlaybackEngine(canvas, settings);
    await engine.loadProject(slides, settings, 2); // Start at slide 2
    assert.equal(engine.getStatus().currentSlideIndex, 2);

    // Blackout at slide 2
    engine.toggleBlackout();
    assert.equal(engine.getStatus().phase, 'BLACKOUT');
    assert.equal(engine.getStatus().currentSlideIndex, 2);

    // Next while in blackout must unblank to slide 2, NOT skip to slide 3!
    engine.next();
    assert.equal(engine.getStatus().phase, 'HOLDING_SLIDE');
    assert.equal(engine.getStatus().currentSlideIndex, 2, 'Unblanking via next() must stay on slide 2');

    // Whiteout at slide 2
    engine.toggleWhiteout();
    assert.equal(engine.getStatus().phase, 'WHITEOUT');
    assert.equal(engine.getStatus().currentSlideIndex, 2);

    // Previous while in whiteout must unblank to slide 2, NOT retreat to slide 1!
    engine.previous();
    assert.equal(engine.getStatus().phase, 'HOLDING_SLIDE');
    assert.equal(engine.getStatus().currentSlideIndex, 2, 'Unblanking via previous() must stay on slide 2');

    engine.destroy();
    console.log('✓ Unblanking preserves exact slide index without unintended advance/retreat');
  }

  console.log('\n================================================================');
  console.log('ALL CHALLENGER 2 EMPIRICAL STRESS TESTS PASSED CLEANLY (6/6)!');
  console.log('================================================================\n');
}

runEmpiricalStressTests().catch((err) => {
  console.error('STRESS TEST FAILED:', err);
  process.exit(1);
});
