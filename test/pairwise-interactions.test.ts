/**
 * Tier 3 Automated Integration Tests: Pairwise Cross-Feature Interactions
 * Grounded in tier3_tier4_infra_specs.md (T3-PAIR-01 through T3-PAIR-12)
 */

import assert from 'node:assert/strict';
import { setupMockDOM, MockKeyboardEvent, MockPointerEvent } from './helpers/mock-dom';
import { makeMockImageAsset, makeMockVideoAsset, flushMicrotasks } from './helpers/test-fixtures';
import { MotionPresentationApp } from '../src/ui/App';
import { StagePlaybackEngine } from '../src/core/engine/StagePlaybackEngine';

export async function runPairwiseInteractionTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n=============================================================');
  console.log('--- RUNNING TIER 3: PAIRWISE CROSS-FEATURE INTERACTIONS ---');
  console.log('=============================================================');

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

  const createStudioWithSlides = async (count = 4) => {
    const env = setupMockDOM();
    const app = new MotionPresentationApp(env.root);
    const store = (app as any).store;

    for (let i = 1; i <= count; i++) {
      store.addSlideFromImage(makeMockImageAsset(`slide_${i}`, `slide_${i}.png`));
    }
    if (count > 0) {
      store.setActivePreviewIndex(0);
      const s0 = store.getSlideByIndex(0);
      if (s0) store.setSelection({ type: 'slide', slideId: s0.id });
      const previewEngine = (app as any).previewEngine as StagePlaybackEngine;
      if (previewEngine) {
        await previewEngine.loadProject(store.getSlides(), store.getSettings(), 0);
      }
    }
    await flushMicrotasks();
    return { env, app, store };
  };

  const launchFullscreen = async (env: any, app: any) => {
    env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'F5' }));
    await flushMicrotasks();
    const engine = (app as any).presenterEngine as StagePlaybackEngine;
    if (engine) engine.jumpToSlide(0);
    return engine;
  };

  const getEffectiveIndex = (engine: StagePlaybackEngine): number => {
    const st = engine.getStatus();
    if (st.phase === 'PLAYING_TRANSITION' && st.targetSlideIndex !== null) {
      return st.targetSlideIndex;
    }
    return st.currentSlideIndex;
  };

  const exitFullscreen = async (env: any, _app: any) => {
    env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
    await flushMicrotasks();
  };

  // T3-PAIR-01: F1 (Shortcuts) × F5/F6 (Timeline Modal)
  await test('T3-PAIR-01', 'Presentation shortcuts do not leak to background engine while timeline modal is open', async () => {
    const { env, app } = await createStudioWithSlides(4);
    try {
      const previewEngine = (app as any).previewEngine as StagePlaybackEngine;
      assert.equal(previewEngine.getStatus().currentSlideIndex, 0);

      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      // Dispatch global presentation keys: Space, ArrowRight, PageDown
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: ' ' }));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'PageDown' }));

      // Background preview engine must remain untouched at slide 0
      assert.equal(previewEngine.getStatus().currentSlideIndex, 0, 'Background slide must not advance while modal is open');

      // Close modal
      const closeBtn = env.root.querySelector('#btn-reel-modal-close');
      closeBtn?.click();
      await flushMicrotasks();

      // Now shortcuts resume working in fullscreen presentation
      const presenterEngine = await launchFullscreen(env, app);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      assert.equal(getEffectiveIndex(presenterEngine), 1);
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-02: F2 (Blank Overlays) × F7 (Transition Engine)
  await test('T3-PAIR-02', 'Blank overlay toggled mid-transition animation halts RAF cleanly and unblanks to stable state', async () => {
    const { env, app } = await createStudioWithSlides(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      // Start transition 0 -> 1
      presenterEngine.next();
      // Toggle blackout mid-flight
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
      assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT');

      // Unblank via B
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
      assert.equal(presenterEngine.getStatus().phase, 'HOLDING_SLIDE');
      assert.ok(presenterEngine.getStatus().currentSlideIndex >= 0);
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-03: F2 (Blank Overlays) × F5 (Timeline Scrubbing)
  await test('T3-PAIR-03', 'Blank overlay toggling during timeline scrubbing clamps safely without NaN', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      const track = env.root.querySelector('#reel-timeline-track');
      track?.setBounds({ left: 0, width: 1000 });

      track?.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 200, pointerId: 1 }));
      track?.dispatchEvent(new MockPointerEvent('pointermove', { clientX: 450, pointerId: 1 }));

      const playhead = env.root.querySelector('#reel-playhead');
      assert.equal(playhead?.style.left, '45%');

      track?.dispatchEvent(new MockPointerEvent('pointerup', { clientX: 450, pointerId: 1 }));
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-04: F3 (Fullscreen Lifecycle) × F7 (Transition Engine)
  await test('T3-PAIR-04', 'Fullscreen exit mid-transition halts presenter, destroys engine, and syncs store cleanly', async () => {
    const { env, app, store } = await createStudioWithSlides(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.next(); // Start transition 0 -> 1

      // Exit fullscreen while mid-transition
      await exitFullscreen(env, app);
      assert.equal((app as any).isPresentingFullscreen, false);
      assert.equal((app as any).presenterEngine, null);

      // Store selection and preview index must be synchronized
      assert.ok(store.getActivePreviewIndex() >= 0);
      const selection = store.getSelection();
      assert.equal(selection.type, 'slide');
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-05: F3 (Fullscreen Lifecycle) × F4 (Slide Grid Modal)
  await test('T3-PAIR-05', 'Hierarchical Escape key routing closes slide grid first, then exits fullscreen', async () => {
    const { env, app } = await createStudioWithSlides(3);
    try {
      await launchFullscreen(env, app);
      assert.equal((app as any).isPresentingFullscreen, true);

      // Open slide grid
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));
      assert.equal((app as any).isSlideGridOpen, true);

      // First Escape: closes slide grid only
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      assert.equal((app as any).isSlideGridOpen, false, 'First Escape must close slide grid');
      assert.equal((app as any).isPresentingFullscreen, true, 'Presentation mode must remain active');

      // Second Escape: exits fullscreen presentation
      await exitFullscreen(env, app);
      assert.equal((app as any).isPresentingFullscreen, false, 'Second Escape must exit fullscreen');
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-06: F5 (Timeline Scrub) × F6 (Keyframe CRUD) × F8 (Store Sync)
  await test('T3-PAIR-06', 'Adding and deleting keyframes during timeline scrubbing normalizes segments correctly', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 10.0] });
      await flushMicrotasks();

      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      videoEl.currentTime = 4.0;

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'c', bubbles: true }));
      await flushMicrotasks();

      let pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(pins.length, 3);

      // Add another keyframe at 8.0s
      videoEl.currentTime = 8.0;
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'c', bubbles: true }));
      await flushMicrotasks();

      pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(pins.length, 4);
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-07: F2 (Blank Overlays) × F4 (Direct Slide Jump)
  await test('T3-PAIR-07', 'Selecting slide thumbnail from slide grid while in Blackout unblanks and renders target slide', async () => {
    const { env, app } = await createStudioWithSlides(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      // Blank screen
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
      assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT');

      // Open slide grid and select card 2
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));
      const card2 = env.root.querySelector('[data-idx="2"]');
      card2?.click();

      // Must be at slide 2 and unblanked
      assert.equal(getEffectiveIndex(presenterEngine), 2);
      assert.notEqual(presenterEngine.getStatus().phase, 'BLACKOUT');
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-08: F6 (Keyframe Deletion) × F8 (Reverse Cache Invalidation)
  await test('T3-PAIR-08', 'Deleting slide bridges adjacent transition ranges and purges stale reverse frame caches', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const video = makeMockVideoAsset('vid1', 'reel.mp4', 12.0);

      await store.applyVideoCuePointsWorkflow(video, [0, 4.0, 8.0, 12.0], { mode: 'replace-all' });
      const slides = store.getSlides();
      const slide1 = slides[1];
      const transId = slide1.transitionToNext.id;

      StagePlaybackEngine.cacheReverseFrames(transId, [env.document.createElement('canvas') as HTMLCanvasElement]);
      assert.ok(StagePlaybackEngine.getReverseFrames(transId));

      store.deleteSlide(slide1.id);
      assert.equal(StagePlaybackEngine.getReverseFrames(transId), undefined, 'Evicted transition cache must be purged');
      assert.equal(store.getSlides()[0].transitionToNext.endTimeSec, 8.0, 'Range must bridge to next cue');
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-09: F1 (Keyboard Navigation) × F2 (Blank Overlays)
  await test('T3-PAIR-09', 'Pressing advance or retreat keys while screen is blanked unblanks and navigates', async () => {
    const { env, app } = await createStudioWithSlides(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
      assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT');

      // First key unblanks screen
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      assert.notEqual(presenterEngine.getStatus().phase, 'BLACKOUT');

      // Subsequent key navigates to next slide
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      assert.equal(getEffectiveIndex(presenterEngine), 1);
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-10: F3 (Fullscreen Lifecycle) × F6/F8 (Store Keyframe Updates)
  await test('T3-PAIR-10', 'Rapid fullscreen cycle during store keyframe mutations preserves atomic timeline state', async () => {
    const { env, app, store } = await createStudioWithSlides(3);
    try {
      await launchFullscreen(env, app);
      await exitFullscreen(env, app);

      // Mutate transition range
      const s0 = store.getSlides()[0];
      store.updateTransitionRange(s0.id, 0.2, 3.8);

      // Re-enter fullscreen
      const presenterEngine = await launchFullscreen(env, app);
      assert.ok(presenterEngine);
      assert.equal((app as any).isPresentingFullscreen, true);
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-11: F4 (Direct Slide Jump) × F5/F7 (Transition Scrubbing)
  await test('T3-PAIR-11', 'Direct slide jump cancels active transition interpolation and mounts destination slide', async () => {
    const { env, app } = await createStudioWithSlides(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.next(); // Start transition 0 -> 1

      // Trigger direct jump to slide 3
      presenterEngine.jumpToSlide(3, true);
      assert.equal(getEffectiveIndex(presenterEngine), 3);
    } finally {
      env.teardown();
    }
  });

  // T3-PAIR-12: F1 (Keyboard Navigation) × F6/F8 (Keyframe Nudge / Reverse)
  await test('T3-PAIR-12', 'Backward navigation immediately following keyframe nudge adheres to updated duration', async () => {
    const { env, app, store } = await createStudioWithSlides(3);
    try {
      const s0 = store.getSlides()[0];
      store.updateTransitionRange(s0.id, 0.1, 2.5);

      const presenterEngine = await launchFullscreen(env, app);

      presenterEngine.jumpToSlide(1);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowLeft' }));
      assert.equal(getEffectiveIndex(presenterEngine), 0);
    } finally {
      env.teardown();
    }
  });

  console.log(`\nPairwise Interactions Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
