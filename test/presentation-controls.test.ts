/**
 * Tier 1 & Tier 2 Automated Tests: Presentation Controls (Features F1, F2, F3, F4)
 * Grounded in ORIGINAL_REQUEST.md (§R1) and spec_miner_e2e_1/tier1_tier2_specs.md
 */

import assert from 'node:assert/strict';
import { setupMockDOM, MockEvent, MockKeyboardEvent, MockMouseEvent, MockPointerEvent } from './helpers/mock-dom';
import { makeMockImageAsset, makeMockVideoAsset, flushMicrotasks } from './helpers/test-fixtures';
import { MotionPresentationApp } from '../src/ui/App';
import { StagePlaybackEngine } from '../src/core/engine/StagePlaybackEngine';
import {
  getLanguage,
  LANGUAGE_STORAGE_KEY,
  PANEL_WIDTHS_STORAGE_KEY,
  resetI18nStateForTesting,
  setLanguage,
} from '../src/core/i18n';
import {
  getResolvedTheme,
  getThemePreference,
  resetThemeStateForTesting,
  THEME_STORAGE_KEY,
} from '../src/ui/theme';

export async function runPresentationControlsTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING TIER 1 & TIER 2: PRESENTATION CONTROLS ---');
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

  // Helper to initialize app with N slides
  const createTestApp = async (slideCount = 3) => {
    const env = setupMockDOM();
    const app = new MotionPresentationApp(env.root);
    const store = (app as any).store;

    for (let i = 1; i <= slideCount; i++) {
      store.addSlideFromImage(makeMockImageAsset(`slide_${i}`, `slide_${i}.png`));
    }
    if (slideCount > 0) {
      store.setActivePreviewIndex(0);
      const s0 = store.getSlideByIndex(0);
      if (s0) store.setSelection({ type: 'slide', slideId: s0.id });
      const previewEngine = (app as any).previewEngine as StagePlaybackEngine;
      if (previewEngine) previewEngine.jumpToSlide(0);
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

  const exitFullscreen = async (env: any) => {
    env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
    await flushMicrotasks();
  };

  /* --------------------------------------------------------------------------
   * FEATURE F1: PowerPoint Keyboard Navigation (Tier 1 & Tier 2)
   * -------------------------------------------------------------------------- */

  await test('T1-F1-01', 'Advance slide via ArrowRight key in presentation mode', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      assert.ok(presenterEngine, 'Presenter engine must be mounted');
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);

      const ev = new MockKeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' });
      env.window.dispatchEvent(ev);
      assert.equal(ev.defaultPrevented, true, 'Keystroke must prevent default');
      assert.equal(getEffectiveIndex(presenterEngine), 1, 'ArrowRight advances to slide 1');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F1-02', 'Advance slide via alternate keys (Space, ArrowDown, PageDown, Enter, N)', async () => {
    const { env, app } = await createTestApp(6);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      // Space advances 0 -> 1
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: ' ' }));
      assert.equal(getEffectiveIndex(presenterEngine), 1, 'Space advances to slide 1');
      presenterEngine.jumpToSlide(1);

      // ArrowDown advances 1 -> 2
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowDown' }));
      assert.equal(getEffectiveIndex(presenterEngine), 2, 'ArrowDown advances to slide 2');
      presenterEngine.jumpToSlide(2);

      // PageDown advances 2 -> 3
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'PageDown' }));
      assert.equal(getEffectiveIndex(presenterEngine), 3, 'PageDown advances to slide 3');
      presenterEngine.jumpToSlide(3);

      // Enter advances 3 -> 4
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Enter' }));
      assert.equal(getEffectiveIndex(presenterEngine), 4, 'Enter advances to slide 4');
      presenterEngine.jumpToSlide(4);

      // 'n' advances 4 -> 5
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'n' }));
      assert.equal(getEffectiveIndex(presenterEngine), 5, 'n key advances to slide 5');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F1-03', 'Retreat slide via ArrowLeft key in presentation mode', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.jumpToSlide(1);
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 1);

      const ev = new MockKeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' });
      env.window.dispatchEvent(ev);
      assert.equal(ev.defaultPrevented, true);
      assert.equal(getEffectiveIndex(presenterEngine), 0, 'ArrowLeft retreats to slide 0');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F1-04', 'Retreat slide via alternate keys (ArrowUp, PageUp, Backspace, P)', async () => {
    const { env, app } = await createTestApp(5);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.jumpToSlide(4);

      // ArrowUp retreats 4 -> 3
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowUp' }));
      assert.equal(getEffectiveIndex(presenterEngine), 3);
      presenterEngine.jumpToSlide(3);

      // PageUp retreats 3 -> 2
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'PageUp' }));
      assert.equal(getEffectiveIndex(presenterEngine), 2);
      presenterEngine.jumpToSlide(2);

      // Backspace retreats 2 -> 1
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Backspace' }));
      assert.equal(getEffectiveIndex(presenterEngine), 1);
      presenterEngine.jumpToSlide(1);

      // 'p' retreats 1 -> 0
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'p' }));
      assert.equal(getEffectiveIndex(presenterEngine), 0);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F1-05', 'Standard PowerPoint Home and End keys jump to first and last slides', async () => {
    const { env, app } = await createTestApp(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'End' }));
      assert.equal(getEffectiveIndex(presenterEngine), 3, 'End key jumps to final slide');

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Home' }));
      assert.equal(getEffectiveIndex(presenterEngine), 0, 'Home key jumps to first slide');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F1-01', 'Retreat at slide index 0 with loopPresentation: false clamps cleanly', async () => {
    const { env, app, store } = await createTestApp(3);
    try {
      store.updateSettings({ loopPresentation: false });
      const presenterEngine = await launchFullscreen(env, app);

      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowLeft' }));
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0, 'Index must not underflow below 0');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F1-02', 'Advance at slide index N-1 with loopPresentation: false clamps cleanly', async () => {
    const { env, app, store } = await createTestApp(3);
    try {
      store.updateSettings({ loopPresentation: false });
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.jumpToSlide(2);

      assert.equal(presenterEngine.getStatus().currentSlideIndex, 2);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 2, 'Index must not exceed N-1');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F1-03', 'Retreat at slide index 0 with loopPresentation: true loops to N-1', async () => {
    const { env, app, store } = await createTestApp(3);
    try {
      store.updateSettings({ loopPresentation: true });
      const presenterEngine = await launchFullscreen(env, app);

      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowLeft' }));
      assert.equal(getEffectiveIndex(presenterEngine), 2, 'Must loop back to slide 2');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F1-04', 'Advance at slide index N-1 with loopPresentation: true loops to 0', async () => {
    const { env, app, store } = await createTestApp(3);
    try {
      store.updateSettings({ loopPresentation: true });
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.jumpToSlide(2);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      assert.equal(getEffectiveIndex(presenterEngine), 0, 'Must loop forward to slide 0');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F1-05', 'Rapid keystroke storm with interruptBehavior: lock does not skip slides', async () => {
    const { env, app, store } = await createTestApp(4);
    try {
      store.updateSettings({ interruptBehavior: 'lock' });
      const presenterEngine = await launchFullscreen(env, app);

      // Start transition 0 -> 1
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: ' ' }));
      // Burst 5 keystrokes
      for (let i = 0; i < 5; i++) {
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: ' ' }));
      }
      assert.equal(getEffectiveIndex(presenterEngine), 1, 'Only 1 transition must execute under lock');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F1-06', 'Advance keystroke with interruptBehavior: skip completes transition immediately', async () => {
    const { env, app, store } = await createTestApp(3);
    try {
      store.updateSettings({ interruptBehavior: 'skip' });
      const presenterEngine = await launchFullscreen(env, app);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      assert.equal(getEffectiveIndex(presenterEngine), 1);
    } finally {
      env.teardown();
    }
  });

  /* --------------------------------------------------------------------------
   * FEATURE F2: Black & White Screen Overlays (Tier 1 & Tier 2)
   * -------------------------------------------------------------------------- */

  await test('T1-F2-01', 'Toggle black screen overlay via B and . keys', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      // First 'b' toggles BLACKOUT
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
      assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT', 'Phase must be BLACKOUT');

      // Second 'b' toggles back to HOLDING_SLIDE
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
      assert.equal(presenterEngine.getStatus().phase, 'HOLDING_SLIDE', 'Phase must unblank');

      // Period key '.' also toggles BLACKOUT
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '.' }));
      assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT', 'Period key must toggle BLACKOUT');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F2-02', 'Toggle white screen overlay via W and , keys', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      // 'w' toggles WHITEOUT
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'w' }));
      assert.equal(presenterEngine.getStatus().phase, 'WHITEOUT', 'Phase must be WHITEOUT');

      // Second 'w' unblanks
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'w' }));
      assert.equal(presenterEngine.getStatus().phase, 'HOLDING_SLIDE');

      // Comma key ',' toggles WHITEOUT
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: ',' }));
      assert.equal(presenterEngine.getStatus().phase, 'WHITEOUT');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F2-03', 'clearBlankScreen returns engine cleanly to HOLDING_SLIDE', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      presenterEngine.toggleBlackout();
      assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT');
      const cleared = presenterEngine.clearBlankScreen();
      assert.equal(cleared, true);
      assert.equal(presenterEngine.getStatus().phase, 'HOLDING_SLIDE');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F2-04', 'Direct switching between blackout and whiteout without unblanking', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
      assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT');

      // Dispatch 'w' directly while in BLACKOUT
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'w' }));
      assert.equal(presenterEngine.getStatus().phase, 'WHITEOUT', 'Direct switch to WHITEOUT');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F2-05', 'Slide advance/retreat clears blank overlay per PowerPoint standard', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
      assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT');

      // Pressing ArrowRight unblanks screen
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      assert.notEqual(presenterEngine.getStatus().phase, 'BLACKOUT', 'ArrowRight must clear blackout');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F2-01', 'Blank screen overlay toggled mid-transition halts animation cleanly', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      presenterEngine.next();
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
      assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT');

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
      assert.equal(presenterEngine.getStatus().phase, 'HOLDING_SLIDE');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F2-02', 'Blanking on empty presentation handles gracefully without throwing', async () => {
    const { env, app } = await createTestApp(0);
    try {
      const presenterEngine = new StagePlaybackEngine(env.root.querySelector('#preview-canvas') as any, (app as any).store.getSettings());
      assert.doesNotThrow(() => {
        presenterEngine.toggleBlackout();
        presenterEngine.toggleWhiteout();
        presenterEngine.clearBlankScreen();
      });
    } finally {
      env.teardown();
    }
  });

  await test('T2-F2-03', 'Rapid alternation between B and W does not desynchronize engine phase', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      for (let i = 0; i < 4; i++) {
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'w' }));
      }
      assert.equal(presenterEngine.getStatus().phase, 'WHITEOUT');
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'w' }));
      assert.equal(presenterEngine.getStatus().phase, 'HOLDING_SLIDE');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F2-04', 'Presenter blank overlay click clears blank screen overlay', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.toggleBlackout();
      assert.equal(presenterEngine.getStatus().phase, 'BLACKOUT');

      const fsBlank = env.root.querySelector('#fs-blank-overlay') || env.root.querySelector('#fs-canvas');
      assert.ok(fsBlank);
      fsBlank.click();
      assert.notEqual(presenterEngine.getStatus().phase, 'BLACKOUT', 'Click must unblank screen');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F2-05', 'Blank screen overlay element exists and has proper styling class in DOM', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.toggleBlackout();

      const overlay = env.root.querySelector('#fs-blank-overlay');
      assert.ok(overlay, 'Blank overlay element must exist');
    } finally {
      env.teardown();
    }
  });

  /* --------------------------------------------------------------------------
   * FEATURE F3: Full-Screen Presentation Mode Lifecycle (Tier 1 & Tier 2)
   * -------------------------------------------------------------------------- */

  await test('T1-F3-01', 'Enter fullscreen mode via F5 key pauses studio preview and sets fullscreen', async () => {
    const { env, app } = await createTestApp(3);
    try {
      assert.equal(await env.desktopAPI.isFullScreen(), false);
      const presenterEngine = await launchFullscreen(env, app);
      assert.equal(await env.desktopAPI.isFullScreen(), true, 'desktopAPI must be fullscreen');
      assert.equal((app as any).isPresentingFullscreen, true);
      assert.ok(presenterEngine);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F3-02', 'Exit fullscreen mode via Escape key cleans up presenter resources', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      assert.equal((app as any).isPresentingFullscreen, true);

      await exitFullscreen(env);
      assert.equal((app as any).isPresentingFullscreen, false, 'Must exit fullscreen');
      assert.equal(await env.desktopAPI.isFullScreen(), false);
      assert.equal((app as any).presenterEngine, null, 'Presenter engine must be destroyed');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F3-03', 'Slide selection synchronizes with store on fullscreen exit', async () => {
    const { env, app, store } = await createTestApp(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.jumpToSlide(2);

      await exitFullscreen(env);
      assert.equal(store.getActivePreviewIndex(), 2, 'Store preview index must match exit slide');
      const selection = store.getSelection();
      assert.equal(selection.type, 'slide');
      assert.equal(selection.slideId, store.getSlideByIndex(2)?.id);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F3-04', 'Studio preview engine restores correct slide frame on fullscreen exit', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.jumpToSlide(1);

      await exitFullscreen(env);
      const previewEngine = (app as any).previewEngine as StagePlaybackEngine;
      assert.equal(previewEngine.getStatus().currentSlideIndex, 1);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F3-05', 'Presenter HUD displays slide counter and top progress bar', async () => {
    const { env, app } = await createTestApp(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.jumpToSlide(1);
      (app as any).updateFullscreenHud(presenterEngine.getStatus());

      const hudLabel = env.root.querySelector('#fs-hud-label');
      assert.ok(hudLabel);
      assert.ok(hudLabel.textContent.includes('02') || hudLabel.textContent.includes('2'));

      const topBar = env.root.querySelector('#fs-top-bar');
      assert.ok(topBar);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F3-01', 'Pressing F5 while already in fullscreen does not spawn duplicate presenter', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const firstEngine = await launchFullscreen(env, app);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'F5' }));
      await flushMicrotasks();
      const secondEngine = (app as any).presenterEngine;
      assert.equal(firstEngine, secondEngine, 'Presenter engine instance must be preserved');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F3-02', 'Exit button click in HUD exits fullscreen cleanly', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      const exitBtn = env.root.querySelector('#fs-btn-exit');
      assert.ok(exitBtn);
      exitBtn.click();
      await flushMicrotasks();
      assert.equal((app as any).isPresentingFullscreen, false);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F3-03', 'Single-slide presentation runs safely in fullscreen', async () => {
    const { env, app } = await createTestApp(1);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);

      // Advance and retreat should safely no-op
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowLeft' }));
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F3-04', 'Rapid F5 -> Escape -> F5 toggle cleanly restores fullscreen presenter', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      await exitFullscreen(env);
      await launchFullscreen(env, app);

      assert.equal((app as any).isPresentingFullscreen, true);
      assert.ok((app as any).presenterEngine);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F3-05', 'Fullscreen exit clears #fullscreen-root innerHTML', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      const fsRoot = env.root.querySelector('#fullscreen-root');
      assert.ok(fsRoot?.children.length && fsRoot.children.length > 0);

      await exitFullscreen(env);
      assert.equal(fsRoot?.children.length, 0, 'fsRoot must be cleared on exit');
    } finally {
      env.teardown();
    }
  });

  /* --------------------------------------------------------------------------
   * FEATURE F4: Direct Slide Jumping & Thumbnail Selection (Tier 1 & Tier 2)
   * -------------------------------------------------------------------------- */

  await test('T1-F4-01', 'Open slide grid modal via G key during presentation mode', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));

      assert.equal((app as any).isSlideGridOpen, true, 'isSlideGridOpen must be true');
      const gridHost = env.root.querySelector('#fs-grid-host');
      assert.ok(gridHost?.querySelector('.slide-grid-modal'));
    } finally {
      env.teardown();
    }
  });

  await test('T1-F4-02', 'Jump to slide via thumbnail click in slide grid', async () => {
    const { env, app } = await createTestApp(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));

      const card2 = env.root.querySelector('[data-idx="2"]');
      assert.ok(card2, 'Thumbnail card for slide 2 must exist');
      card2.click();

      assert.equal((app as any).isSlideGridOpen, false, 'Grid must close after jump');
      assert.equal(getEffectiveIndex(presenterEngine), 2, 'Must jump to slide 2');
    } finally {
      env.teardown();
    }
  });

  await test('T1-F4-03', 'Jump to slide via Enter keyboard key on focused thumbnail', async () => {
    const { env, app } = await createTestApp(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));

      const card3 = env.root.querySelector('[data-idx="3"]');
      assert.ok(card3);
      card3.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      assert.equal((app as any).isSlideGridOpen, false);
      assert.equal(getEffectiveIndex(presenterEngine), 3);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F4-04', 'Close slide grid via Escape key without changing current slide', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));
      assert.equal((app as any).isSlideGridOpen, true);

      // Escape closes grid only; presentation remains
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      assert.equal((app as any).isSlideGridOpen, false);
      assert.equal((app as any).isPresentingFullscreen, true);
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);
    } finally {
      env.teardown();
    }
  });

  await test('T1-F4-05', 'Close slide grid via close button in header', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));

      const closeBtn = env.root.querySelector('#btn-close-grid');
      assert.ok(closeBtn);
      closeBtn.click();
      assert.equal((app as any).isSlideGridOpen, false);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F4-01', 'Presentation navigation shortcuts are isolated while slide grid is open', async () => {
    const { env, app } = await createTestApp(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);

      // Open slide grid
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));

      // ArrowRight, Space, B dispatched on window must not navigate presenter underneath
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: ' ' }));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'b' }));

      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0, 'Slide must remain unchanged');
      assert.notEqual(presenterEngine.getStatus().phase, 'BLACKOUT', 'Screen must not blackout');
    } finally {
      env.teardown();
    }
  });

  await test('T2-F4-02', 'Clicking current active slide thumbnail closes modal cleanly', async () => {
    const { env, app } = await createTestApp(3);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));
      const card0 = env.root.querySelector('[data-idx="0"]');
      assert.ok(card0);
      card0.click();

      assert.equal((app as any).isSlideGridOpen, false);
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F4-03', 'Slide grid handles deck with single slide without error', async () => {
    const { env, app } = await createTestApp(1);
    try {
      await launchFullscreen(env, app);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));

      assert.equal((app as any).isSlideGridOpen, true);
      const cards = env.root.querySelectorAll('.grid-jump-card');
      assert.equal(cards.length, 1);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F4-04', 'Slide grid toggle via G key dismisses open grid cleanly', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));
      assert.equal((app as any).isSlideGridOpen, true);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));
      assert.equal((app as any).isSlideGridOpen, false);
    } finally {
      env.teardown();
    }
  });

  await test('T2-F4-05', 'Arrow keys navigate focus across thumbnail cards in grid', async () => {
    const { env, app } = await createTestApp(4);
    try {
      await launchFullscreen(env, app);
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'g' }));

      const card0 = env.root.querySelector('[data-idx="0"]');
      const card1 = env.root.querySelector('[data-idx="1"]');
      assert.ok(card0 && card1);

      card0.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      assert.equal((globalThis as any).document.activeElement, card1);
    } finally {
      env.teardown();
    }
  });

  /* --------------------------------------------------------------------------
   * FEATURE F1-EXT: PowerPoint Presentation Enhancements
   * Laser pointer (Ctrl+L/Esc), Slide number jump (Digits+Enter),
   * Cursor toggle (A/=), and Canvas right-click navigation
   * -------------------------------------------------------------------------- */

  await test('T1-PPT-01', 'Toggle laser pointer on via Ctrl+L sets laser-active class and displays red dot', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      const presenter = env.root.querySelector('#fs-presenter');
      const laserDot = env.root.querySelector('#fs-laser-dot');
      assert.ok(presenter && laserDot, 'Presenter and laser dot elements must exist');
      assert.equal(presenter.classList.contains('laser-active'), false);
      assert.equal(laserDot.classList.contains('hidden'), true);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'l', ctrlKey: true }));
      assert.equal(presenter.classList.contains('laser-active'), true, 'laser-active class must be added');
      assert.equal(laserDot.classList.contains('hidden'), false, 'laser dot hidden class must be removed');
      assert.equal(laserDot.classList.contains('visible'), true, 'laser dot visible class must be added');
    } finally {
      env.teardown();
    }
  });

  await test('T1-PPT-02', 'Mouse movement updates laser red dot position to cursor coordinates', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      const laserDot = env.root.querySelector('#fs-laser-dot');
      assert.ok(laserDot);

      // Turn laser pointer on
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'l', ctrlKey: true }));

      // Move mouse to (320, 480)
      env.window.dispatchEvent(new MockMouseEvent('mousemove', { clientX: 320, clientY: 480 }));
      assert.equal(laserDot.style.left, '320px', 'Laser dot left style must match clientX');
      assert.equal(laserDot.style.top, '480px', 'Laser dot top style must match clientY');

      // Move mouse to (750, 600)
      env.window.dispatchEvent(new MockMouseEvent('mousemove', { clientX: 750, clientY: 600 }));
      assert.equal(laserDot.style.left, '750px');
      assert.equal(laserDot.style.top, '600px');
    } finally {
      env.teardown();
    }
  });

  await test('T1-PPT-03', 'Toggle laser pointer off via Ctrl+L restores normal cursor', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      const presenter = env.root.querySelector('#fs-presenter');
      const laserDot = env.root.querySelector('#fs-laser-dot');
      assert.ok(presenter && laserDot);

      // On
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'l', ctrlKey: true }));
      assert.equal(presenter.classList.contains('laser-active'), true);

      // Off
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'l', ctrlKey: true }));
      assert.equal(presenter.classList.contains('laser-active'), false, 'laser-active must be removed');
      assert.equal(laserDot.classList.contains('hidden'), true, 'laser dot must be hidden');
    } finally {
      env.teardown();
    }
  });

  await test('T1-PPT-04', 'Escape key turns off laser pointer without exiting presentation', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      const presenter = env.root.querySelector('#fs-presenter');
      assert.ok(presenter);

      // Turn on laser pointer
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'l', ctrlKey: true }));
      assert.equal(presenter.classList.contains('laser-active'), true);

      // First Escape turns off laser pointer
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      assert.equal(presenter.classList.contains('laser-active'), false, 'Laser must be deactivated');
      assert.equal((app as any).isPresentingFullscreen, true, 'Presentation must remain active');

      // Second Escape exits presentation
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      assert.equal((app as any).isPresentingFullscreen, false, 'Second Escape exits fullscreen');
    } finally {
      env.teardown();
    }
  });

  await test('T1-PPT-05', 'Typing slide number in presentation mode displays on-screen indicator', async () => {
    const { env, app } = await createTestApp(5);
    try {
      await launchFullscreen(env, app);
      const indicator = env.root.querySelector('#fs-slide-indicator');
      assert.ok(indicator);
      assert.equal(indicator.classList.contains('hidden'), true);

      // Type digit '3'
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '3' }));
      assert.equal(indicator.classList.contains('hidden'), false);
      assert.equal(indicator.textContent.trim(), '3');

      // Type digit '4' -> '34'
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '4' }));
      assert.equal(indicator.textContent.trim(), '34');
    } finally {
      env.teardown();
    }
  });

  await test('T1-PPT-06', 'Typing slide number followed by Enter jumps directly to slide', async () => {
    const { env, app } = await createTestApp(5);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);

      // Type '3' then press Enter (PowerPoint 1-based slide 3 is index 2)
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '3' }));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Enter' }));

      assert.equal(getEffectiveIndex(presenterEngine), 2, 'Must jump to slide index 2');
      const indicator = env.root.querySelector('#fs-slide-indicator');
      assert.equal(indicator?.classList.contains('hidden'), true, 'Indicator must be hidden after jump');
      await flushMicrotasks();
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-07', 'Backspace edits slide number buffer and Escape cancels slide jump', async () => {
    const { env, app } = await createTestApp(5);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      const indicator = env.root.querySelector('#fs-slide-indicator');
      assert.ok(indicator);

      // Type '2' then '5'
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '2' }));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '5' }));
      assert.equal(indicator.textContent.trim(), '25');

      // Backspace removes '5'
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Backspace' }));
      assert.equal(indicator.textContent.trim(), '2');

      // Escape cancels jump buffer without exiting presentation
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      assert.equal(indicator.classList.contains('hidden'), true);
      assert.equal((app as any).isPresentingFullscreen, true);
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 0);
      await flushMicrotasks();
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-08', 'Slide number exceeding total slide count clamps to last slide on Enter', async () => {
    const { env, app } = await createTestApp(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);

      // Type 99 (exceeds 4 slides) then Enter
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '9' }));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '9' }));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Enter' }));

      assert.equal(getEffectiveIndex(presenterEngine), 3, 'Must clamp to last slide index (3)');
      await flushMicrotasks();
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-09', 'Typing slide number followed by navigation key clears buffer', async () => {
    const { env, app } = await createTestApp(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      const indicator = env.root.querySelector('#fs-slide-indicator');
      assert.ok(indicator);

      // Type '2'
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '2' }));
      assert.equal(indicator.textContent.trim(), '2');

      // Press ArrowRight -> clears buffer and advances normally 0 -> 1
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      assert.equal(indicator.classList.contains('hidden'), true);
      assert.equal(getEffectiveIndex(presenterEngine), 1);
      await flushMicrotasks();
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-10', 'A and = keys toggle presenter cursor visibility', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      const presenter = env.root.querySelector('#fs-presenter');
      assert.ok(presenter);
      assert.equal(presenter.classList.contains('hide-cursor'), false);

      // 'a' hides cursor
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'a' }));
      assert.equal(presenter.classList.contains('hide-cursor'), true, "'a' key must hide cursor");

      // 'a' shows cursor
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'a' }));
      assert.equal(presenter.classList.contains('hide-cursor'), false, "second 'a' key must show cursor");

      // '=' hides cursor
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '=' }));
      assert.equal(presenter.classList.contains('hide-cursor'), true, "'=' key must hide cursor");

      // '=' shows cursor
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '=' }));
      assert.equal(presenter.classList.contains('hide-cursor'), false, "second '=' key must show cursor");
      await flushMicrotasks();
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-11', 'Right-click on presentation canvas retreats to previous slide', async () => {
    const { env, app } = await createTestApp(4);
    try {
      const presenterEngine = await launchFullscreen(env, app);
      presenterEngine.jumpToSlide(2);
      assert.equal(presenterEngine.getStatus().currentSlideIndex, 2);

      const fsCanvas = env.root.querySelector('#fs-canvas');
      assert.ok(fsCanvas);

      const ctxEv = new MockMouseEvent('contextmenu', { cancelable: true });
      fsCanvas.dispatchEvent(ctxEv);
      assert.equal(ctxEv.defaultPrevented, true, 'Right click must prevent context menu default');
      assert.equal(getEffectiveIndex(presenterEngine), 1, 'Right click retreats slide 2 -> 1');
      await flushMicrotasks();
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-12', 'Fullscreen exit resets laser pointer and slide number indicators', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      // Turn on laser pointer and type a digit
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'l', ctrlKey: true }));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '2' }));

      // Direct exit
      await (app as any).exitFullscreenPresentation();
      await flushMicrotasks();

      assert.equal((app as any).isPresentingFullscreen, false);
      assert.equal((app as any).isLaserPointerActive, false);
      assert.equal((app as any).slideNumberBuffer, '');
      assert.equal((app as any).laserPointerEl, null);
      assert.equal((app as any).slideIndicatorEl, null);
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-13', 'Escape unwinds slide buffer, then laser pointer, then exits fullscreen', async () => {
    const { env, app } = await createTestApp(3);
    try {
      await launchFullscreen(env, app);
      const presenter = env.root.querySelector('#fs-presenter');
      const indicator = env.root.querySelector('#fs-slide-indicator');

      // Turn on laser and type slide number
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'l', ctrlKey: true }));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: '2' }));
      assert.equal((app as any).isLaserPointerActive, true);
      assert.equal((app as any).slideNumberBuffer, '2');
      assert.equal(indicator?.classList.contains('hidden'), false);

      // Escape 1: Clears slide number buffer
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      assert.equal((app as any).slideNumberBuffer, '');
      assert.equal(indicator?.classList.contains('hidden'), true);
      assert.equal((app as any).isLaserPointerActive, true, 'Laser remains active');
      assert.equal((app as any).isPresentingFullscreen, true);

      // Escape 2: Turns off laser pointer
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      assert.equal((app as any).isLaserPointerActive, false, 'Laser turned off');
      assert.equal(presenter?.classList.contains('laser-active'), false);
      assert.equal((app as any).isPresentingFullscreen, true);

      // Escape 3: Exits fullscreen presentation
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      await flushMicrotasks();
      assert.equal((app as any).isPresentingFullscreen, false, 'Presentation exited');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-14', 'moveSlideToIndex reorders Slide 1 or Slide 2 directly to Slide 4 position', async () => {
    const { env, store } = await createTestApp(5);
    try {
      const initialIds = store.getSlides().map((s: any) => s.id);
      const slide2Id = initialIds[1];

      // Move Slide 2 (index 1) to Slide 4 (index 3)
      store.moveSlideToIndex(slide2Id, 3);
      const afterMove = store.getSlides().map((s: any) => s.id);
      assert.equal(afterMove[3], slide2Id, 'Slide 2 must now be at index 3 (Slide 4)');
      assert.equal(store.getActivePreviewIndex(), 3);

      // Move Slide 1 (now index 0) to Slide 4 (index 3)
      const firstId = afterMove[0];
      store.moveSlideToIndex(firstId, 3);
      const afterFirstMove = store.getSlides().map((s: any) => s.id);
      assert.equal(afterFirstMove[3], firstId, 'First slide must move to index 3 (Slide 4)');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-15', 'Pointer drag-and-drop on slide-nav-item drags Frame 2 down to Frame 4', async () => {
    const { env, store } = await createTestApp(5);
    try {
      const items = Array.from(env.root.querySelectorAll('.slide-nav-item')) as any[];
      assert.equal(items.length, 5);
      items.forEach((el, idx) => {
        el.setBounds({ left: 10, top: idx * 100, width: 220, height: 80 });
      });

      const slide2Id = store.getSlides()[1].id;
      // Press pointerdown on Frame 2 (idx 1, Y=120)
      items[1].dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 50, clientY: 120, button: 0 }));
      // Drag down onto Frame 4 (idx 3, top=300..380 -> clientY=350)
      env.window.dispatchEvent(new MockPointerEvent('pointermove', { clientX: 50, clientY: 350 }));
      env.window.dispatchEvent(new MockPointerEvent('pointerup', { clientX: 50, clientY: 350 }));
      await flushMicrotasks();

      const updatedIds = store.getSlides().map((s: any) => s.id);
      assert.equal(updatedIds[3], slide2Id, 'Frame 2 dragged down to Frame 4 must land at index 3');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-16', 'Pressing Delete key on selected slide opens transition choice modal (above vs below)', async () => {
    const { env, store } = await createTestApp(4);
    try {
      const slide2 = store.getSlides()[1];
      store.setSelection({ type: 'slide', slideId: slide2.id });
      await flushMicrotasks();

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Delete' }));
      await flushMicrotasks();

      const modal = env.root.querySelector('#delete-slide-modal-backdrop');
      const btnAbove = env.root.querySelector('#btn-delete-trans-above');
      const btnBelow = env.root.querySelector('#btn-delete-trans-below');
      assert.ok(modal, 'Delete slide choice modal must open on Delete key');
      assert.ok(btnAbove, 'Option to delete transition above must be rendered');
      assert.ok(btnBelow, 'Option to delete transition below must be rendered');
      assert.equal(store.getSlides().length, 4, 'Slide is not deleted until transition choice is confirmed');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-17', 'Deleting slide with "above" choice deletes preceding transition and keeps following transition', async () => {
    const { env, store } = await createTestApp(4);
    try {
      const slides = store.getSlides();
      const vidAbove = makeMockVideoAsset('vid_above', 'above.mp4', 3.0);
      const vidBelow = makeMockVideoAsset('vid_below', 'below.mp4', 5.0);
      store.setSlideTransitionVideo(slides[0].id, vidAbove);
      store.setSlideTransitionVideo(slides[1].id, vidBelow);

      // Select Slide 2 (index 1) and press Delete, then pick "above"
      store.setSelection({ type: 'slide', slideId: slides[1].id });
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Delete' }));
      await flushMicrotasks();

      const btnAbove = env.root.querySelector('#btn-delete-trans-above') as any;
      assert.ok(btnAbove);
      btnAbove.click();
      await flushMicrotasks();

      const remaining = store.getSlides();
      assert.equal(remaining.length, 3);
      assert.equal(
        remaining[0].transitionToNext.videoAsset?.id,
        'vid_below',
        'Choosing "above" must delete vid_above and keep vid_below on Slide 1'
      );
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-18', 'Deleting slide with "below" choice deletes following transition and keeps preceding transition', async () => {
    const { env, store } = await createTestApp(4);
    try {
      const slides = store.getSlides();
      const vidAbove = makeMockVideoAsset('vid_above_2', 'above2.mp4', 3.0);
      const vidBelow = makeMockVideoAsset('vid_below_2', 'below2.mp4', 5.0);
      store.setSlideTransitionVideo(slides[0].id, vidAbove);
      store.setSlideTransitionVideo(slides[1].id, vidBelow);

      // Select Slide 2 (index 1) and press Delete, then pick "below"
      store.setSelection({ type: 'slide', slideId: slides[1].id });
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Delete' }));
      await flushMicrotasks();

      const btnBelow = env.root.querySelector('#btn-delete-trans-below') as any;
      assert.ok(btnBelow);
      btnBelow.click();
      await flushMicrotasks();

      const remaining = store.getSlides();
      assert.equal(remaining.length, 3);
      assert.equal(
        remaining[0].transitionToNext.videoAsset?.id,
        'vid_above_2',
        'Choosing "below" must delete vid_below_2 and keep vid_above_2 on Slide 1'
      );
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-19', 'Ctrl+Click multiselects multiple frames and transition videos simultaneously', async () => {
    const { env, store } = await createTestApp(5);
    try {
      const slides = store.getSlides();
      store.setSlideTransitionVideo(slides[0].id, makeMockVideoAsset('tv0', 't0.mp4', 2));
      store.setSlideTransitionVideo(slides[1].id, makeMockVideoAsset('tv1', 't1.mp4', 2));
      store.setSlideTransitionVideo(slides[2].id, makeMockVideoAsset('tv2', 't2.mp4', 2));
      await flushMicrotasks();

      // Click Frame 1 normally
      env.root.querySelectorAll('.slide-nav-item')[0].dispatchEvent(new MockMouseEvent('click', { bubbles: true }));
      // Ctrl+Click Frame 3
      env.root.querySelectorAll('.slide-nav-item')[2].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      // Ctrl+Click Transition 2 (index 1)
      env.root.querySelectorAll('.filmstrip-bridge')[1].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      // Ctrl+Click Transition 4 (index 3)
      env.root.querySelectorAll('.filmstrip-bridge')[3].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      const summary = store.getMultiSelectionSummary();
      assert.deepEqual(summary.slideIds, [slides[0].id, slides[2].id]);
      assert.deepEqual(summary.transitionSlideIds, [slides[1].id, slides[3].id]);
      assert.equal(summary.totalCount, 4);

      const navItems = env.root.querySelectorAll('.slide-nav-item');
      const bridges = env.root.querySelectorAll('.filmstrip-bridge');
      assert.equal(navItems[0].classList.contains('selected'), true, 'navItems[0] must be selected');
      assert.equal(navItems[1].classList.contains('selected'), false, 'navItems[1] must NOT be selected');
      assert.equal(navItems[2].classList.contains('selected'), true, 'navItems[2] must be selected');
      assert.equal(bridges[1].classList.contains('selected'), true, 'bridges[1] must be selected');
      assert.equal(bridges[3].classList.contains('selected'), true, 'bridges[3] must be selected');

      const multiBar = env.root.querySelector('#nav-multi-select-bar');
      assert.ok(multiBar, 'Multi-select action bar must appear when >1 items selected');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-20', 'Ctrl+Click toggles individual items off while plain click replaces selection', async () => {
    const { env, store } = await createTestApp(4);
    try {
      const slides = store.getSlides();
      env.root.querySelectorAll('.slide-nav-item')[0].dispatchEvent(new MockMouseEvent('click', { bubbles: true }));
      env.root.querySelectorAll('.slide-nav-item')[1].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      env.root.querySelectorAll('.filmstrip-bridge')[2].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      assert.equal(store.getMultiSelectionSummary().totalCount, 3);

      // Ctrl+Click Frame 1 again to deselect just Frame 1
      env.root.querySelectorAll('.slide-nav-item')[0].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      const afterToggle = store.getMultiSelectionSummary();
      assert.deepEqual(afterToggle.slideIds, [slides[1].id]);
      assert.deepEqual(afterToggle.transitionSlideIds, [slides[2].id]);
      assert.equal(afterToggle.totalCount, 2);

      // Plain click on Frame 4 clears multi-selection and selects only Frame 4
      env.root.querySelectorAll('.slide-nav-item')[3].dispatchEvent(new MockMouseEvent('click', { bubbles: true }));
      const afterPlain = store.getMultiSelectionSummary();
      assert.deepEqual(afterPlain.slideIds, [slides[3].id]);
      assert.deepEqual(afterPlain.transitionSlideIds, []);
      assert.equal(afterPlain.totalCount, 1);
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-21', 'Deleting multiple Ctrl-selected transition videos clears all selected videos and keeps all slides', async () => {
    const { env, store } = await createTestApp(4);
    try {
      const slides = store.getSlides();
      store.setSlideTransitionVideo(slides[0].id, makeMockVideoAsset('tv_a', 'a.mp4', 2));
      store.setSlideTransitionVideo(slides[1].id, makeMockVideoAsset('tv_b', 'b.mp4', 3));
      store.setSlideTransitionVideo(slides[2].id, makeMockVideoAsset('tv_c', 'c.mp4', 4));

      // Select transition 0 and transition 2 with Ctrl
      env.root.querySelectorAll('.filmstrip-bridge')[0].dispatchEvent(new MockMouseEvent('click', { bubbles: true }));
      env.root.querySelectorAll('.filmstrip-bridge')[2].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Delete' }));
      await flushMicrotasks();

      const updated = store.getSlides();
      assert.equal(updated.length, 4, 'All slides must remain intact');
      assert.equal(updated[0].transitionToNext.videoAsset, null, 'Transition 0 video must be deleted');
      assert.equal(updated[1].transitionToNext.videoAsset?.id, 'tv_b', 'Unselected Transition 1 video must remain');
      assert.equal(updated[2].transitionToNext.videoAsset, null, 'Transition 2 video must be deleted');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-22', 'Deleting Ctrl-selected mixed frames and transitions deletes both cleanly', async () => {
    const { env, store } = await createTestApp(5);
    try {
      const slides = store.getSlides();
      const s0 = slides[0].id;
      const s1 = slides[1].id;
      const s2 = slides[2].id;
      const s3 = slides[3].id;
      const s4 = slides[4].id;

      store.setSlideTransitionVideo(s0, makeMockVideoAsset('v0', 'v0.mp4', 2));
      store.setSlideTransitionVideo(s1, makeMockVideoAsset('v1', 'v1.mp4', 2));
      store.setSlideTransitionVideo(s2, makeMockVideoAsset('v2', 'v2.mp4', 2));
      store.setSlideTransitionVideo(s3, makeMockVideoAsset('v3', 'v3.mp4', 2));

      // Ctrl+select Frame 2 (s1), Trans above Frame 2 (s0/v0), Frame 4 (s3), Trans below Frame 4 (s3/v3)
      env.root.querySelectorAll('.slide-nav-item')[1].dispatchEvent(new MockMouseEvent('click', { bubbles: true }));
      env.root.querySelectorAll('.filmstrip-bridge')[0].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      env.root.querySelectorAll('.slide-nav-item')[3].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      env.root.querySelectorAll('.filmstrip-bridge')[3].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      // Press Delete -> all deleted frames have explicitly selected transitions, deletes immediately
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Delete' }));
      await flushMicrotasks();

      const remaining = store.getSlides();
      assert.deepEqual(
        remaining.map((s: any) => s.id),
        [s0, s2, s4],
        'Frames 2 and 4 must be removed'
      );
      // s0 had v0 (selected/deleted) above s1, so s0 inherits v1 (unselected)!
      assert.equal(remaining[0].transitionToNext.videoAsset?.id, 'v1', 'v0 deleted while unselected v1 preserved');
      // s2 had v2 (unselected), while s3 + v3 (below s3) were deleted, so s2 keeps v2!
      assert.equal(remaining[1].transitionToNext.videoAsset?.id, 'v2', 'Unselected v2 preserved when s3+v3 deleted');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-23', 'Deleting multiple Ctrl-selected frames without transitions opens batch choice modal', async () => {
    const { env, store } = await createTestApp(5);
    try {
      const slides = store.getSlides();
      const ids = slides.map((s: any) => s.id);
      store.setSlideTransitionVideo(ids[0], makeMockVideoAsset('mv0', 'mv0.mp4', 2));
      store.setSlideTransitionVideo(ids[1], makeMockVideoAsset('mv1', 'mv1.mp4', 2));
      store.setSlideTransitionVideo(ids[2], makeMockVideoAsset('mv2', 'mv2.mp4', 2));
      store.setSlideTransitionVideo(ids[3], makeMockVideoAsset('mv3', 'mv3.mp4', 2));

      // Ctrl+select Frame 2 and Frame 3 (no transitions selected)
      env.root.querySelectorAll('.slide-nav-item')[1].dispatchEvent(new MockMouseEvent('click', { bubbles: true }));
      env.root.querySelectorAll('.slide-nav-item')[2].dispatchEvent(new MockMouseEvent('click', { ctrlKey: true, bubbles: true }));
      await flushMicrotasks();

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Delete' }));
      await flushMicrotasks();

      const btnBelow = env.root.querySelector('#btn-delete-trans-below') as any;
      assert.ok(btnBelow, 'Batch delete modal must appear for multiple frames without selected transitions');
      btnBelow.click();
      await flushMicrotasks();

      const remaining = store.getSlides();
      assert.deepEqual(remaining.map((s: any) => s.id), [ids[0], ids[3], ids[4]]);
      assert.equal(remaining[0].transitionToNext.videoAsset?.id, 'mv0');
      assert.equal(remaining[1].transitionToNext.videoAsset?.id, 'mv3');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PPT-24', 'Ctrl+A selects all frames and Escape clears multi-selection', async () => {
    const { env, store } = await createTestApp(4);
    try {
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
      await flushMicrotasks();
      assert.equal(store.getMultiSelectionSummary().slideIds.length, 4, 'Ctrl+A must select all 4 slides');

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      await flushMicrotasks();
      assert.equal(store.getMultiSelectionSummary().totalCount, 1, 'Escape must collapse multi-selection to 1');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PRO-01', 'Studio Undo/Redo restores slide edits and deleted slides with blob URLs intact', async () => {
    const { env, store } = await createTestApp(3);
    try {
      const s0 = store.getSlideByIndex(0)!;
      const origTitle = s0.title;
      store.updateSlideDetails(s0.id, { title: 'عنوان معدّل', notes: 'ملاحظة اختبار' });
      assert.equal(store.canUndo(), true, 'Undo stack should have snapshot after edit');
      assert.equal(store.getSlideByIndex(0)!.title, 'عنوان معدّل');

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      await flushMicrotasks();
      assert.equal(store.getSlideByIndex(0)!.title, origTitle, 'Ctrl+Z must revert title edit');
      assert.equal(store.getSlideByIndex(0)!.notes, '', 'Ctrl+Z must revert speaker notes edit');
      assert.equal(store.canRedo(), true, 'Redo stack should be populated after Undo');

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'y', ctrlKey: true }));
      await flushMicrotasks();
      assert.equal(store.getSlideByIndex(0)!.title, 'عنوان معدّل', 'Ctrl+Y must reapply title edit');
      assert.equal(store.getSlideByIndex(0)!.notes, 'ملاحظة اختبار', 'Ctrl+Y must reapply notes');

      // Delete slide and undo deletion
      const targetSlide = store.getSlideByIndex(1)!;
      targetSlide.imageAsset.objectUrl = 'blob:mock-slide-2';
      store.deleteSlide(targetSlide.id, 'below');
      assert.equal(store.getSlides().length, 2, 'Slide should be deleted');

      assert.equal(store.undo(), true, 'store.undo() should restore deleted slide');
      await flushMicrotasks();
      assert.equal(store.getSlides().length, 3, 'Undo must restore slide count to 3');
      assert.equal(store.getSlideByIndex(1)!.imageAsset.objectUrl, 'blob:mock-slide-2', 'Restored slide must preserve blob URL');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PRO-02', 'Slide duplication (Ctrl+D / duplicateSlide) clones slide, notes and transition spec after source', async () => {
    const { env, store } = await createTestApp(3);
    try {
      const s0 = store.getSlideByIndex(0)!;
      store.updateSlideDetails(s0.id, { title: 'مقدمة العرض', notes: 'تذكير مهم' });
      store.updateTransitionSpec(s0.id, { fallbackStyle: 'wipe-reveal', fallbackDurationMs: 850 });
      store.setSelection({ type: 'slide', slideId: s0.id });
      await flushMicrotasks();

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'd', ctrlKey: true }));
      await flushMicrotasks();

      const slides = store.getSlides();
      assert.equal(slides.length, 4, 'Ctrl+D must increment slide count to 4');
      assert.ok(slides[1].title.includes('(نسخة)'), 'Duplicated slide title should contain (نسخة)');
      assert.equal(slides[1].notes, 'تذكير مهم', 'Duplicated slide must copy speaker notes');
      assert.equal(slides[1].transitionToNext.fallbackStyle, 'wipe-reveal', 'Duplicated slide must copy fallbackStyle');
      assert.equal(slides[1].transitionToNext.fallbackDurationMs, 850, 'Duplicated slide must copy fallbackDurationMs');
      assert.notEqual(slides[1].id, s0.id, 'Duplicated slide must get unique id');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PRO-03', 'Speaker notes inspector syncs with Fullscreen Presenter Notes Drawer (S key)', async () => {
    const { env, app, store } = await createTestApp(3);
    try {
      const slides = store.getSlides();
      store.setSelection({ type: 'slide', slideId: slides[0].id });
      await flushMicrotasks();

      const notesEl = env.root.querySelector('#insp-slide-notes') as any;
      assert.ok(notesEl, 'Inspector must render #insp-slide-notes textarea');
      notesEl.value = 'ابدأ بتعريف المشكلة';
      notesEl.dispatchEvent(new MockEvent('change', { bubbles: true }));
      store.updateSlideDetails(slides[1].id, { notes: 'ملاحظة الشريحة الثانية' });
      await flushMicrotasks();

      assert.equal(store.getSlideByIndex(0)!.notes, 'ابدأ بتعريف المشكلة');

      const presenterEngine = await launchFullscreen(env, app);
      const drawer = env.root.querySelector('#fs-notes-drawer') as any;
      assert.ok(drawer, 'Fullscreen mode must mount #fs-notes-drawer');
      assert.equal(drawer.classList.contains('hidden'), true, 'Notes drawer must start hidden so Escape semantics stay intact');

      // Press 's' to open speaker notes drawer
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 's', code: 'KeyS' }));
      await flushMicrotasks();
      assert.equal(drawer.classList.contains('hidden'), false, 'Pressing S must open #fs-notes-drawer');

      const body = env.root.querySelector('#fs-notes-body') as any;
      assert.ok(body.textContent.includes('ابدأ بتعريف المشكلة'), 'Drawer must display slide 1 speaker notes');

      // Advance cleanly to slide 2 and check live notes sync
      presenterEngine.jumpToSlide(1);
      await flushMicrotasks();
      assert.ok(body.textContent.includes('ملاحظة الشريحة الثانية'), 'Drawer must update live to slide 2 notes');

      await exitFullscreen(env);
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PRO-04', 'New procedural transitions (wipe-reveal, iris-spotlight), duration/easing inspector controls & batch apply', async () => {
    const { env, store } = await createTestApp(3);
    try {
      const s0 = store.getSlideByIndex(0)!;
      store.setSelection({ type: 'transition', slideId: s0.id });
      await flushMicrotasks();

      const styleSel = env.root.querySelector('#insp-fallback-style') as any;
      const durIn = env.root.querySelector('#insp-fallback-duration') as any;
      const easingSel = env.root.querySelector('#insp-trans-easing') as any;
      const applyAllBtn = env.root.querySelector('#btn-apply-trans-all') as any;

      assert.ok(styleSel && durIn && easingSel && applyAllBtn, 'Transition inspector must render style, duration, easing, and apply-all controls');

      styleSel.value = 'wipe-reveal';
      styleSel.dispatchEvent(new MockEvent('change', { bubbles: true }));
      durIn.value = '950';
      durIn.dispatchEvent(new MockEvent('change', { bubbles: true }));
      easingSel.value = 'ease-out';
      easingSel.dispatchEvent(new MockEvent('change', { bubbles: true }));
      applyAllBtn.click();
      await flushMicrotasks();

      for (const s of store.getSlides()) {
        assert.equal(s.transitionToNext.fallbackStyle, 'wipe-reveal');
        assert.equal(s.transitionToNext.fallbackDurationMs, 950);
        assert.equal(s.transitionToNext.easing, 'ease-out');
      }

      // Run wipe-reveal & iris-spotlight on StagePlaybackEngine to verify clip/arc draw calls
      const canvas = env.document.createElement('canvas') as any;
      const engine = new StagePlaybackEngine(canvas, { ...store.getSettings(), defaultFallbackStyle: 'iris-spotlight' });
      await engine.loadProject(store.getSlides(), store.getSettings(), 0);
      engine.next();
      await new Promise((r) => setTimeout(r, 40));
      const ctx = canvas.getContext('2d');
      assert.ok(ctx.drawCalls.some((c: any) => c.method === 'clip' && c.args.length === 0), 'wipe-reveal transition must invoke ctx.clip()');

      store.updateTransitionSpec(s0.id, { fallbackStyle: 'iris-spotlight', fallbackDurationMs: 250 });
      await engine.loadProject(store.getSlides(), store.getSettings(), 0);
      ctx.reset();
      engine.next();
      await new Promise((r) => setTimeout(r, 40));
      assert.ok(ctx.drawCalls.some((c: any) => c.method === 'arc'), 'iris-spotlight transition must invoke ctx.arc()');
      engine.destroy();
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PRO-05', 'Navigator search/filter, Deck Diagnostics card, and Keyboard Shortcuts help modal', async () => {
    const { env, store } = await createTestApp(3);
    try {
      const slides = store.getSlides();
      store.updateSlideDetails(slides[0].id, { title: 'الأولى المهمة', notes: 'ملاحظة مهمة' });
      store.updateSlideDetails(slides[2].id, { title: 'الخاتمة' });
      await flushMicrotasks();

      // Diagnostics check
      const diag = store.getProjectDiagnostics();
      assert.equal(diag.slideCount, 3);
      assert.equal(diag.notesCount, 1);
      assert.equal(diag.proceduralTransitionCount, 2);
      assert.ok(diag.estimatedDurationSec >= 9, 'Estimated duration must include slides and transitions');

      // Filter by notes pill
      const notesPill = env.root.querySelector('.nav-filter-pill[data-filter="notes"]') as any;
      assert.ok(notesPill, 'Notes filter pill must exist');
      notesPill.click();
      await flushMicrotasks();

      const navItems = env.root.querySelectorAll('.slide-nav-item');
      assert.equal(navItems[0].classList.contains('nav-filtered-out'), false, 'Slide with notes stays visible');
      assert.equal(navItems[1].classList.contains('nav-filtered-out'), true, 'Slide without notes is filtered out');

      // Search input resets to all and filters by title
      const allPill = env.root.querySelector('.nav-filter-pill[data-filter="all"]') as any;
      allPill.click();
      const searchIn = env.root.querySelector('#nav-search-input') as any;
      searchIn.value = 'الخاتمة';
      searchIn.dispatchEvent(new MockEvent('input', { bubbles: true }));
      assert.equal(navItems[0].classList.contains('nav-filtered-out'), true);
      assert.equal(navItems[2].classList.contains('nav-filtered-out'), false);

      // Keyboard shortcuts modal via button & Escape
      const helpBtn = env.root.querySelector('#btn-shortcuts-help') as any;
      assert.ok(helpBtn, '#btn-shortcuts-help button must exist');
      helpBtn.click();
      await flushMicrotasks();
      assert.ok(env.root.querySelector('#shortcuts-modal-backdrop'), 'Shortcuts modal must open');

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      await flushMicrotasks();
      assert.equal(env.root.querySelector('#shortcuts-modal-backdrop'), null, 'Escape must close shortcuts modal');
    } finally {
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PRO-06', 'Single-language i18n defaults to system locale, persists changes, and avoids hybrid AR/EN text', async () => {
    const env = setupMockDOM();
    try {
      resetI18nStateForTesting();
      (env.window as any).navigator = { language: 'en-US' };
      if (env.desktopAPI) {
        (env.desktopAPI as any).systemLocale = 'en';
      }

      let app = new MotionPresentationApp(env.root);
      let store = (app as any).store;
      await flushMicrotasks();

      assert.equal(getLanguage(), 'en', 'Default language should follow English system locale');
      assert.equal(env.document.documentElement.getAttribute('lang'), 'en');
      assert.equal(env.document.documentElement.getAttribute('dir'), 'ltr');

      const emptyTextEn = env.root.querySelector('#empty-overlay')?.textContent || '';
      const openBtnEn = env.root.querySelector('#btn-open-project')?.textContent || '';
      assert.ok(openBtnEn.includes('Open'), `Toolbar should render pure English (got: ${openBtnEn})`);
      assert.ok(!/[\u0600-\u06FF]/.test(openBtnEn), 'English toolbar button must not contain Arabic text');
      assert.ok(!/[\u0600-\u06FF]/.test(emptyTextEn), 'English empty overlay must not contain Arabic text');

      // Toggle to Arabic via toolbar language switcher
      const langToggle = env.root.querySelector('#btn-lang-toggle') as any;
      assert.ok(langToggle, '#btn-lang-toggle button must exist');
      langToggle.click();
      await flushMicrotasks();

      assert.equal(getLanguage(), 'ar');
      assert.equal(env.document.documentElement.getAttribute('lang'), 'ar');
      assert.equal(env.document.documentElement.getAttribute('dir'), 'rtl');
      assert.equal((globalThis as any).localStorage.getItem(LANGUAGE_STORAGE_KEY), 'ar');
      assert.equal(env.desktopAPI.language, 'ar');

      // Add a slide and verify inspector tabs have ZERO hybrid AR (EN) strings
      store.addSlideFromImage(makeMockImageAsset('lang_s1', 'lang_s1.png'));
      store.addSlideFromImage(makeMockImageAsset('lang_s2', 'lang_s2.png'));
      const firstSlide = store.getSlideByIndex(0);
      store.setSelection({ type: 'transition', slideId: firstSlide.id });
      await flushMicrotasks();

      const transInspectorHtml = env.root.querySelector('#inspector-pane')?.innerHTML || '';
      for (const hybridToken of ['(Crossfade)', '(Zoom Morph)', '(Slide Push)', '(Ease In-Out)']) {
        assert.ok(
          !transInspectorHtml.includes(hybridToken),
          `Arabic Transition inspector must not contain hybrid token ${hybridToken}`
        );
      }

      store.setSelection({ type: 'settings' });
      await flushMicrotasks();
      const settingsInspectorHtml = env.root.querySelector('#inspector-pane')?.innerHTML || '';
      for (const hybridToken of ['(Loop)', '(Contain)', '(Cover)', '(Crossfade)']) {
        assert.ok(
          !settingsInspectorHtml.includes(hybridToken),
          `Arabic Settings inspector must not contain hybrid token ${hybridToken}`
        );
      }

      // Reload simulation: even if system locale says EN, saved AR preference must win
      resetI18nStateForTesting();
      (env.window as any).navigator = { language: 'en-US' };
      if (env.desktopAPI) (env.desktopAPI as any).systemLocale = 'en';
      env.root.innerHTML = '';
      app = new MotionPresentationApp(env.root);
      await flushMicrotasks();
      assert.equal(getLanguage(), 'ar', 'Saved Arabic preference must override English system locale on reload');

      // Switch to EN, verify saved EN overrides Arabic system locale on reload
      (env.root.querySelector('#btn-lang-toggle') as any)?.click();
      await flushMicrotasks();
      assert.equal((globalThis as any).localStorage.getItem(LANGUAGE_STORAGE_KEY), 'en');

      resetI18nStateForTesting();
      (env.window as any).navigator = { language: 'ar-EG' };
      if (env.desktopAPI) (env.desktopAPI as any).systemLocale = 'ar';
      env.root.innerHTML = '';
      app = new MotionPresentationApp(env.root);
      store = (app as any).store;
      await flushMicrotasks();
      assert.equal(getLanguage(), 'en', 'Saved English preference must persist across restarts');

      // Clean English settings inspector has no Arabic text either
      store.setSelection({ type: 'settings' });
      await flushMicrotasks();
      const settingsEnHtml = env.root.querySelector('#inspector-pane')?.innerHTML || '';
      assert.ok(!/[\u0600-\u06FF]/.test(settingsEnHtml), 'English Settings inspector must contain zero Arabic');
    } finally {
      setLanguage('ar', { persist: false, syncDesktop: false });
      resetI18nStateForTesting();
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PRO-07', 'Sidebars are resizable in RTL/LTR via drag, keyboard, dblclick reset, collapse, and persist widths', async () => {
    resetI18nStateForTesting();
    const { env } = await createTestApp(2);
    try {
      setLanguage('ar', { persist: false, syncDesktop: false });
      await flushMicrotasks();

      const splitView = env.root.querySelector('.split-view') as any;
      const navResizer = env.root.querySelector('#navigator-resizer') as any;
      const inspResizer = env.root.querySelector('#inspector-resizer') as any;
      assert.ok(splitView && navResizer && inspResizer, 'Split view and both resizer handles must exist');

      assert.equal(splitView.style.getPropertyValue('--navigator-width'), '264px');
      assert.equal(splitView.style.getPropertyValue('--inspector-width'), '280px');

      const dock = env.root.querySelector('#studio-timeline-dock') as any;
      // Switch sequence from default bottom dock to side navigator so navigator-resizer is expanded
      (env.root.querySelector('#btn-toggle-navigator') as any)?.click();
      assert.equal(navResizer.classList.contains('collapsed'), false, 'Toggling navigator reveals side navigator resizer');
      assert.equal(dock.classList.contains('hidden'), true, 'Showing side navigator must hide bottom timeline dock (zero duplication)');

      const dragResizer = (handle: any, startX: number, endX: number) => {
        handle.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 1, clientX: startX, button: 0 }));
        assert.equal(splitView.classList.contains('is-resizing'), true, 'Dragging should mark splitView is-resizing');
        env.window.dispatchEvent(new MockPointerEvent('pointermove', { pointerId: 1, clientX: endX }));
        env.window.dispatchEvent(new MockPointerEvent('pointerup', { pointerId: 1, clientX: endX }));
        assert.equal(splitView.classList.contains('is-resizing'), false, 'pointerup should clear is-resizing');
      };

      // In RTL, navigator is on the right -> dragging left (deltaX = -80) grows width (264 + 80 = 344)
      dragResizer(navResizer, 500, 420);
      assert.equal(splitView.style.getPropertyValue('--navigator-width'), '344px');

      // Clamping max/min for navigator [200..440]
      dragResizer(navResizer, 500, 100);
      assert.equal(splitView.style.getPropertyValue('--navigator-width'), '440px');
      dragResizer(navResizer, 100, 700);
      assert.equal(splitView.style.getPropertyValue('--navigator-width'), '200px');

      // Double-click resets navigator width to default 264px
      navResizer.dispatchEvent(new MockEvent('dblclick', { bubbles: true }));
      assert.equal(splitView.style.getPropertyValue('--navigator-width'), '264px');

      // In RTL, inspector is on the left -> dragging right (deltaX = +90) grows width to 370px
      dragResizer(inspResizer, 300, 390);
      assert.equal(splitView.style.getPropertyValue('--inspector-width'), '370px');

      // Keyboard navigation on inspector resizer (End -> 440px, Home -> 240px, ArrowRight -> +16 in LTR / +16 in RTL -> 256px)
      inspResizer.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'End' }));
      assert.equal(splitView.style.getPropertyValue('--inspector-width'), '440px');
      inspResizer.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Home' }));
      assert.equal(splitView.style.getPropertyValue('--inspector-width'), '240px');
      inspResizer.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'ArrowRight' }));
      assert.equal(splitView.style.getPropertyValue('--inspector-width'), '256px');

      // Collapse/switch behavior hides corresponding resizers and keeps single active sequence
      (env.root.querySelector('#btn-toggle-navigator') as any)?.click();
      assert.equal(navResizer.classList.contains('collapsed'), true, 'Switching back to bottom dock hides navigator resizer');
      assert.equal(dock.classList.contains('hidden'), false, 'Bottom dock is restored when switching out of side list');
      (env.root.querySelector('#btn-toggle-navigator') as any)?.click();
      assert.equal(navResizer.classList.contains('collapsed'), false, 'Restoring side navigator reveals its resizer');

      (env.root.querySelector('#btn-toggle-inspector') as any)?.click();
      assert.equal(inspResizer.classList.contains('collapsed'), true, 'Collapsed inspector hides its resizer');
      (env.root.querySelector('#btn-toggle-inspector') as any)?.click();
      assert.equal(inspResizer.classList.contains('collapsed'), false);

      // Switch to LTR and verify navigator grows when dragged right (+60px -> 324px)
      (env.root.querySelector('#btn-lang-toggle') as any)?.click();
      await flushMicrotasks();
      assert.equal(getLanguage(), 'en');
      dragResizer(navResizer, 300, 360);
      assert.equal(splitView.style.getPropertyValue('--navigator-width'), '324px');

      // Persistence check across new app mount
      const savedRaw = (globalThis as any).localStorage.getItem(PANEL_WIDTHS_STORAGE_KEY);
      assert.ok(savedRaw, 'Panel widths must be saved to localStorage');
      const saved = JSON.parse(savedRaw);
      assert.equal(saved.navigatorWidth, 324);
      assert.equal(saved.inspectorWidth, 256);

      env.root.innerHTML = '';
      new MotionPresentationApp(env.root);
      await flushMicrotasks();
      const splitViewReloaded = env.root.querySelector('.split-view') as any;
      assert.equal(splitViewReloaded.style.getPropertyValue('--navigator-width'), '324px');
      assert.equal(splitViewReloaded.style.getPropertyValue('--inspector-width'), '256px');
    } finally {
      setLanguage('ar', { persist: false, syncDesktop: false });
      resetI18nStateForTesting();
      await flushMicrotasks();
      env.teardown();
    }
  });

  await test('T1-PRO-08', 'Adaptive theme, stage swatches, Command Palette (Ctrl+K), timeline dock & context menu work cleanly', async () => {
    resetI18nStateForTesting();
    resetThemeStateForTesting();
    const { env, store } = await createTestApp(0);
    try {
      setLanguage('en', { persist: false, syncDesktop: false });
      await flushMicrotasks();

      // 1. Default theme is OS-synced system mode
      assert.equal(getThemePreference(), 'system', 'Default theme preference should be system');
      assert.equal(
        (document.documentElement as any).getAttribute('data-theme-pref'),
        'system',
        'Document root must expose data-theme-pref="system"'
      );
      const initialResolved = getResolvedTheme();
      assert.ok(initialResolved === 'dark' || initialResolved === 'light');
      assert.equal(
        (document.documentElement as any).getAttribute('data-theme'),
        initialResolved
      );

      const themeBtn = env.root.querySelector('#btn-theme-toggle') as any;
      assert.ok(themeBtn, 'Toolbar theme toggle button #btn-theme-toggle must exist');

      // 2. Clicking theme toggle flips immediately and persists across restart
      themeBtn.click();
      await flushMicrotasks();
      const firstPref = getThemePreference();
      assert.equal(firstPref, 'light', 'First click from system (dark) should switch to light');
      assert.equal(
        (globalThis as any).localStorage.getItem(THEME_STORAGE_KEY),
        'light',
        'Theme preference must be persisted in localStorage'
      );

      resetThemeStateForTesting();
      env.root.innerHTML = '';
      const reloadedApp = new MotionPresentationApp(env.root);
      const activeStore = (reloadedApp as any).store;
      await flushMicrotasks();
      assert.equal(getThemePreference(), 'light', 'Persisted theme must reload across fresh mount');
      assert.equal((document.documentElement as any).getAttribute('data-theme'), 'light');

      // Cycle back toward dark
      (env.root.querySelector('#btn-theme-toggle') as any)?.click();
      await flushMicrotasks();
      assert.equal(getThemePreference(), 'dark');

      // 3. Curated stage color swatches update deck stageBackground setting
      const swatchBtns = Array.from(env.root.querySelectorAll('.stage-swatch-btn')) as any[];
      assert.ok(swatchBtns.length >= 6, 'Deck Settings should render curated stage color swatches');
      const midnightBtn = swatchBtns.find((b) => b.dataset?.stageHex === '#0F172A');
      assert.ok(midnightBtn, 'Midnight stage swatch button (#0F172A) must exist');
      midnightBtn.click();
      await flushMicrotasks();
      assert.equal(activeStore.getSettings().stageBackground.toUpperCase(), '#0F172A');

      // 4. Command Palette opens on Ctrl+K and closes on Escape
      (window as any).dispatchEvent(new MockKeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      await flushMicrotasks();
      const paletteBackdrop = env.root.querySelector('#command-palette-backdrop') as any;
      const paletteInput = env.root.querySelector('#command-palette-input') as any;
      assert.ok(paletteBackdrop && paletteInput, 'Ctrl+K must open Command Palette');

      (window as any).dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      await flushMicrotasks();
      assert.equal(
        env.root.querySelector('#command-palette-backdrop'),
        null,
        'Escape must close Command Palette'
      );

      // 5. Studio Timeline Dock renders slide nodes/bridges and toggles collapse state
      const dockHidden = env.root.querySelector('#studio-timeline-dock') as any;
      assert.ok(dockHidden.classList.contains('hidden'), 'Timeline dock must stay hidden when deck is empty');

      activeStore.addSlideFromImage(makeMockImageAsset('dock_img_1', 'Intro.png'));
      activeStore.addSlideFromImage(makeMockImageAsset('dock_img_2', 'Features.png'));
      await flushMicrotasks();

      const dock = env.root.querySelector('#studio-timeline-dock') as any;
      assert.ok(dock && !dock.classList.contains('hidden'), 'Timeline dock must become visible with slides');
      assert.equal(dock.querySelectorAll('.dock-seq-node').length, 2, 'Timeline dock should render 2 slide nodes');
      assert.equal(dock.querySelectorAll('.dock-seq-bridge').length, 1, 'Timeline dock should render 1 transition bridge');

      const toggleDockBtn = dock.querySelector('#btn-toggle-timeline-dock') as any;
      assert.ok(toggleDockBtn, '#btn-toggle-timeline-dock button must exist');
      toggleDockBtn.click();
      assert.equal(dock.classList.contains('is-collapsed'), true, 'Clicking dock toggle collapses body');
      toggleDockBtn.click();
      assert.equal(dock.classList.contains('is-collapsed'), false, 'Clicking dock toggle again expands body');

      // 6. Slide right-click context menu renders actions and duplicates cleanly
      const firstCard = env.root.querySelector('.slide-nav-item') as any;
      assert.ok(firstCard, 'Navigator should contain at least one .slide-nav-item');
      firstCard.dispatchEvent(new MockMouseEvent('contextmenu', { clientX: 120, clientY: 140 }));
      await flushMicrotasks();

      const ctxMenu = env.root.querySelector('#studio-context-menu') as any;
      const ctxDuplicate = env.root.querySelector('#ctx-duplicate') as any;
      const ctxDelete = env.root.querySelector('#ctx-delete-slide') as any;
      assert.ok(ctxMenu && ctxDuplicate && ctxDelete, 'Right-clicking slide must open #studio-context-menu');

      ctxDuplicate.click();
      await flushMicrotasks();
      assert.equal(activeStore.getSlides().length, 3, 'Context menu Duplicate action should duplicate slide');
      assert.equal(env.root.querySelector('#studio-context-menu'), null, 'Executing action must close context menu');
    } finally {
      resetThemeStateForTesting();
      setLanguage('ar', { persist: false, syncDesktop: false });
      resetI18nStateForTesting();
      await flushMicrotasks();
      env.teardown();
    }
  });

  console.log(`\nPresentation Controls Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
