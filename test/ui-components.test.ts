import assert from 'node:assert/strict';
import { MockKeyboardEvent, MockMouseEvent, setupMockDOM } from './helpers/mock-dom';
import { makeMockImageAsset } from './helpers/test-fixtures';
import { createSlideNode } from '../src/core/domain/defaults';
import { ComponentScope, escapeHtml } from '../src/ui/core/ComponentLifecycle';
import { renderWindowToolbarView } from '../src/ui/components/ToolbarView';
import { renderEmptyStageView } from '../src/ui/components/EmptyStageView';
import { renderStageHudView, resetStageHudStructure } from '../src/ui/components/StageHudView';
import { renderTimelineDockView } from '../src/ui/components/TimelineDockView';
import { openSlideContextMenuView } from '../src/ui/components/SlideContextMenu';
import { openCommandPaletteModal } from '../src/ui/modals/CommandPaletteModal';
import { openShortcutsHelpModalView } from '../src/ui/modals/ShortcutsHelpModal';
import { Icons } from '../src/ui/icons';
import { MotionPresentationApp } from '../src/ui/App';

export async function runUiComponentsTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('--- RUNNING PHASE 3: UI COMPONENTS & LIFECYCLE SUITE ---');
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

  await test('UI-01', 'ComponentScope detaches listeners deterministically across 50 re-render cycles', () => {
    const env = setupMockDOM();
    const baselineGlobal = ComponentScope.getGlobalActiveListenerCount();
    const parentScope = new ComponentScope();
    const childScope = parentScope.createChildScope();
    try {
      let clicks = 0;
      let cleanups = 0;

      for (let i = 0; i < 50; i++) {
        childScope.clear();
        const btn = env.document.createElement('button');
        childScope.listen(btn, 'click', () => {
          clicks++;
        });
        childScope.addCleanup(() => {
          cleanups++;
        });
        assert.equal(
          childScope.getActiveListenerCount(),
          1,
          'Re-render cycle must never accumulate duplicate listeners'
        );
        btn.click();
      }

      assert.equal(clicks, 50);
      assert.equal(cleanups, 49);

      const orphanBtn = env.document.createElement('button');
      childScope.listen(orphanBtn, 'click', () => {
        clicks++;
      });
      const abortedBefore = childScope.signal.aborted;
      assert.equal(abortedBefore, false);

      parentScope.dispose();
      assert.equal(childScope.isDisposed(), true);
      assert.equal(parentScope.getActiveListenerCount(), 0);
      assert.equal(
        ComponentScope.getGlobalActiveListenerCount(),
        baselineGlobal,
        'Global active listener count must return to baseline after dispose()'
      );

      // Clicking after dispose must NOT fire detached handler
      orphanBtn.click();
      assert.equal(clicks, 50);

      // escapeHtml must neutralize HTML metacharacters cleanly
      assert.equal(escapeHtml('<script>"a&b"</script>'), '&lt;script&gt;&quot;a&amp;b&quot;&lt;/script&gt;');
    } finally {
      parentScope.dispose();
      env.teardown();
    }
  });

  await test('UI-02', 'Extracted Toolbar, Launchpad, StageHUD, and TimelineDock render landmarks with zero listener leaks', () => {
    const env = setupMockDOM();
    const scope = new ComponentScope();
    try {
      const toolbarHost = env.document.createElement('header');
      const overlayHost = env.document.createElement('div');
      const hudHost = env.document.createElement('div');
      const dockHost = env.document.createElement('div');

      const s1 = createSlideNode(makeMockImageAsset('ui_img_1', '01_intro.png'), 0);
      const s2 = createSlideNode(makeMockImageAsset('ui_img_2', '02_flow.png'), 1);

      let playCount = 0;
      let importCount = 0;

      for (let cycle = 0; cycle < 20; cycle++) {
        renderWindowToolbarView(
          toolbarHost as any,
          scope,
          {
            projectTitle: `Deck ${cycle}`,
            hasSlides: true,
            isNavigatorVisible: true,
            isInspectorVisible: true,
            isGeneratingDemo: false,
            canUndo: true,
            canRedo: false,
            themeIcon: Icons.moon,
            themePref: 'dark',
          },
          {
            onProjectTitleChange: () => {},
            onToggleNavigator: () => {},
            onToggleInspector: () => {},
            onOpenProject: () => {},
            onImportMedia: () => {
              importCount++;
            },
            onOpenReelWorkflow: () => {},
            onAddSlide: () => {},
            onGenerateDemo: () => {},
            onSaveProject: () => {},
            onUndo: () => {},
            onRedo: () => {},
            onOpenShortcuts: () => {},
            onOpenCommandPalette: () => {},
            onToggleTheme: () => {},
            onToggleLanguage: () => {},
            onStartFullscreen: () => {
              playCount++;
            },
          }
        );
      }

      assert.ok(toolbarHost.querySelector('.toolbar-io-cluster'), 'Toolbar must group I/O buttons');
      assert.ok(toolbarHost.querySelector('.toolbar-creation-cluster'), 'Toolbar must group creation tools');
      assert.ok(toolbarHost.querySelector('.toolbar-history-cluster'), 'Toolbar must group history tools');
      const countAfter20 = scope.getActiveListenerCount();
      assert.equal(countAfter20, 16, 'Toolbar must have exact fixed listener count after 20 re-renders');

      (toolbarHost.querySelector('#btn-start-fullscreen') as any)?.click();
      assert.equal(playCount, 1, 'Play CTA must fire exactly once');

      // Empty Stage Launchpad
      const emptyScope = scope.createChildScope();
      renderEmptyStageView(overlayHost as any, hudHost as any, emptyScope, 0, {
        onImportMedia: () => {
          importCount++;
        },
        onOpenReelWorkflow: () => {},
        onGenerateDemo: () => {},
        onOpenProject: () => {},
      });
      assert.ok(overlayHost.querySelector('.empty-launchpad-grid'), 'Launchpad bento grid must render');
      assert.equal(
        overlayHost.querySelectorAll('.empty-workflow-card').length,
        3,
        'Launchpad must render 3 primary workflow cards'
      );
      (overlayHost.querySelector('#btn-empty-import') as any)?.click();
      assert.equal(importCount, 1);

      // Stage HUD & Timeline Dock
      const hudScope = scope.createChildScope();
      let nextClicks = 0;
      const idx = renderStageHudView(
        hudHost as any,
        hudScope,
        2,
        {
          phase: 'IDLE_ON_SLIDE',
          currentSlideIndex: 0,
          targetSlideIndex: null,
          transitionProgress: 0,
          activeTransitionName: '',
          isTransitionUsingVideo: false,
        },
        false,
        {
          onPrev: () => {},
          onNext: () => {
            nextClicks++;
          },
          onReplay: () => {},
        }
      );
      assert.equal(idx, 0);
      assert.equal(hudHost.querySelector('#hud-slide-counter')?.textContent?.trim(), '01 / 02');
      (hudHost.querySelector('#btn-hud-next') as any)?.click();
      assert.equal(nextClicks, 1);
      resetStageHudStructure(hudHost as any, hudScope);
      assert.equal(hudScope.getActiveListenerCount(), 0);

      const dockScope = scope.createChildScope();
      let selectedSlide = '';
      renderTimelineDockView(
        dockHost as any,
        dockScope,
        {
          slides: [s1, s2],
          activeSlideId: s1.id,
          isTransitionSelected: false,
          selectedTransitionSlideId: undefined,
          isCollapsed: false,
          formattedTotalDuration: '0:01',
        },
        {
          onOpenCues: () => {},
          onToggleCollapse: () => {},
          onSelectSlide: (id) => {
            selectedSlide = id;
          },
          onSelectTransition: () => {},
        }
      );
      assert.equal(dockHost.querySelectorAll('.dock-seq-node').length, 2);
      assert.equal(dockHost.querySelectorAll('.dock-seq-bridge').length, 1);
      (dockHost.querySelectorAll('.dock-seq-node')[1] as any)?.click();
      assert.equal(selectedSlide, s2.id);

      scope.dispose();
      assert.equal(scope.getActiveListenerCount(), 0, 'Disposing parent scope zeroes all child listeners');
    } finally {
      scope.dispose();
      env.teardown();
    }
  });

  await test('UI-03', 'Modals, ContextMenu, and MotionPresentationApp.dispose() leave zero stray listeners', () => {
    const env = setupMockDOM();
    const modalScope = new ComponentScope();
    try {
      const host = env.document.createElement('div');
      let ranCommand = false;
      let closedCount = 0;

      // 1. Command Palette opens, filters via input, executes on Enter, cleans up listeners
      openCommandPaletteModal({
        host: host as any,
        scope: modalScope,
        items: [
          {
            id: 'cmd-a',
            group: 'File',
            label: 'Open Project',
            shortcut: 'Ctrl+O',
            icon: Icons.folderOpen,
            run: () => {},
          },
          {
            id: 'cmd-b',
            group: 'Present',
            label: 'Start Show',
            shortcut: 'F5',
            icon: Icons.playFill,
            run: () => {
              ranCommand = true;
            },
          },
        ],
        initialQuery: '',
        initialActiveIdx: 0,
        onStateChange: () => {},
        onBeforeClose: () => {
          closedCount++;
        },
      });

      const input = host.querySelector('#command-palette-input') as any;
      assert.ok(input);
      input.value = 'Start';
      input.dispatchEvent(new MockMouseEvent('input'));
      assert.equal(host.querySelectorAll('.command-item-btn').length, 1);

      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Enter' }));
      assert.equal(ranCommand, true, 'Enter must run matching command item');
      assert.equal(closedCount, 1);
      assert.equal(modalScope.getActiveListenerCount(), 0, 'CommandPalette close must remove all window listeners');

      // 2. Shortcuts Help modal cleans up on Escape
      let shortcutsClosed = false;
      openShortcutsHelpModalView(host as any, modalScope, () => {
        shortcutsClosed = true;
      });
      assert.ok(host.querySelector('#shortcuts-modal-backdrop'));
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      assert.equal(shortcutsClosed, true);
      assert.equal(modalScope.getActiveListenerCount(), 0);

      // 3. Context Menu cleans up window/document listeners on action click
      let duplicatedId = '';
      openSlideContextMenuView(
        {
          host: host as any,
          scope: modalScope,
          slideId: 'slide_99',
          slideIndex: 0,
          totalSlides: 2,
          hasReelContext: false,
          clientX: 100,
          clientY: 120,
        },
        {
          onMoveUp: () => {},
          onMoveDown: () => {},
          onDuplicate: (id) => {
            duplicatedId = id;
          },
          onEditTransition: () => {},
          onReplaceImage: () => {},
          onOpenCues: () => {},
          onDelete: () => {},
        }
      );
      assert.ok(host.querySelector('#studio-context-menu'));
      (host.querySelector('#ctx-duplicate') as any)?.click();
      assert.equal(duplicatedId, 'slide_99');
      assert.equal(modalScope.getActiveListenerCount(), 0, 'ContextMenu click must detach all listeners');

      // 4. Full MotionPresentationApp dispose() runs cleanly
      const appRoot = env.document.createElement('div');
      const app = new MotionPresentationApp(appRoot as any);
      assert.ok(appRoot.querySelector('.empty-launchpad-grid'), 'App initial shell mounts Launchpad');
      app.dispose();
    } finally {
      modalScope.dispose();
      env.teardown();
    }
  });

  console.log(`\nUI Components & Lifecycle Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
