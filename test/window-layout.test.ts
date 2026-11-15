import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupMockDOM, MockKeyboardEvent } from './helpers/mock-dom';
import { makeMockImageAsset, flushMicrotasks } from './helpers/test-fixtures';
import { computeLayoutPlan, computeStageFrameSize } from '../src/ui/layout/LayoutGovernor';
import { LayerStack } from '../src/ui/core/LayerStack';
import { MotionPresentationApp } from '../src/ui/App';
import { openShortcutsHelpModalView } from '../src/ui/modals/ShortcutsHelpModal';
import { ComponentScope } from '../src/ui/core/ComponentLifecycle';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const windowController = require(path.resolve(__dirname, '../electron/lib/windowController.cjs')) as {
  clampZoomFactor: (raw: number) => number;
  stepZoomFactor: (current: number, dir: number) => number;
  computeScaledMinSize: (zoomFactor: number) => { minWidth: number; minHeight: number };
  resolveBoundsForDisplays: (args: {
    savedState: Record<string, unknown> | null;
    displays: Array<{ id: number; workArea: { x: number; y: number; width: number; height: number } }>;
    primaryDisplay: { id: number; workArea: { x: number; y: number; width: number; height: number } };
  }) => {
    x: number;
    y: number;
    width: number;
    height: number;
    mode: 'normal' | 'maximized';
    displayId: number | null;
    zoomFactor: number;
    minWidth: number;
    minHeight: number;
  };
  shouldPersistBounds: (args: {
    isDestroyed: boolean;
    isFullScreen: boolean;
    isMinimized: boolean;
    isPresenting: boolean;
  }) => boolean;
  choosePresenterDisplay: (args: {
    displays: Array<{ id: number; workArea: { x: number; y: number; width: number; height: number } }>;
    primaryDisplay: { id: number; workArea: { x: number; y: number; width: number; height: number } };
    studioDisplay: { id: number; workArea: { x: number; y: number; width: number; height: number } };
    preferredDisplayId?: number | null;
  }) => { id: number } | null;
};

export async function runWindowLayoutTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING WINDOW, LAYOUT & PRESENTER ISOLATION TESTS ---');
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
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  };

  await test('WL-1', 'windowController clamps zoom and scales min window bounds accurately', () => {
    assert.equal(windowController.clampZoomFactor(0.4), 0.8);
    assert.equal(windowController.clampZoomFactor(2.0), 1.25);
    assert.equal(windowController.clampZoomFactor(1.1), 1.1);
    assert.equal(windowController.stepZoomFactor(1.2, 1), 1.25);
    assert.deepEqual(windowController.computeScaledMinSize(1.0), { minWidth: 720, minHeight: 500 });
    assert.deepEqual(windowController.computeScaledMinSize(1.25), { minWidth: 900, minHeight: 625 });
  });

  await test('WL-2', 'windowController relocates disconnected display bounds into primary workArea', () => {
    const primary = { id: 1, workArea: { x: 0, y: 0, width: 1366, height: 728 } };
    const resolved = windowController.resolveBoundsForDisplays({
      savedState: { x: 3000, y: -500, width: 1800, height: 1000, mode: 'normal', displayId: 99, zoomFactor: 1.5 },
      displays: [primary],
      primaryDisplay: primary,
    });
    assert.equal(resolved.displayId, 1);
    assert.equal(resolved.zoomFactor, 1.25);
    assert.ok(resolved.x >= 0 && resolved.x + resolved.width <= 1366);
    assert.ok(resolved.y >= 0 && resolved.y + resolved.height <= 728);
  });

  await test('WL-3', 'windowController blocks saving bounds during fullscreen, minimize, or presenter mode', () => {
    assert.equal(
      windowController.shouldPersistBounds({ isDestroyed: false, isFullScreen: false, isMinimized: false, isPresenting: false }),
      true
    );
    assert.equal(
      windowController.shouldPersistBounds({ isDestroyed: false, isFullScreen: true, isMinimized: false, isPresenting: false }),
      false
    );
    assert.equal(
      windowController.shouldPersistBounds({ isDestroyed: false, isFullScreen: false, isMinimized: true, isPresenting: false }),
      false
    );
    assert.equal(
      windowController.shouldPersistBounds({ isDestroyed: false, isFullScreen: false, isMinimized: false, isPresenting: true }),
      false
    );
  });

  await test('WL-4', 'choosePresenterDisplay prefers secondary external monitor over studio display', () => {
    const d1 = { id: 10, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
    const d2 = { id: 20, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } };
    const chosen = windowController.choosePresenterDisplay({
      displays: [d1, d2],
      primaryDisplay: d1,
      studioDisplay: d1,
    });
    assert.equal(chosen?.id, 20);
  });

  await test('WL-5', 'LayoutGovernor adapts focusMode, sheet inspector, toolbarTier, and hysteresis cleanly', () => {
    const minPlan = computeLayoutPlan({
      viewportWidth: 720,
      viewportHeight: 500,
      isRtl: false,
      requestedSequenceMode: 'docked',
      requestedNavigatorOpen: true,
      requestedInspectorOpen: true,
      floatingSequenceSize: { width: 620, height: 176 },
      inspectorWidth: 300,
    });
    assert.equal(minPlan.focusMode, true);
    assert.equal(minPlan.inspectorMode, 'sheet');
    assert.equal(minPlan.toolbarTier, 'minimal');

    const deadbandStay = computeLayoutPlan({
      viewportWidth: 760,
      viewportHeight: 540,
      isRtl: true,
      requestedSequenceMode: 'docked',
      requestedNavigatorOpen: true,
      requestedInspectorOpen: true,
      floatingSequenceSize: { width: 620, height: 176 },
      inspectorWidth: 300,
      previousFocusMode: true,
    });
    assert.equal(deadbandStay.focusMode, true);

    const deadbandExit = computeLayoutPlan({
      viewportWidth: 780,
      viewportHeight: 620,
      isRtl: true,
      requestedSequenceMode: 'docked',
      requestedNavigatorOpen: true,
      requestedInspectorOpen: true,
      floatingSequenceSize: { width: 620, height: 176 },
      inspectorWidth: 300,
      previousFocusMode: true,
    });
    assert.equal(deadbandExit.focusMode, false);
    assert.equal(deadbandExit.inspectorMode, 'overlay');

    const frame9x16 = computeStageFrameSize({
      containerWidth: 420,
      containerHeight: 380,
      aspectRatio: 9 / 16,
    });
    assert.ok(frame9x16.width <= 420 && frame9x16.height <= 380 && frame9x16.height > frame9x16.width);
  });

  await test('WL-6', 'LayerStack suppresses toasts during presentation and pops topmost layer first', () => {
    const stack = new LayerStack();
    let modalClosed = false;
    let paletteClosed = false;
    stack.push({ id: 'm1', kind: 'modal', close: () => { modalClosed = true; stack.remove('m1'); } });
    stack.push({ id: 'cp', kind: 'command-palette', close: () => { paletteClosed = true; stack.remove('cp'); } });
    assert.equal(stack.dismissTopmost(), true);
    assert.equal(paletteClosed, true);
    assert.equal(modalClosed, false);

    assert.equal(stack.shouldSuppressToasts(), false);
    stack.setPresenting(true);
    assert.equal(stack.shouldSuppressToasts(), true);
  });

  await test('WL-7', 'App presenter epoch guard prevents null crash on F5->Esc race & isolates shortcuts/toasts', async () => {
    const env = setupMockDOM();
    let resolveEnterFs!: (val: boolean) => void;
    let fsListener: ((state: { mode: string; isFullScreen: boolean; isMaximized: boolean; isMinimized: boolean; zoomFactor: number }) => void) | null = null;
    env.desktopAPI.setFullScreen = (flag: boolean) =>
      flag ? new Promise<boolean>((r) => { resolveEnterFs = r; }) : Promise.resolve(false);
    (env.desktopAPI as any).onWindowState = (cb: any) => {
      fsListener = cb;
      return () => {};
    };

    const app = new MotionPresentationApp(env.root);
    const store = (app as any).store;
    store.addSlideFromImage(makeMockImageAsset('img_a', '01.png'));
    store.addSlideFromImage(makeMockImageAsset('img_b', '02.png'));
    await flushMicrotasks(6);

    // 1. Race: start enterFullscreenPresentation then exit before setFullScreen resolves
    const enterPromise = (app as any).enterFullscreenPresentation(0);
    await flushMicrotasks(2);
    await (app as any).exitFullscreenPresentation();
    resolveEnterFs(true);
    await enterPromise;
    await flushMicrotasks(2);

    assert.equal((app as any).isPresentingFullscreen, false);
    assert.equal((app as any).presentationTimerHandle, null);

    // 2. Normal enter presentation -> verify shortcut isolation & toast suppression & window:state exit
    env.desktopAPI.setFullScreen = async () => true;
    await (app as any).enterFullscreenPresentation(0);
    await flushMicrotasks(4);
    assert.equal((app as any).isPresentingFullscreen, true);

    store.notify('Should be suppressed during presentation', 'info');
    assert.equal(env.root.querySelector('#toast-container')?.innerHTML, '');

    env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    assert.equal((app as any).isCommandPaletteOpen, false);

    // Trigger window:state leavefullscreen sync
    fsListener?.({ mode: 'normal', isFullScreen: false, isMaximized: false, isMinimized: false, zoomFactor: 1 });
    await flushMicrotasks(4);
    assert.equal((app as any).isPresentingFullscreen, false);

    app.dispose();
    env.teardown();
  });

  await test('WL-8', 'ShortcutsHelpModal renders real <kbd> Esc badge without escaped HTML', () => {
    const env = setupMockDOM();
    const host = env.document.createElement('div');
    env.root.appendChild(host);
    const scope = new ComponentScope();
    const close = openShortcutsHelpModalView(host as any, scope, () => {});
    const footerEl = host.querySelector('.reel-cue-modal-footer');
    const kbdEl = host.querySelector('.reel-cue-modal-footer .kbd-badge');
    assert.ok(footerEl, 'Footer element must exist');
    assert.ok(kbdEl, 'Footer must contain real parsed .kbd-badge element instead of escaped text');
    assert.equal(kbdEl?.textContent, 'Esc');
    assert.equal((footerEl?.textContent || '').includes('<kbd'), false);
    close();
    scope.dispose();
    env.teardown();
  });

  return { passed, failed };
}
