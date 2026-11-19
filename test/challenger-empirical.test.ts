import assert from 'node:assert';
import {
  setupMockDOM,
  teardownMockDOM,
  parseHTMLToTree,
  MockHTMLElement,
} from './helpers/mock-dom';
import { StagePlaybackEngine } from '../src/core/engine/StagePlaybackEngine';
import { SlideNode } from '../src/core/domain/types';
import { createSlideNode, createDefaultSettings } from '../src/core/domain/defaults';
import { makeMockImageAsset } from './helpers/test-fixtures';

function createMockSlide(id: string, name: string): SlideNode {
  return createSlideNode(makeMockImageAsset(id, name), 0);
}

export async function runChallengerStressTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      passed++;
      console.log(`  ✓ [CHALLENGE] ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ [CHALLENGE] ${name}:`, err);
    }
  }

  async function runAsyncTest(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ [CHALLENGE] ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ [CHALLENGE] ${name}:`, err);
    }
  }

  console.log('======================================================');
  console.log('--- EMPIRICAL CHALLENGER 1 STRESS TEST SUITE ---');
  console.log('======================================================');

  // --------------------------------------------------------------------------
  // TEST SECTION 1: mock-dom HTML Attribute Parsing & Edge Cases
  // --------------------------------------------------------------------------
  runTest('HTML Parser: quoted attributes containing > characters', () => {
    const root = new MockHTMLElement('div');
    const html = `<div id="elem1" data-expr="x > 5 && y > 10" title="A > B > C" data-math="1 > 0">content</div>`;
    parseHTMLToTree(html, root);

    const el = root.querySelector('#elem1');
    assert.ok(el, 'Element #elem1 must be parsed');
    assert.strictEqual(el.getAttribute('id'), 'elem1');
    assert.strictEqual(el.getAttribute('data-expr'), 'x > 5 && y > 10');
    assert.strictEqual(el.getAttribute('title'), 'A > B > C');
    assert.strictEqual(el.dataset.expr, 'x > 5 && y > 10');
    assert.strictEqual(el.dataset.math, '1 > 0');
    assert.strictEqual(el.textContent, 'content');
  });

  runTest('HTML Parser: unquoted and single-quoted attributes', () => {
    const root = new MockHTMLElement('div');
    const html = `<div id=main-container class=card-primary style='color: red; font-size: 14px' data-role='super-admin'>hello world</div>`;
    parseHTMLToTree(html, root);

    const el = root.querySelector('#main-container');
    assert.ok(el, 'Element #main-container must be parsed');
    assert.strictEqual(el.id, 'main-container');
    assert.strictEqual(el.className, 'card-primary');
    assert.strictEqual(el.style.color, 'red');
    assert.strictEqual(el.style.fontSize, '14px');
    assert.strictEqual(el.getAttribute('data-role'), 'super-admin');
    assert.strictEqual(el.dataset.role, 'super-admin');
    assert.strictEqual(el.textContent, 'hello world');
  });

  runTest('HTML Parser: boolean attributes (disabled, checked) & tabIndex variations', () => {
    const root = new MockHTMLElement('div');
    const html = `
      <form id="test-form">
        <button id="btn-disabled" disabled>Disabled Btn</button>
        <button id="btn-enabled">Enabled Btn</button>
        <input id="chk-checked" type="checkbox" checked />
        <input id="chk-unchecked" type="checkbox" />
        <div id="tab-zero" tabindex="0">Tab 0</div>
        <div id="tab-negative" tabindex="-1">Tab -1</div>
        <div id="tab-positive" tabIndex="5">Tab 5</div>
        <div id="tab-unquoted" tabindex=2>Tab 2</div>
      </form>
    `;
    parseHTMLToTree(html, root);

    const btnDisabled = root.querySelector('#btn-disabled');
    assert.ok(btnDisabled, '#btn-disabled must exist');
    assert.strictEqual(btnDisabled.disabled, true, 'disabled property must be true');

    const btnEnabled = root.querySelector('#btn-enabled');
    assert.ok(btnEnabled, '#btn-enabled must exist');
    assert.strictEqual(btnEnabled.disabled, false, 'disabled property must default to false');

    const chkChecked = root.querySelector('#chk-checked');
    assert.ok(chkChecked, '#chk-checked must exist');
    assert.strictEqual(chkChecked.checked, true, 'checked property must be true');

    const chkUnchecked = root.querySelector('#chk-unchecked');
    assert.ok(chkUnchecked, '#chk-unchecked must exist');
    assert.strictEqual(chkUnchecked.checked, false, 'checked property must default to false');

    const tabZero = root.querySelector('#tab-zero');
    assert.ok(tabZero, '#tab-zero must exist');
    assert.strictEqual(tabZero.tabIndex, 0, 'tabIndex 0 must be 0');

    const tabNeg = root.querySelector('#tab-negative');
    assert.ok(tabNeg, '#tab-negative must exist');
    assert.strictEqual(tabNeg.tabIndex, -1, 'tabIndex -1 must be -1');

    const tabPos = root.querySelector('#tab-positive');
    assert.ok(tabPos, '#tab-positive must exist');
    assert.strictEqual(tabPos.tabIndex, 5, 'tabIndex 5 must be 5');

    const tabUnquoted = root.querySelector('#tab-unquoted');
    assert.ok(tabUnquoted, '#tab-unquoted must exist');
    assert.strictEqual(tabUnquoted.tabIndex, 2, 'tabIndex 2 must be 2');
  });

  runTest('HTML Parser: complex nested structure with self-closing and void tags', () => {
    const root = new MockHTMLElement('div');
    const html = `
      <div id="presenter-root" class="presenter-shell active">
        <header class="hud-header">
          <span class="slide-badge" data-index="0">Slide 1 / 10</span>
          <img src="logo.png" alt="Logo" />
          <input type="text" value="search" />
        </header>
        <main class="stage-container">
          <canvas id="stage-canvas" width="1920" height="1080"></canvas>
          <div id="fs-blank-overlay" class="presenter-blank-overlay hidden"></div>
        </main>
      </div>
    `;
    parseHTMLToTree(html, root);

    const presenter = root.querySelector('#presenter-root');
    assert.ok(presenter, '#presenter-root must exist');
    assert.ok(presenter.classList.contains('presenter-shell'));
    assert.ok(presenter.classList.contains('active'));

    const canvas = root.querySelector('#stage-canvas');
    assert.ok(canvas, '#stage-canvas must exist');
    assert.strictEqual(canvas.tagName.toLowerCase(), 'canvas');

    const blankOverlay = root.querySelector('#fs-blank-overlay');
    assert.ok(blankOverlay, '#fs-blank-overlay must exist');
    assert.ok(blankOverlay.classList.contains('presenter-blank-overlay'));
    assert.ok(blankOverlay.classList.contains('hidden'));
  });

  // --------------------------------------------------------------------------
  // TEST SECTION 2: mock-dom RAF and Timer Lifecycle & Leak Prevention
  // --------------------------------------------------------------------------
  await runAsyncTest('Mock DOM: RAF timers do not leak or execute after teardownMockDOM', async () => {
    const env = setupMockDOM();
    let rafFiredCount = 0;
    let windowTimeoutFiredCount = 0;

    // Schedule 5 RAF callbacks via globalThis.requestAnimationFrame
    for (let i = 0; i < 5; i++) {
      globalThis.requestAnimationFrame(() => {
        rafFiredCount++;
      });
    }

    // Schedule 5 window.setTimeout callbacks
    for (let i = 0; i < 5; i++) {
      env.window.setTimeout(() => {
        windowTimeoutFiredCount++;
      }, 30);
    }

    // Immediately tear down DOM
    teardownMockDOM();

    // Wait 60ms - more than enough time for any leaked timers to have fired
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.strictEqual(
      rafFiredCount,
      0,
      `No pending RAF callbacks should fire after teardownMockDOM, but ${rafFiredCount} fired!`
    );
    assert.strictEqual(
      windowTimeoutFiredCount,
      0,
      `No pending window.setTimeout callbacks should fire after teardownMockDOM, but ${windowTimeoutFiredCount} fired!`
    );
  });

  await runAsyncTest('Mock DOM: RAF cancelAnimationFrame cancels specific timer cleanly', async () => {
    setupMockDOM();
    let firedId1 = false;
    let firedId2 = false;

    const id1 = globalThis.requestAnimationFrame(() => {
      firedId1 = true;
    });
    globalThis.requestAnimationFrame(() => {
      firedId2 = true;
    });

    globalThis.cancelAnimationFrame(id1);

    // Wait 35ms for id2 to fire
    await new Promise((resolve) => setTimeout(resolve, 35));

    assert.strictEqual(firedId1, false, 'id1 was cancelled and must NOT fire');
    assert.strictEqual(firedId2, true, 'id2 was NOT cancelled and must fire');

    teardownMockDOM();
  });

  // --------------------------------------------------------------------------
  // TEST SECTION 3: StagePlaybackEngine clearBlankScreen & Phase Invariants
  // --------------------------------------------------------------------------
  await runAsyncTest('StagePlaybackEngine: clearBlankScreen() behavior in all phases', async () => {
    const env = setupMockDOM();
    const canvas = env.document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const settings = createDefaultSettings();
    const engine = new StagePlaybackEngine(canvas, settings);

    const slides = [createMockSlide('s1', 'Slide 1'), createMockSlide('s2', 'Slide 2')];

    await engine.loadProject(slides, settings, 0);
    assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');

    // 1. In HOLDING_SLIDE: clearBlankScreen() must return false
    const clearedWhenHolding = engine.clearBlankScreen();
    assert.strictEqual(clearedWhenHolding, false, 'clearBlankScreen() must return false when in HOLDING_SLIDE');
    assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');

    // 2. In BLACKOUT: clearBlankScreen() must return true and unblank to HOLDING_SLIDE
    engine.toggleBlackout();
    assert.strictEqual(engine.getStatus().phase, 'BLACKOUT');
    const clearedFromBlack = engine.clearBlankScreen();
    assert.strictEqual(clearedFromBlack, true, 'clearBlankScreen() must return true when in BLACKOUT');
    assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');

    // Calling clearBlankScreen() again immediately must return false
    assert.strictEqual(engine.clearBlankScreen(), false, 'Second clearBlankScreen() call must return false');

    // 3. In WHITEOUT: clearBlankScreen() must return true and unblank to HOLDING_SLIDE
    engine.toggleWhiteout();
    assert.strictEqual(engine.getStatus().phase, 'WHITEOUT');
    const clearedFromWhite = engine.clearBlankScreen();
    assert.strictEqual(clearedFromWhite, true, 'clearBlankScreen() must return true when in WHITEOUT');
    assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');

    // 4. Destroyed engine: clearBlankScreen() must return false
    engine.destroy();
    assert.strictEqual(engine.clearBlankScreen(), false, 'clearBlankScreen() must return false when destroyed');

    teardownMockDOM();
  });

  await runAsyncTest('StagePlaybackEngine: Rapid alternation of toggleWhiteout and toggleBlackout (20x loop)', async () => {
    const env = setupMockDOM();
    const canvas = env.document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const settings = createDefaultSettings();
    const engine = new StagePlaybackEngine(canvas, settings);

    const slides = [
      createMockSlide('s1', 'Slide 1'),
      createMockSlide('s2', 'Slide 2'),
      createMockSlide('s3', 'Slide 3'),
    ];

    await engine.loadProject(slides, settings, 0);
    assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');

    // Rapidly alternate 20 times:
    // Pattern: W -> B -> W -> B -> ...
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) {
        engine.toggleWhiteout();
        assert.strictEqual(
          engine.getStatus().phase,
          'WHITEOUT',
          `Iteration ${i}: Expected phase WHITEOUT, got ${engine.getStatus().phase}`
        );
      } else {
        engine.toggleBlackout();
        assert.strictEqual(
          engine.getStatus().phase,
          'BLACKOUT',
          `Iteration ${i}: Expected phase BLACKOUT, got ${engine.getStatus().phase}`
        );
      }
    }

    // At iteration 19 (odd), phase is BLACKOUT
    assert.strictEqual(engine.getStatus().phase, 'BLACKOUT');

    // Toggling blackout again should return to HOLDING_SLIDE
    engine.toggleBlackout();
    assert.strictEqual(
      engine.getStatus().phase,
      'HOLDING_SLIDE',
      'Toggling blackout while in BLACKOUT must return to HOLDING_SLIDE'
    );

    // Now test extreme rapid alternation: 100 cycles without delay
    for (let i = 0; i < 100; i++) {
      engine.toggleBlackout(); // -> BLACKOUT
      assert.strictEqual(engine.getStatus().phase, 'BLACKOUT');
      engine.toggleWhiteout(); // -> WHITEOUT
      assert.strictEqual(engine.getStatus().phase, 'WHITEOUT');
      engine.toggleWhiteout(); // -> HOLDING_SLIDE
      assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');
    }

    // Verify engine state is clean and slide index preserved
    assert.strictEqual(engine.getStatus().currentSlideIndex, 0);
    assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');

    engine.destroy();
    teardownMockDOM();
  });

  await runAsyncTest('StagePlaybackEngine: Advance and retreat cleanly unblank from WHITEOUT and BLACKOUT', async () => {
    const env = setupMockDOM();
    const canvas = env.document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const settings = createDefaultSettings();
    const engine = new StagePlaybackEngine(canvas, settings);

    const slides = [
      createMockSlide('s1', 'Slide 1'),
      createMockSlide('s2', 'Slide 2'),
      createMockSlide('s3', 'Slide 3'),
    ];

    await engine.loadProject(slides, settings, 0);

    // 1. In WHITEOUT, calling next() unblanks and stays on slide 0 (PowerPoint behavior: first click unblanks)
    engine.toggleWhiteout();
    assert.strictEqual(engine.getStatus().phase, 'WHITEOUT');
    await engine.next();
    assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');
    assert.strictEqual(engine.getStatus().currentSlideIndex, 0, 'Unblanking via next() stays on current slide');

    // 2. In BLACKOUT, calling previous() unblanks and stays on slide
    engine.toggleBlackout();
    assert.strictEqual(engine.getStatus().phase, 'BLACKOUT');
    await engine.previous();
    assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');
    assert.strictEqual(engine.getStatus().currentSlideIndex, 0, 'Unblanking via previous() stays on current slide');

    engine.destroy();
    teardownMockDOM();
  });

  // --------------------------------------------------------------------------
  // TEST SECTION 4: Adversarial Edge Cases & Stress Invariants
  // --------------------------------------------------------------------------
  runTest('HTML Parser: 50-level deep nesting and malformed/unclosed tags', () => {
    const root = new MockHTMLElement('div');
    let deepHtml = '';
    for (let i = 0; i < 50; i++) {
      deepHtml += `<div id="level-${i}" class="nest">`;
    }
    deepHtml += `<span id="leaf">deep content</span>`;
    for (let i = 0; i < 50; i++) {
      deepHtml += `</div>`;
    }
    parseHTMLToTree(deepHtml, root);

    const leaf = root.querySelector('#leaf');
    assert.ok(leaf, 'Deeply nested leaf must be parsed');
    assert.strictEqual(leaf.textContent, 'deep content');

    // Malformed HTML: unclosed tags and mismatched tags should not throw or lock up
    const malformedRoot = new MockHTMLElement('div');
    const malformedHtml = `<div><p><span>Hello<div>world</b></p>trailing text`;
    assert.doesNotThrow(() => {
      parseHTMLToTree(malformedHtml, malformedRoot);
    });
    assert.ok(malformedRoot.children.length > 0);

    // Empty and comment-only HTML
    const emptyRoot = new MockHTMLElement('div');
    parseHTMLToTree('<!-- this is just a comment -->   \n\t', emptyRoot);
    assert.strictEqual(emptyRoot.children.length, 0);
  });

  runTest('Mock DOM: Repeated setup and teardown lifecycle resilience', () => {
    // Calling setupMockDOM twice in a row should auto-teardown without leaking
    setupMockDOM();
    const env2 = setupMockDOM();
    assert.ok(env2.root);

    // Calling teardownMockDOM multiple times should be a safe no-op
    teardownMockDOM();
    assert.doesNotThrow(() => {
      teardownMockDOM();
      teardownMockDOM();
    });
  });

  await runAsyncTest('StagePlaybackEngine: jumpToSlide unblanks and holds slide', async () => {
    const env = setupMockDOM();
    const canvas = env.document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const settings = createDefaultSettings();
    const engine = new StagePlaybackEngine(canvas, settings);

    const slides = [
      createMockSlide('s1', 'Slide 1'),
      createMockSlide('s2', 'Slide 2'),
      createMockSlide('s3', 'Slide 3'),
    ];

    await engine.loadProject(slides, settings, 0);

    // From BLACKOUT, jump to slide 2
    engine.toggleBlackout();
    assert.strictEqual(engine.getStatus().phase, 'BLACKOUT');
    engine.jumpToSlide(2);
    assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');
    assert.strictEqual(engine.getStatus().currentSlideIndex, 2);

    // From WHITEOUT, jump to slide 1
    engine.toggleWhiteout();
    assert.strictEqual(engine.getStatus().phase, 'WHITEOUT');
    engine.jumpToSlide(1);
    assert.strictEqual(engine.getStatus().phase, 'HOLDING_SLIDE');
    assert.strictEqual(engine.getStatus().currentSlideIndex, 1);

    engine.destroy();
    teardownMockDOM();
  });

  console.log('======================================================');
  console.log(`Empirical Challenger Stress Suite: ${passed} Passed, ${failed} Failed.`);
  console.log('======================================================');

  return { passed, failed };
}

// Auto-run if executed directly
if (process.argv[1]?.includes('challenger-empirical.test')) {
  runChallengerStressTests().then((res) => {
    if (res.failed > 0) {
      process.exit(1);
    }
  });
}
