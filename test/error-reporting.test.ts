import assert from 'node:assert/strict';
import {
  createErrorThrottle,
  DEFAULT_ERROR_COOLDOWN_MS,
  normalizeError,
  UNKNOWN_ERROR_MESSAGE,
} from '../src/core/services/ErrorReporting';
import { MotionPresentationApp } from '../src/ui/App';
import {
  flushMicrotasks,
  makeMockImageAsset,
} from './helpers/test-fixtures';
import { MockKeyboardEvent, setupMockDOM } from './helpers/mock-dom';

/**
 * Covers the two global safety nets that guard the studio:
 *  1. `normalizeError` / `createErrorThrottle` — the pure decision layer.
 *  2. `exitFullscreenPresentation` — must leave presentation mode even when the presenter-window
 *     IPC rejects, because a stuck presentation also disables autosave forever.
 */
export async function runErrorReportingTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function runCase(id: string, title: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ [${id}] ${title}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [${id}] ${title}:`, err);
      failed++;
    }
  }

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
    }
    await flushMicrotasks();
    return { env, app, store };
  };

  await runCase('ERR-01', 'An Error instance keeps its message and stack', () => {
    const err = new Error('Presenter window closed unexpectedly');
    const normalized = normalizeError(err, 'unhandledrejection');
    assert.equal(normalized.message, 'Presenter window closed unexpectedly');
    assert.equal(normalized.source, 'unhandledrejection');
    assert.ok(normalized.stack && normalized.stack.includes('Error'));
  });

  await runCase('ERR-02', 'String rejections are cleaned of newlines and padding', () => {
    const normalized = normalizeError('  boom\n  happened  ', 'unhandledrejection');
    assert.equal(normalized.message, 'boom happened');
    assert.equal(normalized.stack, null);
  });

  await runCase('ERR-03', 'Plain-object rejections fall back to their message field', () => {
    assert.equal(normalizeError({ message: 'IPC channel closed' }, 'error').message, 'IPC channel closed');
  });

  await runCase('ERR-04', 'Null / undefined / empty reasons never produce an empty toast', () => {
    for (const reason of [null, undefined, '', '   ', {}]) {
      assert.equal(normalizeError(reason, 'error').message, UNKNOWN_ERROR_MESSAGE);
    }
  });

  await runCase('ERR-05', 'Primitive reasons survive normalization', () => {
    assert.equal(normalizeError(42, 'error').message, '42');
    assert.equal(normalizeError(false, 'error').message, 'false');
  });

  await runCase('ERR-06', 'The throttle reports the first occurrence and suppresses repeats', () => {
    const throttle = createErrorThrottle(DEFAULT_ERROR_COOLDOWN_MS);
    assert.equal(throttle.shouldReport('disk full', 1000), true);
    assert.equal(throttle.shouldReport('disk full', 1000 + DEFAULT_ERROR_COOLDOWN_MS - 1), false);
  });

  await runCase('ERR-07', 'Suppression never extends the window (a stuck loop still reports)', () => {
    const throttle = createErrorThrottle(1000);
    assert.equal(throttle.shouldReport('loop', 0), true);
    assert.equal(throttle.shouldReport('loop', 500), false);
    assert.equal(throttle.shouldReport('loop', 1200), true, 'must report again after the cooldown');
  });

  await runCase('ERR-08', 'Different messages are throttled independently and reset clears state', () => {
    const throttle = createErrorThrottle(1000);
    assert.equal(throttle.shouldReport('a', 0), true);
    assert.equal(throttle.shouldReport('b', 0), true);
    assert.equal(throttle.shouldReport('a', 10), false);
    throttle.reset();
    assert.equal(throttle.shouldReport('a', 20), true);
  });

  await runCase(
    'ERR-09',
    'A rejecting closePresenterWindow still exits presentation mode (no stuck autosave lock)',
    async () => {
      const { env, app } = await createTestApp(3);
      try {
        // Enter presentation mode, then pretend a dedicated presenter window is on a 2nd display.
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'F5' }));
        await flushMicrotasks();
        assert.equal((app as any).isPresentingFullscreen, true);
        // The mock has no second display, so flip the flag the dual-display path would set.
        (app as any).isDedicatedPresenterOpen = true;

        // The exact failure mode: the IPC to close the second window rejects.
        env.desktopAPI.closePresenterWindow = async () => {
          throw new Error('IPC channel closed before closePresenterWindow handled');
        };

        await (app as any).exitFullscreenPresentation();
        await flushMicrotasks();

        assert.equal(
          (app as any).isPresentingFullscreen,
          false,
          'the studio must leave presentation mode even if the IPC rejects'
        );
        assert.equal(
          (app as any).isDedicatedPresenterOpen,
          false,
          'the dedicated presenter must not stay flagged as open'
        );
      } finally {
        await flushMicrotasks();
        env.teardown();
      }
    }
  );

  await runCase(
    'ERR-10',
    'Exit still completes when the presenter window close resolves normally (no regression)',
    async () => {
      const { env, app } = await createTestApp(2);
      try {
        let closeCalls = 0;
        env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'F5' }));
        await flushMicrotasks();
        (app as any).isDedicatedPresenterOpen = true;
        env.desktopAPI.closePresenterWindow = async () => {
          closeCalls++;
        };

        await (app as any).exitFullscreenPresentation();
        await flushMicrotasks();

        assert.equal(closeCalls, 1);
        assert.equal((app as any).isPresentingFullscreen, false);
      } finally {
        await flushMicrotasks();
        env.teardown();
      }
    }
  );

  console.log(`\nError Reporting Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
