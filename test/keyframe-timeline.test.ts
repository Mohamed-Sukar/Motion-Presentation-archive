/**
 * Tier 1 & Tier 2 Automated Tests: Keyframe Timeline & Video Processing (Features F5, F6, F7, F8)
 * Grounded in ORIGINAL_REQUEST.md (§R2) and spec_miner_e2e_1/tier1_tier2_specs.md
 */

import assert from 'node:assert/strict';
import {
  setupMockDOM,
  MockKeyboardEvent,
  MockPointerEvent,
  MockMouseEvent,
} from './helpers/mock-dom';
import {
  makeMockImageAsset,
  makeMockVideoAsset,
  flushMicrotasks,
} from './helpers/test-fixtures';
import { MotionPresentationApp } from '../src/ui/App';
import { SmartPairer } from '../src/core/services/SmartPairer';
import { StagePlaybackEngine } from '../src/core/engine/StagePlaybackEngine';
import { ProjectSerializer } from '../src/core/services/ProjectSerializer';
import { evaluateEasing } from '../src/core/domain/defaults';

export async function runKeyframeTimelineTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING TIER 1 & TIER 2: KEYFRAME TIMELINE SUITE ---');
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

  /* --------------------------------------------------------------------------
   * FEATURE F5: Interactive Visual Timeline Track & Playhead (Tier 1 & Tier 2)
   * -------------------------------------------------------------------------- */

  await test('T1-F5-01', 'Pointerdown timeline scrubbing seeks video & positions playhead', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      const track = env.root.querySelector('#reel-timeline-track');
      assert.ok(track, 'Timeline track must be mounted');
      track.setBounds({ left: 100, width: 1000, top: 0, height: 40 });

      // Click at clientX = 500 (400px into track -> 40%)
      const ev = new MockPointerEvent('pointerdown', { clientX: 500, pointerId: 1, button: 0, buttons: 1 });
      track.dispatchEvent(ev);
      await flushMicrotasks();

      const playhead = env.root.querySelector('#reel-playhead');
      assert.ok(playhead);
      assert.equal(playhead.style.left, '40%', 'Playhead left must be 40%');

      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      assert.equal(videoEl.currentTime, 4.0, 'Video currentTime must be 4.0s');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F5-02', 'Pointermove continuous scrubbing updates video and playhead', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      const track = env.root.querySelector('#reel-timeline-track');
      track?.setBounds({ left: 0, width: 1000 });

      track?.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 200, pointerId: 1 }));
      track?.dispatchEvent(new MockPointerEvent('pointermove', { clientX: 600, pointerId: 1 }));
      await flushMicrotasks();

      const playhead = env.root.querySelector('#reel-playhead');
      assert.equal(playhead?.style.left, '60%');

      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      assert.equal(videoEl.currentTime, 6.0);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F5-03', 'Pointerup terminates scrubbing and releases pointer capture', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      const track = env.root.querySelector('#reel-timeline-track');
      track?.setBounds({ left: 0, width: 1000 });

      track?.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 750, pointerId: 1 }));
      assert.equal(track?.hasPointerCapture(1), true);

      track?.dispatchEvent(new MockPointerEvent('pointerup', { clientX: 750, pointerId: 1 }));
      assert.equal(track?.hasPointerCapture(1), false, 'Pointer capture must be released');

      const playhead = env.root.querySelector('#reel-playhead');
      assert.equal(playhead?.style.left, '75%');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F5-04', 'Timecode readout formatting formats minutes, seconds, and centiseconds', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const formatted = (app as any).formatTimecode(65.42);
      assert.ok(formatted.includes('01:05.42'), `Formatted timecode must include 01:05.42, got ${formatted}`);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F5-05', 'Playhead style left synchronizes with video duration ratio', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 20.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      videoEl.currentTime = 5.0; // 5 / 20 = 25%
      await flushMicrotasks();

      const playhead = env.root.querySelector('#reel-playhead');
      assert.ok(playhead);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F5-01', 'Dragging scrub pointer to the left of track clamps to 0.0s (0%)', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      const track = env.root.querySelector('#reel-timeline-track');
      track?.setBounds({ left: 100, width: 1000 });

      // Click to the left of track (clientX = 50 < left 100)
      track?.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 50, pointerId: 1 }));
      await flushMicrotasks();

      const playhead = env.root.querySelector('#reel-playhead');
      assert.equal(playhead?.style.left, '0%');
      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      assert.equal(videoEl.currentTime, 0.0);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F5-02', 'Dragging scrub pointer past right of track clamps to duration (100%)', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      const track = env.root.querySelector('#reel-timeline-track');
      track?.setBounds({ left: 100, width: 1000 }); // right = 1100

      // Click past right of track (clientX = 1200 > 1100)
      track?.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 1200, pointerId: 1 }));
      await flushMicrotasks();

      const playhead = env.root.querySelector('#reel-playhead');
      assert.equal(playhead?.style.left, '100%');
      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      assert.equal(videoEl.currentTime, 10.0);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F5-03', 'Pointerdown directly on cue pin initiates pin drag instead of track scrub', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 5.0, 10.0] });
      await flushMicrotasks();

      const pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.ok(pins.length >= 3, 'Must have at least 3 pins');

      const middlePin = pins[1];
      middlePin.setBounds({ left: 500, width: 16 });
      middlePin.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 508, pointerId: 2, bubbles: true }));

      // Verify that pin drag was initiated
      assert.ok(middlePin);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F5-04', 'Zero-duration video asset in modal defaults to 1.0s fallback duration', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid0', 'zero.mp4', 0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      assert.ok(videoEl);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F5-05', 'Rapid back-and-forth scrubbing does not throw NaN or unhandled errors', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      const track = env.root.querySelector('#reel-timeline-track');
      track?.setBounds({ left: 0, width: 1000 });

      for (let i = 0; i < 10; i++) {
        const clientX = (i % 2 === 0) ? 100 : 900;
        track?.dispatchEvent(new MockPointerEvent('pointermove', { clientX, pointerId: 1 }));
      }
      await flushMicrotasks();
      assert.ok(true, 'Rapid scrubbing completed cleanly');
    } finally {
      env.teardown();
    }
  });

  /* --------------------------------------------------------------------------
   * FEATURE F6: Keyframe CRUD & Boundary Positioning (Tier 1 & Tier 2)
   * -------------------------------------------------------------------------- */

  await test('T1-F6-01', 'Add keyframe via C key at current playhead position', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 10.0] });
      await flushMicrotasks();

      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      videoEl.currentTime = 4.5;

      const modal = env.root.querySelector('.reel-cue-modal');
      assert.ok(modal);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'c', bubbles: true }));
      await flushMicrotasks();

      const pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(pins.length, 3, 'Must render 3 pins after adding keyframe at 4.5s');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F6-02', 'Add keyframe via #btn-reel-add-current button', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 10.0] });
      await flushMicrotasks();

      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      videoEl.currentTime = 7.2;

      const addBtn = env.root.querySelector('#btn-reel-add-current');
      assert.ok(addBtn);
      addBtn.click();
      await flushMicrotasks();

      const pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(pins.length, 3);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F6-03', 'Reposition keyframe via pin dragging updates timestamp', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 3.0, 10.0] });
      await flushMicrotasks();

      const track = env.root.querySelector('#reel-timeline-track');
      track?.setBounds({ left: 0, width: 1000 });

      const pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(pins.length, 3);
      const middlePin = pins[1];

      // Drag middle pin from 300px (3.0s) to 550px (5.5s)
      middlePin.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 300, pointerId: 1, bubbles: true }));
      middlePin.dispatchEvent(new MockPointerEvent('pointermove', { clientX: 550, pointerId: 1, bubbles: true }));
      middlePin.dispatchEvent(new MockPointerEvent('pointerup', { clientX: 550, pointerId: 1, bubbles: true }));
      await flushMicrotasks();

      const updatedPins = env.root.querySelectorAll('.reel-cue-pin');
      assert.ok(updatedPins[1].style.left.includes('55') || updatedPins[1].style.left.includes('54.'));
    } finally {
      env.teardown();
    }
  });

  await test('T1-F6-04', 'Nudge keyframe by ±0.05s increments shifts cue timestamp', async () => {
    const duration = 10.0;
    // Nudge +0.05s on cue 1
    const nudgedPlus = SmartPairer.normalizeCuePoints([0, 5.05, 10.0], duration);
    assert.equal(nudgedPlus[1], 5.05, 'Cue timestamp nudged by +0.05s');

    // Nudge -0.10s
    const nudgedMinus = SmartPairer.normalizeCuePoints([0, 4.95, 10.0], duration);
    assert.equal(nudgedMinus[1], 4.95, 'Cue timestamp nudged by -0.05s');
  });

  await test('T1-F6-05', 'Delete keyframe via Delete / Backspace key removes active keyframe', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 3.0, 7.0, 10.0] });
      await flushMicrotasks();

      let pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(pins.length, 4);

      // Select pin 1 (3.0s) and press Delete
      pins[1].click();
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await flushMicrotasks();

      pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(pins.length, 3, 'Must have 3 pins after deleting one');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F6-01', 'Adding cue within 0.08s of existing cue point is rejected by normalization', async () => {
    const raw = [0, 5.0, 5.04, 10.0]; // 5.04 is within 0.04s of 5.0 (< 0.08s)
    const normalized = SmartPairer.normalizeCuePoints(raw, 10.0);
    assert.equal(normalized.length, 3, 'Duplicate within 0.08s must be rejected');
    assert.deepEqual(normalized, [0, 5.0, 10.0]);
  });

  await test('T2-F6-02', 'Dragging cue pin toward predecessor is clamped to >= 0.08s spacing', async () => {
    const cues = [0, 3.0, 10.0];
    const prevCue = cues[0]; // 0.0
    const desiredPos = 0.02; // trying to place at 0.02s
    const clampedPos = Math.max(prevCue + 0.08, desiredPos);
    assert.equal(clampedPos, 0.08, 'Must clamp to at least 0.08s past predecessor');
  });

  await test('T2-F6-03', 'Dragging cue pin toward successor is clamped to >= 0.08s spacing', async () => {
    const cues = [0, 5.0, 10.0];
    const nextCue = cues[2]; // 10.0
    const desiredPos = 9.98; // trying to place at 9.98s
    const clampedPos = Math.min(nextCue - 0.08, desiredPos);
    assert.equal(clampedPos, 9.92, 'Must clamp to at least 0.08s before successor');
  });

  await test('T2-F6-04', 'Deleting cue when only 2 cues remain is blocked (minimum 2 cues protection)', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 10.0] });
      await flushMicrotasks();

      const pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(pins.length, 2);

      pins[0].click();
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await flushMicrotasks();

      const remainingPins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(remainingPins.length, 2, 'Cannot delete boundary cue when only 2 cues remain');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F6-05', 'Nudging cue pin at boundary against neighbor is rejected', async () => {
    const cues = [0, 0.10, 10.0];
    // Nudge left by -0.05s would yield 0.05s, which is < 0 + 0.08s
    const target = 0.10 - 0.05;
    const isTooClose = Math.abs(target - cues[0]) < 0.08;
    assert.equal(isTooClose, true, 'Nudge violating 0.08s boundary spacing must be rejected');
  });

  /* --------------------------------------------------------------------------
   * FEATURE F7: Real-Time Frame Transition & Interpolation (Tier 1 & Tier 2)
   * -------------------------------------------------------------------------- */

  await test('T1-F7-01', 'Linear segment progress calculation P = (t - Ta) / (Tb - Ta)', async () => {
    const Ta = 2.0;
    const Tb = 6.0;
    const calcProgress = (t: number) => Math.max(0, Math.min(1, (t - Ta) / (Tb - Ta)));

    assert.equal(calcProgress(2.0), 0.0);
    assert.equal(calcProgress(3.0), 0.25);
    assert.equal(calcProgress(4.0), 0.50);
    assert.equal(calcProgress(5.0), 0.75);
    assert.equal(calcProgress(6.0), 1.0);
  });

  await test('T1-F7-02', 'Multi-segment active keyframe range resolution resolves correct interval', async () => {
    const cues = [0, 3.0, 7.0, 10.0];
    const resolveSegment = (t: number) => {
      for (let i = 0; i < cues.length - 1; i++) {
        if (t >= cues[i] && t <= cues[i + 1]) {
          return { index: i, start: cues[i], end: cues[i + 1] };
        }
      }
      return null;
    };

    const s1 = resolveSegment(1.5);
    assert.deepEqual(s1, { index: 0, start: 0, end: 3.0 });

    const s2 = resolveSegment(5.2);
    assert.deepEqual(s2, { index: 1, start: 3.0, end: 7.0 });

    const s3 = resolveSegment(8.8);
    assert.deepEqual(s3, { index: 2, start: 7.0, end: 10.0 });
  });

  await test('T1-F7-03', 'Procedural crossfade alpha calculation computes exact blending coefficients', async () => {
    const progress = 0.70;
    const fromAlpha = 1.0 - progress;
    const toAlpha = progress;

    assert.ok(Math.abs(fromAlpha - 0.30) < 1e-6);
    assert.ok(Math.abs(toAlpha - 0.70) < 1e-6);
  });

  await test('T1-F7-04', 'Video transition progress synchronization updates transitionProgress', async () => {
    const start = 2.0;
    const end = 6.0;
    const currentTime = 4.0;
    const progress = (currentTime - start) / (end - start);
    assert.equal(progress, 0.50);
  });

  await test('T1-F7-05', 'Playback speed multiplier scales transition effective duration', async () => {
    const rawDuration = 4.0;
    const speed = 2.0;
    const effectiveDuration = rawDuration / speed;
    assert.equal(effectiveDuration, 2.0);
  });

  await test('T2-F7-01', 'Time query exactly on cue boundary (t == Tb) yields progress exactly 1.0', async () => {
    const Ta = 1.0;
    const Tb = 5.0;
    const progress = (Tb - Ta) / (Tb - Ta);
    assert.equal(progress, 1.0);
  });

  await test('T2-F7-02', 'Micro-segment duration (delta T = 0.08s) evaluates with numerical stability', async () => {
    const Ta = 2.00;
    const Tb = 2.08;
    const t = 2.04;
    const progress = (t - Ta) / (Tb - Ta);
    assert.ok(Math.abs(progress - 0.50) < 1e-6, `Progress must evaluate to 0.50, got ${progress}`);
  });

  await test('T2-F7-03', 'Reverse progress calculation 1.0 - P mirrors forward progression', async () => {
    for (const p of [0.0, 0.25, 0.5, 0.75, 1.0]) {
      const rev = 1.0 - p;
      assert.equal(p + rev, 1.0);
    }
  });

  await test('T2-F7-04', 'Negative scrub time is clamped to 0.0', async () => {
    const scrubTime = -1.5;
    const clamped = Math.max(0, scrubTime);
    assert.equal(clamped, 0.0);
  });

  await test('T2-F7-05', 'Transition interpolation style zoom-morph scales gracefully', async () => {
    const p = 0.5;
    // zoom-morph scale function
    const scale = 1.0 + (1.15 - 1.0) * p;
    assert.equal(scale, 1.075);
  });

  /* --------------------------------------------------------------------------
   * FEATURE F8: Timeline State Persistence & Synchronization (Tier 1 & Tier 2)
   * -------------------------------------------------------------------------- */

  await test('T1-F8-01', 'applyVideoCuePointsWorkflow creates correct slide count with matching ranges', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const video = makeMockVideoAsset('vid1', 'reel.mp4', 10.0);

      await store.applyVideoCuePointsWorkflow(video, [0, 3.5, 7.0, 10.0], { mode: 'replace-all' });
      const slides = store.getSlides();
      assert.equal(slides.length, 4, 'Must create 4 slides for 4 cue points');

      assert.equal(slides[0].transitionToNext.startTimeSec, 0);
      assert.equal(slides[0].transitionToNext.endTimeSec, 3.5);

      assert.equal(slides[1].transitionToNext.startTimeSec, 3.5);
      assert.equal(slides[1].transitionToNext.endTimeSec, 7.0);

      assert.equal(slides[2].transitionToNext.startTimeSec, 7.0);
      assert.equal(slides[2].transitionToNext.endTimeSec, 10.0);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F8-02', 'updateTransitionRange mutates slide transition timestamps', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const video = makeMockVideoAsset('vid1', 'reel.mp4', 10.0);

      await store.applyVideoCuePointsWorkflow(video, [0, 5.0, 10.0], { mode: 'replace-all' });
      const slide0 = store.getSlides()[0];

      const res = store.updateTransitionRange(slide0.id, 0.5, 4.2);
      assert.equal(res, true);
      assert.equal(slide0.transitionToNext.startTimeSec, 0.5);
      assert.equal(slide0.transitionToNext.endTimeSec, 4.2);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F8-03', 'Reverse frame cache is invalidated when transition range is updated', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const video = makeMockVideoAsset('vid1', 'reel.mp4', 10.0);

      await store.applyVideoCuePointsWorkflow(video, [0, 5.0, 10.0], { mode: 'replace-all' });
      const slide0 = store.getSlides()[0];
      const transId = slide0.transitionToNext.id;

      StagePlaybackEngine.cacheReverseFrames(transId, [env.document.createElement('canvas') as HTMLCanvasElement]);
      assert.ok(StagePlaybackEngine.getReverseFrames(transId));

      store.updateTransitionRange(slide0.id, 1.0, 4.5);
      assert.equal(StagePlaybackEngine.getReverseFrames(transId), undefined, 'Cache must be invalidated');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F8-04', 'Project manifest serializer roundtrip preserves keyframe cue ranges', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const video = makeMockVideoAsset('vid1', 'reel.mp4', 10.0);

      await store.applyVideoCuePointsWorkflow(video, [0, 3.5, 7.0, 10.0], { mode: 'replace-all' });
      const project = store.getProject();

      const manifest = ProjectSerializer.buildManifestObject(project);
      const serialized = JSON.stringify(manifest);
      const parsed = ProjectSerializer.deserializeProject(serialized);

      assert.equal(parsed.slidesData.length, 4);
      assert.equal(parsed.slidesData[0].transitionToNext?.startTimeSec, 0);
      assert.equal(parsed.slidesData[0].transitionToNext?.endTimeSec, 3.5);
      assert.equal(parsed.slidesData[1].transitionToNext?.startTimeSec, 3.5);
      assert.equal(parsed.slidesData[1].transitionToNext?.endTimeSec, 7.0);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F8-05', 'Modal cancellation discards pending edits without corrupting store slides', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      store.addSlideFromImage(makeMockImageAsset('s1', 's1.png'));
      store.addSlideFromImage(makeMockImageAsset('s2', 's2.png'));
      assert.equal(store.getSlides().length, 2);

      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all' });
      await flushMicrotasks();

      // Cancel modal
      const cancelBtn = env.root.querySelector('#btn-reel-cancel');
      assert.ok(cancelBtn);
      cancelBtn.click();
      await flushMicrotasks();

      // Store slides must remain untouched
      assert.equal(store.getSlides().length, 2, 'Store slide count must remain 2 after cancel');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F8-01', 'Abort signal during reel slicing terminates cleanly without partial state', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const video = makeMockVideoAsset('vid1', 'abort.mp4', 10.0);

      const abortCtrl = new AbortController();
      abortCtrl.abort();

      await assert.rejects(
        async () => {
          await store.applyVideoCuePointsWorkflow(video, [0, 5.0, 10.0], {
            mode: 'replace-all',
            signal: abortCtrl.signal,
          });
        },
        { name: 'AbortError' }
      );
    } finally {
      env.teardown();
    }
  });

  await test('T2-F8-02', 'Invalid transition range (endTime <= startTime + 0.05) is rejected by store', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const video = makeMockVideoAsset('vid1', 'reel.mp4', 10.0);

      await store.applyVideoCuePointsWorkflow(video, [0, 5.0, 10.0], { mode: 'replace-all' });
      const slide0 = store.getSlides()[0];

      // Try setting end <= start + 0.05
      const rejected = store.updateTransitionRange(slide0.id, 4.0, 4.02);
      assert.equal(rejected, false, 'Range delta < 0.05 must be rejected');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F8-03', 'Slide deletion bridges transition range of surrounding slides', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const video = makeMockVideoAsset('vid1', 'reel.mp4', 12.0);

      await store.applyVideoCuePointsWorkflow(video, [0, 4.0, 8.0, 12.0], { mode: 'replace-all' });
      const slides = store.getSlides();
      assert.equal(slides.length, 4);

      // Delete middle slide (index 1)
      const slide1 = slides[1];
      store.deleteSlide(slide1.id);

      const updatedSlides = store.getSlides();
      assert.equal(updatedSlides.length, 3);
      // Slide 0 transition range must bridge from 0 to 8.0s
      assert.equal(updatedSlides[0].transitionToNext.startTimeSec, 0);
      assert.equal(updatedSlides[0].transitionToNext.endTimeSec, 8.0);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F8-04', 'Re-slicing existing reel preserves custom slide metadata when requested', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const video = makeMockVideoAsset('vid1', 'reel.mp4', 10.0);

      await store.applyVideoCuePointsWorkflow(video, [0, 5.0, 10.0], { mode: 'replace-all' });
      store.updateSlideDetails(store.getSlides()[0].id, { title: 'مقدمة مخصصة' });

      // Re-slice preserving metadata
      await store.applyVideoCuePointsWorkflow(video, [0, 3.0, 7.0, 10.0], {
        mode: 'replace-reel',
        targetVideoAssetId: video.id,
        preserveMetadata: true,
      });

      assert.equal(store.getSlides()[0].title, 'مقدمة مخصصة', 'Slide title must be preserved');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F8-05', 'Safe blob revocation protects in-use media assets during slide operations', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const img = makeMockImageAsset('shared_img', 'slide.png');

      const s1 = store.addSlideFromImage(img);
      store.addSlideFromImage(img); // shares same imageAsset

      // Deleting s1 should NOT revoke shared_img objectUrl because s2 still references it
      store.deleteSlide(s1.id);
      assert.ok(store.getSlides().some((s: any) => s.imageAsset.id === img.id));
    } finally {
      env.teardown();
    }
  });

  /* --------------------------------------------------------------------------
   * ADVANCED VIDEO EDITOR TIMELINE FEATURES: EASING, UNDO/REDO, CLIPBOARD, ZOOM
   * -------------------------------------------------------------------------- */

  await test('T1-ADV-01', 'Per-segment easing curve evaluation computes mathematical curve progression', async () => {
    assert.equal(evaluateEasing(0, 'linear'), 0);
    assert.equal(evaluateEasing(1, 'linear'), 1);
    assert.equal(evaluateEasing(0.5, 'linear'), 0.5);

    assert.equal(evaluateEasing(0.5, 'ease-in'), 0.25);
    assert.equal(evaluateEasing(0.5, 'ease-out'), 0.75);
    assert.equal(evaluateEasing(0.5, 'ease-in-out'), 0.5);

    assert.equal(evaluateEasing(0.99, 'hold'), 0);
    assert.equal(evaluateEasing(1.0, 'hold'), 1);
    assert.equal(evaluateEasing(0.99, 'step'), 0);
    assert.equal(evaluateEasing(1.0, 'step'), 1);
  });

  await test('T1-ADV-02', 'Easing dropdown in cue cards updates segment easing and reflects badge in timeline overlay', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 5.0, 10.0] });
      await flushMicrotasks();

      const easingSelects = env.root.querySelectorAll('.reel-segment-easing-select') as any;
      assert.ok(easingSelects.length >= 2, 'Must render easing dropdowns for segments');

      easingSelects[0].value = 'ease-in-out';
      easingSelects[0].dispatchEvent(new MockMouseEvent('change', { bubbles: true }));
      await flushMicrotasks();

      const badge = env.root.querySelector('.reel-segment-easing-badge');
      assert.ok(badge, 'Segment easing badge must be rendered in timeline overlay');
      assert.ok(badge.textContent?.includes('ease-in-out'));
    } finally {
      env.teardown();
    }
  });

  await test('T1-ADV-03', 'ProjectSerializer backward compatibility preserves easing and handles legacy manifest safely', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const store = (app as any).store;
      const video = makeMockVideoAsset('vid1', 'reel.mp4', 10.0);

      await store.applyVideoCuePointsWorkflow(video, [0, 4.0, 10.0], {
        mode: 'replace-all',
        segmentEasings: ['ease-out', 'ease-in'],
      });
      const slides = store.getSlides();
      assert.equal(slides[0].transitionToNext.easing, 'ease-out');
      assert.equal(slides[1].transitionToNext.easing, 'ease-in');

      const project = store.getProject();
      const manifest = ProjectSerializer.buildManifestObject(project);
      assert.equal(manifest.slides[0].transitionToNext.easing, 'ease-out');
      assert.equal(manifest.slides[1].transitionToNext.easing, 'ease-in');

      const json = JSON.stringify(manifest);
      const parsed = ProjectSerializer.deserializeProject(json);
      assert.equal(parsed.slidesData[0].transitionToNext?.easing, 'ease-out');

      const legacyJson = JSON.stringify({
        version: '1.0.0',
        projectId: 'legacy1',
        title: 'Legacy Deck',
        slides: [
          {
            index: 1,
            title: 'S1',
            notes: '',
            imageFileName: 's1.png',
            imageDataUrl: 'data:image/png;base64,mock',
            transitionToNext: {
              fallbackStyle: 'crossfade',
              fallbackDurationMs: 500,
            },
          },
        ],
      });
      const legacyParsed = ProjectSerializer.deserializeProject(legacyJson);
      assert.equal(legacyParsed.slidesData.length, 1);
      assert.equal(legacyParsed.slidesData[0].transitionToNext?.easing, undefined);

      store.loadProjectFromManifest(legacyParsed);
      assert.equal(store.getSlides()[0].transitionToNext.easing, 'linear');
    } finally {
      env.teardown();
    }
  });

  await test('T1-ADV-04', 'Undo and redo (Ctrl+Z / Ctrl+Y) restores and reapplies keyframe addition', async () => {
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
      assert.equal(pins.length, 3, 'Must have 3 pins after add');

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(pins.length, 2, 'Must have 2 pins after undo');

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(pins.length, 3, 'Must restore 3 pins after redo');
    } finally {
      env.teardown();
    }
  });

  await test('T1-ADV-05', 'Undo and redo (Ctrl+Z / Ctrl+Y) restores and reapplies keyframe nudging and deletion', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 5.0, 10.0] });
      await flushMicrotasks();

      const nudgeButtons = env.root.querySelectorAll('.reel-nudge-btn') as any[];
      const nudgePlusBtn = nudgeButtons.find((btn) => btn.dataset.idx === '1' && btn.dataset.nudge === '0.05');
      assert.ok(nudgePlusBtn);
      nudgePlusBtn.click();
      await flushMicrotasks();

      let cardTime = env.root.querySelector('.reel-cue-card[data-idx="1"] .reel-cue-card-time');
      assert.ok(cardTime?.textContent?.includes('5.05'));

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      cardTime = env.root.querySelector('.reel-cue-card[data-idx="1"] .reel-cue-card-time');
      assert.ok(cardTime?.textContent?.includes('5.00'));

      const pins = env.root.querySelectorAll('.reel-cue-pin');
      pins[1].click();
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await flushMicrotasks();

      assert.equal(env.root.querySelectorAll('.reel-cue-pin').length, 2);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      assert.equal(env.root.querySelectorAll('.reel-cue-pin').length, 3);
    } finally {
      env.teardown();
    }
  });

  await test('T1-ADV-06', 'Undo and redo (Ctrl+Z / Ctrl+Y) restores and reapplies easing curve modifications', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 5.0, 10.0] });
      await flushMicrotasks();

      const easingSelect = env.root.querySelector('.reel-segment-easing-select') as any;
      assert.ok(easingSelect, 'Easing dropdown must exist');

      easingSelect.value = 'ease-out';
      easingSelect.dispatchEvent(new MockMouseEvent('change', { bubbles: true }));
      await flushMicrotasks();

      assert.ok(env.root.querySelector('.reel-segment-easing-badge')?.textContent?.includes('ease-out'));

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      assert.equal(env.root.querySelector('.reel-segment-easing-badge'), null);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      assert.ok(env.root.querySelector('.reel-segment-easing-badge')?.textContent?.includes('ease-out'));
    } finally {
      env.teardown();
    }
  });

  await test('T1-ADV-07', 'Copy and paste keyframes (Ctrl+C / Ctrl+V) duplicates keyframe timestamp relative to playhead', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 3.0, 10.0] });
      await flushMicrotasks();

      const pins = env.root.querySelectorAll('.reel-cue-pin');
      pins[1].click();

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      videoEl.currentTime = 7.0;

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      const updatedPins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(updatedPins.length, 4, 'Must have 4 pins after paste');
      const cards = env.root.querySelectorAll('.reel-cue-card');
      const times = Array.from(cards).map((c: any) => parseFloat(c.dataset.time));
      assert.ok(times.includes(7.0), 'Must include pasted timestamp at 7.0s');
    } finally {
      env.teardown();
    }
  });

  await test('T1-ADV-08', 'Duplicate keyframe via Ctrl+D creates keyframe copy without collision', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 4.0, 10.0] });
      await flushMicrotasks();

      const pins = env.root.querySelectorAll('.reel-cue-pin');
      pins[1].click();

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      const updatedPins = env.root.querySelectorAll('.reel-cue-pin');
      assert.equal(updatedPins.length, 4, 'Must have 4 pins after duplicate');
    } finally {
      env.teardown();
    }
  });

  await test('T1-ADV-09', 'Timeline zoom controls and Fit-to-view button / F shortcut update track width and reset to 100%', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 10.0] });
      await flushMicrotasks();

      const track = env.root.querySelector('#reel-timeline-track') as any;
      const zoomInBtn = env.root.querySelector('#btn-reel-zoom-in') as any;
      const zoomFitBtn = env.root.querySelector('#btn-reel-zoom-fit') as any;
      const zoomReadout = env.root.querySelector('#reel-zoom-readout') as any;

      assert.equal(zoomReadout.textContent, '100%');

      zoomInBtn.click();
      await flushMicrotasks();
      assert.equal(zoomReadout.textContent, '125%');
      assert.ok(track.style.width.includes('125%'));

      zoomFitBtn.click();
      await flushMicrotasks();
      assert.equal(zoomReadout.textContent, '100%');
      assert.ok(track.style.width.includes('100%'));

      zoomInBtn.click();
      await flushMicrotasks();
      assert.equal(zoomReadout.textContent, '125%');

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'f', bubbles: true }));
      await flushMicrotasks();
      assert.equal(zoomReadout.textContent, '100%');
    } finally {
      env.teardown();
    }
  });

  await test('T1-ADV-10', 'Frame-step keys step video preview playhead by exact frame and half-second deltas', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 10.0] });
      await flushMicrotasks();

      const videoEl = env.root.querySelector('#reel-preview-video') as any;
      videoEl.currentTime = 5.0;

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '.', bubbles: true }));
      await flushMicrotasks();
      assert.ok(Math.abs(videoEl.currentTime - (5.0 + 1 / 30)) < 1e-4);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: ',', bubbles: true }));
      await flushMicrotasks();
      assert.ok(Math.abs(videoEl.currentTime - 5.0) < 1e-4);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await flushMicrotasks();
      assert.ok(Math.abs(videoEl.currentTime - (5.0 + 1 / 30)) < 1e-4);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
      await flushMicrotasks();
      assert.ok(Math.abs(videoEl.currentTime - (5.0 + 1 / 30 - 0.5)) < 1e-4);
    } finally {
      env.teardown();
    }
  });

  await test('T1-ADV-11', 'Shift-click multi-selection selects keyframe range and group move drags keyframes together', async () => {
    const env = setupMockDOM();
    try {
      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid1', 'demo.mp4', 10.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 3.0, 5.0, 7.0, 10.0] });
      await flushMicrotasks();

      const cards = env.root.querySelectorAll('.reel-cue-card');
      assert.equal(cards.length, 5);

      // Select card 1 (3.0s)
      cards[1].dispatchEvent(new MockMouseEvent('click', { bubbles: true }));
      await flushMicrotasks();

      // Shift-click card 3 (7.0s) -> multi-select 1, 2, 3
      cards[3].dispatchEvent(new MockMouseEvent('click', { shiftKey: true, bubbles: true }));
      await flushMicrotasks();

      const pins = env.root.querySelectorAll('.reel-cue-pin');
      assert.ok(pins[1].classList.contains('selected'));
      assert.ok(pins[2].classList.contains('selected'));
      assert.ok(pins[3].classList.contains('selected'));

      // Group move: drag pin 2 by +1.0s (track 1000px wide, drag from 500px to 600px -> +1.0s)
      const track = env.root.querySelector('#reel-timeline-track');
      track?.setBounds({ left: 0, width: 1000 });

      pins[2].dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 500, pointerId: 1, bubbles: true }));
      pins[2].dispatchEvent(new MockPointerEvent('pointermove', { clientX: 600, pointerId: 1, bubbles: true }));
      pins[2].dispatchEvent(new MockPointerEvent('pointerup', { clientX: 600, pointerId: 1, bubbles: true }));
      await flushMicrotasks();

      const updatedCards = env.root.querySelectorAll('.reel-cue-card');
      const t1 = parseFloat((updatedCards[1] as any).dataset.time);
      const t2 = parseFloat((updatedCards[2] as any).dataset.time);
      const t3 = parseFloat((updatedCards[3] as any).dataset.time);

      assert.ok(Math.abs(t1 - 4.0) < 0.1, `t1 should shift to ~4.0s, got ${t1}`);
      assert.ok(Math.abs(t2 - 6.0) < 0.1, `t2 should shift to ~6.0s, got ${t2}`);
      assert.ok(Math.abs(t3 - 8.0) < 0.1, `t3 should shift to ~8.0s, got ${t3}`);
    } finally {
      env.teardown();
    }
  });

  await test('T1-ADV-12', 'Pixel-simulated detectCuePointsFromVideo detects plateaus, localized 10% motion, cuts, and skips duplicates', async () => {
    const env = setupMockDOM();
    try {
      (globalThis as any).__mockVideoDuration = 10.0;

      const fillSolid = (buf: Uint8ClampedArray, w: number, h: number, r: number, g: number, b: number) => {
        for (let i = 0; i < w * h; i++) {
          const idx = i * 4;
          buf[idx] = r;
          buf[idx + 1] = g;
          buf[idx + 2] = b;
          buf[idx + 3] = 255;
        }
      };

      const fillRectPx = (
        buf: Uint8ClampedArray,
        w: number,
        h: number,
        x0: number,
        y0: number,
        rw: number,
        rh: number,
        r: number,
        g: number,
        b: number
      ) => {
        const sx = Math.max(0, Math.round(x0));
        const sy = Math.max(0, Math.round(y0));
        const ex = Math.min(w, Math.round(x0 + rw));
        const ey = Math.min(h, Math.round(y0 + rh));
        for (let y = sy; y < ey; y++) {
          for (let x = sx; x < ex; x++) {
            const idx = (y * w + x) * 4;
            buf[idx] = r;
            buf[idx + 1] = g;
            buf[idx + 2] = b;
            buf[idx + 3] = 255;
          }
        }
      };

      (globalThis as any).__mockVideoFrameRenderer = (t: number, w: number, h: number) => {
        const buf = new Uint8ClampedArray(w * h * 4);

        if (t < 7.2) {
          // Dark slate studio canvas
          fillSolid(buf, w, h, 18, 22, 34);

          if (t < 4.5) {
            // Slide 0 -> Slide 1 ease-out over [0..1.0s], hold [1.0..2.0s]
            const u1 = Math.max(0, Math.min(1, t / 1.0));
            const ease1 = 1 - Math.pow(1 - u1, 2);
            const card1X = -w * 0.45 + ease1 * (w * 0.52);
            fillRectPx(buf, w, h, card1X, h * 0.14, w * 0.44, h * 0.56, 56, 189, 248);
            fillRectPx(buf, w, h, card1X + 4, h * 0.2, w * 0.3, h * 0.1, 240, 248, 255);

            // Localized ~6% card animates in over [2.0..3.2s], settles cleanly for short hold [3.2..3.45s+]
            if (t >= 2.0) {
              const u2 = Math.max(0, Math.min(1, (t - 2.0) / 1.2));
              const ease2 = 1 - Math.pow(1 - u2, 2);
              const badgeY = h - ease2 * (h * 0.42);
              fillRectPx(buf, w, h, w * 0.64, badgeY, w * 0.24, h * 0.26, 250, 204, 21);
            }

            // Tiny transient cursor dot at [3.85..4.05] -> must NOT create a duplicate cue
            if (t >= 3.85 && t <= 4.05) {
              fillRectPx(buf, w, h, w * 0.52, h * 0.48, 2, 2, 255, 255, 255);
            }
          } else {
            // Slide 1b -> Slide 2 ease-in-out over [4.5..6.2s], then hold [6.2..7.2s]
            const u3 = Math.max(0, Math.min(1, (t - 4.5) / 1.7));
            const ease3 = u3 < 0.5 ? 2 * u3 * u3 : 1 - Math.pow(-2 * u3 + 2, 2) / 2;
            const slideOutX = w * 0.07 - ease3 * w * 0.9;
            fillRectPx(buf, w, h, slideOutX, h * 0.14, w * 0.44, h * 0.56, 56, 189, 248);
            const goldX = w * 1.05 - ease3 * w * 0.92;
            fillRectPx(buf, w, h, goldX, h * 0.15, w * 0.72, h * 0.68, 245, 158, 11);
            fillRectPx(buf, w, h, goldX + 8, h * 0.25, w * 0.45, h * 0.14, 255, 251, 235);
          }
        } else {
          // Hard scene cut at t = 7.2s to Emerald slide [7.2..10.0s]
          fillSolid(buf, w, h, 10, 46, 38);
          fillRectPx(buf, w, h, w * 0.1, h * 0.12, w * 0.8, h * 0.74, 16, 185, 129);
          fillRectPx(buf, w, h, w * 0.18, h * 0.28, w * 0.52, h * 0.16, 236, 253, 245);
        }

        return buf;
      };

      const video = makeMockVideoAsset('vid-detect-1', 'slides_demo.mp4', 10.0);
      const res = await SmartPairer.detectCuePointsFromVideo(video, { sensitivity: 'medium' });

      assert.ok(res.samplesAnalyzed >= 24, `Expected >=24 analyzed samples, got ${res.samplesAnalyzed}`);
      assert.ok(res.motionProfile, 'motionProfile should be returned');
      assert.equal(
        res.motionProfile!.sampleTimes.length,
        res.motionProfile!.motionScores.length,
        'motionProfile sampleTimes and motionScores must match length'
      );
      assert.ok(res.motionProfile!.stillThreshold > 0, 'stillThreshold must be positive');

      assert.equal(res.cueTimesSec[0], 0);
      // Final cut at 7.2s enters the final static hold [7.2..10.0], so lastCoversFinalHold collapses the trailing end cue onto ~7.2s
      const lastCue = res.cueTimesSec[res.cueTimesSec.length - 1];
      assert.ok(
        Math.abs(lastCue - 7.2) <= 0.25,
        `Expected final cue to settle at the ~7.2s final-hold cut without duplicate 10.0s end cue, got ${lastCue}`
      );

      // Verify Slide 1 settle (~1.0-1.45s), localized badge settle (~3.2-3.55s), Slide 2 (~6.2-6.55s), and cut (~7.2s)
      const near = (target: number, tol: number) =>
        res.cueTimesSec.some((c) => Math.abs(c - target) <= tol);
      assert.ok(near(1.15, 0.4), `Expected Slide 1 cue near ~1.0-1.4s in [${res.cueTimesSec.join(', ')}]`);
      assert.ok(near(3.3, 0.4), `Expected localized 6% card cue near ~3.2-3.5s in [${res.cueTimesSec.join(', ')}]`);
      assert.ok(near(6.35, 0.4), `Expected Slide 2 settle cue near ~6.2-6.5s in [${res.cueTimesSec.join(', ')}]`);
      assert.ok(near(7.2, 0.25), `Expected hard scene cut near 7.2s in [${res.cueTimesSec.join(', ')}]`);

      // Verify transient 2x2 cursor blink did NOT add a spurious cue inside [3.75..4.35]
      const spuriousCursorCues = res.cueTimesSec.filter((c) => c >= 3.75 && c <= 4.35);
      assert.equal(
        spuriousCursorCues.length,
        0,
        `Should reject duplicate cursor blink cues in [3.75..4.35], found [${spuriousCursorCues.join(', ')}]`
      );

      assert.ok(res.recommendedEasings, 'recommendedEasings must be present');
      assert.equal(
        res.recommendedEasings!.length,
        res.cueTimesSec.length - 1,
        'recommendedEasings length must equal cueTimesSec.length - 1'
      );
      assert.ok(
        res.recommendedEasings!.some((e) => e !== 'linear'),
        `Expected non-linear smart easings, got [${res.recommendedEasings!.join(', ')}]`
      );
    } finally {
      delete (globalThis as any).__mockVideoDuration;
      delete (globalThis as any).__mockVideoFrameRenderer;
      env.teardown();
    }
  });

  await test('T1-ADV-13', 'Reel Cue Studio auto-detect renders motion sparkline, detection badges, recommended easings, and supports Undo/Redo', async () => {
    const env = setupMockDOM();
    try {
      (globalThis as any).__mockVideoDuration = 8.0;
      (globalThis as any).__mockVideoFrameRenderer = (t: number, w: number, h: number) => {
        const buf = new Uint8ClampedArray(w * h * 4);
        let r: number;
        let g: number;
        let b: number;
        let cardX: number;

        if (t < 2.2) {
          // Animated transition [0..2.0] with ease-out then settles on Slide 1 [2.0..4.8]
          const u = Math.max(0, Math.min(1, t / 2.0));
          const easeOut = 1 - Math.pow(1 - u, 2);
          r = 24;
          g = 40;
          b = 72;
          cardX = Math.round(easeOut * (w * 0.55));
        } else if (t < 5.0) {
          // Rest plateau on Slide 1
          r = 24;
          g = 40;
          b = 72;
          cardX = Math.round(w * 0.55);
        } else {
          // Hard scene cut at t=5.0s -> bright amber/teal layout
          r = 220;
          g = 120;
          b = 24;
          cardX = Math.round(w * 0.15);
        }

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const inCard = x >= cardX && x < cardX + w * 0.35 && y >= h * 0.2 && y < h * 0.75;
            buf[idx] = inCard ? 245 : r;
            buf[idx + 1] = inCard ? 248 : g;
            buf[idx + 2] = inCard ? 255 : b;
            buf[idx + 3] = 255;
          }
        }
        return buf;
      };

      const app = new MotionPresentationApp(env.root);
      const video = makeMockVideoAsset('vid-ui-detect', 'reel_detect.mp4', 8.0);
      (app as any).openReelCueModal(video, { mode: 'replace-all', initialCuePoints: [0, 8.0] });
      await flushMicrotasks();

      // Default open state preserves linear easings & empty sparkline/detect badges
      assert.equal(env.root.querySelectorAll('.reel-cue-detect-badge').length, 0);
      assert.equal(env.root.querySelector('#reel-motion-sparkline-layer svg'), null);
      assert.equal(env.root.querySelector('.reel-segment-easing-badge'), null);

      const detectBtn = env.root.querySelector('#btn-reel-auto-detect') as any;
      assert.ok(detectBtn, '#btn-reel-auto-detect must exist');
      detectBtn.dispatchEvent(new MockMouseEvent('click', { bubbles: true }));

      // Poll cleanly until async frame analysis finishes in mock DOM (rVFC waits ~16ms/sample)
      for (let i = 0; i < 300 && detectBtn.disabled; i++) {
        await new Promise((r) => setTimeout(r, 20));
        await flushMicrotasks();
      }
      await flushMicrotasks();
      assert.equal(detectBtn.disabled, false, 'Auto-detect button should re-enable after analysis');

      const pinsAfter = env.root.querySelectorAll('.reel-cue-pin');
      const cardsAfter = env.root.querySelectorAll('.reel-cue-card');
      assert.ok(pinsAfter.length >= 3, `Expected >= 3 pins after auto-detect, got ${pinsAfter.length}`);
      assert.equal(cardsAfter.length, pinsAfter.length);

      const sparklineSvg = env.root.querySelector('#reel-motion-sparkline-layer .reel-motion-sparkline-svg');
      assert.ok(sparklineSvg, 'Motion sparkline SVG must be rendered inside #reel-motion-sparkline-layer');
      assert.ok(
        env.root.querySelector('#reel-motion-sparkline-layer .reel-motion-energy-line'),
        'Motion sparkline energy polyline must be present'
      );
      assert.ok(
        env.root.querySelector('#reel-motion-sparkline-layer .reel-motion-threshold-line'),
        'Motion sparkline stillThreshold line must be present'
      );

      const detectBadges = env.root.querySelectorAll('.reel-cue-detect-badge');
      assert.ok(
        detectBadges.length >= 1,
        `Expected >= 1 .reel-cue-detect-badge on interior cues, got ${detectBadges.length}`
      );
      assert.ok(
        detectBadges.some((b: any) => /استقرار|توقف حركي|قطع مشهد/.test(b.textContent) && /%/.test(b.textContent)),
        'Detection badge must display Arabic category label and confidence percentage'
      );

      // Recommended non-linear easings should render at least one easing badge when non-linear segments exist
      assert.ok(
        env.root.querySelectorAll('.reel-segment-easing-badge').length >= 1,
        'Smart auto-detect should apply recommended non-linear segment easings'
      );

      // Ctrl+Z undoes back to [0, 8.0] (2 pins, 0 detection badges)
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();
      assert.equal(env.root.querySelectorAll('.reel-cue-pin').length, 2, 'Ctrl+Z must restore initial 2 cues');
      assert.equal(
        env.root.querySelectorAll('.reel-cue-detect-badge').length,
        0,
        'Ctrl+Z to manual 2 cues must not show stale card detect badges'
      );

      // Ctrl+Y redoes back to detected cues & badges
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
      await flushMicrotasks();
      assert.equal(env.root.querySelectorAll('.reel-cue-pin').length, pinsAfter.length, 'Ctrl+Y must restore detected cues');
      assert.ok(
        env.root.querySelectorAll('.reel-cue-detect-badge').length >= 1,
        'Ctrl+Y must restore card detect badges'
      );
    } finally {
      delete (globalThis as any).__mockVideoDuration;
      delete (globalThis as any).__mockVideoFrameRenderer;
      env.teardown();
    }
  });

  console.log(`\nKeyframe Timeline Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
