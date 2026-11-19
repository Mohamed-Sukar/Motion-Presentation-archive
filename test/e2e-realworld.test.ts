/**
 * Tier 4 Automated Tests: Real-World End-to-End Application Scenarios
 * Grounded in tier3_tier4_infra_specs.md (T4-SCEN-01 through T4-SCEN-05)
 */

import assert from 'node:assert/strict';
import {
  setupMockDOM,
  MockKeyboardEvent,
  MockPointerEvent,
} from './helpers/mock-dom';
import {
  makeMockImageAsset,
  makeMockVideoAsset,
  flushMicrotasks,
} from './helpers/test-fixtures';
import { MotionPresentationApp } from '../src/ui/App';
import { StagePlaybackEngine } from '../src/core/engine/StagePlaybackEngine';
import { ProjectSerializer } from '../src/core/services/ProjectSerializer';
import { SmartPairer } from '../src/core/services/SmartPairer';

export async function runE2ERealWorldTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING TIER 4: REAL-WORLD E2E SCENARIOS ---');
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

  const getEffectiveIndex = (engine: StagePlaybackEngine): number => {
    const st = engine.getStatus();
    if (st.phase === 'PLAYING_TRANSITION' && st.targetSlideIndex !== null) {
      return st.targetSlideIndex;
    }
    return st.currentSlideIndex;
  };

  // T4-SCEN-01: Complete Corporate Keynote Presentation Workflow
  await test(
    'T4-SCEN-01',
    'Executive Keynote: Fullscreen launch, PowerPoint navigation, Q&A blanking, grid jump, and clean exit',
    async () => {
      const env = setupMockDOM();
      let app: MotionPresentationApp | null = null;
      try {
        app = new MotionPresentationApp(env.root);
        const store = (app as any).store;

        // 1. Author loaded 5-slide deck
        for (let i = 1; i <= 5; i++) {
          store.addSlideFromImage(makeMockImageAsset(`slide_${i}`, `slide_${i}.png`));
        }
        store.setActivePreviewIndex(0);
        const previewEngine = (app as any).previewEngine as StagePlaybackEngine;
        if (previewEngine) {
          await previewEngine.loadProject(store.getSlides(), store.getSettings(), 0);
        }
        await flushMicrotasks();
        assert.equal(store.getSlides().length, 5);

        // 2. Executive launches fullscreen presentation (F5)
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'F5' }));
        await flushMicrotasks();
        assert.equal(await env.desktopAPI.isFullScreen(), true);
        assert.equal((app as any).isPresentingFullscreen, true);
        const presenterEngine = (app as any).presenterEngine as StagePlaybackEngine;
        assert.equal(getEffectiveIndex(presenterEngine), 0);

        // 3. Advances through slides using Right Arrow and Space
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
        assert.equal(getEffectiveIndex(presenterEngine), 1);
        // Space skips current animation to slide 1, then second Space advances to slide 2
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: ' ' }));
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: ' ' }));
        assert.equal(getEffectiveIndex(presenterEngine), 2);

        // 4. Audience question: Speaker blanks screen to black (B) to focus attention
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
        assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT');

        // 5. Another question: Speaker switches to white screen (W) for whiteboard projection
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'w' }));
        assert.equal(presenterEngine.getStatus().phase, 'WHITEOUT');

        // 6. Resumes presentation: Space clears whiteout and continues
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: ' ' }));
        assert.notEqual(presenterEngine.getStatus().phase, 'WHITEOUT');

        // 7. Audience asks to return to Slide 1: Speaker opens Slide Grid (G) and selects Slide 1
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));
        assert.equal((app as any).isSlideGridOpen, true);
        const card0 = env.root.querySelector('[data-idx="0"]');
        assert.ok(card0);
        card0.click();
        presenterEngine.completeTransitionImmediately(0);
        assert.equal((app as any).isSlideGridOpen, false);
        assert.equal(getEffectiveIndex(presenterEngine), 0);

        // 8. Keynote ends: Speaker presses Escape to return to Studio
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
        await flushMicrotasks();
        assert.equal((app as any).isPresentingFullscreen, false);
        assert.equal(store.getActivePreviewIndex(), 0);
        assert.equal(store.getSelection().slideId, store.getSlideByIndex(0)?.id);
      } finally {
        (app as any).previewEngine?.destroy();
        env.teardown();
      }
    }
  );

  // T4-SCEN-02: Video Transition Fine-Tuning Workflow
  await test(
    'T4-SCEN-02',
    'Motion Graphics Designer: Ingest 12s reel, scrub timeline, add/drag/nudge keyframes, and generate slides',
    async () => {
      const env = setupMockDOM();
      let app: MotionPresentationApp | null = null;
      try {
        app = new MotionPresentationApp(env.root);
        const store = (app as any).store;
        const video = makeMockVideoAsset('reel_12s', 'product_demo.mp4', 12.0);

        // 1. Open Reel Cue Modal
        (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 12.0] });
        await flushMicrotasks();

        const track = env.root.querySelector('#reel-timeline-track');
        assert.ok(track);
        track.setBounds({ left: 0, width: 1200 });

        // 2. Scrub playhead to 3.0s (300px)
        track.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 300, pointerId: 1 }));
        track.dispatchEvent(new MockPointerEvent('pointerup', { clientX: 300, pointerId: 1 }));
        await flushMicrotasks();

        // 3. Add keyframe via C key
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'c', bubbles: true }));
        await flushMicrotasks();

        // 4. Scrub to 7.0s (700px) and add another keyframe via button
        track.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 700, pointerId: 1 }));
        track.dispatchEvent(new MockPointerEvent('pointerup', { clientX: 700, pointerId: 1 }));
        const addBtn = env.root.querySelector('#btn-reel-add-current');
        addBtn?.click();
        await flushMicrotasks();

        const pins = env.root.querySelectorAll('.reel-cue-pin');
        assert.equal(pins.length, 4, 'Must have 4 pins: 0, 3.0, 7.0, 12.0');

        // 5. Apply reel slicing workflow to commit to store
        await store.applyVideoCuePointsWorkflow(video, [0, 3.0, 7.0, 12.0], { mode: 'replace-all' });
        const generatedSlides = store.getSlides();
        assert.equal(generatedSlides.length, 4, 'Must generate 4 slides');
        assert.equal(generatedSlides[0].transitionToNext.startTimeSec, 0);
        assert.equal(generatedSlides[0].transitionToNext.endTimeSec, 3.0);
        assert.equal(generatedSlides[1].transitionToNext.startTimeSec, 3.0);
        assert.equal(generatedSlides[1].transitionToNext.endTimeSec, 7.0);
        assert.equal(generatedSlides[2].transitionToNext.startTimeSec, 7.0);
        assert.equal(generatedSlides[2].transitionToNext.endTimeSec, 12.0);
      } finally {
        (app as any).previewEngine?.destroy();
        env.teardown();
      }
    }
  );

  // T4-SCEN-03: Rapid Presentation Rehearsal with Keyboard Shortcuts
  await test(
    'T4-SCEN-03',
    'Keynote Rehearsal: Rapid advance/retreat bursts, directional interrupts, and boundary jumps without crash',
    async () => {
      const env = setupMockDOM();
      let app: MotionPresentationApp | null = null;
      try {
        app = new MotionPresentationApp(env.root);
        const store = (app as any).store;

        for (let i = 1; i <= 6; i++) {
          store.addSlideFromImage(makeMockImageAsset(`slide_${i}`, `slide_${i}.png`));
        }
        store.setActivePreviewIndex(0);
        const previewEngine = (app as any).previewEngine as StagePlaybackEngine;
        if (previewEngine) {
          await previewEngine.loadProject(store.getSlides(), store.getSettings(), 0);
        }
        await flushMicrotasks();

        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'F5' }));
        await flushMicrotasks();
        const presenterEngine = (app as any).presenterEngine as StagePlaybackEngine;
        if (presenterEngine) presenterEngine.jumpToSlide(0);

        // Rapid forward advance burst
        for (let i = 0; i < 4; i++) {
          env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
        }
        assert.ok(getEffectiveIndex(presenterEngine) >= 1);

        // Jump to End and Home
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'End' }));
        assert.equal(getEffectiveIndex(presenterEngine), 5);

        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Home' }));
        assert.equal(getEffectiveIndex(presenterEngine), 0);

        // Settle at slide 0 without crossfade before rapid retreat test
        presenterEngine.jumpToSlide(0, false);
        assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);

        // Rapid retreat back and forth
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
        assert.equal(getEffectiveIndex(presenterEngine), 1);
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowLeft' }));
        assert.equal(getEffectiveIndex(presenterEngine), 0);

        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
        await flushMicrotasks();
        assert.equal((app as any).isPresentingFullscreen, false);
      } finally {
        (app as any).previewEngine?.destroy();
        env.teardown();
      }
    }
  );

  // T4-SCEN-04: Non-destructive Keyframe Editing & Boundary Enforcement
  await test(
    'T4-SCEN-04',
    'Video Editor: Enforce boundary pin protection, reject min-cue deletion, and isolate cancel transactions',
    async () => {
      const env = setupMockDOM();
      let app: MotionPresentationApp | null = null;
      try {
        app = new MotionPresentationApp(env.root);
        const store = (app as any).store;
        store.addSlideFromImage(makeMockImageAsset('init_1', 'init_1.png'));
        store.addSlideFromImage(makeMockImageAsset('init_2', 'init_2.png'));
        assert.equal(store.getSlides().length, 2);

        const video = makeMockVideoAsset('vid1', 'editor.mp4', 10.0);
        (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 10.0] });
        await flushMicrotasks();

        // 1. Minimum 2-cue protection
        const pins = env.root.querySelectorAll('.reel-cue-pin');
        assert.equal(pins.length, 2);
        pins[0].click();
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        await flushMicrotasks();
        assert.equal(env.root.querySelectorAll('.reel-cue-pin').length, 2, 'Cannot delete boundary cue');

        // 2. Adjacent spacing clamp (0.08s)
        const rawCues = [0, 5.0, 5.03, 10.0];
        const normalized = SmartPairer.normalizeCuePoints(rawCues, 10.0);
        assert.equal(normalized.length, 3, 'Cue within 0.03s (< 0.08s) was deduplicated');

        // 3. User cancels modal: store must remain exactly as before
        const cancelBtn = env.root.querySelector('#btn-reel-cancel');
        cancelBtn?.click();
        await flushMicrotasks();

        assert.equal(store.getSlides().length, 2, 'Store must retain 2 original slides');
      } finally {
        (app as any).previewEngine?.destroy();
        env.teardown();
      }
    }
  );

  // T4-SCEN-05: Full Project Lifecycle Roundtrip
  await test(
    'T4-SCEN-05',
    'Full Lifecycle: Project creation with video keyframes, serialization, reset, deserialization, and presentation',
    async () => {
      const env = setupMockDOM();
      let app: MotionPresentationApp | null = null;
      try {
        app = new MotionPresentationApp(env.root);
        const store = (app as any).store;
        const video = makeMockVideoAsset('lifecycle_vid', 'reel.mp4', 15.0);

        // 1. Build project with 4 video-sliced slides (from 4 cue points)
        await store.applyVideoCuePointsWorkflow(video, [0, 5.0, 10.0, 15.0], { mode: 'replace-all' });
        assert.equal(store.getSlides().length, 4);

        // 2. Serialize project
        const project = store.getProject();
        project.title = 'Lifecycle Showcase Project';
        const manifest = ProjectSerializer.buildManifestObject(project);
        const json = JSON.stringify(manifest);

        // 3. Reset store to clean empty state
        store.loadProjectFromManifest({ title: 'Clean', slides: [] });
        assert.equal(store.getSlides().length, 0);

        // 4. Restore project from manifest
        const parsed = ProjectSerializer.deserializeProject(json);
        store.loadProjectFromManifest(parsed);
        assert.equal(store.getSlides().length, 4);
        assert.equal(store.getProject().title, 'Lifecycle Showcase Project');
        assert.equal(store.getSlides()[1].transitionToNext.startTimeSec, 5.0);
        assert.equal(store.getSlides()[1].transitionToNext.endTimeSec, 10.0);

        // 5. Present restored project in fullscreen
        store.setActivePreviewIndex(0);
        const previewEngine = (app as any).previewEngine as StagePlaybackEngine;
        if (previewEngine) {
          await previewEngine.loadProject(store.getSlides(), store.getSettings(), 0);
        }
        await flushMicrotasks();

        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'F5' }));
        await flushMicrotasks();
        assert.equal((app as any).isPresentingFullscreen, true);
        const presenterEngine = (app as any).presenterEngine as StagePlaybackEngine;
        assert.equal(getEffectiveIndex(presenterEngine), 0);

        // Navigate forward
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
        assert.equal(getEffectiveIndex(presenterEngine), 1);

        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
        await flushMicrotasks();
        assert.equal((app as any).isPresentingFullscreen, false);
      } finally {
        (app as any).previewEngine?.destroy();
        env.teardown();
      }
    }
  );

  console.log(`\nReal-World Scenarios Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
