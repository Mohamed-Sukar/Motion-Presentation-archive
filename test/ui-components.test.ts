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
import { openAboutModalView } from '../src/ui/modals/AboutModal';
import { Icons } from '../src/ui/icons';
import { getSavedStudioSkin, getStudioSkin, SKIN_STORAGE_KEY, STUDIO_SKINS } from '../src/ui/skins';
import { getResolvedTheme, resetThemeStateForTesting, selectStudioSkin } from '../src/ui/theme';
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
            onOpenMoreMenu: () => {},
          }
        );
      }

      assert.ok(toolbarHost.querySelector('.toolbar-io-cluster'), 'Toolbar must group I/O buttons');
      assert.ok(toolbarHost.querySelector('.toolbar-creation-cluster'), 'Toolbar must group creation tools');
      assert.ok(toolbarHost.querySelector('.toolbar-history-cluster'), 'Toolbar must group history tools');
      assert.ok(toolbarHost.querySelector('#btn-toolbar-more'), 'Toolbar must render pull-down More menu button');
      const countAfter20 = scope.getActiveListenerCount();
      assert.equal(countAfter20, 17, 'Toolbar must have exact fixed listener count after 20 re-renders');

      (toolbarHost.querySelector('#btn-start-fullscreen') as any)?.click();
      assert.equal(playCount, 1, 'Play CTA must fire exactly once');

      // Empty Stage Concept 01 Two-Column Welcome Hub
      const emptyScope = scope.createChildScope();
      renderEmptyStageView(overlayHost as any, hudHost as any, emptyScope, 0, [], {
        onImportMedia: () => {
          importCount++;
        },
        onOpenReelWorkflow: () => {},
        onGenerateDemo: () => {},
        onOpenProject: () => {},
        onOpenRecentSession: () => {},
        onTogglePinRecentSession: () => {},
        onRevealRecentSession: () => {},
        onRemoveRecentSession: () => {},
        onClearUnpinnedRecents: () => {},
      });
      assert.ok(overlayHost.querySelector('#empty-drop-card.welcome-hub'), 'Welcome two-column hub must render');
      assert.equal(
        overlayHost.querySelectorAll('.welcome-action-row').length,
        4,
        'Welcome hub must render all 4 primary action rows'
      );
      assert.ok(overlayHost.querySelector('#welcome-recent-search'), 'Welcome hub must render previous sessions search');
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

      // 2b. About modal renders Concept 10 squircle, version badge, and cleans up on Escape
      let aboutClosed = false;
      openAboutModalView(host as any, modalScope, '1.2.1', () => {
        aboutClosed = true;
      });
      assert.ok(host.querySelector('#about-modal-backdrop'), 'About modal must open');
      assert.ok(
        host.querySelector('.about-modal-version')?.textContent?.includes('1.2.1'),
        'About modal must display version string'
      );
      env.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'Escape' }));
      assert.equal(aboutClosed, true);
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
      assert.ok(appRoot.querySelector('#empty-drop-card.welcome-hub'), 'App initial shell mounts Welcome Hub');
      app.dispose();
    } finally {
      modalScope.dispose();
      env.teardown();
    }
  });

  await test('UI-04', 'Studio skins, Activity Rail, Skin Popover, Overview Grid & Chamfer SVG icons work cleanly', () => {
    const env = setupMockDOM();
    let app: MotionPresentationApp | null = null;
    try {
      // 1. Chamfer Pro icon set must strictly contain crisp SVGs and zero emojis
      const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
      for (const [key, svg] of Object.entries(Icons)) {
        assert.ok(svg.includes('<svg'), `Icons.${key} must render SVG`);
        assert.equal(emojiRegex.test(svg), false, `Icons.${key} must not contain emojis`);
      }

      // 2. All 6 Studio Skins apply and persist cleanly
      assert.equal(STUDIO_SKINS.length, 6, 'Must define 6 curated studio skins');
      for (const skin of STUDIO_SKINS) {
        selectStudioSkin(skin.id);
        assert.equal(getStudioSkin(), skin.id);
        assert.equal(env.document.documentElement.dataset.skin, skin.id);
        assert.equal((globalThis as any).localStorage.getItem(SKIN_STORAGE_KEY), skin.id);
        assert.equal(getSavedStudioSkin(), skin.id);
        assert.equal(getResolvedTheme(), skin.mode);
      }
      selectStudioSkin('framer');

      // 3. Empty Launchpad -> Workspace Rail -> M1 Skin Popover & G1 Overview toggle
      const appRoot = env.document.createElement('div');
      app = new MotionPresentationApp(appRoot as any);

      assert.ok(appRoot.querySelector('.split-view.is-deck-empty'), 'Empty deck must trigger full-bleed Launchpad');
      assert.ok(appRoot.querySelector('#activity-rail.hidden'), 'Activity rail hides during full-bleed Launchpad');

      const store = (app as any).store;
      store.addSlideFromImage(makeMockImageAsset('s1', 'slide_1.png'));
      store.addSlideFromImage(makeMockImageAsset('s2', 'slide_2.png'));

      assert.equal(appRoot.querySelector('.split-view')?.classList.contains('is-deck-empty'), false, 'Deck with slides exits empty mode');
      const railSkinsBtn = appRoot.querySelector('#rail-btn-skins') as HTMLElement | null;
      assert.ok(railSkinsBtn, 'Rail Skins button must exist when deck has slides');
      railSkinsBtn.click();

      const popoverCard = appRoot.querySelector('#skin-popover-host .skin-popover-card');
      assert.ok(popoverCard, 'Clicking Rail Skins opens M1 Skin Popover');
      assert.equal(appRoot.querySelectorAll('#skin-popover-host [data-pick-skin]').length, 6);

      (appRoot.querySelector('#skin-popover-host [data-pick-skin="capcut"]') as HTMLElement | null)?.click();
      assert.equal(env.document.documentElement.dataset.skin, 'capcut', 'Popover click switches active skin immediately');

      (appRoot.querySelector('#rail-btn-overview') as HTMLElement | null)?.click();
      const ovGrid = appRoot.querySelector('#stage-overview-grid') as HTMLElement | null;
      assert.ok(ovGrid && ovGrid.style.display === 'flex', 'Overview button reveals G1 Bento Overview Grid');
      assert.equal(appRoot.querySelectorAll('#stage-overview-grid .overview-bento-card').length, 2);

      app.dispose();
      app = null;
    } finally {
      app?.dispose();
      resetThemeStateForTesting();
      env.teardown();
    }
  });

  await test('UI-05', 'Unified single sequence, Stage Popover, Slim Inspector modals & responsive overlay drawer work cleanly', () => {
    const env = setupMockDOM();
    const baselineListeners = ComponentScope.getGlobalActiveListenerCount();
    let app: MotionPresentationApp | null = null;
    try {
      const appRoot = env.document.createElement('div');
      app = new MotionPresentationApp(appRoot as any);
      const store = (app as any).store;
      store.addSlideFromImage(makeMockImageAsset('u1', 'slide_1.png'));
      store.addSlideFromImage(makeMockImageAsset('u2', 'slide_2.png'));

      const navPane = appRoot.querySelector('#navigator-pane') as HTMLElement;
      const dock = appRoot.querySelector('#studio-timeline-dock') as HTMLElement;
      const restoreBtn = appRoot.querySelector('#btn-stage-show-sequence') as HTMLElement;

      // 1. Mutually exclusive sequence modes: initially bottom dock active, side navigator collapsed
      assert.equal(dock.classList.contains('hidden'), false, 'Bottom timeline dock active initially');
      assert.equal(navPane.classList.contains('collapsed'), true, 'Side navigator collapsed while dock active');

      // Switch to side list via dock button -> dock hides, side navigator expands
      (appRoot.querySelector('#btn-dock-to-side') as any)?.click();
      assert.equal(dock.classList.contains('hidden'), true, 'Dock hides when switched to side list');
      assert.equal(navPane.classList.contains('collapsed'), false, 'Side navigator reveals cleanly');

      // Switch back to bottom via navigator header button
      (appRoot.querySelector('#btn-nav-to-bottom') as any)?.click();
      assert.equal(dock.classList.contains('hidden'), false, 'Dock reveals when switched back');
      assert.equal(navPane.classList.contains('collapsed'), true, 'Side navigator hides cleanly');

      // 2. Stage & Aspect Ratio Popover switches ratio + sequence hidden mode
      (appRoot.querySelector('#btn-stage-settings') as any)?.click();
      assert.ok(appRoot.querySelector('#stage-settings-card'), 'Toolbar #btn-stage-settings opens Stage Popover');

      (appRoot.querySelector('[data-pick-ratio="9:16"]') as any)?.click();
      assert.equal(store.getSettings().aspectRatio, '9:16', 'Popover changes aspect ratio live');

      (appRoot.querySelector('[data-pick-layout="hidden"]') as any)?.click();
      assert.equal(dock.classList.contains('hidden'), true, 'Hidden layout hides bottom dock');
      assert.equal(navPane.classList.contains('collapsed'), true, 'Hidden layout hides side navigator');
      assert.equal(restoreBtn.style.display, 'inline-flex', 'Floating restore pill shows when sequence is hidden');

      restoreBtn.click();
      assert.equal(dock.classList.contains('hidden') && navPane.classList.contains('collapsed'), false, 'Restore pill brings back sequence');
      (appRoot.querySelector('#btn-close-stage-popover') as any)?.click();
      assert.equal(appRoot.querySelector('#stage-settings-card'), null, 'Stage popover closes cleanly');

      // 3. Inline Inspector (Idle Loop, Deck Diagnostics) & Specialized Modals (Surgical AI, Engine Prefs)
      assert.ok(appRoot.querySelector('#insp-idle-loop-card'), 'Slide tab renders inline Idle Loop card');
      assert.ok(appRoot.querySelector('#btn-insp-assign-idle'), 'Slide tab offers inline Assign Idle Loop button');

      (appRoot.querySelector('#btn-open-ai-edit-modal') as any)?.click();
      assert.ok(appRoot.querySelector('#surgical-ai-modal-body'), 'Opens Surgical AI modal');
      (appRoot.querySelector('#btn-close-workspace-modal') as any)?.click();

      store.setSelection({ type: 'settings' });
      assert.ok(appRoot.querySelector('#insp-deck-diagnostics-group .diagnostics-grid'), 'Settings tab renders inline Deck Diagnostics grid');
      (appRoot.querySelector('#btn-open-engine-prefs-modal') as any)?.click();
      assert.ok(appRoot.querySelector('#mod-interrupt-behavior'), 'Settings tab opens Engine Preferences modal');
      (appRoot.querySelector('#btn-close-workspace-modal') as any)?.click();
      assert.equal(appRoot.querySelector('#workspace-modal-backdrop'), null);

      // 4. Responsive Stage-First Overlay Drawer on narrow split window
      const splitView = appRoot.querySelector('.split-view') as any;
      splitView.getBoundingClientRect = () => ({ width: 700, height: 480, top: 0, left: 0, right: 700, bottom: 480 });
      (app as any).handleViewportResize();
      assert.equal(splitView.classList.contains('is-compact-width'), true, 'Compact width class applied below 760px');
      assert.equal(splitView.classList.contains('is-compact-height'), true, 'Compact height class applied below 640px');
      assert.equal(splitView.classList.contains('is-inspector-overlay'), false, '700px fits >=60% stage (420px) + 280px docked inspector');

      splitView.getBoundingClientRect = () => ({ width: 600, height: 480, top: 0, left: 0, right: 600, bottom: 480 });
      (app as any).handleViewportResize();
      assert.equal(splitView.classList.contains('is-inspector-overlay'), true, 'Inspector converts to overlay drawer below budget to protect >= 60% Stage width');
      assert.ok(appRoot.querySelector('#btn-close-floating-inspector'), 'Overlay drawer provides quick dismiss button');

      app.dispose();
      app = null;
      assert.ok(
        ComponentScope.getGlobalActiveListenerCount() <= baselineListeners,
        'Disposing app must leave zero leaked listeners'
      );
    } finally {
      app?.dispose();
      resetThemeStateForTesting();
      env.teardown();
    }
  });

  await test('UI-06', 'Timeline dock scrollLeft and DOM nodes survive metadata/settings edits & structural re-renders', () => {
    const env = setupMockDOM();
    let app: MotionPresentationApp | null = null;
    try {
      const appRoot = env.document.createElement('div');
      app = new MotionPresentationApp(appRoot as any);
      const store = (app as any).store;

      const addedSlides: any[] = [];
      for (let i = 1; i <= 14; i++) {
        addedSlides.push(store.addSlideFromImage(makeMockImageAsset(`s_${i}`, `slide_${i}.png`)));
      }

      const slide12 = addedSlides[11];
      const slide13 = addedSlides[12];
      store.setSelection({ type: 'slide', slideId: slide12.id });

      const dock = appRoot.querySelector('#studio-timeline-dock') as HTMLElement;
      const trackBefore = dock.querySelector('.dock-sequence-track') as HTMLElement;
      assert.ok(trackBefore, 'Timeline track must exist');
      trackBefore.scrollLeft = 1420;

      const slide13BtnBefore = dock.querySelector(`[data-dock-slide-id="${slide13.id}"]`) as HTMLElement;
      const dupBtnBefore = appRoot.querySelector('#btn-insp-duplicate-slide') as HTMLElement;
      const titleInput = appRoot.querySelector('#insp-slide-title') as any;
      const holdInput = appRoot.querySelector('#insp-slide-hold') as any;
      assert.ok(slide13BtnBefore && dupBtnBefore && titleInput && holdInput);

      // Simulate blur->change on Slide 12 title and hold duration
      titleInput.value = 'Slide 12 Edited';
      titleInput.dispatchEvent(new MockMouseEvent('change'));
      holdInput.value = '4.5';
      holdInput.dispatchEvent(new MockMouseEvent('change'));

      const trackAfterMeta = dock.querySelector('.dock-sequence-track') as HTMLElement;
      const slide13BtnAfter = dock.querySelector(`[data-dock-slide-id="${slide13.id}"]`) as HTMLElement;
      const dupBtnAfter = appRoot.querySelector('#btn-insp-duplicate-slide') as HTMLElement;
      const slide12Btn = dock.querySelector(`[data-dock-slide-id="${slide12.id}"]`) as HTMLElement;

      assert.equal(trackAfterMeta, trackBefore, 'Metadata edit must not destroy timeline track');
      assert.equal(trackAfterMeta.scrollLeft, 1420, 'Timeline scrollLeft must stay at 1420 after metadata edit');
      assert.equal(slide13BtnAfter, slide13BtnBefore, 'Timeline slide buttons must stay intact so click fires');
      assert.equal(dupBtnAfter, dupBtnBefore, 'Inspector buttons must stay intact so click fires');
      assert.equal(
        slide12Btn.querySelector('.dock-seq-label')?.textContent,
        'Slide 12 Edited',
        'Timeline slide label must update in place'
      );
      assert.equal(
        slide12Btn.querySelector('.dock-seq-hold')?.textContent,
        '4.5s',
        'Timeline hold badge must update in place'
      );
      assert.equal(
        appRoot.querySelector('#lbl-slide-hold')?.textContent,
        '4.5s',
        'Inspector hold readout must update in place'
      );

      // Clicking slide 13 right after metadata change must work immediately
      slide13BtnAfter.click();
      assert.equal(store.getSelection().slideId, slide13.id, 'First click on timeline after edit must select slide 13');

      // Structural re-render (e.g. replaceSlideImage) must also preserve timeline scrollLeft
      const trackBeforeStruct = dock.querySelector('.dock-sequence-track') as HTMLElement;
      trackBeforeStruct.scrollLeft = 1350;
      store.replaceSlideImage(slide13.id, makeMockImageAsset('s_13_new', 'slide_13_v2.png'));

      const trackAfterStruct = dock.querySelector('.dock-sequence-track') as HTMLElement;
      assert.equal(trackAfterStruct.scrollLeft, 1350, 'Structural re-render must preserve timeline scrollLeft');

      // Settings tab in-place sync must preserve DOM nodes on settings change
      store.setSelection({ type: 'settings' });
      const loopCheckBefore = appRoot.querySelector('#set-loop') as HTMLInputElement;
      const bgTextBefore = appRoot.querySelector('#set-stage-bg-text') as any;
      bgTextBefore.value = '#112233';
      bgTextBefore.dispatchEvent(new MockMouseEvent('change'));
      const loopCheckAfter = appRoot.querySelector('#set-loop') as HTMLInputElement;
      assert.equal(loopCheckAfter, loopCheckBefore, 'Settings edit must update inspector in place without wiping DOM');

      app.dispose();
      app = null;
    } finally {
      app?.dispose();
      resetThemeStateForTesting();
      env.teardown();
    }
  });

  console.log(`\nUI Components & Lifecycle Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
