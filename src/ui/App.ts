import {
  AspectRatioOption,
  BackwardBehavior,
  EngineStatus,
  FallbackTransitionStyle,
  FitMode,
  HudVisibility,
  InterruptBehavior,
  MediaAsset,
  PresentationSettings,
  SegmentEasing,
  SlideNode,
} from '../core/domain/types';
import { StagePlaybackEngine } from '../core/engine/StagePlaybackEngine';
import { DemoGenerator } from '../core/services/DemoGenerator';
import {
  FilmstripFrame,
  FrameExtractor,
  VideoFrameExtractorSession,
} from '../core/services/FrameExtractor';
import {
  ALL_MEDIA_ACCEPT_STRING,
  IMAGE_ACCEPT_STRING,
  MediaValidator,
  VIDEO_ACCEPT_STRING,
} from '../core/services/MediaValidator';
import { ProjectSerializer } from '../core/services/ProjectSerializer';
import { CueDetectionResult, CueDetectionSensitivity, SmartPairer } from '../core/services/SmartPairer';
import { MotionReelImporter, MotionReelMetadata } from '../core/services/MotionReelImporter';
import {
  AppLanguage,
  detectInitialLanguage,
  formatSlideCount,
  formatSummaryParts,
  getFlowArrow,
  getLanguage,
  hasSavedLanguagePreference,
  isRtlLanguage,
  normalizeLocaleToLanguage,
  PANEL_WIDTHS_STORAGE_KEY,
  setLanguage,
  t,
  TranslationKey,
} from '../core/i18n';
import { PresentationStore, StoreChangeType } from '../core/state/PresentationStore';
import { Icons } from './icons';
import {
  cycleThemePreference,
  detectInitialTheme,
  getResolvedTheme,
  getThemePreference,
  STAGE_COLOR_SWATCHES,
  ThemePreference,
} from './theme';

declare global {
  interface Window {
    desktopAPI?: {
      isDesktopApp: boolean;
      setFullScreen: (flag: boolean) => Promise<boolean>;
      isFullScreen: () => Promise<boolean>;
      setWindowTitle?: (title: string) => Promise<void>;
      getSystemLocale?: () => Promise<'ar' | 'en'>;
      setLanguage?: (lang: 'ar' | 'en') => Promise<'ar' | 'en'>;
      setTheme?: (theme: 'system' | 'dark' | 'light') => Promise<'dark' | 'light'>;
      openProjectDialog?: () => Promise<{
        filePath: string;
        fileName: string;
        buffer: ArrayBuffer;
      } | null>;
      saveProjectDialog?: (payload: {
        defaultFileName: string;
        currentFilePath?: string | null;
        bundleBytes: Uint8Array;
        manifestJson: string;
      }) => Promise<{ filePath: string; fileName: string } | null>;
      saveProjectDirect?: (payload: {
        filePath: string;
        bundleBytes: Uint8Array;
        manifestJson: string;
      }) => Promise<{ filePath: string; fileName: string }>;
      consumePendingProjectFile?: () => Promise<{
        filePath: string;
        fileName: string;
        buffer: ArrayBuffer;
      } | null>;
      onOpenProjectFile?: (
        callback: (payload: {
          filePath: string;
          fileName: string;
          buffer: ArrayBuffer;
        }) => void
      ) => void;
      openMediaDialog?: () => Promise<Array<{ fileName: string; mimeType: string; buffer: ArrayBuffer }> | null>;
      onMenuCommand?: (callback: (command: string) => void) => void;
      getPathForFile?: (file: File) => string | null;
    };
  }
}

export class MotionPresentationApp {
  private root: HTMLElement;
  private store: PresentationStore;

  private previewCanvas!: HTMLCanvasElement;
  private previewEngine!: StagePlaybackEngine;
  private latestEngineStatus!: EngineStatus;

  private isNavigatorVisible = true;
  private isInspectorVisible = true;
  private navigatorWidth = 288;
  private inspectorWidth = 320;
  private readonly defaultNavigatorWidth = 288;
  private readonly defaultInspectorWidth = 320;
  private readonly minNavigatorWidth = 200;
  private readonly maxNavigatorWidth = 480;
  private readonly minInspectorWidth = 260;
  private readonly maxInspectorWidth = 520;
  private isPresentingFullscreen = false;
  private isSlideGridOpen = false;
  private isGeneratingDemo = false;
  private isSavingProject = false;
  private aiEditDraftInstruction = '';
  private aiEditScopeOverride: 'slide' | 'idle-loop' | 'transition' | 'project' | null = null;
  private currentProjectFilePath: string | null = null;
  private presenterCursorTimer: number | null = null;
  private presenterOverlayEl: HTMLElement | null = null;
  private presenterEngine: StagePlaybackEngine | null = null;
  private isLaserPointerActive = false;
  private laserPointerEl: HTMLElement | null = null;
  private slideNumberBuffer = '';
  private slideNumberTimer: number | null = null;
  private slideIndicatorEl: HTMLElement | null = null;
  private onPresenterMouseMove: ((e: MouseEvent) => void) | null = null;
  private isModalOpen = false;
  private activeModalClose: (() => void) | null = null;
  private activeInspectorSplitSession: VideoFrameExtractorSession | null = null;
  private pendingRelinkTarget: string | string[] | null = null;
  private draggedSlideId: string | null = null;
  private navigatorSearchQuery = '';
  private navigatorFilterMode: 'all' | 'video' | 'notes' = 'all';
  private isPresenterNotesOpen = false;
  private presenterNotesFontSize = 15;
  private presentationStartTimeMs = 0;
  private presentationTimerHandle: ReturnType<typeof setInterval> | null = null;
  private isTimelineDockCollapsed = false;
  private isCommandPaletteOpen = false;
  private commandPaletteQuery = '';
  private commandPaletteActiveIdx = 0;
  private closeContextMenuFn: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    const initialLang = detectInitialLanguage();
    detectInitialTheme(() => {
      if (this.root.querySelector('#window-toolbar')) {
        this.renderWindowToolbar();
      }
      this.syncThemeToDesktop(getThemePreference());
    });
    this.syncThemeToDesktop(getThemePreference());
    this.store = new PresentationStore();
    this.loadSavedPanelWidths();
    this.mountInitialShell();
    this.applyPanelWidths(false);
    this.bindPaneResizers();
    this.bindGlobalShortcuts();
    this.bindNativeMenuCommands();
    this.bindDesktopProjectOpenEvents();
    this.store.subscribe((changeType) => this.onStoreUpdated(changeType));
    this.onStoreUpdated();
    void this.syncDesktopLanguageAndLocale(initialLang);
    void this.consumeInitialProjectFile();
  }

  private async syncDesktopLanguageAndLocale(initialLang: AppLanguage): Promise<void> {
    try {
      const api = window.desktopAPI;
      if (!api) return;
      if (!hasSavedLanguagePreference() && typeof api.getSystemLocale === 'function') {
        const osLocale = await api.getSystemLocale();
        const osLang = normalizeLocaleToLanguage(osLocale);
        if (osLang !== initialLang) {
          const prevLang = getLanguage();
          setLanguage(osLang, { persist: false, syncDesktop: true });
          this.store.syncDefaultTitlesForLanguage(prevLang, osLang);
          this.refreshLanguageDependentUi();
          return;
        }
      }
      if (typeof api.setLanguage === 'function') {
        await api.setLanguage(initialLang);
      }
    } catch {
      // Ignore desktop bridge sync failures
    }
  }

  private getLocalStorageSafe(): Storage | null {
    try {
      return window?.localStorage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    } catch {
      return null;
    }
  }

  private clampPanelWidth(pane: 'navigator' | 'inspector', rawWidth: number): number {
    const min = pane === 'navigator' ? this.minNavigatorWidth : this.minInspectorWidth;
    const hardMax = pane === 'navigator' ? this.maxNavigatorWidth : this.maxInspectorWidth;
    let effectiveMax = hardMax;
    const splitView = this.root.querySelector('.split-view') as HTMLElement | null;
    const splitWidth = splitView?.getBoundingClientRect?.().width || 0;
    if (splitWidth > 680) {
      const otherWidth =
        pane === 'navigator'
          ? this.isInspectorVisible
            ? this.inspectorWidth
            : 0
          : this.isNavigatorVisible
            ? this.navigatorWidth
            : 0;
      const maxFitting = Math.max(min, Math.floor(splitWidth - otherWidth - 320));
      effectiveMax = Math.min(hardMax, maxFitting);
    }
    const safeVal = Number.isFinite(rawWidth) ? rawWidth : pane === 'navigator' ? this.defaultNavigatorWidth : this.defaultInspectorWidth;
    return Math.max(min, Math.min(effectiveMax, Math.round(safeVal)));
  }

  private loadSavedPanelWidths(): void {
    let navW = this.defaultNavigatorWidth;
    let inspW = this.defaultInspectorWidth;

    const settings = this.store.getSettings();
    if (typeof settings.navigatorWidth === 'number') navW = settings.navigatorWidth;
    if (typeof settings.inspectorWidth === 'number') inspW = settings.inspectorWidth;

    try {
      const raw = this.getLocalStorageSafe()?.getItem(PANEL_WIDTHS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.navigatorWidth === 'number') navW = parsed.navigatorWidth;
        if (typeof parsed?.inspectorWidth === 'number') inspW = parsed.inspectorWidth;
      }
    } catch {
      // Ignore malformed stored widths
    }

    this.navigatorWidth = Math.max(
      this.minNavigatorWidth,
      Math.min(this.maxNavigatorWidth, Math.round(navW))
    );
    this.inspectorWidth = Math.max(
      this.minInspectorWidth,
      Math.min(this.maxInspectorWidth, Math.round(inspW))
    );
  }

  private savePanelWidths(): void {
    try {
      this.getLocalStorageSafe()?.setItem(
        PANEL_WIDTHS_STORAGE_KEY,
        JSON.stringify({
          navigatorWidth: this.navigatorWidth,
          inspectorWidth: this.inspectorWidth,
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  private applyPanelWidths(persist = false): void {
    const splitView = this.root.querySelector('.split-view') as HTMLElement | null;
    if (splitView) {
      splitView.style?.setProperty?.('--navigator-width', `${this.navigatorWidth}px`);
      splitView.style?.setProperty?.('--inspector-width', `${this.inspectorWidth}px`);
    }

    const navResizer = this.root.querySelector('#navigator-resizer') as HTMLElement | null;
    if (navResizer) {
      navResizer.setAttribute('aria-valuenow', String(this.navigatorWidth));
      navResizer.classList.toggle('collapsed', !this.isNavigatorVisible);
    }

    const inspResizer = this.root.querySelector('#inspector-resizer') as HTMLElement | null;
    if (inspResizer) {
      inspResizer.setAttribute('aria-valuenow', String(this.inspectorWidth));
      inspResizer.classList.toggle('collapsed', !this.isInspectorVisible);
    }

    if (persist) {
      this.savePanelWidths();
    }
  }

  private bindPaneResizers(): void {
    const setupResizer = (
      selector: string,
      pane: 'navigator' | 'inspector',
      defaultWidth: number,
      minWidth: number,
      maxWidth: number
    ) => {
      const resizer = this.root.querySelector(selector) as HTMLElement | null;
      const splitView = this.root.querySelector('.split-view') as HTMLElement | null;
      if (!resizer || !splitView) return;

      let activePointerId: number | null = null;
      let startX = 0;
      let startWidth = pane === 'navigator' ? this.navigatorWidth : this.inspectorWidth;

      const onPointerMove = (ev: PointerEvent) => {
        if (activePointerId === null || ev.pointerId !== activePointerId) return;
        const deltaX = ev.clientX - startX;
        const rtl = isRtlLanguage();
        const rawWidth =
          pane === 'navigator'
            ? rtl
              ? startWidth - deltaX
              : startWidth + deltaX
            : rtl
              ? startWidth + deltaX
              : startWidth - deltaX;

        const clamped = this.clampPanelWidth(pane, rawWidth);
        if (pane === 'navigator') {
          this.navigatorWidth = clamped;
        } else {
          this.inspectorWidth = clamped;
        }
        this.applyPanelWidths(false);
        this.previewEngine?.resize?.();
      };

      const finishDrag = (ev?: PointerEvent) => {
        if (activePointerId === null) return;
        if (ev && ev.pointerId !== activePointerId) return;
        const pid = activePointerId;
        activePointerId = null;
        splitView.classList.remove('is-resizing');
        resizer.classList.remove('active');
        try {
          if (typeof resizer.releasePointerCapture === 'function') {
            resizer.releasePointerCapture(pid);
          }
        } catch {
          // Ignore release errors
        }
        window.removeEventListener('pointermove', onPointerMove as any);
        window.removeEventListener('pointerup', finishDrag as any);
        window.removeEventListener('pointercancel', finishDrag as any);
        this.applyPanelWidths(true);
        this.previewEngine?.resize?.();
      };

      resizer.addEventListener('pointerdown', (e) => {
        const pe = e as PointerEvent;
        if (pe.button !== 0) return;
        if (
          (pane === 'navigator' && !this.isNavigatorVisible) ||
          (pane === 'inspector' && !this.isInspectorVisible)
        ) {
          return;
        }
        pe.preventDefault();
        activePointerId = pe.pointerId ?? 1;
        startX = pe.clientX;
        startWidth = pane === 'navigator' ? this.navigatorWidth : this.inspectorWidth;
        splitView.classList.add('is-resizing');
        resizer.classList.add('active');
        try {
          if (typeof resizer.setPointerCapture === 'function') {
            resizer.setPointerCapture(activePointerId);
          }
        } catch {
          // Ignore in synthetic environments
        }
        window.addEventListener('pointermove', onPointerMove as any);
        window.addEventListener('pointerup', finishDrag as any);
        window.addEventListener('pointercancel', finishDrag as any);
      });

      resizer.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (pane === 'navigator') {
          this.navigatorWidth = this.clampPanelWidth('navigator', defaultWidth);
        } else {
          this.inspectorWidth = this.clampPanelWidth('inspector', defaultWidth);
        }
        this.applyPanelWidths(true);
        this.previewEngine?.resize?.();
      });

      resizer.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const rtl = isRtlLanguage();
        const step = ke.shiftKey ? 40 : 16;
        let nextWidth: number | null = null;
        const current = pane === 'navigator' ? this.navigatorWidth : this.inspectorWidth;

        if (ke.key === 'ArrowLeft') {
          const growInRtl = pane === 'navigator' ? step : -step;
          const growInLtr = pane === 'navigator' ? -step : step;
          nextWidth = current + (rtl ? growInRtl : growInLtr);
        } else if (ke.key === 'ArrowRight') {
          const growInRtl = pane === 'navigator' ? -step : step;
          const growInLtr = pane === 'navigator' ? step : -step;
          nextWidth = current + (rtl ? growInRtl : growInLtr);
        } else if (ke.key === 'Home') {
          nextWidth = minWidth;
        } else if (ke.key === 'End') {
          nextWidth = maxWidth;
        } else if (ke.key === 'Enter' || ke.key === ' ') {
          nextWidth = defaultWidth;
        }

        if (nextWidth !== null) {
          ke.preventDefault();
          const clamped = this.clampPanelWidth(pane, nextWidth);
          if (pane === 'navigator') {
            this.navigatorWidth = clamped;
          } else {
            this.inspectorWidth = clamped;
          }
          this.applyPanelWidths(true);
          this.previewEngine?.resize?.();
        }
      });
    };

    setupResizer(
      '#navigator-resizer',
      'navigator',
      this.defaultNavigatorWidth,
      this.minNavigatorWidth,
      this.maxNavigatorWidth
    );
    setupResizer(
      '#inspector-resizer',
      'inspector',
      this.defaultInspectorWidth,
      this.minInspectorWidth,
      this.maxInspectorWidth
    );
  }

  private refreshLanguageDependentUi(): void {
    const toolbar = this.root.querySelector('#window-toolbar');
    toolbar?.setAttribute('aria-label', t('shell.toolbarAria'));
    this.root.querySelector('#navigator-pane')?.setAttribute('aria-label', t('shell.navigatorAria'));
    this.root.querySelector('#stage-pane')?.setAttribute('aria-label', t('shell.stageAria'));
    this.root.querySelector('#floating-stage-hud')?.setAttribute('aria-label', t('shell.hudAria'));
    this.root.querySelector('#inspector-pane')?.setAttribute('aria-label', t('shell.inspectorAria'));

    const navResizer = this.root.querySelector('#navigator-resizer');
    if (navResizer) {
      navResizer.setAttribute('aria-label', t('shell.navResizerAria'));
      navResizer.setAttribute('title', t('shell.resizerTitle'));
    }

    const inspResizer = this.root.querySelector('#inspector-resizer');
    if (inspResizer) {
      inspResizer.setAttribute('aria-label', t('shell.inspectorResizerAria'));
      inspResizer.setAttribute('title', t('shell.resizerTitle'));
    }

    const dropText = this.root.querySelector('#stage-drop-overlay span');
    if (dropText) {
      dropText.textContent = t('shell.dropOverlayText');
    }

    const hud = this.root.querySelector('#floating-stage-hud');
    if (hud) {
      hud.innerHTML = '';
    }

    this.syncWindowTitle();
    this.renderWindowToolbar();
    this.renderNavigatorPane();
    this.renderEmptyOverlay();
    this.renderFloatingStageHud();
    this.renderStudioTimelineDock();
    this.renderInspectorPane();
    this.applyPanelWidths(false);
    this.previewEngine?.resize?.();
    this.closeSlideContextMenu();
    if (this.isCommandPaletteOpen) {
      this.openCommandPalette(true);
    }
  }

  private toggleLanguage(): void {
    const prevLang = getLanguage();
    const nextLang: AppLanguage = prevLang === 'ar' ? 'en' : 'ar';
    setLanguage(nextLang, { persist: true, syncDesktop: true });
    this.store.syncDefaultTitlesForLanguage(prevLang, nextLang);
    this.refreshLanguageDependentUi();
    this.store.notify(t('notify.languageSwitched'), 'info', 2200);
  }

  private syncThemeToDesktop(pref: ThemePreference): void {
    window.desktopAPI?.setTheme?.(pref)?.catch?.(() => {
      // Ignore IPC errors in browser preview or headless test environments
    });
  }

  private getThemeIcon(pref: ThemePreference = getThemePreference()): string {
    if (pref === 'light') return Icons.sun;
    if (pref === 'dark') return Icons.moon;
    return Icons.themeAuto;
  }

  private toggleTheme(): void {
    const next = cycleThemePreference();
    this.syncThemeToDesktop(next);
    this.renderWindowToolbar();
    this.store.notify(
      t('notify.themeSwitched', { theme: t(`theme.${next}`) }),
      'info',
      1800
    );
  }

  private mountInitialShell(): void {
    this.root.innerHTML = `
      <header class="window-toolbar" id="window-toolbar" role="toolbar" aria-label="${this.escapeHtml(t('shell.toolbarAria'))}"></header>
      <main class="split-view">
        <aside class="navigator-pane" id="navigator-pane" aria-label="${this.escapeHtml(t('shell.navigatorAria'))}"></aside>
        <div
          class="pane-resizer pane-resizer-navigator"
          id="navigator-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="${this.escapeHtml(t('shell.navResizerAria'))}"
          aria-valuemin="${this.minNavigatorWidth}"
          aria-valuemax="${this.maxNavigatorWidth}"
          aria-valuenow="${this.navigatorWidth}"
          title="${this.escapeHtml(t('shell.resizerTitle'))}"
          tabindex="0"
        ></div>
        <section class="stage-pane" id="stage-pane" aria-label="${this.escapeHtml(t('shell.stageAria'))}">
          <div class="stage-canvas-area">
            <div class="stage-canvas-frame" id="canvas-frame">
              <canvas class="stage-canvas" id="preview-canvas"></canvas>
            </div>
            <div class="stage-drop-overlay" id="stage-drop-overlay">
              ${Icons.folderImport}
              <span>${this.escapeHtml(t('shell.dropOverlayText'))}</span>
            </div>
            <div class="empty-canvas-sheet" id="empty-overlay" style="display:none;"></div>
            <div class="floating-stage-hud" id="floating-stage-hud" role="region" aria-label="${this.escapeHtml(t('shell.hudAria'))}"></div>
          </div>
          <div class="studio-timeline-dock hidden" id="studio-timeline-dock"></div>
        </section>
        <div
          class="pane-resizer pane-resizer-inspector"
          id="inspector-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="${this.escapeHtml(t('shell.inspectorResizerAria'))}"
          aria-valuemin="${this.minInspectorWidth}"
          aria-valuemax="${this.maxInspectorWidth}"
          aria-valuenow="${this.inspectorWidth}"
          title="${this.escapeHtml(t('shell.resizerTitle'))}"
          tabindex="0"
        ></div>
        <aside class="inspector-pane" id="inspector-pane" aria-label="${this.escapeHtml(t('shell.inspectorAria'))}"></aside>
      </main>
      <div id="toast-container" aria-live="polite"></div>
      <div id="fullscreen-root"></div>
      <div id="choice-modal-host"></div>
      <div id="reel-modal-host"></div>
      <div id="shortcuts-modal-host"></div>
      <div id="command-palette-host"></div>
      <div id="context-menu-host"></div>
      <input type="file" id="reel-video-input" accept="${VIDEO_ACCEPT_STRING}" style="display:none;" />
      <input type="file" id="relink-video-input" accept="${VIDEO_ACCEPT_STRING}" style="display:none;" />
      <input type="file" id="batch-file-input" multiple accept="${ALL_MEDIA_ACCEPT_STRING}" style="display:none;" />
      <input type="file" id="single-image-input" accept="${IMAGE_ACCEPT_STRING}" style="display:none;" />
      <input type="file" id="single-video-input" accept="${VIDEO_ACCEPT_STRING}" style="display:none;" />
      <input type="file" id="project-file-input" accept=".mpres,.mpres.json,.json" style="display:none;" />
    `;

    this.previewCanvas = this.root.querySelector('#preview-canvas') as HTMLCanvasElement;
    this.previewEngine = new StagePlaybackEngine(
      this.previewCanvas,
      this.store.getSettings()
    );

    this.previewEngine.onStatusChange((status) => {
      this.latestEngineStatus = status;
      this.renderFloatingStageHud();
      this.syncTimelineDockActiveState();
    });

    this.previewCanvas.addEventListener('click', () => {
      if (this.store.getSlides().length > 0) {
        this.previewEngine.next();
      }
    });

    this.setupGlobalDragAndDrop();
    this.setupHiddenFileInputs();
  }

  private async onStoreUpdated(changeType?: StoreChangeType): Promise<void> {
    if (changeType === 'notification') {
      this.renderToast();
      return;
    }

    if (changeType === 'selection') {
      this.syncSelectionHighlight();
      this.syncToolbarUndoRedoState();
      this.renderInspectorPane();
      const targetIdx = this.store.getActivePreviewIndex();
      if (
        this.latestEngineStatus &&
        this.latestEngineStatus.currentSlideIndex !== targetIdx &&
        this.latestEngineStatus.phase !== 'PLAYING_TRANSITION'
      ) {
        this.previewEngine.jumpToSlide(targetIdx);
      }
      return;
    }

    if (changeType === 'metadata') {
      const project = this.store.getProject();
      const titleInput = this.root.querySelector('#project-title-input') as HTMLInputElement;
      if (titleInput && document.activeElement !== titleInput) {
        titleInput.value = project.title;
      }
      this.syncToolbarUndoRedoState();
      this.updateNavigatorCaptions();
      this.renderStudioTimelineDock();
      this.renderInspectorPane();
      return;
    }

    if (changeType === 'settings') {
      const settings = this.store.getSettings();
      this.updateCanvasFrameDimensions(settings);
      this.previewEngine.updateSettingsLive(settings);
      this.presenterEngine?.updateSettingsLive(settings);
      this.syncToolbarUndoRedoState();
      this.renderInspectorPane();
      return;
    }

    // Structural changes (slides added/removed, full project loaded)
    this.renderWindowToolbar();
    this.renderNavigatorPane();
    this.renderEmptyOverlay();
    this.renderStudioTimelineDock();
    this.renderInspectorPane();
    this.renderToast();

    const slides = this.store.getSlides();
    const settings = this.store.getSettings();
    const targetIdx = this.store.getActivePreviewIndex();

    this.updateCanvasFrameDimensions(settings);
    this.previewEngine.updateSettingsLive(settings);
    await this.previewEngine.loadProject(slides, settings, targetIdx);
  }

  private updateCanvasFrameDimensions(settings: PresentationSettings): void {
    const frameEl = this.root.querySelector('#canvas-frame') as HTMLElement;
    if (!frameEl) return;
    const ratioMap: Record<AspectRatioOption, { css: string; num: number }> = {
      '16:9': { css: '16 / 9', num: 16 / 9 },
      '16:10': { css: '16 / 10', num: 16 / 10 },
      '4:3': { css: '4 / 3', num: 4 / 3 },
      '9:16': { css: '9 / 16', num: 9 / 16 },
    };
    const r = ratioMap[settings.aspectRatio as AspectRatioOption] || ratioMap['16:9'];
    frameEl.style.aspectRatio = r.css;
    frameEl.style.width = `min(100%, calc((100vh - 160px) * ${r.num}))`;
  }

  private syncMultiSelectBar(): void {
    const slot = this.root.querySelector('#nav-multi-select-slot') as HTMLElement | null;
    if (!slot) return;

    const selection = this.store.getSelection();
    const multiSel = this.store.getMultiSelectionSummary?.() ?? {
      slideIds: selection.type === 'slide' ? [selection.slideId] : [],
      transitionSlideIds: selection.type === 'transition' ? [selection.slideId] : [],
      totalCount: selection.type === 'slide' || selection.type === 'transition' ? 1 : 0,
    };

    if (multiSel.totalCount <= 1) {
      slot.innerHTML = '';
      return;
    }

    const parts: string[] = [];
    if (multiSel.slideIds.length > 0) {
      parts.push(this.formatArabicSlideCount(multiSel.slideIds.length));
    }
    if (multiSel.transitionSlideIds.length > 0) {
      parts.push(
        t('nav.multiSelectTransitions', { count: multiSel.transitionSlideIds.length })
      );
    }

    slot.innerHTML = `
      <div class="nav-multi-select-bar" id="nav-multi-select-bar" role="region" aria-label="${this.escapeHtml(t('nav.multiSelectAria'))}">
        <div class="nav-multi-select-info">
          <span class="nav-multi-badge tabular-nums">${multiSel.totalCount}</span>
          <span>${parts.join(' · ')}</span>
        </div>
        <div class="nav-multi-select-actions">
          <button class="btn btn-xs btn-destructive" id="btn-nav-delete-selected" title="${this.escapeHtml(t('nav.deleteSelectedTitle'))}">
            ${Icons.trash}
            <span>${t('nav.deleteSelected')}</span>
          </button>
          <button class="btn btn-xs" id="btn-nav-clear-selection" title="${this.escapeHtml(t('nav.clearSelectionTitle'))}">
            ${t('nav.clearSelection')}
          </button>
        </div>
      </div>
    `;

    slot.querySelector('#btn-nav-delete-selected')?.addEventListener('click', () => {
      this.handleDeleteAction();
    });
    slot.querySelector('#btn-nav-clear-selection')?.addEventListener('click', () => {
      this.store.clearMultiSelection();
    });
  }

  private syncSelectionHighlight(): void {
    const selection = this.store.getSelection();
    this.root.querySelectorAll('.slide-nav-item').forEach((item) => {
      const id = (item as HTMLElement).dataset.slideId;
      const isSelected = Boolean(
        id &&
          (this.store.isSlideSelected
            ? this.store.isSlideSelected(id)
            : selection.type === 'slide' && selection.slideId === id)
      );
      item.classList.toggle('selected', isSelected);
    });
    this.root.querySelectorAll('.filmstrip-bridge').forEach((bridge) => {
      const id = (bridge as HTMLElement).dataset.transitionSlideId;
      const isSelected = Boolean(
        id &&
          (this.store.isTransitionSelected
            ? this.store.isTransitionSelected(id)
            : selection.type === 'transition' && selection.slideId === id)
      );
      bridge.classList.toggle('selected', isSelected);
    });
    this.syncMultiSelectBar();
    this.syncTimelineDockActiveState();
  }

  private updateNavigatorCaptions(): void {
    const slides = this.store.getSlides();
    this.root.querySelectorAll('.slide-nav-item').forEach((item) => {
      const id = (item as HTMLElement).dataset.slideId;
      const slide = slides.find((s) => s.id === id);
      if (slide) {
        const titleEl = item.querySelector('.slide-caption-title');
        if (titleEl) titleEl.textContent = slide.title;
        const captionRow = item.querySelector('.slide-caption-row');
        const existingBadge = captionRow?.querySelector('.slide-notes-badge');
        const hasNotes = Boolean(slide.notes && slide.notes.trim().length > 0);
        if (hasNotes && !existingBadge && captionRow) {
          const badge = document.createElement('span');
          badge.className = 'slide-notes-badge';
          badge.title = t('nav.hasNotesTitle');
          badge.innerHTML = Icons.notes;
          const metaEl = captionRow.querySelector('.slide-caption-meta');
          captionRow.insertBefore(badge, metaEl || null);
        } else if (!hasNotes && existingBadge) {
          existingBadge.remove();
        }
        const metaEl = item.querySelector('.slide-caption-meta');
        if (metaEl) metaEl.textContent = slide.holdDurationSec ? `${slide.holdDurationSec}s` : '';
      }
    });
    this.applyNavigatorFilter();
  }

  private syncToolbarUndoRedoState(): void {
    const undoBtn = this.root.querySelector('#btn-studio-undo') as HTMLButtonElement | null;
    const redoBtn = this.root.querySelector('#btn-studio-redo') as HTMLButtonElement | null;
    if (undoBtn) {
      undoBtn.disabled = !(this.store.canUndo?.() ?? false);
    }
    if (redoBtn) {
      redoBtn.disabled = !(this.store.canRedo?.() ?? false);
    }
  }

  /* =========================================================================
   * 1. INTEGRATED WINDOW TOOLBAR (toolbars.md)
   * ========================================================================= */
  private renderWindowToolbar(): void {
    const toolbar = this.root.querySelector('#window-toolbar') as HTMLElement;
    if (!toolbar) return;

    const project = this.store.getProject();
    const hasSlides = project.slides.length > 0;
    const rtl = isRtlLanguage();
    const navIcon = rtl ? Icons.sidebarRight : Icons.sidebarLeft;
    const inspIcon = rtl ? Icons.sidebarLeft : Icons.sidebarRight;
    const themePref = getThemePreference();
    const themeTitle = `${t('toolbar.themeToggleTitle')} (${t(`theme.${themePref}`)})`;

    toolbar.innerHTML = `
      <div class="toolbar-group-leading">
        <button
          class="btn btn-toolbar btn-icon-only ${this.isNavigatorVisible ? 'active-pane' : ''}"
          id="btn-toggle-navigator"
          title="${this.escapeHtml(t('toolbar.toggleNavTitle'))}"
          aria-label="${this.escapeHtml(t('toolbar.toggleNavTitle'))}"
        >
          ${navIcon}
        </button>
        <div class="toolbar-divider"></div>
        <input
          type="text"
          class="doc-title-input"
          id="project-title-input"
          value="${this.escapeHtml(project.title)}"
          aria-label="${this.escapeHtml(t('toolbar.projectTitleAria'))}"
          placeholder="${this.escapeHtml(t('toolbar.projectTitlePlaceholder'))}"
        />
      </div>

      <div class="toolbar-group-center">
        <button class="btn btn-toolbar is-compactable" id="btn-open-project" title="${this.escapeHtml(t('toolbar.openProjectTitle'))}" aria-label="${this.escapeHtml(t('toolbar.openProjectTitle'))}">
          ${Icons.folderOpen}
          <span class="btn-label">${t('toolbar.openProject')}</span>
        </button>

        <button class="btn btn-toolbar is-compactable-md" id="btn-batch-import" title="${this.escapeHtml(t('toolbar.importMediaTitle'))}" aria-label="${this.escapeHtml(t('toolbar.importMediaTitle'))}">
          ${Icons.folderImport}
          <span class="btn-label">${t('toolbar.importMedia')}</span>
        </button>

        <button class="btn btn-toolbar is-compactable-md" id="btn-reel-workflow" title="${this.escapeHtml(t('toolbar.reelWorkflowTitle'))}" aria-label="${this.escapeHtml(t('toolbar.reelWorkflowTitle'))}">
          ${Icons.filmTransition}
          <span class="btn-label">${t('toolbar.reelWorkflow')}</span>
        </button>

        <button class="btn btn-toolbar is-compactable" id="btn-add-slide" title="${this.escapeHtml(t('toolbar.addSlideTitle'))}" aria-label="${this.escapeHtml(t('toolbar.addSlideTitle'))}">
          ${Icons.photoPlus}
          <span class="btn-label">${t('toolbar.addSlide')}</span>
        </button>

        <div class="toolbar-divider"></div>

        <button class="btn btn-toolbar is-compactable" id="btn-load-demo" ${this.isGeneratingDemo ? 'disabled' : ''} title="${this.escapeHtml(t('toolbar.loadDemoTitle'))}" aria-label="${this.escapeHtml(t('toolbar.loadDemoTitle'))}">
          ${Icons.sparkles}
          <span class="btn-label">${this.isGeneratingDemo ? t('toolbar.loadDemoBusy') : t('toolbar.loadDemo')}</span>
        </button>

        <button class="btn btn-toolbar is-compactable" id="btn-export-manifest" ${!hasSlides ? 'disabled' : ''} title="${this.escapeHtml(t('toolbar.saveProjectTitle'))}" aria-label="${this.escapeHtml(t('toolbar.saveProjectTitle'))}">
          ${Icons.exportDoc}
          <span class="btn-label">${t('toolbar.saveProject')}</span>
        </button>

        <div class="toolbar-divider"></div>

        <button class="btn btn-toolbar btn-icon-only" id="btn-studio-undo" ${!(this.store.canUndo?.() ?? false) ? 'disabled' : ''} title="${this.escapeHtml(t('toolbar.undoTitle'))}" aria-label="${this.escapeHtml(t('toolbar.undoTitle'))}">
          ${Icons.undo}
        </button>
        <button class="btn btn-toolbar btn-icon-only" id="btn-studio-redo" ${!(this.store.canRedo?.() ?? false) ? 'disabled' : ''} title="${this.escapeHtml(t('toolbar.redoTitle'))}" aria-label="${this.escapeHtml(t('toolbar.redoTitle'))}">
          ${Icons.redo}
        </button>
        <button class="btn btn-toolbar btn-icon-only" id="btn-shortcuts-help" title="${this.escapeHtml(t('toolbar.shortcutsTitle'))}" aria-label="${this.escapeHtml(t('toolbar.shortcutsTitle'))}">
          ${Icons.keyboard}
        </button>
      </div>

      <div class="toolbar-group-trailing">
        <button
          class="btn btn-toolbar btn-icon-only"
          id="btn-command-palette"
          type="button"
          title="${this.escapeHtml(t('toolbar.commandPaletteTitle'))}"
          aria-label="${this.escapeHtml(t('toolbar.commandPaletteTitle'))}"
        >
          ${Icons.command}
        </button>
        <button
          class="btn btn-toolbar btn-icon-only"
          id="btn-theme-toggle"
          type="button"
          data-theme-pref="${themePref}"
          data-theme-resolved="${getResolvedTheme()}"
          title="${this.escapeHtml(themeTitle)}"
          aria-label="${this.escapeHtml(themeTitle)}"
        >
          ${this.getThemeIcon(themePref)}
        </button>
        <button
          class="btn btn-toolbar btn-lang-toggle"
          id="btn-lang-toggle"
          type="button"
          title="${this.escapeHtml(t('toolbar.langToggleTitle'))}"
          aria-label="${this.escapeHtml(t('toolbar.langToggleTitle'))}"
        >
          ${Icons.globe}
          <span class="lang-toggle-code">${t('toolbar.langCurrent')}</span>
        </button>
        <button
          class="btn btn-toolbar btn-icon-only ${this.isInspectorVisible ? 'active-pane' : ''}"
          id="btn-toggle-inspector"
          title="${this.escapeHtml(t('toolbar.toggleInspectorTitle'))}"
          aria-label="${this.escapeHtml(t('toolbar.toggleInspectorTitle'))}"
        >
          ${inspIcon}
        </button>
        <button class="btn btn-prominent" id="btn-start-fullscreen" ${!hasSlides ? 'disabled' : ''} title="${this.escapeHtml(t('toolbar.playPresentationTitle'))}">
          ${Icons.playFill}
          <span>${t('toolbar.playPresentation')}</span>
        </button>
      </div>
    `;

    const titleInput = toolbar.querySelector('#project-title-input') as HTMLInputElement;
    titleInput?.addEventListener('change', () => {
      this.store.setProjectTitle(titleInput.value);
    });

    toolbar.querySelector('#btn-command-palette')?.addEventListener('click', () => {
      this.openCommandPalette();
    });

    toolbar.querySelector('#btn-theme-toggle')?.addEventListener('click', () => {
      this.toggleTheme();
    });

    toolbar.querySelector('#btn-lang-toggle')?.addEventListener('click', () => {
      this.toggleLanguage();
    });

    toolbar.querySelector('#btn-toggle-navigator')?.addEventListener('click', () => {
      this.toggleNavigatorPane();
    });

    toolbar.querySelector('#btn-toggle-inspector')?.addEventListener('click', () => {
      this.toggleInspectorPane();
    });

    toolbar.querySelector('#btn-open-project')?.addEventListener('click', () => {
      this.handleOpenProject();
    });

    toolbar.querySelector('#btn-load-demo')?.addEventListener('click', () => {
      this.handleGenerateDemo();
    });

    toolbar.querySelector('#btn-batch-import')?.addEventListener('click', () => {
      this.handleImportMedia();
    });

    toolbar.querySelector('#btn-reel-workflow')?.addEventListener('click', () => {
      this.handleOpenReelWorkflow();
    });

    toolbar.querySelector('#btn-add-slide')?.addEventListener('click', () => {
      const input = this.root.querySelector('#single-image-input') as HTMLInputElement;
      input.dataset.replaceSlideId = '';
      input.click();
    });

    toolbar.querySelector('#btn-export-manifest')?.addEventListener('click', () => {
      void this.handleSaveProject(false);
    });

    toolbar.querySelector('#btn-studio-undo')?.addEventListener('click', () => {
      if (this.store.undo()) {
        this.store.notify(t('notify.undoDone'), 'info', 2000);
      }
    });

    toolbar.querySelector('#btn-studio-redo')?.addEventListener('click', () => {
      if (this.store.redo()) {
        this.store.notify(t('notify.redoDone'), 'info', 2000);
      }
    });

    toolbar.querySelector('#btn-shortcuts-help')?.addEventListener('click', () => {
      this.openShortcutsHelpModal();
    });

    toolbar.querySelector('#btn-start-fullscreen')?.addEventListener('click', () => {
      this.enterFullscreenPresentation(this.latestEngineStatus?.currentSlideIndex || 0);
    });
  }

  private toggleNavigatorPane(): void {
    this.isNavigatorVisible = !this.isNavigatorVisible;
    const navPane = this.root.querySelector('#navigator-pane');
    navPane?.classList.toggle('collapsed', !this.isNavigatorVisible);
    const navResizer = this.root.querySelector('#navigator-resizer');
    navResizer?.classList.toggle('collapsed', !this.isNavigatorVisible);
    const btn = this.root.querySelector('#btn-toggle-navigator');
    btn?.classList.toggle('active-pane', this.isNavigatorVisible);
    this.previewEngine?.resize?.();
  }

  private toggleInspectorPane(): void {
    this.isInspectorVisible = !this.isInspectorVisible;
    const inspPane = this.root.querySelector('#inspector-pane');
    inspPane?.classList.toggle('collapsed', !this.isInspectorVisible);
    const inspResizer = this.root.querySelector('#inspector-resizer');
    inspResizer?.classList.toggle('collapsed', !this.isInspectorVisible);
    const btn = this.root.querySelector('#btn-toggle-inspector');
    btn?.classList.toggle('active-pane', this.isInspectorVisible);
    this.previewEngine?.resize?.();
  }

  private syncWindowTitle(): void {
    const appName = t('app.name');
    const title = this.store.getProject().title?.trim() || appName;
    const fullTitle = `${title} — ${appName}`;
    document.title = fullTitle;
    void window.desktopAPI?.setWindowTitle?.(fullTitle);
  }

  private bindDesktopProjectOpenEvents(): void {
    window.desktopAPI?.onOpenProjectFile?.((payload) => {
      if (!payload?.buffer) return;
      void this.openProjectFromBytes(
        new Uint8Array(payload.buffer),
        payload.fileName,
        payload.filePath
      );
    });
  }

  private async consumeInitialProjectFile(): Promise<void> {
    try {
      const pending = await window.desktopAPI?.consumePendingProjectFile?.();
      if (pending?.buffer) {
        await this.openProjectFromBytes(
          new Uint8Array(pending.buffer),
          pending.fileName,
          pending.filePath
        );
      }
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.openSelectedProjectError'),
        'error'
      );
    }
  }

  private async openProjectFromBytes(
    bytes: Uint8Array,
    fileName: string,
    filePath?: string | null
  ): Promise<void> {
    try {
      if (this.isPresentingFullscreen) {
        await this.exitFullscreenPresentation();
      }
      if (this.isModalOpen && this.activeModalClose) {
        this.activeModalClose();
      }
      this.store.notify(t('notify.openProjectProgress', { name: fileName }), 'info', 2500);
      const parsed = ProjectSerializer.parseProjectBytes(bytes);
      await this.store.loadProjectBundle(parsed);
      this.currentProjectFilePath = filePath || null;
      this.syncWindowTitle();
      this.store.notify(
        t('notify.openProjectSuccess', { title: parsed.projectData.title }),
        'success'
      );
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.openProjectError'),
        'error'
      );
    }
  }

  private async handleSaveProject(saveAs = false): Promise<void> {
    if (this.isSavingProject) return;
    const project = this.store.getProject();
    if (project.slides.length === 0) return;

    this.isSavingProject = true;
    try {
      this.store.notify(t('notify.saveProjectProgress'), 'info', 3000);
      void ProjectSerializer.cacheProjectAssetsToLocalDb(project);

      const bundleBytes = await ProjectSerializer.buildBundleBytes(project);
      const manifestJson = JSON.stringify(ProjectSerializer.buildManifestObject(project), null, 2);
      const safeName = project.title.replace(/[\\/:*?"<>|]/g, '_') || 'presentation';

      if (window.desktopAPI?.saveProjectDialog && window.desktopAPI?.saveProjectDirect) {
        const canDirectSave =
          !saveAs &&
          Boolean(this.currentProjectFilePath) &&
          this.currentProjectFilePath!.toLowerCase().endsWith('.mpres');

        const suggestedPath = this.currentProjectFilePath
          ? this.currentProjectFilePath.replace(/(\.mpres\.json|\.json)$/i, '.mpres')
          : `${safeName}.mpres`;

        const result = canDirectSave
          ? await window.desktopAPI.saveProjectDirect({
              filePath: this.currentProjectFilePath!,
              bundleBytes,
              manifestJson,
            })
          : await window.desktopAPI.saveProjectDialog({
              defaultFileName: `${safeName}.mpres`,
              currentFilePath: suggestedPath,
              bundleBytes,
              manifestJson,
            });

        if (!result) return;
        this.currentProjectFilePath = result.filePath;
        this.syncWindowTitle();
        this.store.notify(t('notify.saveProjectSuccess', { name: result.fileName }), 'success');
      } else {
        ProjectSerializer.triggerBundleDownload(project.title, bundleBytes);
        this.store.notify(t('notify.saveProjectSuccessDefault'), 'success');
      }
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.saveProjectError'),
        'error'
      );
    } finally {
      this.isSavingProject = false;
    }
  }

  private async handleOpenProject(): Promise<void> {
    try {
      if (window.desktopAPI?.openProjectDialog) {
        const res = await window.desktopAPI.openProjectDialog();
        if (!res) return;
        await this.openProjectFromBytes(new Uint8Array(res.buffer), res.fileName, res.filePath);
      } else {
        const input = this.root.querySelector('#project-file-input') as HTMLInputElement;
        input?.click();
      }
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.openProjectError'),
        'error'
      );
    }
  }

  private async handleImportMedia(): Promise<void> {
    if (window.desktopAPI?.openMediaDialog) {
      try {
        const selected = await window.desktopAPI.openMediaDialog();
        if (selected && selected.length > 0) {
          const files = selected.map(
            (item) => new File([item.buffer], item.fileName, { type: item.mimeType })
          );
          await this.handleBatchFiles(files);
        }
      } catch (err) {
        this.store.notify(
          err instanceof Error ? err.message : t('notify.importMediaError'),
          'error'
        );
      }
    } else {
      (this.root.querySelector('#batch-file-input') as HTMLInputElement)?.click();
    }
  }

  /* =========================================================================
   * 2. LEADING PANE: KEYNOTE NAVIGATOR + MAGNETIC FILMSTRIP BRIDGE
   * ========================================================================= */
  private renderNavigatorPane(): void {
    const pane = this.root.querySelector('#navigator-pane') as HTMLElement;
    if (!pane) return;

    pane.classList.toggle('collapsed', !this.isNavigatorVisible);

    const slides = this.store.getSlides();
    const settings = this.store.getSettings();
    const selection = this.store.getSelection();
    const activeIdx = this.latestEngineStatus?.currentSlideIndex ?? 0;
    const missingVideos = this.store.getMissingVideoAssets?.() ?? [];
    const reelContext = this.store.getReelContextForSlide?.() ?? null;

    const fallbackShortNames: Record<FallbackTransitionStyle, string> = {
      crossfade: t('fallback.short.crossfade'),
      'zoom-morph': t('fallback.short.zoom-morph'),
      'slide-push': t('fallback.short.slide-push'),
      'wipe-reveal': t('fallback.short.wipe-reveal'),
      'iris-spotlight': t('fallback.short.iris-spotlight'),
      cut: t('fallback.short.cut'),
    };

    let bannerHtml = '';
    if (missingVideos.length > 0) {
      const firstMissing = missingVideos[0];
      bannerHtml = `
        <div class="nav-context-banner warning" role="region" aria-label="${this.escapeHtml(t('nav.unlinkedTitle'))}">
          <div class="nav-context-banner-row">
            <span style="display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--signal-danger-text);">
              ${Icons.alertCircle}
              <span>${t('nav.unlinkedText')}</span>
            </span>
            <button class="btn btn-xs btn-prominent" id="btn-nav-relink-video" title="${this.escapeHtml(t('nav.relinkTitle'))}">
              ${Icons.relink}
              <span>${t('nav.relinkBtn')}</span>
            </button>
          </div>
          <div class="nav-context-banner-sub" title="${this.escapeHtml(firstMissing.videoFileName)}">
            ${this.escapeHtml(firstMissing.videoFileName)}
          </div>
        </div>
      `;
    } else if (reelContext) {
      bannerHtml = `
        <div class="nav-context-banner" role="region" aria-label="${this.escapeHtml(t('nav.reelBannerAria'))}">
          <div class="nav-context-banner-row">
            <span style="display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--signal-film-text);">
              ${Icons.filmTransition}
              <span>${t('nav.reelBannerText', { count: this.formatArabicSlideCount(reelContext.cuePointsSec.length) })}</span>
            </span>
            <button class="btn btn-xs" id="btn-nav-edit-reel-cues" title="${this.escapeHtml(t('nav.editCuesTitle'))}">
              ${Icons.sliders}
              <span>${t('nav.editCuesBtn')}</span>
            </button>
          </div>
          <div class="nav-context-banner-sub" title="${this.escapeHtml(reelContext.videoAsset.name)}">
            ${this.escapeHtml(reelContext.videoAsset.name)}
          </div>
        </div>
      `;
    }

    let listHtml = '';
    slides.forEach((slide, idx) => {
      const isSlideSelected = this.store.isSlideSelected
        ? this.store.isSlideSelected(slide.id)
        : selection.type === 'slide' && selection.slideId === slide.id;
      const isTransSelected = this.store.isTransitionSelected
        ? this.store.isTransitionSelected(slide.id)
        : selection.type === 'transition' && selection.slideId === slide.id;
      const isActiveOnStage = idx === activeIdx && slides.length > 0;
      const isLastSlide = idx === slides.length - 1;
      const nextSlide =
        idx + 1 < slides.length
          ? slides[idx + 1]
          : settings.loopPresentation && slides.length > 1
            ? slides[0]
            : null;
      const vid = slide.transitionToNext.videoAsset;
      const hasSlice =
        typeof slide.transitionToNext.startTimeSec === 'number' ||
        typeof slide.transitionToNext.endTimeSec === 'number';
      const segStart = slide.transitionToNext.startTimeSec ?? 0;
      const segEnd = vid ? (slide.transitionToNext.endTimeSec ?? vid.durationSec) : 0;
      const clipDur = vid ? Math.max(0.05, hasSlice ? segEnd - segStart : vid.durationSec) : 0;
      const startThumb = vid
        ? (hasSlice ? slide.imageAsset.thumbnailUrl || vid.thumbnailUrl : vid.thumbnailUrl)
        : '';
      const endThumb = vid
        ? (hasSlice
            ? nextSlide?.imageAsset.thumbnailUrl || vid.lastFrameUrl || vid.thumbnailUrl
            : vid.lastFrameUrl || vid.thumbnailUrl)
        : '';
      const missingExpectedName = !vid ? slide.transitionToNext.expectedVideoFileName : undefined;

      listHtml += `
        <div
          class="slide-nav-item ${isSlideSelected ? 'selected' : ''}"
          data-slide-id="${slide.id}"
          data-slide-index="${idx}"
          tabindex="0"
          role="button"
          aria-label="${this.escapeHtml(t('nav.slideAria', { num: idx + 1, title: slide.title }))}"
          title="${this.escapeHtml(t('nav.slideTitleHint'))}"
        >
          <div class="slide-gutter-col">
            <span class="slide-num">${idx + 1}</span>
            ${isActiveOnStage ? `<span class="live-stage-dot" title="${this.escapeHtml(t('nav.liveDotTitle'))}"></span>` : ''}
          </div>
          <div class="slide-card-body">
            <div class="slide-thumb-frame">
              <img src="${slide.imageAsset.thumbnailUrl || slide.imageAsset.objectUrl}" alt="${this.escapeHtml(slide.title)}" draggable="false" />
              <div class="slide-hover-actions">
                <button class="mini-action-btn btn-move-up" data-id="${slide.id}" title="${this.escapeHtml(t('nav.moveUpTitle'))}" aria-label="${this.escapeHtml(t('nav.moveUpTitle'))}" ${idx === 0 ? 'disabled' : ''}>
                  ${Icons.chevronUp}
                </button>
                <button class="mini-action-btn btn-move-down" data-id="${slide.id}" title="${this.escapeHtml(t('nav.moveDownTitle'))}" aria-label="${this.escapeHtml(t('nav.moveDownTitle'))}" ${isLastSlide ? 'disabled' : ''}>
                  ${Icons.chevronDown}
                </button>
                <button class="mini-action-btn btn-duplicate-slide" data-id="${slide.id}" title="${this.escapeHtml(t('nav.duplicateTitle'))}" aria-label="${this.escapeHtml(t('nav.duplicateTitle'))}">
                  ${Icons.duplicate}
                </button>
                <button class="mini-action-btn btn-delete-slide" data-id="${slide.id}" title="${this.escapeHtml(t('nav.deleteTitle'))}" aria-label="${this.escapeHtml(t('nav.deleteTitle'))}">
                  ${Icons.trash}
                </button>
              </div>
            </div>
            <div class="slide-caption-row">
              <span class="slide-caption-title">${this.escapeHtml(slide.title)}</span>
              ${slide.notes && slide.notes.trim().length > 0 ? `<span class="slide-notes-badge" title="${this.escapeHtml(t('nav.hasNotesTitle'))}">${Icons.notes}</span>` : ''}
              <span class="slide-caption-meta">${slide.holdDurationSec ? `${slide.holdDurationSec}s` : ''}</span>
            </div>
          </div>
        </div>
      `;

      // Render Magnetic Filmstrip Transition Bridge between Slide[idx] and Slide[idx+1]
      if (!isLastSlide || settings.loopPresentation || vid) {
        listHtml += `
          <div
            class="filmstrip-bridge ${vid ? 'has-video' : ''} ${isTransSelected ? 'selected' : ''}"
            data-transition-slide-id="${slide.id}"
            data-transition-slide-index="${idx}"
          >
            <div
              class="filmstrip-pill"
              tabindex="0"
              role="button"
              aria-label="${this.escapeHtml(t('nav.transitionAria', { num: idx + 1 }))}"
              title="${this.escapeHtml(t('nav.transitionTitleHint'))}"
            >
              <div class="filmstrip-pill-lead">
                ${
                  vid
                    ? `
                  <span class="filmstrip-dual-thumb">
                    <img src="${startThumb}" alt="" draggable="false" />
                    <img src="${endThumb}" alt="" draggable="false" />
                  </span>
                  <span class="filmstrip-text">${
                    hasSlice
                      ? `${segStart.toFixed(1)}s → ${segEnd.toFixed(1)}s`
                      : this.escapeHtml(vid.name)
                  }</span>
                `
                    : missingExpectedName
                      ? `
                  <span class="filmstrip-icon-badge" style="color:var(--signal-danger-text);">${Icons.relink}</span>
                  <span class="filmstrip-text" style="color:var(--signal-danger-text);">${this.escapeHtml(t('nav.relinkLabel', { name: missingExpectedName }))}</span>
                `
                      : `
                  <span class="filmstrip-icon-badge">${Icons.filmTransition}</span>
                  <span class="filmstrip-text">${t('nav.addVideoTransition')}</span>
                `
                }
              </div>
              ${
                vid
                  ? `<span class="filmstrip-timecode">${clipDur.toFixed(1)}s</span>`
                  : `<span class="filmstrip-fallback-tag">${fallbackShortNames[slide.transitionToNext.fallbackStyle]}</span>`
              }
            </div>
          </div>
        `;
      }
    });

    const filterBarHtml =
      slides.length > 0
        ? `
      <div class="nav-filter-bar" role="search" aria-label="${this.escapeHtml(t('nav.searchAria'))}">
        <div class="nav-search-wrap">
          <span class="nav-search-icon">${Icons.search}</span>
          <input
            type="text"
            class="nav-search-input"
            id="nav-search-input"
            placeholder="${this.escapeHtml(t('nav.searchPlaceholder'))}"
            value="${this.escapeHtml(this.navigatorSearchQuery)}"
            aria-label="${this.escapeHtml(t('nav.searchAria'))}"
          />
        </div>
        <div class="nav-filter-pills">
          <button class="nav-filter-pill ${this.navigatorFilterMode === 'all' ? 'active' : ''}" data-filter="all" type="button">${t('nav.filterAll')}</button>
          <button class="nav-filter-pill ${this.navigatorFilterMode === 'video' ? 'active' : ''}" data-filter="video" type="button">${t('nav.filterVideo')}</button>
          <button class="nav-filter-pill ${this.navigatorFilterMode === 'notes' ? 'active' : ''}" data-filter="notes" type="button">${t('nav.filterNotes')}</button>
        </div>
      </div>
    `
        : '';

    pane.innerHTML = `
      <div class="pane-subheader">
        <span>${t('nav.sectionHeader')}</span>
        <span class="tabular-nums">${slides.length}</span>
      </div>
      ${bannerHtml}
      ${filterBarHtml}
      <div id="nav-multi-select-slot"></div>
      <div class="navigator-list">
        ${
          slides.length > 0
            ? listHtml
            : `
          <div style="padding: 32px 12px; text-align: center; color: var(--label-tertiary); font-size: 12px; line-height: 1.6;">
            ${t('nav.emptyText')}
          </div>
        `
        }
      </div>
    `;

    const navSearchIn = pane.querySelector('#nav-search-input') as HTMLInputElement | null;
    navSearchIn?.addEventListener('input', () => {
      this.navigatorSearchQuery = navSearchIn.value;
      this.applyNavigatorFilter();
    });

    pane.querySelectorAll('.nav-filter-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const mode = ((pill as HTMLElement).dataset.filter || 'all') as 'all' | 'video' | 'notes';
        this.navigatorFilterMode = mode;
        pane.querySelectorAll('.nav-filter-pill').forEach((p) => {
          p.classList.toggle('active', (p as HTMLElement).dataset.filter === mode);
        });
        this.applyNavigatorFilter();
      });
    });

    pane.querySelector('#btn-nav-relink-video')?.addEventListener('click', () => {
      if (missingVideos[0]) {
        this.triggerRelinkVideo(missingVideos[0].slideIds);
      }
    });

    pane.querySelector('#btn-nav-edit-reel-cues')?.addEventListener('click', () => {
      if (reelContext) {
        this.openReelCueModal(reelContext.videoAsset, {
          mode: 'replace-reel',
          targetVideoAssetId: reelContext.videoAsset.id,
          initialCuePoints: reelContext.cuePointsSec,
          isAlreadyOwnedByStore: true,
        });
      }
    });

    this.syncMultiSelectBar();

    // Bind Slide Item Click, Keyboard Selection & Drag-and-Drop Reordering
    const navListEl = pane.querySelector('.navigator-list') as HTMLElement | null;
    const clearDropIndicators = () => {
      pane.querySelectorAll('.slide-nav-item').forEach((el) => {
        el.classList.remove('is-dragging', 'drop-target-above', 'drop-target-below');
      });
      this.root.querySelector('#slide-drag-ghost')?.remove();
    };

    const resolveDropTargetIndex = (fromIdx: number, clientY: number): number => {
      const allItems = Array.from(pane.querySelectorAll('.slide-nav-item')) as HTMLElement[];
      if (allItems.length <= 1) return fromIdx;
      let passedCount = 0;
      for (let k = 0; k < allItems.length; k++) {
        if (k === fromIdx) continue;
        const r = allItems[k].getBoundingClientRect();
        const threshold = k > fromIdx ? r.top + r.height * 0.25 : r.top + r.height * 0.75;
        if (clientY >= threshold) {
          passedCount++;
        }
      }
      return Math.max(0, Math.min(allItems.length - 1, passedCount));
    };

    const updateDropIndicators = (fromIdx: number, targetIdx: number) => {
      const allItems = Array.from(pane.querySelectorAll('.slide-nav-item')) as HTMLElement[];
      allItems.forEach((el, k) => {
        el.classList.toggle('drop-target-above', targetIdx !== fromIdx && targetIdx < fromIdx && k === targetIdx);
        el.classList.toggle('drop-target-below', targetIdx !== fromIdx && targetIdx > fromIdx && k === targetIdx);
      });
    };

    pane.querySelectorAll('.slide-nav-item').forEach((item) => {
      const el = item as HTMLElement;
      const slideId = el.dataset.slideId;
      const fromIdx = parseInt(el.dataset.slideIndex || '0', 10);
      if (!slideId) return;

      let suppressClick = false;

      el.addEventListener('pointerdown', (e: PointerEvent) => {
        if (
          e.button !== 0 ||
          e.ctrlKey ||
          e.metaKey ||
          e.shiftKey ||
          (e.target as HTMLElement).closest('button')
        ) {
          return;
        }
        if (slides.length <= 1) return;

        const startX = e.clientX;
        const startY = e.clientY;
        let dragStarted = false;
        let currentTargetIdx = fromIdx;
        let ghostEl: HTMLElement | null = null;

        const onPointerMove = (ev: PointerEvent) => {
          const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
          if (!dragStarted) {
            if (dist < 5) return;
            dragStarted = true;
            suppressClick = true;
            this.draggedSlideId = slideId;
            el.classList.add('is-dragging');
            ghostEl = document.createElement('div');
            ghostEl.id = 'slide-drag-ghost';
            ghostEl.className = 'slide-drag-ghost';
            ghostEl.textContent = t('nav.ghostMove', { from: fromIdx + 1, to: fromIdx + 1 });
            this.root.appendChild(ghostEl);
          }

          if (navListEl) {
            const listRect = navListEl.getBoundingClientRect();
            if (ev.clientY < listRect.top + 36) {
              navListEl.scrollTop -= 10;
            } else if (ev.clientY > listRect.bottom - 36) {
              navListEl.scrollTop += 10;
            }
          }

          currentTargetIdx = resolveDropTargetIndex(fromIdx, ev.clientY);
          updateDropIndicators(fromIdx, currentTargetIdx);

          if (ghostEl) {
            ghostEl.style.left = `${ev.clientX + 14}px`;
            ghostEl.style.top = `${ev.clientY - 14}px`;
            ghostEl.textContent =
              currentTargetIdx === fromIdx
                ? t('nav.ghostSame', { from: fromIdx + 1 })
                : t('nav.ghostMove', { from: fromIdx + 1, to: currentTargetIdx + 1 });
          }
        };

        const finishPointerDrag = () => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', finishPointerDrag);
          window.removeEventListener('pointercancel', finishPointerDrag);
          this.draggedSlideId = null;
          clearDropIndicators();

          if (dragStarted) {
            setTimeout(() => {
              suppressClick = false;
            }, 0);
            if (currentTargetIdx !== fromIdx) {
              this.store.moveSlideToIndex(slideId, currentTargetIdx);
              this.store.notify(t('nav.slideMoved', { pos: currentTargetIdx + 1 }), 'info', 2000);
            }
          }
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', finishPointerDrag);
        window.addEventListener('pointercancel', finishPointerDrag);
      });

      // Also support HTML5 dragstart / dragover / drop for standard DragEvents
      el.addEventListener('dragstart', (e) => {
        if ((e.target as HTMLElement).closest('button')) {
          e.preventDefault();
          return;
        }
        this.draggedSlideId = slideId;
        el.classList.add('is-dragging');
        const dt = (e as DragEvent).dataTransfer;
        if (dt) {
          dt.effectAllowed = 'move';
          try {
            dt.setData('text/plain', slideId);
          } catch {
            // Ignore in synthetic environments
          }
        }
      });

      el.addEventListener('dragover', (e) => {
        if (!this.draggedSlideId) return;
        e.preventDefault();
        e.stopPropagation();
        const draggedIdx = slides.findIndex((s) => s.id === this.draggedSlideId);
        if (draggedIdx === -1) return;
        updateDropIndicators(draggedIdx, fromIdx);
      });

      el.addEventListener('drop', (e) => {
        if (!this.draggedSlideId) return;
        e.preventDefault();
        e.stopPropagation();
        const sourceId = this.draggedSlideId;
        this.draggedSlideId = null;
        clearDropIndicators();
        if (sourceId !== slideId) {
          this.store.moveSlideToIndex(sourceId, fromIdx);
          this.store.notify(t('nav.slideMoved', { pos: fromIdx + 1 }), 'info', 2000);
        }
      });

      el.addEventListener('dragend', () => {
        this.draggedSlideId = null;
        clearDropIndicators();
      });

      el.addEventListener('click', (e) => {
        if (suppressClick) return;
        if ((e.target as HTMLElement).closest('button')) return;
        const me = e as MouseEvent;
        if (me.ctrlKey || me.metaKey) {
          this.store.toggleSlideSelection(slideId);
        } else if (me.shiftKey) {
          this.store.selectSlideRange(slideId);
        } else {
          this.store.setSelection({ type: 'slide', slideId });
        }
      });

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.store.setSelection({ type: 'slide', slideId });
        const me = e as MouseEvent;
        this.openSlideContextMenu(slideId, me.clientX ?? 120, me.clientY ?? 120);
      });

      el.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          if (ke.ctrlKey || ke.metaKey) {
            this.store.toggleSlideSelection(slideId);
          } else {
            this.store.setSelection({ type: 'slide', slideId });
          }
        } else if (ke.key === 'Delete' || ke.key === 'Backspace') {
          ke.preventDefault();
          ke.stopPropagation();
          if (this.store.getMultiSelectionSummary().totalCount > 1 && this.store.isSlideSelected(slideId)) {
            this.handleDeleteAction();
          } else {
            this.promptDeleteSlide(slideId);
          }
        }
      });
    });

    pane.querySelectorAll('.btn-move-up').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        if (id) this.store.moveSlide(id, 'up');
      });
    });

    pane.querySelectorAll('.btn-move-down').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        if (id) this.store.moveSlide(id, 'down');
      });
    });

    pane.querySelectorAll('.btn-duplicate-slide').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        if (id && this.store.duplicateSlide(id)) {
          this.store.notify(t('notify.slideDuplicated'), 'success', 2000);
        }
      });
    });

    pane.querySelectorAll('.btn-delete-slide').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        if (!id) return;
        if (this.store.getMultiSelectionSummary().totalCount > 1 && this.store.isSlideSelected(id)) {
          this.handleDeleteAction();
        } else {
          this.promptDeleteSlide(id);
        }
      });
    });

    // Bind Filmstrip Bridge Click, Double-Click (file picker), Keyboard, and Drag & Drop
    pane.querySelectorAll('.filmstrip-bridge').forEach((bridge) => {
      const bridgeEl = bridge as HTMLElement;
      const slideId = bridgeEl.dataset.transitionSlideId;
      const bridgeIdx = parseInt(bridgeEl.dataset.transitionSlideIndex || '0', 10);
      if (!slideId) return;

      bridge.addEventListener('click', (e) => {
        const me = e as MouseEvent;
        if (me.ctrlKey || me.metaKey) {
          this.store.toggleTransitionSelection(slideId);
        } else {
          this.store.setSelection({ type: 'transition', slideId });
        }
      });

      bridge.querySelector('.filmstrip-pill')?.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          if (ke.ctrlKey || ke.metaKey) {
            this.store.toggleTransitionSelection(slideId);
          } else {
            this.store.setSelection({ type: 'transition', slideId });
          }
        } else if (ke.key === 'Delete' || ke.key === 'Backspace') {
          ke.preventDefault();
          ke.stopPropagation();
          if (this.store.getMultiSelectionSummary().totalCount > 1 && this.store.isTransitionSelected(slideId)) {
            this.handleDeleteAction();
          } else {
            this.handleDeleteAction(undefined, slideId);
          }
        }
      });

      bridge.addEventListener('dblclick', () => {
        const input = this.root.querySelector('#single-video-input') as HTMLInputElement;
        input.dataset.targetSlideId = slideId;
        input.click();
      });

      bridge.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.draggedSlideId) {
          const draggedIdx = slides.findIndex((s) => s.id === this.draggedSlideId);
          if (draggedIdx !== -1) {
            const targetIdx = draggedIdx <= bridgeIdx ? bridgeIdx : Math.min(slides.length - 1, bridgeIdx + 1);
            updateDropIndicators(draggedIdx, targetIdx);
          }
          return;
        }
        bridge.classList.add('drag-over');
      });

      bridge.addEventListener('dragleave', () => {
        bridge.classList.remove('drag-over');
      });

      bridge.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        bridge.classList.remove('drag-over');
        if (this.draggedSlideId) {
          const sourceId = this.draggedSlideId;
          this.draggedSlideId = null;
          clearDropIndicators();
          const draggedIdx = slides.findIndex((s) => s.id === sourceId);
          if (draggedIdx !== -1) {
            const targetIdx = draggedIdx <= bridgeIdx ? bridgeIdx : Math.min(slides.length - 1, bridgeIdx + 1);
            if (targetIdx !== draggedIdx) {
              this.store.moveSlideToIndex(sourceId, targetIdx);
              this.store.notify(t('nav.slideMoved', { pos: targetIdx + 1 }), 'info', 2000);
            }
          }
          return;
        }
        const dt = (e as DragEvent).dataTransfer;
        if (!dt?.files?.length) return;
        await this.attachVideoFileToSlide(slideId, dt.files[0]);
      });
    });

    if (this.navigatorSearchQuery.trim() || this.navigatorFilterMode !== 'all') {
      this.applyNavigatorFilter();
    }
  }

  private applyNavigatorFilter(): void {
    const pane = this.root.querySelector('#navigator-pane') as HTMLElement | null;
    if (!pane) return;

    const slides = this.store.getSlides();
    const q = this.navigatorSearchQuery.trim().toLowerCase();
    const mode = this.navigatorFilterMode;

    const visibleSlideIds = new Set<string>();
    slides.forEach((s, idx) => {
      const matchesMode =
        mode === 'all' ||
        (mode === 'video' && Boolean(s.transitionToNext.videoAsset)) ||
        (mode === 'notes' && Boolean(s.notes && s.notes.trim().length > 0));
      const matchesQuery =
        !q ||
        s.title.toLowerCase().includes(q) ||
        (s.notes && s.notes.toLowerCase().includes(q)) ||
        String(idx + 1).includes(q);
      if (matchesMode && matchesQuery) {
        visibleSlideIds.add(s.id);
      }
    });

    pane.querySelectorAll('.slide-nav-item').forEach((el) => {
      const id = (el as HTMLElement).dataset.slideId || '';
      el.classList.toggle('nav-filtered-out', !visibleSlideIds.has(id));
    });

    pane.querySelectorAll('.filmstrip-bridge').forEach((el) => {
      const id = (el as HTMLElement).dataset.transitionSlideId || '';
      el.classList.toggle('nav-filtered-out', !visibleSlideIds.has(id));
    });
  }

  /* =========================================================================
   * 3. CENTER STAGE: EMPTY STATE & FLOATING LIQUID GLASS HUD
   * ========================================================================= */
  private renderEmptyOverlay(): void {
    const overlay = this.root.querySelector('#empty-overlay') as HTMLElement;
    const hud = this.root.querySelector('#floating-stage-hud') as HTMLElement;
    if (!overlay) return;

    const slides = this.store.getSlides();
    if (slides.length > 0) {
      overlay.style.display = 'none';
      if (hud) hud.style.display = 'flex';
      return;
    }

    overlay.style.display = 'flex';
    if (hud) hud.style.display = 'none';

    overlay.innerHTML = `
      <div class="empty-sheet-card" id="empty-drop-card">
        <div class="empty-symbol-circle">${Icons.filmTransition}</div>
        <h2 class="empty-heading">${t('stage.emptyHeading')}</h2>
        <p class="empty-copy">
          ${t('stage.emptyDesc')}
        </p>
        <div class="empty-meta-line">PNG · JPG · WEBP · MP4 · WEBM · MOV · MPRES</div>
        <div class="empty-actions-row">
          <button class="btn btn-prominent" id="btn-empty-import">
            ${Icons.folderImport}
            <span>${t('stage.emptyPickFiles')}</span>
          </button>
          <button class="btn" id="btn-empty-reel">
            ${Icons.filmTransition}
            <span>${t('stage.emptyReelWorkflow')}</span>
          </button>
          <button class="btn" id="btn-empty-demo">
            ${Icons.sparkles}
            <span>${t('stage.emptyLoadDemo')}</span>
          </button>
        </div>
      </div>
    `;

    overlay.querySelector('#btn-empty-import')?.addEventListener('click', () => {
      this.handleImportMedia();
    });

    overlay.querySelector('#btn-empty-reel')?.addEventListener('click', () => {
      this.handleOpenReelWorkflow();
    });

    overlay.querySelector('#btn-empty-demo')?.addEventListener('click', () => {
      this.handleGenerateDemo();
    });
  }

  private ensureFloatingStageHudStructure(): void {
    const hud = this.root.querySelector('#floating-stage-hud') as HTMLElement;
    if (!hud || hud.querySelector('#btn-hud-next')) return;

    const rtl = isRtlLanguage();
    const prevIcon = rtl ? Icons.chevronRight : Icons.chevronLeft;
    const nextIcon = rtl ? Icons.chevronLeft : Icons.chevronRight;

    hud.innerHTML = `
      <button
        class="hud-transport-btn"
        id="btn-hud-prev"
        title="${this.escapeHtml(t('hud.prevTitle'))}"
        aria-label="${this.escapeHtml(t('hud.prevAria'))}"
      >
        ${prevIcon}
      </button>

      <div class="hud-status-readout">
        <span class="hud-phase-dot" id="hud-phase-dot"></span>
        <span class="tabular-nums" id="hud-slide-counter" style="color: var(--label-primary); font-weight: 600;">
          01 / 01
        </span>
      </div>

      <button
        class="hud-step-btn"
        id="btn-hud-next"
        title="${this.escapeHtml(t('hud.nextTitle'))}"
        aria-label="${this.escapeHtml(t('hud.nextAria'))}"
      >
        <span id="hud-next-label">${t('hud.nextLabel')}</span>
        ${nextIcon}
      </button>

      <div class="toolbar-divider"></div>

      <button
        class="hud-transport-btn"
        id="btn-hud-replay"
        title="${this.escapeHtml(t('hud.replayTitle'))}"
        aria-label="${this.escapeHtml(t('hud.replayAria'))}"
      >
        ${Icons.replay}
      </button>
    `;

    hud.querySelector('#btn-hud-prev')?.addEventListener('click', () => {
      this.previewEngine.previous();
    });

    hud.querySelector('#btn-hud-next')?.addEventListener('click', () => {
      this.previewEngine.next();
    });

    hud.querySelector('#btn-hud-replay')?.addEventListener('click', () => {
      this.previewEngine.previewCurrentTransition();
    });
  }

  private renderFloatingStageHud(): void {
    const hud = this.root.querySelector('#floating-stage-hud') as HTMLElement;
    if (!hud) return;

    const slides = this.store.getSlides();
    if (slides.length === 0) {
      hud.style.display = 'none';
      return;
    }
    hud.style.display = 'flex';

    this.ensureFloatingStageHudStructure();

    const status = this.latestEngineStatus;
    const idx = status?.currentSlideIndex ?? 0;
    const isTransitioning = status?.phase === 'PLAYING_TRANSITION';
    const currentFormatted = String(idx + 1).padStart(2, '0');
    const totalFormatted = String(slides.length).padStart(2, '0');

    const counter = hud.querySelector('#hud-slide-counter');
    if (counter && counter.textContent !== `${currentFormatted} / ${totalFormatted}`) {
      counter.textContent = `${currentFormatted} / ${totalFormatted}`;
    }

    const dot = hud.querySelector('#hud-phase-dot');
    dot?.classList.toggle('transitioning', isTransitioning);

    const nextLabel = hud.querySelector('#hud-next-label');
    const expectedNextText = isTransitioning ? t('hud.skipLabel') : t('hud.nextLabel');
    if (nextLabel && nextLabel.textContent !== expectedNextText) {
      nextLabel.textContent = expectedNextText;
    }

    const prevBtn = hud.querySelector('#btn-hud-prev') as HTMLButtonElement;
    if (prevBtn) {
      prevBtn.disabled = idx === 0 && !this.store.getSettings().loopPresentation;
    }

    const replayBtn = hud.querySelector('#btn-hud-replay') as HTMLButtonElement;
    if (replayBtn) {
      replayBtn.disabled = slides.length < 2;
    }

    this.syncNavigatorActiveSlide(idx);
  }

  private syncNavigatorActiveSlide(currentIdx: number): void {
    const items = this.root.querySelectorAll('.slide-nav-item');
    const summary = this.store.getMultiSelectionSummary
      ? this.store.getMultiSelectionSummary()
      : { slideIds: [], transitionSlideIds: [], totalCount: 0 };
    const preserveStoreSelection =
      summary.totalCount > 1 ||
      summary.transitionSlideIds.length > 0 ||
      this.store.getSelection().type === 'transition';

    items.forEach((item, i) => {
      const isCurrent = i === currentIdx;
      const id = (item as HTMLElement).dataset?.slideId;
      const isSelected = preserveStoreSelection
        ? Boolean(id && this.store.isSlideSelected(id))
        : isCurrent;
      item.classList.toggle('selected', isSelected);
      const gutter = item.querySelector('.slide-gutter-col');
      const existingDot = gutter?.querySelector('.live-stage-dot');
      if (isCurrent) {
        if (!existingDot && gutter) {
          const doc = typeof document !== 'undefined' ? document : (globalThis as any).document;
          if (doc?.createElement) {
            const dot = doc.createElement('span');
            dot.className = 'live-stage-dot';
            dot.title = t('nav.liveDotTitle');
            gutter.appendChild(dot);
          }
        }
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        if (existingDot) {
          existingDot.remove();
        }
      }
    });
  }

  /* =========================================================================
   * 4. TRAILING PANE: INSPECTOR WITH MACOS SEGMENTED CONTROL
   * ========================================================================= */
  private renderInspectorPane(): void {
    this.disposeActiveSplitSession();

    const pane = this.root.querySelector('#inspector-pane') as HTMLElement;
    if (!pane) return;

    pane.classList.toggle('collapsed', !this.isInspectorVisible);

    const selection = this.store.getSelection();
    const slides = this.store.getSlides();
    const settings = this.store.getSettings();

    const activeSlide =
      selection.type === 'slide' || selection.type === 'transition'
        ? slides.find((s) => s.id === selection.slideId) || slides[0]
        : slides[this.store.getActivePreviewIndex()] || slides[0];

    const activeSegment =
      !activeSlide
        ? 'settings'
        : selection.type === 'slide'
          ? 'slide'
          : selection.type === 'transition'
            ? 'transition'
            : 'settings';

    let contentHtml = '';

    if (activeSegment === 'slide' && activeSlide) {
      const slideIdx = slides.findIndex((s) => s.id === activeSlide.id);
      contentHtml = `
        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${t('inspector.slideHeader', { num: slideIdx + 1 })}</span>
            <span class="tabular-nums">${activeSlide.imageAsset.width}×${activeSlide.imageAsset.height}</span>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="insp-slide-title">${t('inspector.slideTitleLabel')}</label>
            <input
              type="text"
              class="input-field"
              id="insp-slide-title"
              value="${this.escapeHtml(activeSlide.title)}"
            />
          </div>

          <div class="prop-row">
            <span class="prop-label">${t('inspector.imageFileLabel')}</span>
            <div class="prop-subtext" style="word-break: break-all;">
              <bdi dir="ltr">${this.escapeHtml(activeSlide.imageAsset.name)}</bdi> (${(activeSlide.imageAsset.fileSize / 1024).toFixed(0)} KB)
            </div>
            <button class="btn" id="btn-replace-slide-img" style="margin-top: 4px; width: 100%;">
              ${t('inspector.replaceImage')}
            </button>
          </div>

          <div class="prop-row" style="margin-bottom: 0; padding-top: 6px; border-top: 1px solid var(--border-subtle);">
            <span class="prop-label">${t('inspector.idleLoopSection')}</span>
            <div class="prop-subtext" style="word-break: break-all;">
              ${
                activeSlide.idleLoopAsset
                  ? `<bdi dir="ltr">${this.escapeHtml(activeSlide.idleLoopAsset.name)}</bdi> (${activeSlide.idleLoopAsset.durationSec.toFixed(1)}s)`
                  : t('inspector.idleLoopNone')
              }
            </div>
            <div style="display: flex; gap: 6px; margin-top: 4px;">
              <button class="btn" id="btn-assign-idle-loop" style="flex: 1;">
                ${Icons.replay}
                <span>${activeSlide.idleLoopAsset ? t('inspector.idleLoopReplace') : t('inspector.idleLoopAssign')}</span>
              </button>
              ${
                activeSlide.idleLoopAsset
                  ? `<button class="btn btn-destructive" id="btn-remove-idle-loop" title="${this.escapeHtml(t('inspector.idleLoopRemove'))}">${Icons.trash}<span>${t('inspector.idleLoopRemove')}</span></button>`
                  : ''
              }
            </div>
          </div>
        </div>

        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${t('inspector.timingSection')}</span>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="insp-slide-hold">
              <span>${t('inspector.autoAdvanceLabel')}</span>
              <span class="tabular-nums" style="color: var(--label-secondary);">
                ${activeSlide.holdDurationSec ? `${activeSlide.holdDurationSec}s` : t('inspector.manualHold')}
              </span>
            </label>
            <input
              type="number"
              min="0"
              max="300"
              step="0.5"
              class="input-field tabular-nums"
              id="insp-slide-hold"
              placeholder="${this.escapeHtml(t('inspector.autoAdvancePlaceholder'))}"
              value="${activeSlide.holdDurationSec ?? ''}"
            />
            <span class="prop-subtext">${t('inspector.autoAdvanceHint')}</span>
          </div>
        </div>

        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${t('inspector.notesSection')}</span>
            ${Icons.notes}
          </div>

          <div class="prop-row" style="margin-bottom: 0;">
            <label class="prop-label" for="insp-slide-notes">${t('inspector.notesLabel')}</label>
            <textarea
              class="textarea-field"
              id="insp-slide-notes"
              rows="4"
              placeholder="${this.escapeHtml(t('inspector.notesPlaceholder'))}"
            >${this.escapeHtml(activeSlide.notes || '')}</textarea>
          </div>
        </div>

        ${this.renderSurgicalAiPromptGroup(activeSlide, slideIdx, slides.length, 'slide')}

        <div class="inspector-group" style="border-bottom: none;">
          <button class="btn" id="btn-insp-duplicate-slide" style="width: 100%; margin-bottom: 6px;">
            ${Icons.duplicate}
            <span>${t('inspector.duplicateSlide')}</span>
          </button>
          <button class="btn btn-destructive" id="btn-insp-delete-slide" style="width: 100%;">
            ${Icons.trash}
            <span>${t('inspector.deleteSlide')}</span>
          </button>
        </div>
      `;
    } else if (activeSegment === 'transition' && activeSlide) {
      const slideIdx = slides.findIndex((s) => s.id === activeSlide.id);
      const nextIdx =
        slideIdx + 1 < slides.length
          ? slideIdx + 1
          : settings.loopPresentation && slides.length > 1
            ? 0
            : -1;
      const nextSlide = nextIdx !== -1 ? slides[nextIdx] : null;
      const spec = activeSlide.transitionToNext;
      const vid = spec.videoAsset;
      const hasSlice =
        typeof spec.startTimeSec === 'number' || typeof spec.endTimeSec === 'number';
      const segStart = vid ? Math.max(0, spec.startTimeSec ?? 0) : 0;
      const segEnd = vid ? Math.max(segStart, spec.endTimeSec ?? vid.durationSec) : 0;
      const segDur = vid ? Math.max(0, segEnd - segStart) : 0;
      const canSplit = Boolean(vid && segDur >= 0.18);
      const midTime = Number(((segStart + segEnd) / 2).toFixed(2));
      const startFrameUrl =
        hasSlice && activeSlide.imageAsset
          ? activeSlide.imageAsset.thumbnailUrl || activeSlide.imageAsset.objectUrl
          : vid?.thumbnailUrl || '';
      const endFrameUrl =
        hasSlice && nextSlide
          ? nextSlide.imageAsset.thumbnailUrl || nextSlide.imageAsset.objectUrl
          : vid?.lastFrameUrl || vid?.thumbnailUrl || '';
      const slideReelContext = vid ? this.store.getReelContextForSlide?.(activeSlide.id) : null;

      contentHtml = `
        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${
              nextIdx !== -1
                ? t('inspector.transPairHeader', {
                    from: slideIdx + 1,
                    to: nextIdx + 1,
                    arrow: getFlowArrow(),
                  })
                : t('inspector.transAfterHeader', { num: slideIdx + 1 })
            }</span>
            ${
              vid
                ? `<span class="tabular-nums" style="color: var(--signal-film);">${segDur.toFixed(2)}s</span>`
                : ''
            }
          </div>

          ${
            vid
              ? `
            <div class="inspector-filmstrip-box">
              <div class="inspector-frame-pair">
                <div class="inspector-frame-cell">
                  <img src="${startFrameUrl}" alt="${this.escapeHtml(t('inspector.startFrameAlt'))}" />
                  <span>${hasSlice ? t('inspector.startFrameSlice', { time: segStart.toFixed(2) }) : t('inspector.startFrameVideo')}</span>
                </div>
                <div style="text-align: center; color: var(--label-secondary);">${isRtlLanguage() ? Icons.arrowLeft : Icons.arrowRight}</div>
                <div class="inspector-frame-cell">
                  <img src="${endFrameUrl}" alt="${this.escapeHtml(t('inspector.endFrameAlt'))}" />
                  <span>${hasSlice ? t('inspector.endFrameSlice', { time: segEnd.toFixed(2) }) : t('inspector.endFrameVideo')}</span>
                </div>
              </div>
              <div class="prop-subtext" style="word-break: break-all;">
                ${this.escapeHtml(vid.name)} (${vid.width}×${vid.height})
              </div>
            </div>

            ${
              slideReelContext
                ? `
              <div class="inspector-reel-pill-box">
                <span class="prop-subtext" style="color:var(--label-primary);">
                  ${t('inspector.reelSliceNotice', { count: this.formatArabicSlideCount(slideReelContext.cuePointsSec.length) })}
                </span>
                <button class="btn btn-xs" id="btn-insp-edit-reel-cues" style="width:100%;">
                  ${Icons.sliders}
                  <span>${t('inspector.editReelCues')}</span>
                </button>
              </div>
            `
                : ''
            }

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
              <button class="btn" id="btn-replace-trans-video">${t('inspector.replaceTransVideo')}</button>
              <button class="btn btn-destructive" id="btn-remove-trans-video">${t('inspector.removeTransVideo')}</button>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px;">
              <div class="prop-row" style="margin-bottom: 0;">
                <label class="prop-label" for="insp-trans-start">${t('inspector.sliceStartLabel')}</label>
                <input
                  type="number"
                  min="0"
                  max="${vid.durationSec.toFixed(2)}"
                  step="0.05"
                  class="input-field tabular-nums"
                  id="insp-trans-start"
                  value="${segStart.toFixed(2)}"
                />
              </div>
              <div class="prop-row" style="margin-bottom: 0;">
                <label class="prop-label" for="insp-trans-end">${t('inspector.sliceEndLabel')}</label>
                <input
                  type="number"
                  min="0"
                  max="${vid.durationSec.toFixed(2)}"
                  step="0.05"
                  class="input-field tabular-nums"
                  id="insp-trans-end"
                  value="${segEnd.toFixed(2)}"
                />
              </div>
            </div>

            <button class="btn" id="btn-open-split-popover" style="width: 100%; margin-top: 6px;" ${!canSplit ? 'disabled' : ''} title="${this.escapeHtml(t('inspector.splitPopoverBtnTitle'))}">
              ${Icons.splitCue}
              <span>${t('inspector.splitPopoverBtn')}</span>
            </button>

            <div class="split-popover-card" id="split-popover-card" style="display:none;">
              <div class="prop-label">
                <span>${t('inspector.splitPopoverHeading')}</span>
                <span class="tabular-nums" id="split-time-readout" style="color:var(--signal-film);">${midTime.toFixed(2)}s</span>
              </div>
              <div class="split-preview-frame">
                <img id="split-preview-img" src="${startFrameUrl}" alt="${this.escapeHtml(t('inspector.splitPreviewAlt'))}" />
              </div>
              <div class="split-scrubber-row">
                <span class="prop-subtext tabular-nums">${(segStart + 0.08).toFixed(2)}s</span>
                <input
                  type="range"
                  id="split-time-range"
                  min="${(segStart + 0.08).toFixed(2)}"
                  max="${Math.max(segStart + 0.09, segEnd - 0.08).toFixed(2)}"
                  step="0.02"
                  value="${midTime}"
                />
                <span class="prop-subtext tabular-nums">${Math.max(segStart + 0.09, segEnd - 0.08).toFixed(2)}s</span>
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <input
                  type="number"
                  class="input-field tabular-nums"
                  id="split-time-num"
                  min="${(segStart + 0.08).toFixed(2)}"
                  max="${Math.max(segStart + 0.09, segEnd - 0.08).toFixed(2)}"
                  step="0.02"
                  value="${midTime.toFixed(2)}"
                  style="width:92px;"
                />
                <button class="btn btn-xs" id="btn-split-use-stage-time" style="flex:1;" title="${this.escapeHtml(t('inspector.splitUseStageTimeTitle'))}">
                  ${t('inspector.splitUseStageTime')}
                </button>
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                <button class="btn btn-xs" id="btn-cancel-split-popover">${t('inspector.cancel')}</button>
                <button class="btn btn-xs btn-prominent" id="btn-confirm-split-transition">${t('inspector.splitConfirm')}</button>
              </div>
            </div>

            <button class="btn" id="btn-extract-end-frame" style="width: 100%; margin-top: 6px;" title="${this.escapeHtml(t('inspector.extractEndTitle'))}">
              ${Icons.extractFrame}
              <span>${hasSlice ? t('inspector.extractEndSlice') : t('inspector.extractEndVideo')}</span>
            </button>
          `
              : `
            ${
              spec.expectedVideoFileName
                ? `
              <div class="inspector-alert-box">
                <span style="display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--signal-danger-text);">
                  ${Icons.alertCircle}
                  <span>${t('inspector.missingVideoBadge')}</span>
                </span>
                <span class="prop-subtext">${this.escapeHtml(spec.expectedVideoFileName)}</span>
                <button class="btn btn-prominent" id="btn-insp-relink-video" style="width:100%;">
                  ${Icons.relink}
                  <span>${t('inspector.relinkVideoBtn')}</span>
                </button>
              </div>
            `
                : `
              <div class="prop-subtext">
                ${t('inspector.noVideoHint')}
              </div>
            `
            }
            <button class="btn ${spec.expectedVideoFileName ? '' : 'btn-prominent'}" id="btn-replace-trans-video" style="width: 100%;">
              ${Icons.filmTransition}
              <span>${t('inspector.linkVideoBtn')}</span>
            </button>
          `
          }

          <button class="btn" id="btn-generate-trans-video" style="width: 100%; margin-top: 4px;" title="${this.escapeHtml(t('inspector.generateTransTitle'))}">
            ${Icons.sparkles}
            <span>${t('inspector.generateTransBtn')}</span>
          </button>
        </div>

        <div class="inspector-group" style="border-bottom: none;">
          <div class="inspector-group-title">
            <span>${t('inspector.speedFallbackSection')}</span>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="insp-trans-speed">
              <span>${t('inspector.playbackSpeed')}</span>
              <span class="tabular-nums" id="lbl-trans-speed">${spec.playbackSpeed.toFixed(2)}×</span>
            </label>
            <div class="slider-control-row">
              <input
                type="range"
                id="insp-trans-speed"
                min="0.25"
                max="2.5"
                step="0.05"
                value="${spec.playbackSpeed}"
              />
            </div>
          </div>

          <div class="prop-row-inline">
            <label class="prop-label" for="insp-trans-muted" style="cursor: pointer;">${t('inspector.muteTransAudio')}</label>
            <input type="checkbox" id="insp-trans-muted" ${spec.muted ? 'checked' : ''} />
          </div>

          <div class="prop-row">
            <label class="prop-label" for="insp-fallback-style">${t('inspector.fallbackStyleLabel')}</label>
            <select class="select-field" id="insp-fallback-style">
              <option value="crossfade" ${spec.fallbackStyle === 'crossfade' ? 'selected' : ''}>${t('fallback.full.crossfade')}</option>
              <option value="zoom-morph" ${spec.fallbackStyle === 'zoom-morph' ? 'selected' : ''}>${t('fallback.full.zoom-morph')}</option>
              <option value="slide-push" ${spec.fallbackStyle === 'slide-push' ? 'selected' : ''}>${t('fallback.full.slide-push')}</option>
              <option value="wipe-reveal" ${spec.fallbackStyle === 'wipe-reveal' ? 'selected' : ''}>${t('fallback.full.wipe-reveal')}</option>
              <option value="iris-spotlight" ${spec.fallbackStyle === 'iris-spotlight' ? 'selected' : ''}>${t('fallback.full.iris-spotlight')}</option>
              <option value="cut" ${spec.fallbackStyle === 'cut' ? 'selected' : ''}>${t('fallback.full.cut')}</option>
            </select>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <div class="prop-row" style="margin-bottom: 0;">
              <label class="prop-label" for="insp-fallback-duration">${t('inspector.fallbackDurationLabel')}</label>
              <input
                type="number"
                class="input-field tabular-nums"
                id="insp-fallback-duration"
                min="100"
                max="5000"
                step="50"
                value="${spec.fallbackDurationMs || 700}"
              />
            </div>
            <div class="prop-row" style="margin-bottom: 0;">
              <label class="prop-label" for="insp-trans-easing">${t('inspector.easingLabel')}</label>
              <select class="select-field" id="insp-trans-easing">
                <option value="ease-in-out" ${(spec.easing || 'ease-in-out') === 'ease-in-out' ? 'selected' : ''}>${t('easing.easeInOut')}</option>
                <option value="ease-out" ${spec.easing === 'ease-out' ? 'selected' : ''}>${t('easing.easeOut')}</option>
                <option value="ease-in" ${spec.easing === 'ease-in' ? 'selected' : ''}>${t('easing.easeIn')}</option>
                <option value="linear" ${spec.easing === 'linear' ? 'selected' : ''}>${t('easing.linear')}</option>
                <option value="step" ${spec.easing === 'step' ? 'selected' : ''}>${t('easing.step')}</option>
              </select>
            </div>
          </div>

          <button class="btn" id="btn-apply-trans-all" style="width: 100%; margin-top: 8px;" title="${this.escapeHtml(t('inspector.applyAllTransTitle'))}">
            ${Icons.checkAll}
            <span>${t('inspector.applyAllTrans')}</span>
          </button>
        </div>

        ${this.renderSurgicalAiPromptGroup(activeSlide, slideIdx, slides.length, 'transition')}
      `;
    } else {
      contentHtml = `
        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${t('settings.behaviorSection')}</span>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-interrupt-behavior">${t('settings.interruptLabel')}</label>
            <select class="select-field" id="set-interrupt-behavior">
              <option value="skip" ${settings.interruptBehavior === 'skip' ? 'selected' : ''}>${t('settings.interruptSkip')}</option>
              <option value="lock" ${settings.interruptBehavior === 'lock' ? 'selected' : ''}>${t('settings.interruptLock')}</option>
              <option value="fast-forward" ${settings.interruptBehavior === 'fast-forward' ? 'selected' : ''}>${t('settings.interruptFF')}</option>
            </select>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-backward-behavior">${t('settings.backwardLabel')}</label>
            <select class="select-field" id="set-backward-behavior">
              <option value="reverse-step" ${settings.backwardBehavior === 'reverse-step' ? 'selected' : ''}>${t('settings.backwardReverse')}</option>
              <option value="crossfade" ${settings.backwardBehavior === 'crossfade' ? 'selected' : ''}>${t('settings.backwardCrossfade')}</option>
              <option value="instant" ${settings.backwardBehavior === 'instant' ? 'selected' : ''}>${t('settings.backwardInstant')}</option>
            </select>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-global-speed">
              <span>${t('settings.globalSpeedLabel')}</span>
              <span class="tabular-nums" id="lbl-global-speed">${settings.globalPlaybackSpeed.toFixed(2)}×</span>
            </label>
            <div class="slider-control-row">
              <input
                type="range"
                id="set-global-speed"
                min="0.5"
                max="2.0"
                step="0.05"
                value="${settings.globalPlaybackSpeed}"
              />
            </div>
          </div>

          <div class="prop-row-inline">
            <label class="prop-label" for="set-loop" style="cursor: pointer;">${t('settings.loopLabel')}</label>
            <input type="checkbox" id="set-loop" ${settings.loopPresentation ? 'checked' : ''} />
          </div>
        </div>

        <div class="inspector-group" style="border-bottom: none;">
          <div class="inspector-group-title">
            <span>${t('settings.displayAudioSection')}</span>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-aspect-ratio">${t('settings.aspectRatioLabel')}</label>
            <select class="select-field" id="set-aspect-ratio">
              <option value="16:9" ${settings.aspectRatio === '16:9' ? 'selected' : ''}>${t('settings.aspect169')}</option>
              <option value="16:10" ${settings.aspectRatio === '16:10' ? 'selected' : ''}>${t('settings.aspect1610')}</option>
              <option value="4:3" ${settings.aspectRatio === '4:3' ? 'selected' : ''}>${t('settings.aspect43')}</option>
              <option value="9:16" ${settings.aspectRatio === '9:16' ? 'selected' : ''}>${t('settings.aspect916')}</option>
            </select>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-fit-mode">${t('settings.fitModeLabel')}</label>
            <select class="select-field" id="set-fit-mode">
              <option value="contain" ${settings.fitMode === 'contain' ? 'selected' : ''}>${t('settings.fitContain')}</option>
              <option value="cover" ${settings.fitMode === 'cover' ? 'selected' : ''}>${t('settings.fitCover')}</option>
            </select>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-hud">${t('settings.hudLabel')}</label>
            <select class="select-field" id="set-hud">
              <option value="minimal" ${settings.showPresenterHud === 'minimal' ? 'selected' : ''}>${t('settings.hudMinimal')}</option>
              <option value="progress-bar" ${settings.showPresenterHud === 'progress-bar' ? 'selected' : ''}>${t('settings.hudProgress')}</option>
              <option value="hidden" ${settings.showPresenterHud === 'hidden' ? 'selected' : ''}>${t('settings.hudHidden')}</option>
            </select>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-master-volume">
              <span>${t('settings.masterVolumeLabel')}</span>
              <span class="tabular-nums" id="lbl-master-volume">${Math.round((settings.masterVolume ?? 0.9) * 100)}%</span>
            </label>
            <div class="slider-control-row">
              <input
                type="range"
                id="set-master-volume"
                min="0"
                max="1"
                step="0.05"
                value="${settings.masterVolume ?? 0.9}"
              />
            </div>
          </div>

          <div class="prop-row-inline">
            <label class="prop-label" for="set-master-muted" style="cursor: pointer;">${t('settings.masterMutedLabel')}</label>
            <input type="checkbox" id="set-master-muted" ${settings.masterMuted ? 'checked' : ''} />
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-stage-bg">${t('settings.stageBgLabel')}</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="color" id="set-stage-bg" value="${settings.stageBackground || '#05070B'}" style="width: 38px; height: 28px; padding: 0; border: none; background: transparent; cursor: pointer;" />
              <input type="text" id="set-stage-bg-text" class="input-field tabular-nums" value="${settings.stageBackground || '#05070B'}" style="flex: 1;" />
            </div>
          </div>
          <div class="prop-row">
            <span class="prop-label">${this.escapeHtml(t('settings.stageSwatchesLabel'))}</span>
            <div class="stage-color-swatches" role="group" aria-label="${this.escapeHtml(t('settings.stageSwatchesLabel'))}">
              ${STAGE_COLOR_SWATCHES.map((sw) => {
                const active = (settings.stageBackground || '#05070B').toUpperCase() === sw.hex.toUpperCase();
                const label = t(sw.labelKey);
                const isLightSwatch = sw.id === 'paper' || sw.id === 'daylight';
                return `<button type="button" class="stage-swatch-btn ${active ? 'active' : ''}" data-stage-hex="${sw.hex}" data-light-swatch="${isLightSwatch ? 'true' : 'false'}" title="${this.escapeHtml(label)}" aria-label="${this.escapeHtml(label)}" aria-pressed="${active ? 'true' : 'false'}" style="background:${sw.hex};"></button>`;
              }).join('')}
            </div>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-preload-strategy">${t('settings.preloadLabel')}</label>
            <select class="select-field" id="set-preload-strategy">
              <option value="all" ${settings.preloadStrategy === 'all' ? 'selected' : ''}>${t('settings.preloadAll')}</option>
              <option value="adjacent" ${settings.preloadStrategy === 'adjacent' ? 'selected' : ''}>${t('settings.preloadAdjacent')}</option>
            </select>
          </div>

          <div class="prop-row-inline">
            <label class="prop-label" for="set-autohide-cursor" style="cursor: pointer;">${t('settings.autohideCursorLabel')}</label>
            <input type="checkbox" id="set-autohide-cursor" ${settings.autoHideCursor ? 'checked' : ''} />
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-default-fallback-style">${t('settings.defaultFallbackLabel')}</label>
            <select class="select-field" id="set-default-fallback-style">
              <option value="crossfade" ${settings.defaultFallbackStyle === 'crossfade' ? 'selected' : ''}>${t('fallback.full.crossfade')}</option>
              <option value="zoom-morph" ${settings.defaultFallbackStyle === 'zoom-morph' ? 'selected' : ''}>${t('fallback.full.zoom-morph')}</option>
              <option value="slide-push" ${settings.defaultFallbackStyle === 'slide-push' ? 'selected' : ''}>${t('fallback.full.slide-push')}</option>
              <option value="wipe-reveal" ${settings.defaultFallbackStyle === 'wipe-reveal' ? 'selected' : ''}>${t('fallback.full.wipe-reveal')}</option>
              <option value="iris-spotlight" ${settings.defaultFallbackStyle === 'iris-spotlight' ? 'selected' : ''}>${t('fallback.full.iris-spotlight')}</option>
              <option value="cut" ${settings.defaultFallbackStyle === 'cut' ? 'selected' : ''}>${t('fallback.full.cut')}</option>
            </select>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-default-fallback-dur">${t('settings.defaultFallbackDurLabel')}</label>
            <input type="number" id="set-default-fallback-dur" class="input-field tabular-nums" min="100" max="3000" step="50" value="${settings.defaultFallbackDurationMs}" />
          </div>
        </div>

        ${(() => {
          const diag = this.store.getProjectDiagnostics?.() ?? {
            slideCount: slides.length,
            videoTransitionCount: 0,
            proceduralTransitionCount: 0,
            notesCount: 0,
            estimatedDurationSec: 0,
            totalMediaBytes: 0,
          };
          const mins = Math.floor(diag.estimatedDurationSec / 60);
          const secs = diag.estimatedDurationSec % 60;
          const durText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
          const mbText =
            diag.totalMediaBytes >= 1024 * 1024
              ? `${(diag.totalMediaBytes / (1024 * 1024)).toFixed(1)} MB`
              : `${Math.round(diag.totalMediaBytes / 1024)} KB`;
          return `
        <div class="inspector-group" style="border-bottom: none;" id="insp-deck-diagnostics">
          <div class="inspector-group-title">
            <span>${t('settings.statsSection')}</span>
            <span class="tabular-nums">${durText}</span>
          </div>
          <div class="diagnostics-grid">
            <div class="stat-card">
              <span class="stat-value tabular-nums">${diag.slideCount}</span>
              <span class="stat-label">${t('settings.statTotalSlides')}</span>
            </div>
            <div class="stat-card">
              <span class="stat-value tabular-nums">${diag.videoTransitionCount}</span>
              <span class="stat-label">${t('settings.statVideoTrans')}</span>
            </div>
            <div class="stat-card">
              <span class="stat-value tabular-nums">${diag.proceduralTransitionCount}</span>
              <span class="stat-label">${t('settings.statCssTrans')}</span>
            </div>
            <div class="stat-card">
              <span class="stat-value tabular-nums">${diag.notesCount}</span>
              <span class="stat-label">${t('settings.statWithNotes')}</span>
            </div>
            <div class="stat-card">
              <span class="stat-value tabular-nums">${durText}</span>
              <span class="stat-label">${t('settings.statEstDuration')}</span>
            </div>
            <div class="stat-card">
              <span class="stat-value tabular-nums">${mbText}</span>
              <span class="stat-label">${t('settings.statMediaSize')}</span>
            </div>
          </div>
        </div>
          `;
        })()}
      `;
    }

    // Equal-width noun-only Segmented Control per segmented-controls.md › Content
    pane.innerHTML = `
      <div class="segmented-control-wrap">
        <div class="segmented-control" role="tablist" aria-label="${this.escapeHtml(t('inspector.tabsAria'))}">
          <button
            class="segment-btn ${activeSegment === 'slide' ? 'active' : ''}"
            data-tab="slide"
            role="tab"
            aria-selected="${activeSegment === 'slide'}"
            ${!activeSlide ? 'disabled' : ''}
          >
            ${t('inspector.tabSlide')}
          </button>
          <button
            class="segment-btn ${activeSegment === 'transition' ? 'active' : ''}"
            data-tab="transition"
            role="tab"
            aria-selected="${activeSegment === 'transition'}"
            ${!activeSlide ? 'disabled' : ''}
          >
            ${t('inspector.tabTransition')}
          </button>
          <button
            class="segment-btn ${activeSegment === 'settings' ? 'active' : ''}"
            data-tab="settings"
            role="tab"
            aria-selected="${activeSegment === 'settings'}"
          >
            ${t('inspector.tabSettings')}
          </button>
        </div>
      </div>
      <div class="inspector-scroll">
        ${contentHtml}
      </div>
    `;

    pane.querySelectorAll('.segment-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.tab;
        if (tab === 'settings') {
          this.store.setSelection({ type: 'settings' });
        } else if (activeSlide && (tab === 'slide' || tab === 'transition')) {
          this.store.setSelection({ type: tab, slideId: activeSlide.id });
        }
      });
    });

    if (activeSegment === 'slide' && activeSlide) {
      const titleIn = pane.querySelector('#insp-slide-title') as HTMLInputElement;
      titleIn?.addEventListener('change', () => {
        this.store.updateSlideDetails(activeSlide.id, { title: titleIn.value });
      });

      const holdIn = pane.querySelector('#insp-slide-hold') as HTMLInputElement;
      holdIn?.addEventListener('change', () => {
        const val = parseFloat(holdIn.value);
        this.store.updateSlideDetails(activeSlide.id, {
          holdDurationSec: Number.isFinite(val) && val > 0 ? val : null,
        });
      });

      const notesIn = pane.querySelector('#insp-slide-notes') as HTMLTextAreaElement;
      notesIn?.addEventListener('change', () => {
        this.store.updateSlideDetails(activeSlide.id, { notes: notesIn.value });
      });

      pane.querySelector('#btn-replace-slide-img')?.addEventListener('click', () => {
        const input = this.root.querySelector('#single-image-input') as HTMLInputElement;
        input.dataset.replaceSlideId = activeSlide.id;
        input.click();
      });

      pane.querySelector('#btn-assign-idle-loop')?.addEventListener('click', () => {
        const input = this.root.querySelector('#single-video-input') as HTMLInputElement;
        if (!input) return;
        delete input.dataset.targetSlideId;
        input.dataset.idleLoopSlideId = activeSlide.id;
        input.click();
      });

      pane.querySelector('#btn-remove-idle-loop')?.addEventListener('click', () => {
        this.store.setSlideIdleLoopVideo(activeSlide.id, null);
        this.store.notify(t('notify.idleLoopRemoved'), 'info');
      });

      pane.querySelector('#btn-insp-duplicate-slide')?.addEventListener('click', () => {
        if (this.store.duplicateSlide(activeSlide.id)) {
          this.store.notify(t('notify.slideDuplicated'), 'success', 2000);
        }
      });

      pane.querySelector('#btn-insp-delete-slide')?.addEventListener('click', () => {
        this.promptDeleteSlide(activeSlide.id);
      });

      this.wireSurgicalAiPromptEvents(pane, activeSlide, slides.indexOf(activeSlide), slides.length);
    }

    if (activeSegment === 'transition' && activeSlide) {
      const spec = activeSlide.transitionToNext;
      const vid = spec.videoAsset;

      this.wireSurgicalAiPromptEvents(pane, activeSlide, slides.indexOf(activeSlide), slides.length);

      pane.querySelector('#btn-replace-trans-video')?.addEventListener('click', () => {
        const input = this.root.querySelector('#single-video-input') as HTMLInputElement;
        delete input.dataset.idleLoopSlideId;
        input.dataset.targetSlideId = activeSlide.id;
        input.click();
      });

      pane.querySelector('#btn-insp-relink-video')?.addEventListener('click', () => {
        const missing = this.store.getMissingVideoAssets?.() ?? [];
        const match = missing.find((m) => m.slideIds.includes(activeSlide.id));
        this.triggerRelinkVideo(match ? match.slideIds : [activeSlide.id]);
      });

      pane.querySelector('#btn-remove-trans-video')?.addEventListener('click', () => {
        this.store.setSlideTransitionVideo(activeSlide.id, null);
        this.store.notify(t('notify.transRemoved'), 'info');
      });

      if (vid) {
        pane.querySelector('#btn-insp-edit-reel-cues')?.addEventListener('click', () => {
          const ctx = this.store.getReelContextForSlide?.(activeSlide.id);
          if (ctx) {
            this.openReelCueModal(ctx.videoAsset, {
              mode: 'replace-reel',
              targetVideoAssetId: ctx.videoAsset.id,
              initialCuePoints: ctx.cuePointsSec,
              isAlreadyOwnedByStore: true,
            });
          }
        });

        const startIn = pane.querySelector('#insp-trans-start') as HTMLInputElement;
        const endIn = pane.querySelector('#insp-trans-end') as HTMLInputElement;

        const commitRange = () => {
          const fallbackStart = spec.startTimeSec ?? 0;
          const fallbackEnd = spec.endTimeSec ?? vid.durationSec;
          const rawStart = parseFloat(startIn?.value ?? '');
          const rawEnd = parseFloat(endIn?.value ?? '');
          const nextStart = Number.isFinite(rawStart) ? rawStart : fallbackStart;
          const nextEnd = Number.isFinite(rawEnd) ? rawEnd : fallbackEnd;
          const ok = this.store.updateTransitionRange(activeSlide.id, nextStart, nextEnd);
          if (!ok) {
            if (startIn) startIn.value = fallbackStart.toFixed(2);
            if (endIn) endIn.value = fallbackEnd.toFixed(2);
            this.store.notify(t('notify.rangeInvalid'), 'warning');
          }
        };

        startIn?.addEventListener('change', commitRange);
        endIn?.addEventListener('change', commitRange);

        const splitOpenBtn = pane.querySelector('#btn-open-split-popover') as HTMLButtonElement;
        const splitCard = pane.querySelector('#split-popover-card') as HTMLElement;
        const splitRange = pane.querySelector('#split-time-range') as HTMLInputElement;
        const splitNum = pane.querySelector('#split-time-num') as HTMLInputElement;
        const splitReadout = pane.querySelector('#split-time-readout') as HTMLElement;
        const splitPreviewImg = pane.querySelector('#split-preview-img') as HTMLImageElement;
        const splitConfirmBtn = pane.querySelector('#btn-confirm-split-transition') as HTMLButtonElement;
        const splitCancelBtn = pane.querySelector('#btn-cancel-split-popover') as HTMLButtonElement;
        const splitStageTimeBtn = pane.querySelector('#btn-split-use-stage-time') as HTMLButtonElement;

        let pendingSplitPreviewTime: number | null = null;
        let isPreviewLoopRunning = false;

        const flushSplitPreview = async () => {
          if (isPreviewLoopRunning) return;
          isPreviewLoopRunning = true;
          try {
            while (pendingSplitPreviewTime !== null) {
              const targetT = pendingSplitPreviewTime;
              pendingSplitPreviewTime = null;
              if (!this.activeInspectorSplitSession) {
                this.activeInspectorSplitSession = await FrameExtractor.createSession(vid);
              }
              if (!this.activeInspectorSplitSession) break;
              const thumb = await this.activeInspectorSplitSession.seekAndCaptureThumb(targetT, 320);
              if (thumb && splitPreviewImg && splitPreviewImg.isConnected) {
                splitPreviewImg.src = thumb;
              }
            }
          } catch {
            // Keep existing preview on transient scrub failure
          } finally {
            isPreviewLoopRunning = false;
          }
        };

        const setSplitTime = (val: number, fetchThumb = true) => {
          const minT = parseFloat(splitRange?.min || '0.08');
          const maxT = parseFloat(splitRange?.max || String(vid.durationSec));
          const clamped = Number(Math.min(maxT, Math.max(minT, val)).toFixed(2));
          if (splitRange) splitRange.value = String(clamped);
          if (splitNum) splitNum.value = clamped.toFixed(2);
          if (splitReadout) splitReadout.textContent = `${clamped.toFixed(2)}s`;
          if (fetchThumb) {
            pendingSplitPreviewTime = clamped;
            void flushSplitPreview();
          }
        };

        splitOpenBtn?.addEventListener('click', () => {
          if (!splitCard) return;
          const isHidden = splitCard.style.display === 'none';
          if (!isHidden) {
            splitCard.style.display = 'none';
            this.disposeActiveSplitSession();
            return;
          }
          splitCard.style.display = 'flex';
          const curStageT = this.latestEngineStatus?.currentVideoTimeSec;
          const minT = parseFloat(splitRange?.min || '0.08');
          const maxT = parseFloat(splitRange?.max || String(vid.durationSec));
          if (typeof curStageT === 'number' && curStageT >= minT && curStageT <= maxT) {
            setSplitTime(curStageT, true);
          } else {
            setSplitTime(parseFloat(splitRange?.value || '0'), true);
          }
        });

        splitCancelBtn?.addEventListener('click', () => {
          if (splitCard) splitCard.style.display = 'none';
          this.disposeActiveSplitSession();
        });

        splitRange?.addEventListener('input', () => {
          const val = parseFloat(splitRange.value);
          if (Number.isFinite(val)) setSplitTime(val, true);
        });

        splitNum?.addEventListener('change', () => {
          const val = parseFloat(splitNum.value);
          if (Number.isFinite(val)) setSplitTime(val, true);
        });

        splitStageTimeBtn?.addEventListener('click', () => {
          const curStageT = this.latestEngineStatus?.currentVideoTimeSec;
          const minT = parseFloat(splitRange?.min || '0.08');
          const maxT = parseFloat(splitRange?.max || String(vid.durationSec));
          if (typeof curStageT === 'number' && curStageT >= minT && curStageT <= maxT) {
            setSplitTime(curStageT, true);
          } else {
            this.store.notify(t('notify.stageTimeOutOfRange'), 'info', 2500);
          }
        });

        splitConfirmBtn?.addEventListener('click', async () => {
          const chosenSec = parseFloat(splitNum?.value || splitRange?.value || '0');
          splitConfirmBtn.disabled = true;
          splitConfirmBtn.textContent = t('inspector.splitConfirmBusy');
          try {
            this.disposeActiveSplitSession();
            const created = await this.store.splitTransitionAtTime(activeSlide.id, chosenSec);
            if (!created) {
              splitConfirmBtn.disabled = false;
              splitConfirmBtn.textContent = t('inspector.splitConfirm');
            }
          } catch (err) {
            splitConfirmBtn.disabled = false;
            splitConfirmBtn.textContent = t('inspector.splitConfirm');
            this.store.notify(
              err instanceof Error ? err.message : t('notify.splitFailed'),
              'error'
            );
          }
        });

        const extractBtn = pane.querySelector('#btn-extract-end-frame') as HTMLButtonElement;
        extractBtn?.addEventListener('click', async () => {
          if (extractBtn) {
            extractBtn.disabled = true;
            extractBtn.innerHTML = `${Icons.extractFrame}<span>${t('inspector.extractEndBusy')}</span>`;
          }
          try {
            await this.store.extractNextSlideFromTransitionEnd(activeSlide.id, spec.endTimeSec);
          } catch (err) {
            this.store.notify(
              err instanceof Error ? err.message : t('notify.extractFailed'),
              'error'
            );
          } finally {
            if (extractBtn && extractBtn.isConnected) {
              extractBtn.disabled = false;
              extractBtn.innerHTML = `${Icons.extractFrame}<span>${
                typeof spec.endTimeSec === 'number'
                  ? t('inspector.extractEndSlice')
                  : t('inspector.extractEndVideo')
              }</span>`;
            }
          }
        });
      }

      pane.querySelector('#btn-generate-trans-video')?.addEventListener('click', async () => {
        const btn = pane.querySelector('#btn-generate-trans-video') as HTMLButtonElement;
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `${Icons.sparkles}<span>${t('inspector.generateTransBusy')}</span>`;
        }
        try {
          await this.store.generateTransitionVideoForSlide(activeSlide.id);
        } finally {
          if (btn) btn.disabled = false;
        }
      });

      const speedInput = pane.querySelector('#insp-trans-speed') as HTMLInputElement;
      const speedLbl = pane.querySelector('#lbl-trans-speed') as HTMLElement;
      speedInput?.addEventListener('input', () => {
        const v = parseFloat(speedInput.value) || 1.0;
        if (speedLbl) speedLbl.textContent = `${v.toFixed(2)}×`;
      });
      speedInput?.addEventListener('change', () => {
        const v = parseFloat(speedInput.value) || 1.0;
        this.store.updateTransitionSpec(activeSlide.id, { playbackSpeed: v });
      });

      const mutedCheck = pane.querySelector('#insp-trans-muted') as HTMLInputElement;
      mutedCheck?.addEventListener('change', () => {
        this.store.updateTransitionSpec(activeSlide.id, { muted: mutedCheck.checked });
      });

      const fallbackSelect = pane.querySelector('#insp-fallback-style') as HTMLSelectElement;
      fallbackSelect?.addEventListener('change', () => {
        this.store.updateTransitionSpec(activeSlide.id, {
          fallbackStyle: fallbackSelect.value as FallbackTransitionStyle,
        });
      });

      const fallbackDurIn = pane.querySelector('#insp-fallback-duration') as HTMLInputElement;
      fallbackDurIn?.addEventListener('change', () => {
        const val = parseInt(fallbackDurIn.value, 10);
        const clamped = Number.isFinite(val) ? Math.max(100, Math.min(5000, val)) : 700;
        fallbackDurIn.value = String(clamped);
        this.store.updateTransitionSpec(activeSlide.id, { fallbackDurationMs: clamped });
      });

      const easingSelect = pane.querySelector('#insp-trans-easing') as HTMLSelectElement;
      easingSelect?.addEventListener('change', () => {
        this.store.updateTransitionSpec(activeSlide.id, {
          easing: easingSelect.value as SegmentEasing,
        });
      });

      pane.querySelector('#btn-apply-trans-all')?.addEventListener('click', () => {
        const count = this.store.applyTransitionSpecToAllSlides(activeSlide.id);
        if (count > 0) {
          this.store.notify(t('notify.appliedToAll', { count }), 'success', 2500);
        }
      });
    }

    if (activeSegment === 'settings') {
      const interruptSel = pane.querySelector('#set-interrupt-behavior') as HTMLSelectElement;
      interruptSel?.addEventListener('change', () => {
        this.store.updateSettings({
          interruptBehavior: interruptSel.value as InterruptBehavior,
        });
      });

      const backSel = pane.querySelector('#set-backward-behavior') as HTMLSelectElement;
      backSel?.addEventListener('change', () => {
        this.store.updateSettings({
          backwardBehavior: backSel.value as BackwardBehavior,
        });
      });

      const globalSpeedIn = pane.querySelector('#set-global-speed') as HTMLInputElement;
      const globalSpeedLbl = pane.querySelector('#lbl-global-speed') as HTMLElement;
      globalSpeedIn?.addEventListener('input', () => {
        const v = parseFloat(globalSpeedIn.value) || 1.0;
        if (globalSpeedLbl) globalSpeedLbl.textContent = `${v.toFixed(2)}×`;
      });
      globalSpeedIn?.addEventListener('change', () => {
        const v = parseFloat(globalSpeedIn.value) || 1.0;
        this.store.updateSettings({ globalPlaybackSpeed: v });
      });

      const loopCheck = pane.querySelector('#set-loop') as HTMLInputElement;
      loopCheck?.addEventListener('change', () => {
        this.store.updateSettings({ loopPresentation: loopCheck.checked });
      });

      const ratioSel = pane.querySelector('#set-aspect-ratio') as HTMLSelectElement;
      ratioSel?.addEventListener('change', () => {
        this.store.updateSettings({ aspectRatio: ratioSel.value as AspectRatioOption });
      });

      const fitSel = pane.querySelector('#set-fit-mode') as HTMLSelectElement;
      fitSel?.addEventListener('change', () => {
        this.store.updateSettings({ fitMode: fitSel.value as FitMode });
      });

      const hudSel = pane.querySelector('#set-hud') as HTMLSelectElement;
      hudSel?.addEventListener('change', () => {
        this.store.updateSettings({ showPresenterHud: hudSel.value as HudVisibility });
      });

      const muteCheck = pane.querySelector('#set-master-muted') as HTMLInputElement;
      muteCheck?.addEventListener('change', () => {
        this.store.updateSettings({ masterMuted: muteCheck.checked });
      });

      const volInput = pane.querySelector('#set-master-volume') as HTMLInputElement;
      const volLbl = pane.querySelector('#lbl-master-volume') as HTMLElement;
      volInput?.addEventListener('input', () => {
        const v = parseFloat(volInput.value) || 0.9;
        if (volLbl) volLbl.textContent = `${Math.round(v * 100)}%`;
      });
      volInput?.addEventListener('change', () => {
        const v = parseFloat(volInput.value) || 0.9;
        this.store.updateSettings({ masterVolume: v });
      });

      const stageBg = pane.querySelector('#set-stage-bg') as HTMLInputElement;
      const stageBgText = pane.querySelector('#set-stage-bg-text') as HTMLInputElement;
      stageBg?.addEventListener('input', () => {
        if (stageBgText) stageBgText.value = stageBg.value;
      });
      stageBg?.addEventListener('change', () => {
        this.store.updateSettings({ stageBackground: stageBg.value });
      });
      stageBgText?.addEventListener('change', () => {
        this.store.updateSettings({ stageBackground: stageBgText.value });
      });

      pane.querySelectorAll('.stage-swatch-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const hex = (btn as HTMLElement).dataset.stageHex;
          if (!hex) return;
          if (stageBg) stageBg.value = hex;
          if (stageBgText) stageBgText.value = hex;
          this.store.updateSettings({ stageBackground: hex });
        });
      });

      const preloadSel = pane.querySelector('#set-preload-strategy') as HTMLSelectElement;
      preloadSel?.addEventListener('change', () => {
        this.store.updateSettings({ preloadStrategy: preloadSel.value as 'all' | 'adjacent' });
      });

      const autoHideCheck = pane.querySelector('#set-autohide-cursor') as HTMLInputElement;
      autoHideCheck?.addEventListener('change', () => {
        this.store.updateSettings({ autoHideCursor: autoHideCheck.checked });
      });

      const fallbackSel = pane.querySelector('#set-default-fallback-style') as HTMLSelectElement;
      fallbackSel?.addEventListener('change', () => {
        this.store.updateSettings({ defaultFallbackStyle: fallbackSel.value as FallbackTransitionStyle });
      });

      const fallbackDurIn = pane.querySelector('#set-default-fallback-dur') as HTMLInputElement;
      fallbackDurIn?.addEventListener('change', () => {
        const d = parseInt(fallbackDurIn.value, 10) || 650;
        this.store.updateSettings({ defaultFallbackDurationMs: d });
      });
    }
  }

  private renderSurgicalAiPromptGroup(
    activeSlide: SlideNode,
    slideIdx: number,
    totalSlides: number,
    defaultScope: 'slide' | 'transition'
  ): string {
    const aiMeta = this.store.getProjectAiSourceMeta();
    const skillName: 'new-motion-presentation' | 'create-new' =
      aiMeta?.skillName === 'create-new' ? 'create-new' : 'new-motion-presentation';
    const scope = this.aiEditScopeOverride ?? defaultScope;
    const outputDirPath = aiMeta?.outputDirPath || aiMeta?.projectRootPath || '';
    const lang = getLanguage();
    const currentVideoTime = this.previewEngine?.getActiveVideoTimeSec?.() ?? null;

    const previewPrompt = MotionReelImporter.buildSurgicalEditPrompt({
      skillName,
      projectRootPath: aiMeta?.projectRootPath || outputDirPath,
      outputDirPath,
      scope,
      slideIndex: slideIdx + 1,
      totalSlides,
      slideTitle: activeSlide.title,
      hasIdleLoop: Boolean(activeSlide.idleLoopAsset || activeSlide.expectedIdleLoopFileName),
      currentTimecodeSec: currentVideoTime,
      sourceMeta: activeSlide.sourceMeta,
      userInstruction: this.aiEditDraftInstruction,
      language: lang,
    });

    const chipLoopVal =
      lang === 'ar'
        ? 'أضف حركة خمول دائرية ناعمة (Idle Loop) تلتزم بنقطة الراحة مع بقاء النصوص ثابتة.'
        : 'Add a subtle Rest-Pose Idle Loop animation keeping core typography rock-steady.';
    const chipFasterVal =
      lang === 'ar'
        ? 'اجعل التوقيت أسرع وأكثر حيوية (Snappier spring easing).'
        : 'Make the motion timing snappier with crisp spring easing.';
    const chipZoomVal =
      lang === 'ar'
        ? 'نفّذ انتقال كاميرا سلس (Camera Zoom Morph) نحو العنصر الرئيسي.'
        : 'Use a smooth log-space camera zoom morph into the hero element.';
    const chipColorsVal =
      lang === 'ar'
        ? 'حسّن تباين الألوان ووضوح العناوين.'
        : 'Boost color contrast and headline legibility.';
    const chipAltVal =
      lang === 'ar'
        ? 'ابتكر تصميماً وحركة بديلة أكثر إبداعاً لنفس المحتوى.'
        : 'Propose and render a fresh, higher-creativity visual alternative for this same content.';

    return `
      <div class="inspector-group" id="insp-ai-prompt-group">
        <div class="inspector-group-title">
          <span>${t('inspector.aiEditTitle')}</span>
          ${Icons.wand}
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <div class="prop-row" style="margin-bottom: 6px;">
            <label class="prop-label" for="insp-ai-scope">${t('inspector.aiScopeLabel')}</label>
            <select class="select-field" id="insp-ai-scope">
              <option value="slide" ${scope === 'slide' ? 'selected' : ''}>${t('inspector.aiScopeSlide')}</option>
              <option value="idle-loop" ${scope === 'idle-loop' ? 'selected' : ''}>${t('inspector.aiScopeLoop')}</option>
              <option value="transition" ${scope === 'transition' ? 'selected' : ''}>${t('inspector.aiScopeTransition')}</option>
              <option value="project" ${scope === 'project' ? 'selected' : ''}>${t('inspector.aiScopeProject')}</option>
            </select>
          </div>
          <div class="prop-row" style="margin-bottom: 6px;">
            <label class="prop-label" for="insp-ai-skill">${t('inspector.aiSkillLabel')}</label>
            <select class="select-field" id="insp-ai-skill">
              <option value="new-motion-presentation" ${skillName === 'new-motion-presentation' ? 'selected' : ''}>/new-motion-presentation</option>
              <option value="create-new" ${skillName === 'create-new' ? 'selected' : ''}>/create-new</option>
            </select>
          </div>
        </div>

        <div class="prop-row">
          <label class="prop-label" for="insp-ai-path">${t('inspector.aiPathLabel')}</label>
          <input
            type="text"
            class="input-field"
            id="insp-ai-path"
            dir="ltr"
            placeholder="${this.escapeHtml(t('inspector.aiPathPlaceholder'))}"
            value="${this.escapeHtml(outputDirPath)}"
          />
        </div>

        <div class="prop-row">
          <label class="prop-label" for="insp-ai-custom-input">${t('inspector.aiInstructionLabel')}</label>
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px;">
            <button type="button" class="btn btn-xs ai-quick-chip" data-chip-text="${this.escapeHtml(chipLoopVal)}">${Icons.replay}<span>${t('inspector.chipLoop')}</span></button>
            <button type="button" class="btn btn-xs ai-quick-chip" data-chip-text="${this.escapeHtml(chipFasterVal)}">${Icons.bolt}<span>${t('inspector.chipFaster')}</span></button>
            <button type="button" class="btn btn-xs ai-quick-chip" data-chip-text="${this.escapeHtml(chipZoomVal)}">${Icons.maximize}<span>${t('inspector.chipZoom')}</span></button>
            <button type="button" class="btn btn-xs ai-quick-chip" data-chip-text="${this.escapeHtml(chipColorsVal)}">${Icons.palette}<span>${t('inspector.chipColors')}</span></button>
            <button type="button" class="btn btn-xs ai-quick-chip" data-chip-text="${this.escapeHtml(chipAltVal)}">${Icons.sparkles}<span>${t('inspector.chipAlt')}</span></button>
          </div>
          <textarea
            class="textarea-field"
            id="insp-ai-custom-input"
            rows="3"
            placeholder="${this.escapeHtml(t('inspector.aiInstructionPlaceholder'))}"
          >${this.escapeHtml(this.aiEditDraftInstruction)}</textarea>
        </div>

        <div class="prop-row" style="margin-bottom: 6px;">
          <label class="prop-label" for="insp-ai-prompt-output">${t('inspector.aiPreviewLabel')}</label>
          <textarea
            class="textarea-field"
            id="insp-ai-prompt-output"
            rows="5"
            readonly
            style="font-family: var(--font-mono, monospace); font-size: 11px; opacity: 0.92;"
          >${this.escapeHtml(previewPrompt)}</textarea>
        </div>

        <button class="btn btn-primary" id="btn-copy-ai-prompt" type="button" style="width: 100%;">
          ${Icons.duplicate}
          <span>${t('inspector.aiCopyBtn')}</span>
        </button>
      </div>
    `;
  }

  private wireSurgicalAiPromptEvents(
    pane: HTMLElement,
    activeSlide: SlideNode,
    slideIdx: number,
    totalSlides: number
  ): void {
    const scopeSel = pane.querySelector('#insp-ai-scope') as HTMLSelectElement | null;
    const skillSel = pane.querySelector('#insp-ai-skill') as HTMLSelectElement | null;
    const pathIn = pane.querySelector('#insp-ai-path') as HTMLInputElement | null;
    const customIn = pane.querySelector('#insp-ai-custom-input') as HTMLTextAreaElement | null;
    const outputPreview = pane.querySelector('#insp-ai-prompt-output') as HTMLTextAreaElement | null;
    const copyBtn = pane.querySelector('#btn-copy-ai-prompt') as HTMLButtonElement | null;

    const refreshPreview = () => {
      if (!outputPreview) return;
      const scope = (scopeSel?.value || 'slide') as
        | 'slide'
        | 'idle-loop'
        | 'transition'
        | 'project';
      const skillName = (skillSel?.value || 'new-motion-presentation') as
        | 'new-motion-presentation'
        | 'create-new';
      const pathVal = pathIn?.value ?? '';
      const aiMeta = this.store.getProjectAiSourceMeta();
      this.aiEditScopeOverride = scope;
      this.aiEditDraftInstruction = customIn?.value ?? '';

      outputPreview.value = MotionReelImporter.buildSurgicalEditPrompt({
        skillName,
        projectRootPath: aiMeta?.projectRootPath || pathVal,
        outputDirPath: pathVal,
        scope,
        slideIndex: Math.max(1, slideIdx + 1),
        totalSlides,
        slideTitle: activeSlide.title,
        hasIdleLoop: Boolean(activeSlide.idleLoopAsset || activeSlide.expectedIdleLoopFileName),
        currentTimecodeSec: this.previewEngine?.getActiveVideoTimeSec?.() ?? null,
        sourceMeta: activeSlide.sourceMeta,
        userInstruction: this.aiEditDraftInstruction,
        language: getLanguage(),
      });
    };

    scopeSel?.addEventListener('change', refreshPreview);
    skillSel?.addEventListener('change', () => {
      const curr = this.store.getProjectAiSourceMeta() || {};
      this.store.setProjectAiSourceMeta({
        ...curr,
        skillName: skillSel.value as 'new-motion-presentation' | 'create-new',
      });
      refreshPreview();
    });
    pathIn?.addEventListener('input', refreshPreview);
    pathIn?.addEventListener('change', () => {
      const curr = this.store.getProjectAiSourceMeta() || {};
      this.store.setProjectAiSourceMeta({
        ...curr,
        outputDirPath: pathIn.value.trim(),
        projectRootPath: curr.projectRootPath || pathIn.value.trim(),
      });
      refreshPreview();
    });
    customIn?.addEventListener('input', refreshPreview);

    pane.querySelectorAll('.ai-quick-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const snippet = (chip as HTMLElement).dataset.chipText || '';
        if (!snippet || !customIn) return;
        const current = customIn.value.trim();
        customIn.value = current ? `${current}\n- ${snippet}` : snippet;
        refreshPreview();
        customIn.focus();
      });
    });

    copyBtn?.addEventListener('click', async () => {
      refreshPreview();
      const text = outputPreview?.value || '';
      if (!text) return;
      try {
        await navigator.clipboard?.writeText(text);
        this.store.notify(t('notify.aiPromptCopied'), 'success', 2500);
      } catch {
        outputPreview?.select();
        document.execCommand?.('copy');
        this.store.notify(t('notify.aiPromptCopied'), 'success', 2500);
      }
    });
  }

  private renderToast(): void {
    const container = this.root.querySelector('#toast-container') as HTMLElement;
    if (!container) return;

    const note = this.store.getNotification();
    if (!note) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="status-toast ${note.kind}">
        <span class="status-toast-dot"></span>
        <span>${this.escapeHtml(note.message)}</span>
      </div>
    `;
  }

  private setupHiddenFileInputs(): void {
    const batchInput = this.root.querySelector('#batch-file-input') as HTMLInputElement;
    batchInput?.addEventListener('change', async () => {
      if (!batchInput.files?.length) return;
      await this.handleBatchFiles(Array.from(batchInput.files));
      batchInput.value = '';
    });

    const projectInput = this.root.querySelector('#project-file-input') as HTMLInputElement;
    projectInput?.addEventListener('change', async () => {
      if (!projectInput.files?.length) return;
      const file = projectInput.files[0];
      projectInput.value = '';
      const bytes = new Uint8Array(await file.arrayBuffer());
      const filePath = window.desktopAPI?.getPathForFile?.(file) || null;
      await this.openProjectFromBytes(bytes, file.name, filePath);
    });

    const singleImgInput = this.root.querySelector('#single-image-input') as HTMLInputElement;
    singleImgInput?.addEventListener('change', async () => {
      if (!singleImgInput.files?.length) return;
      const file = singleImgInput.files[0];
      const replaceId = singleImgInput.dataset.replaceSlideId;
      singleImgInput.value = '';

      try {
        const asset = await MediaValidator.ingestFile(file, 'image');
        if (replaceId) {
          this.store.replaceSlideImage(replaceId, asset);
          this.store.notify(t('notify.slideImageUpdated', { name: asset.name }), 'success');
        } else {
          this.store.addSlideFromImage(asset);
          this.store.notify(t('notify.slideAdded', { name: asset.name }), 'success');
        }
      } catch (err) {
        this.store.notify(
          err instanceof Error ? err.message : t('notify.imageInvalid'),
          'error'
        );
      }
    });

    const singleVidInput = this.root.querySelector('#single-video-input') as HTMLInputElement;
    singleVidInput?.addEventListener('change', async () => {
      if (!singleVidInput.files?.length) return;
      const file = singleVidInput.files[0];
      const targetSlideId = singleVidInput.dataset.targetSlideId;
      const idleLoopSlideId = singleVidInput.dataset.idleLoopSlideId;
      delete singleVidInput.dataset.targetSlideId;
      delete singleVidInput.dataset.idleLoopSlideId;
      singleVidInput.value = '';
      if (idleLoopSlideId) {
        await this.attachIdleLoopVideoToSlide(idleLoopSlideId, file);
        return;
      }
      if (!targetSlideId) return;
      await this.attachVideoFileToSlide(targetSlideId, file);
    });

    const reelVideoInput = this.root.querySelector('#reel-video-input') as HTMLInputElement;
    reelVideoInput?.addEventListener('change', async () => {
      if (!reelVideoInput.files?.length) return;
      const file = reelVideoInput.files[0];
      reelVideoInput.value = '';
      await this.ingestAndRouteReelVideo(file);
    });

    const relinkVideoInput = this.root.querySelector('#relink-video-input') as HTMLInputElement;
    relinkVideoInput?.addEventListener('change', async () => {
      if (!relinkVideoInput.files?.length) return;
      const file = relinkVideoInput.files[0];
      const target = this.pendingRelinkTarget;
      this.pendingRelinkTarget = null;
      relinkVideoInput.value = '';
      if (!target) return;
      await this.performVideoRelink(target, file);
    });
  }

  private async attachIdleLoopVideoToSlide(slideId: string, file: File): Promise<void> {
    try {
      this.store.notify(t('notify.analyzingVideo', { name: file.name }), 'info', 2000);
      const videoAsset = await MediaValidator.ingestFile(file, 'video');
      this.store.setSlideIdleLoopVideo(slideId, videoAsset);
      this.store.notify(
        t('notify.idleLoopAssigned', { name: videoAsset.name }),
        'success'
      );
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.videoUnsupported'),
        'error'
      );
    }
  }

  private async attachVideoFileToSlide(slideId: string, file: File): Promise<void> {
    try {
      this.store.notify(t('notify.analyzingVideo', { name: file.name }), 'info', 2000);
      const videoAsset = await MediaValidator.ingestFile(file, 'video');
      this.store.setSlideTransitionVideo(slideId, videoAsset);
      this.store.notify(
        t('notify.transVideoLinked', {
          name: videoAsset.name,
          dur: videoAsset.durationSec.toFixed(1),
        }),
        'success'
      );
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.videoUnsupported'),
        'error'
      );
    }
  }

  private setupGlobalDragAndDrop(): void {
    const stagePane = this.root.querySelector('#stage-pane') as HTMLElement;

    const showDragState = (active: boolean) => {
      this.root.querySelector('#empty-drop-card')?.classList.toggle('drag-over', active);
      if (this.store.getSlides().length > 0) {
        stagePane?.classList.toggle('drag-over', active);
      } else {
        stagePane?.classList.remove('drag-over');
      }
    };

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.isModalOpen || this.draggedSlideId) return;
      showDragState(true);
    });

    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        showDragState(false);
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      showDragState(false);
    });

    stagePane?.addEventListener('drop', async (e) => {
      e.preventDefault();
      showDragState(false);
      if (this.isModalOpen) return;
      if (!e.dataTransfer) return;
      const droppedFiles = await MotionReelImporter.extractFilesFromDataTransfer(e.dataTransfer);
      if (!droppedFiles.length) return;
      await this.handleBatchFiles(droppedFiles);
    });
  }

  private async handleBatchFiles(files: File[]): Promise<void> {
    if (files.length === 1) {
      const file = files[0];
      if (/\.(mpres|mpres\.json)$/i.test(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const filePath = window.desktopAPI?.getPathForFile?.(file) || null;
        await this.openProjectFromBytes(bytes, file.name, filePath);
        return;
      }
      const check = MediaValidator.validateFile(file);
      if (check.valid && check.kind === 'video') {
        await this.ingestAndRouteReelVideo(file);
        return;
      }
    }

    if (files.length > 1) {
      const reelBundle = await MotionReelImporter.parseBundle(files);
      if (reelBundle.isMotionReel && reelBundle.primaryVideoFile) {
        try {
          const videoAsset = await MediaValidator.ingestFile(reelBundle.primaryVideoFile, 'video');
          const existingSlides = this.store.getSlides();
          if (reelBundle.title && existingSlides.length === 0) {
            this.store.setProjectTitle(reelBundle.title);
          }
          if (reelBundle.suggestedAspectRatio && existingSlides.length === 0) {
            this.store.updateSettings({ aspectRatio: reelBundle.suggestedAspectRatio });
          }
          const cueCount =
            reelBundle.recommendedCuePointsSec.length > 0
              ? reelBundle.recommendedCuePointsSec.length
              : 2;
          this.store.notify(
            t('notify.motionReelDetected', {
              title: reelBundle.title || reelBundle.primaryVideoFile.name,
              cues: cueCount,
            }),
            'success',
            4500
          );
          this.openReelCueModal(videoAsset, {
            mode: existingSlides.length === 0 ? 'replace-all' : 'append',
            initialCuePoints:
              reelBundle.recommendedCuePointsSec.length >= 2
                ? reelBundle.recommendedCuePointsSec
                : undefined,
            initialCueLabels:
              reelBundle.recommendedCueLabels.length >= 2
                ? reelBundle.recommendedCueLabels
                : undefined,
            motionReelMeta: reelBundle,
          });
          return;
        } catch (err) {
          this.store.notify(
            err instanceof Error ? err.message : t('notify.videoUnsupported'),
            'error'
          );
          return;
        }
      }
    }

    const manifestFile = MotionReelImporter.findPresentationManifestFile(files);
    const parsedManifest = manifestFile
      ? MotionReelImporter.parsePresentationManifest(await manifestFile.text().catch(() => null))
      : null;
    const mediaFiles = files.filter((f) => !/\.json$/i.test(f.name));
    if (!mediaFiles.length) return;

    this.store.notify(t('notify.batchScanning', { count: mediaFiles.length }), 'info', 3000);
    try {
      const { newSlides, unpairedVideos, report } = await SmartPairer.processBatchFiles(
        mediaFiles,
        this.store.getSlides().length,
        this.store.getSettings().defaultFallbackStyle,
        {
          onProgress: (done, total, fileName) => {
            this.store.notify(
              t('notify.batchProgress', { done, total, name: fileName }),
              'info',
              2500
            );
          },
        }
      );

      let inferredDir: string | undefined;
      const firstPath = window.desktopAPI?.getPathForFile?.(mediaFiles[0]);
      if (firstPath) {
        const sepIdx = Math.max(firstPath.lastIndexOf('\\'), firstPath.lastIndexOf('/'));
        if (sepIdx > 0) inferredDir = firstPath.slice(0, sepIdx);
      }

      if (parsedManifest) {
        const aiMeta = MotionReelImporter.applyPresentationManifestToSlides(
          newSlides,
          parsedManifest
        );
        if (!aiMeta.outputDirPath && inferredDir) {
          aiMeta.outputDirPath = inferredDir;
        }
        if (parsedManifest.title && this.store.getSlides().length === 0) {
          this.store.setProjectTitle(parsedManifest.title);
        }
        const ratio = MotionReelImporter.formatToAspectRatio(parsedManifest.aspectRatio);
        if (ratio && this.store.getSlides().length === 0) {
          this.store.updateSettings({ aspectRatio: ratio });
        }
        this.store.setProjectAiSourceMeta(aiMeta);
      } else if (inferredDir && !this.store.getProjectAiSourceMeta()?.outputDirPath) {
        this.store.setProjectAiSourceMeta({
          ...(this.store.getProjectAiSourceMeta() || {}),
          outputDirPath: inferredDir,
        });
      }

      if (newSlides.length > 0 || unpairedVideos.length > 0) {
        this.store.appendBatchSlides(newSlides, unpairedVideos);
      }

      if (report.rejectedFiles.length > 0) {
        const firstErr = report.rejectedFiles[0];
        this.store.notify(
          `${t('notify.batchImportedPartial', {
            slides: this.formatArabicSlideCount(report.slidesAdded),
            rejected: report.rejectedFiles.length,
          })} (${firstErr.name}: ${firstErr.reason})`,
          'warning',
          5500
        );
      } else if (report.slidesAdded === 0 && report.transitionsMatched === 0) {
        this.store.notify(t('notify.batchNothingValid'), 'warning');
      } else if (parsedManifest) {
        this.store.notify(
          t('notify.manifestApplied', { count: newSlides.length }),
          'success',
          4000
        );
      } else {
        this.store.notify(
          t('notify.batchImportedSuccess', {
            slides: this.formatArabicSlideCount(report.slidesAdded),
            matched: report.transitionsMatched,
          }),
          'success'
        );
      }
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.importFilesError'),
        'error'
      );
    }
  }

  private async handleGenerateDemo(): Promise<void> {
    if (this.isGeneratingDemo) return;
    this.isGeneratingDemo = true;
    this.renderWindowToolbar();

    try {
      const demoSlides = await DemoGenerator.generateDemoSlides((msg) => {
        this.store.notify(msg, 'info', 2000);
      });
      this.currentProjectFilePath = null;
      this.store.batchUpdate(() => {
        this.store.clearAllSlides();
        this.store.setProjectTitle(t('app.titleDemo'));
        this.store.appendBatchSlides(demoSlides);
      });
      this.syncWindowTitle();
      this.store.notify(t('notify.demoReady'), 'success', 4500);
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.demoFailed'),
        'error'
      );
    } finally {
      this.isGeneratingDemo = false;
      this.renderWindowToolbar();
    }
  }

  /* =========================================================================
   * 5. FULLSCREEN PRESENTATION MODE (F5)
   * ========================================================================= */
  private async enterFullscreenPresentation(startIndex = 0): Promise<void> {
    const slides = this.store.getSlides();
    if (slides.length === 0 || this.isPresentingFullscreen) return;

    // Pause studio preview engine to avoid dual hardware decoding and resource contention
    this.previewEngine.pause();

    this.isPresentingFullscreen = true;
    this.isSlideGridOpen = false;
    this.isLaserPointerActive = false;
    this.isPresenterNotesOpen = false;
    this.presentationStartTimeMs = Date.now();
    this.slideNumberBuffer = '';
    if (this.slideNumberTimer) {
      clearTimeout(this.slideNumberTimer);
      this.slideNumberTimer = null;
    }
    if (this.presentationTimerHandle) {
      clearInterval(this.presentationTimerHandle);
      this.presentationTimerHandle = null;
    }

    const fsRoot = this.root.querySelector('#fullscreen-root') as HTMLElement;
    const settings = this.store.getSettings();

    fsRoot.innerHTML = `
      <div class="fullscreen-presenter" id="fs-presenter">
        <div class="presenter-top-progress" id="fs-top-progress" style="${settings.showPresenterHud === 'hidden' ? 'display:none;' : ''}">
          <div class="presenter-top-progress-bar" id="fs-top-bar" style="width:0%"></div>
        </div>
        <canvas class="presenter-canvas" id="fs-canvas"></canvas>
        <div class="presenter-blank-overlay hidden" id="fs-blank-overlay"></div>
        <div class="presenter-laser-dot hidden" id="fs-laser-dot" aria-hidden="true"></div>
        <div class="presenter-slide-indicator hidden" id="fs-slide-indicator" aria-live="polite"></div>
        <div class="presenter-hud" id="fs-hud" style="${settings.showPresenterHud !== 'minimal' ? 'display:none;' : ''}">
          <button class="hud-transport-btn" id="fs-btn-prev" title="${this.escapeHtml(t('presenter.prevTitle'))}" aria-label="${this.escapeHtml(t('presenter.prevAria'))}">
            ${isRtlLanguage() ? Icons.chevronRight : Icons.chevronLeft}
          </button>
          <span id="fs-hud-label" class="tabular-nums" style="font-weight:600; min-width:86px; text-align:center;"></span>
          <button class="hud-step-btn" id="fs-btn-next" title="${this.escapeHtml(t('presenter.nextTitle'))}" aria-label="${this.escapeHtml(t('presenter.nextAria'))}">
            <span>${t('presenter.nextLabel')}</span>
            ${isRtlLanguage() ? Icons.chevronLeft : Icons.chevronRight}
          </button>
          <div class="toolbar-divider"></div>
          <span class="presenter-timer-pill tabular-nums" id="fs-elapsed-timer" title="${this.escapeHtml(t('presenter.timerTitle'))}">${Icons.clock}<span>00:00</span></span>
          <button class="hud-transport-btn" id="fs-btn-notes" title="${this.escapeHtml(t('presenter.notesTitle'))}" aria-label="${this.escapeHtml(t('presenter.notesAria'))}">
            ${Icons.notes}
          </button>
          <button class="hud-transport-btn" id="fs-btn-grid" title="${this.escapeHtml(t('presenter.gridTitle'))}" aria-label="${this.escapeHtml(t('presenter.gridAria'))}">
            ${Icons.grid}
          </button>
          <button class="hud-transport-btn" id="fs-btn-exit" title="${this.escapeHtml(t('presenter.exitTitle'))}" aria-label="${this.escapeHtml(t('presenter.exitAria'))}">
            ${Icons.close}
          </button>
        </div>
        <div class="presenter-notes-drawer hidden" id="fs-notes-drawer" role="region" aria-label="${this.escapeHtml(t('presenter.notesDrawerAria'))}">
          <div class="presenter-notes-header">
            <span class="presenter-notes-title" id="fs-notes-slide-title">${t('presenter.notesHeader')}</span>
            <div class="presenter-notes-controls">
              <button class="btn btn-xs" id="fs-notes-font-dec" type="button" title="${this.escapeHtml(t('presenter.notesFontDec'))}">A-</button>
              <button class="btn btn-xs" id="fs-notes-font-inc" type="button" title="${this.escapeHtml(t('presenter.notesFontInc'))}">A+</button>
              <button class="btn btn-xs" id="fs-notes-close" type="button" title="${this.escapeHtml(t('presenter.closeShortcut'))}">✕</button>
            </div>
          </div>
          <div class="presenter-notes-body" id="fs-notes-body" style="font-size:${this.presenterNotesFontSize}px;"></div>
          <div class="presenter-notes-footer" id="fs-notes-next-slide"></div>
        </div>
        <div id="fs-grid-host"></div>
      </div>
    `;

    this.presenterOverlayEl = fsRoot.querySelector('#fs-presenter') as HTMLElement;
    this.laserPointerEl = fsRoot.querySelector('#fs-laser-dot') as HTMLElement;
    this.slideIndicatorEl = fsRoot.querySelector('#fs-slide-indicator') as HTMLElement;
    const fsCanvas = fsRoot.querySelector('#fs-canvas') as HTMLCanvasElement;

    this.presenterEngine = new StagePlaybackEngine(fsCanvas, settings);
    this.presenterEngine.onStatusChange((st) => {
      this.updateFullscreenHud(st);
    });

    await this.presenterEngine.loadProject(slides, settings, startIndex);

    try {
      if (window.desktopAPI?.setFullScreen) {
        await window.desktopAPI.setFullScreen(true);
      } else if (this.presenterOverlayEl.requestFullscreen) {
        await this.presenterOverlayEl.requestFullscreen();
      }
    } catch {
      // Fallback to maximized overlay
    }

    fsCanvas.addEventListener('click', () => {
      if (!this.isSlideGridOpen) {
        this.presenterEngine?.next();
      }
    });

    fsCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.isSlideGridOpen) {
        this.presenterEngine?.previous();
      }
    });

    const fsBlankOverlay = fsRoot.querySelector('#fs-blank-overlay') as HTMLElement;
    fsBlankOverlay?.addEventListener('click', () => {
      if (!this.isSlideGridOpen) {
        this.presenterEngine?.next();
      }
    });
    fsBlankOverlay?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.isSlideGridOpen) {
        this.presenterEngine?.previous();
      }
    });

    fsRoot.querySelector('#fs-btn-prev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.presenterEngine?.previous();
    });

    fsRoot.querySelector('#fs-btn-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.presenterEngine?.next();
    });

    fsRoot.querySelector('#fs-btn-grid')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePresenterSlideGrid();
    });

    fsRoot.querySelector('#fs-btn-notes')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePresenterNotesDrawer();
    });

    fsRoot.querySelector('#fs-notes-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePresenterNotesDrawer(false);
    });

    fsRoot.querySelector('#fs-notes-font-dec')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.adjustPresenterNotesFont(-2);
    });

    fsRoot.querySelector('#fs-notes-font-inc')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.adjustPresenterNotesFont(2);
    });

    fsRoot.querySelector('#fs-notes-drawer')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    fsRoot.querySelector('#fs-elapsed-timer')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetPresenterTimer();
    });

    fsRoot.querySelector('#fs-btn-exit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exitFullscreenPresentation();
    });

    this.syncPresenterNotesDrawerContent();
    this.updatePresenterTimerDisplay();
    this.presentationTimerHandle = setInterval(() => this.updatePresenterTimerDisplay(), 1000);
    (this.presentationTimerHandle as unknown as { unref?: () => void })?.unref?.();

    this.onPresenterMouseMove = (e: MouseEvent) => {
      this.resetPresenterCursorAutoHide();
      if (this.isLaserPointerActive && this.laserPointerEl) {
        this.laserPointerEl.style.left = `${e.clientX ?? 0}px`;
        this.laserPointerEl.style.top = `${e.clientY ?? 0}px`;
      }
    };
    this.presenterOverlayEl.addEventListener('mousemove', this.onPresenterMouseMove);
    window.addEventListener('mousemove', this.onPresenterMouseMove);
    this.resetPresenterCursorAutoHide();
  }

  private updateFullscreenHud(status: EngineStatus): void {
    if (!this.isPresentingFullscreen) return;
    const slides = this.store.getSlides();
    const label = this.root.querySelector('#fs-hud-label') as HTMLElement;
    const topBar = this.root.querySelector('#fs-top-bar') as HTMLElement;
    const blankOverlay = this.root.querySelector('#fs-blank-overlay') as HTMLElement;

    const current = String(status.currentSlideIndex + 1).padStart(2, '0');
    const total = String(slides.length).padStart(2, '0');
    if (label) {
      if (status.phase === 'PLAYING_TRANSITION') {
        const target = String((status.targetSlideIndex ?? status.currentSlideIndex) + 1).padStart(2, '0');
        label.textContent = `${current} ${getFlowArrow()} ${target}`;
      } else if (status.phase === 'BLACKOUT') {
        label.textContent = t('presenter.blackoutLabel');
      } else if (status.phase === 'WHITEOUT') {
        label.textContent = t('presenter.whiteoutLabel');
      } else {
        label.textContent = `${current} / ${total}`;
      }
    }

    if (blankOverlay) {
      if (status.phase === 'BLACKOUT') {
        blankOverlay.classList.remove('hidden', 'white');
        blankOverlay.classList.add('black');
      } else if (status.phase === 'WHITEOUT') {
        blankOverlay.classList.remove('hidden', 'black');
        blankOverlay.classList.add('white');
      } else {
        blankOverlay.classList.add('hidden');
        blankOverlay.classList.remove('black', 'white');
      }
    }

    if (topBar && slides.length > 0) {
      const basePct =
        slides.length > 1
          ? ((status.currentSlideIndex +
              (status.phase === 'PLAYING_TRANSITION' ? status.transitionProgress : 0)) /
              (slides.length - 1)) *
            100
          : 100;
      topBar.style.width = `${Math.min(100, Math.max(0, basePct))}%`;
    }

    this.syncPresenterNotesDrawerContent(status.currentSlideIndex);
  }

  private togglePresenterNotesDrawer(forceState?: boolean): void {
    if (!this.isPresentingFullscreen) return;
    this.isPresenterNotesOpen =
      typeof forceState === 'boolean' ? forceState : !this.isPresenterNotesOpen;
    const drawer = this.root.querySelector('#fs-notes-drawer') as HTMLElement | null;
    const btn = this.root.querySelector('#fs-btn-notes') as HTMLElement | null;
    if (drawer) {
      drawer.classList.toggle('hidden', !this.isPresenterNotesOpen);
    }
    if (btn) {
      btn.classList.toggle('active-pane', this.isPresenterNotesOpen);
    }
    if (this.isPresenterNotesOpen) {
      this.syncPresenterNotesDrawerContent();
    }
  }

  private adjustPresenterNotesFont(delta: number): void {
    this.presenterNotesFontSize = Math.max(12, Math.min(28, this.presenterNotesFontSize + delta));
    const body = this.root.querySelector('#fs-notes-body') as HTMLElement | null;
    if (body) {
      body.style.fontSize = `${this.presenterNotesFontSize}px`;
    }
  }

  private syncPresenterNotesDrawerContent(overrideIdx?: number): void {
    const slides = this.store.getSlides();
    const idx =
      typeof overrideIdx === 'number'
        ? overrideIdx
        : this.presenterEngine?.getStatus().currentSlideIndex ?? 0;
    const currentSlide = slides[idx];
    const nextSlide = idx + 1 < slides.length ? slides[idx + 1] : null;

    const titleEl = this.root.querySelector('#fs-notes-slide-title') as HTMLElement | null;
    const bodyEl = this.root.querySelector('#fs-notes-body') as HTMLElement | null;
    const footerEl = this.root.querySelector('#fs-notes-next-slide') as HTMLElement | null;

    if (titleEl && currentSlide) {
      titleEl.textContent = t('presenter.notesForSlide', { title: currentSlide.title });
    }
    if (bodyEl) {
      const notes = currentSlide?.notes?.trim() || '';
      if (notes) {
        bodyEl.innerHTML = `<p class="presenter-notes-text">${this.escapeHtml(notes)}</p>`;
      } else {
        bodyEl.innerHTML = `<p class="presenter-notes-empty">${t('presenter.notesEmpty')}</p>`;
      }
    }
    if (footerEl) {
      footerEl.textContent = nextSlide
        ? t('presenter.notesNextSlide', { title: nextSlide.title })
        : t('presenter.notesEnd');
    }
  }

  private updatePresenterTimerDisplay(): void {
    const timerEl = this.root.querySelector('#fs-elapsed-timer') as HTMLElement | null;
    if (!timerEl || !this.isPresentingFullscreen) return;
    const elapsedSec = Math.max(0, Math.floor((Date.now() - this.presentationStartTimeMs) / 1000));
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const span = timerEl.querySelector('span');
    if (span) {
      span.textContent = formatted;
    } else {
      timerEl.textContent = formatted;
    }
  }

  private resetPresenterTimer(): void {
    if (!this.isPresentingFullscreen) return;
    this.presentationStartTimeMs = Date.now();
    this.updatePresenterTimerDisplay();
  }

  private togglePresenterSlideGrid(): void {
    if (!this.isPresentingFullscreen) return;
    this.isSlideGridOpen = !this.isSlideGridOpen;
    const host = this.root.querySelector('#fs-grid-host') as HTMLElement;
    if (!host) return;

    if (!this.isSlideGridOpen) {
      host.innerHTML = '';
      return;
    }

    const slides = this.store.getSlides();
    const activeIdx = this.presenterEngine?.getStatus().currentSlideIndex ?? 0;

    host.innerHTML = `
      <div class="slide-grid-modal" role="dialog" aria-label="${this.escapeHtml(t('presenter.gridModalAria'))}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h2 style="font-size:17px; font-weight:600;">${t('presenter.gridHeading')}</h2>
          <button class="btn" id="btn-close-grid">
            ${Icons.close}
            <span>${t('presenter.close')}</span>
          </button>
        </div>
        <div class="grid-cards-container">
          ${slides
            .map(
              (s, i) => `
            <div class="grid-jump-card ${i === activeIdx ? 'active' : ''}" data-idx="${i}" tabindex="0" role="button">
              <img src="${s.imageAsset.thumbnailUrl || s.imageAsset.objectUrl}" alt="${this.escapeHtml(s.title)}" />
              <div class="grid-jump-card-title">
                <span class="tabular-nums" style="color:var(--label-secondary); margin-inline-end:6px;">${i + 1}</span>
                <span>${this.escapeHtml(s.title)}</span>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;

    host.querySelector('#btn-close-grid')?.addEventListener('click', () => {
      this.togglePresenterSlideGrid();
    });

    const cards = Array.from(host.querySelectorAll('.grid-jump-card')) as HTMLElement[];
    cards.forEach((card, i) => {
      const activate = () => {
        const idx = parseInt(card.dataset.idx || '0', 10);
        this.togglePresenterSlideGrid();
        this.presenterEngine?.jumpToSlide(idx, true);
        this.store.setActivePreviewIndex(idx);
        const slide = this.store.getSlideByIndex(idx);
        if (slide) {
          this.store.setSelection({ type: 'slide', slideId: slide.id });
        }
      };

      card.addEventListener('click', activate);

      card.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          activate();
          return;
        }

        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          const targetCard = cards[Math.min(cards.length - 1, i + 1)];
          targetCard?.focus();
          return;
        }

        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          const targetCard = cards[Math.max(0, i - 1)];
          targetCard?.focus();
          return;
        }

        if (e.key === 'Home') {
          e.preventDefault();
          e.stopPropagation();
          cards[0]?.focus();
          return;
        }

        if (e.key === 'End') {
          e.preventDefault();
          e.stopPropagation();
          cards[cards.length - 1]?.focus();
          return;
        }
      });
    });

    // Auto-focus currently active slide or first slide for immediate keyboard control
    const activeCard = host.querySelector('.grid-jump-card.active') as HTMLElement | null;
    if (activeCard) {
      activeCard.focus();
    } else if (cards.length > 0) {
      cards[0].focus();
    }
  }

  private resetPresenterCursorAutoHide(): void {
    if (!this.presenterOverlayEl) return;
    this.presenterOverlayEl.classList.remove('hide-cursor');
    if (this.presenterCursorTimer) {
      clearTimeout(this.presenterCursorTimer);
    }
    if (this.store.getSettings().autoHideCursor) {
      this.presenterCursorTimer = window.setTimeout(() => {
        if (this.isPresentingFullscreen && !this.isSlideGridOpen) {
          this.presenterOverlayEl?.classList.add('hide-cursor');
        }
      }, 2200);
    }
  }

  private async exitFullscreenPresentation(): Promise<void> {
    if (!this.isPresentingFullscreen) return;
    const lastIdx = this.presenterEngine?.getStatus().currentSlideIndex ?? 0;

    this.isPresentingFullscreen = false;
    this.isSlideGridOpen = false;
    this.isLaserPointerActive = false;
    this.isPresenterNotesOpen = false;
    this.clearSlideNumberBuffer();
    if (this.presentationTimerHandle) {
      clearInterval(this.presentationTimerHandle);
      this.presentationTimerHandle = null;
    }
    if (this.onPresenterMouseMove) {
      window.removeEventListener('mousemove', this.onPresenterMouseMove);
      this.presenterOverlayEl?.removeEventListener('mousemove', this.onPresenterMouseMove);
      this.onPresenterMouseMove = null;
    }
    this.laserPointerEl = null;
    this.slideIndicatorEl = null;
    if (this.presenterCursorTimer) {
      clearTimeout(this.presenterCursorTimer);
      this.presenterCursorTimer = null;
    }

    this.presenterEngine?.destroy();
    this.presenterEngine = null;
    this.presenterOverlayEl = null;

    const fsRoot = this.root.querySelector('#fullscreen-root') as HTMLElement;
    if (fsRoot) fsRoot.innerHTML = '';

    try {
      if (window.desktopAPI?.setFullScreen) {
        await window.desktopAPI.setFullScreen(false);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore
    }

    this.store.setActivePreviewIndex(lastIdx);
    const slide = this.store.getSlideByIndex(lastIdx);
    if (slide) {
      this.store.setSelection({ type: 'slide', slideId: slide.id });
    }
    this.syncNavigatorActiveSlide(lastIdx);
    await this.previewEngine.jumpToSlide(lastIdx, true);
  }

  private toggleLaserPointer(): void {
    if (!this.isPresentingFullscreen || this.isSlideGridOpen) return;
    this.setLaserPointer(!this.isLaserPointerActive);
  }

  private setLaserPointer(active: boolean): void {
    this.isLaserPointerActive = active;
    if (!this.presenterOverlayEl) return;
    if (active) {
      this.presenterOverlayEl.classList.add('laser-active');
      if (this.laserPointerEl) {
        this.laserPointerEl.classList.remove('hidden');
        this.laserPointerEl.classList.add('visible');
      }
    } else {
      this.presenterOverlayEl.classList.remove('laser-active');
      if (this.laserPointerEl) {
        this.laserPointerEl.classList.remove('visible');
        this.laserPointerEl.classList.add('hidden');
      }
    }
  }

  private togglePresenterCursorVisibility(): void {
    if (!this.presenterOverlayEl) return;
    const isHidden = this.presenterOverlayEl.classList.contains('hide-cursor');
    if (isHidden) {
      this.presenterOverlayEl.classList.remove('hide-cursor');
      this.resetPresenterCursorAutoHide();
    } else {
      if (this.presenterCursorTimer) {
        clearTimeout(this.presenterCursorTimer);
        this.presenterCursorTimer = null;
      }
      this.presenterOverlayEl.classList.add('hide-cursor');
    }
  }

  private handleSlideNumberInput(digit: string): void {
    this.slideNumberBuffer += digit;
    this.showSlideJumpIndicator();
    if (this.slideNumberTimer) {
      clearTimeout(this.slideNumberTimer);
    }
    this.slideNumberTimer = window.setTimeout(() => {
      this.clearSlideNumberBuffer();
    }, 2500);
  }

  private showSlideJumpIndicator(): void {
    if (!this.presenterOverlayEl) return;
    if (!this.slideIndicatorEl) {
      this.slideIndicatorEl = this.presenterOverlayEl.querySelector('#fs-slide-indicator') as HTMLElement;
    }
    if (this.slideIndicatorEl) {
      this.slideIndicatorEl.textContent = this.slideNumberBuffer;
      this.slideIndicatorEl.classList.remove('hidden');
      this.slideIndicatorEl.classList.add('visible');
    }
  }

  private clearSlideNumberBuffer(): void {
    this.slideNumberBuffer = '';
    if (this.slideNumberTimer) {
      clearTimeout(this.slideNumberTimer);
      this.slideNumberTimer = null;
    }
    if (this.slideIndicatorEl) {
      this.slideIndicatorEl.textContent = '';
      this.slideIndicatorEl.classList.remove('visible');
      this.slideIndicatorEl.classList.add('hidden');
    }
  }

  private jumpToSlideFromNumber(): boolean {
    if (!this.slideNumberBuffer) return false;
    const targetNum = parseInt(this.slideNumberBuffer, 10);
    this.clearSlideNumberBuffer();
    if (!isNaN(targetNum) && targetNum > 0) {
      const slides = this.store.getSlides();
      const targetIdx = Math.min(slides.length - 1, Math.max(0, targetNum - 1));
      this.presenterEngine?.jumpToSlide(targetIdx, true);
      this.store.setActivePreviewIndex(targetIdx);
      const slide = this.store.getSlideByIndex(targetIdx);
      if (slide) {
        this.store.setSelection({ type: 'slide', slideId: slide.id });
      }
      return true;
    }
    return false;
  }

  /* =========================================================================
   * 6. KEYBOARD SHORTCUTS & NATIVE DESKTOP MENU COMMANDS (keyboards.md, the-menu-bar.md)
   * ========================================================================= */
  private bindNativeMenuCommands(): void {
    window.desktopAPI?.onMenuCommand?.((cmd) => {
      switch (cmd) {
        case 'import-media':
          this.handleImportMedia();
          break;
        case 'open-project':
          this.handleOpenProject();
          break;
        case 'add-slide': {
          const input = this.root.querySelector('#single-image-input') as HTMLInputElement;
          input.dataset.replaceSlideId = '';
          input.click();
          break;
        }
        case 'load-demo':
          this.handleGenerateDemo();
          break;
        case 'save-project':
          void this.handleSaveProject(false);
          break;
        case 'save-project-as':
          void this.handleSaveProject(true);
          break;
        case 'undo':
          if (this.store.undo()) {
            this.store.notify(t('notify.undoDone'), 'info', 2000);
          }
          break;
        case 'redo':
          if (this.store.redo()) {
            this.store.notify(t('notify.redoDone'), 'info', 2000);
          }
          break;
        case 'duplicate-slide':
          if (this.store.duplicateSlide()) {
            this.store.notify(t('notify.slideDuplicated'), 'success', 2000);
          }
          break;
        case 'toggle-navigator':
          this.toggleNavigatorPane();
          break;
        case 'toggle-inspector':
          this.toggleInspectorPane();
          break;
        case 'start-presentation':
          this.enterFullscreenPresentation(
            this.latestEngineStatus?.currentSlideIndex || 0
          );
          break;
      }
    });
  }

  private bindGlobalShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      if (this.isModalOpen) {
        return;
      }

      const target = e.target as HTMLElement;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');

      // Native style pane and action shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        this.toggleNavigatorPane();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        this.toggleInspectorPane();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        this.handleOpenProject();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void this.handleSaveProject(e.shiftKey);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        this.openCommandPalette();
        return;
      }

      if (e.key === 'F5') {
        e.preventDefault();
        if (!this.isPresentingFullscreen) {
          this.enterFullscreenPresentation(
            this.latestEngineStatus?.currentSlideIndex || 0
          );
        }
        return;
      }

      if (this.isPresentingFullscreen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (this.isSlideGridOpen) {
            this.togglePresenterSlideGrid();
          } else if (this.slideNumberBuffer.length > 0) {
            this.clearSlideNumberBuffer();
          } else if (this.isLaserPointerActive) {
            this.setLaserPointer(false);
          } else {
            this.exitFullscreenPresentation();
          }
          return;
        }

        // Laser pointer toggle (Ctrl+L)
        if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
          e.preventDefault();
          this.toggleLaserPointer();
          return;
        }

        if (e.key.toLowerCase() === 'g') {
          e.preventDefault();
          this.clearSlideNumberBuffer();
          this.togglePresenterSlideGrid();
          return;
        }

        // EVENT ISOLATION: When the slide grid modal is open, prevent all
        // background presentation controls (Space, Arrows, PageUp/Down, Enter, B, W, etc.)
        // from bleeding into the playback engine.
        if (this.isSlideGridOpen) {
          return;
        }

        // Toggle cursor visibility via 'A' or '='
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key.toLowerCase() === 'a' || e.key === '=')) {
          e.preventDefault();
          this.togglePresenterCursorVisibility();
          return;
        }

        // Toggle Speaker Notes Drawer via 'S'
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) {
          e.preventDefault();
          this.togglePresenterNotesDrawer();
          return;
        }

        // Reset Elapsed Presentation Timer via 'T'
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key.toLowerCase() === 't' || e.code === 'KeyT')) {
          e.preventDefault();
          this.resetPresenterTimer();
          return;
        }

        // Slide number jump buffer (PowerPoint behavior: type digits then press Enter)
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key >= '0' && e.key <= '9') {
          e.preventDefault();
          this.handleSlideNumberInput(e.key);
          return;
        }

        // Backspace removes last digit from slide number buffer if present
        if (e.key === 'Backspace' && this.slideNumberBuffer.length > 0) {
          e.preventDefault();
          this.slideNumberBuffer = this.slideNumberBuffer.slice(0, -1);
          if (this.slideNumberBuffer.length === 0) {
            this.clearSlideNumberBuffer();
          } else {
            this.showSlideJumpIndicator();
            if (this.slideNumberTimer) {
              clearTimeout(this.slideNumberTimer);
            }
            this.slideNumberTimer = window.setTimeout(() => {
              this.clearSlideNumberBuffer();
            }, 2500);
          }
          return;
        }

        // Enter key: jump to slide number if buffer active, otherwise normal advance
        if (e.key === 'Enter') {
          if (this.slideNumberBuffer.length > 0) {
            e.preventDefault();
            this.jumpToSlideFromNumber();
            return;
          }
        }

        // Clear slide number buffer on any other navigation or control key
        if (this.slideNumberBuffer.length > 0 && e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt') {
          this.clearSlideNumberBuffer();
        }

        if (e.key.toLowerCase() === 'b' || e.key === '.') {
          e.preventDefault();
          this.presenterEngine?.toggleBlackout();
          return;
        }

        if (e.code === 'KeyW' || e.key.toLowerCase() === 'w' || e.key === ',' || e.key === '،') {
          e.preventDefault();
          this.presenterEngine?.toggleWhiteout();
          return;
        }

        // Standard PowerPoint navigation: Right/Down/Space/PageDown/Enter/N advance to next slide
        if (
          e.key === ' ' ||
          e.key === 'ArrowRight' ||
          e.key === 'ArrowDown' ||
          e.key === 'PageDown' ||
          e.key === 'Enter' ||
          (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'n')
        ) {
          e.preventDefault();
          this.presenterEngine?.next();
          return;
        }

        // Standard PowerPoint navigation: Left/Up/PageUp/Backspace/P retreat to previous slide
        if (
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowUp' ||
          e.key === 'PageUp' ||
          e.key === 'Backspace' ||
          (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'p')
        ) {
          e.preventDefault();
          this.presenterEngine?.previous();
          return;
        }

        if (e.key === 'Home') {
          e.preventDefault();
          this.presenterEngine?.jumpToSlide(0, true);
          return;
        }

        if (e.key === 'End') {
          e.preventDefault();
          this.presenterEngine?.jumpToSlide(this.store.getSlides().length - 1, true);
          return;
        }
        return;
      }

      // Studio-wide shortcuts available even when deck is empty (e.g., Undo last slide delete, Shortcuts help)
      if (!isInputFocused) {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (this.store.undo()) {
            this.store.notify(t('notify.undoDone'), 'info', 2000);
          }
          return;
        }

        if (
          (e.ctrlKey || e.metaKey) &&
          (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
        ) {
          e.preventDefault();
          if (this.store.redo()) {
            this.store.notify(t('notify.redoDone'), 'info', 2000);
          }
          return;
        }

        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          if (this.store.duplicateSlide()) {
            this.store.notify(t('notify.slideDuplicated'), 'success', 2000);
          }
          return;
        }

        if (e.key === '?' || e.key === 'F1') {
          e.preventDefault();
          this.openShortcutsHelpModal();
          return;
        }
      }

      // Studio view shortcuts (when no text input/textarea is focused)
      if (!isInputFocused && this.store.getSlides().length > 0) {
        const slides = this.store.getSlides();
        const selection = this.store.getSelection();
        const activeSlideId =
          selection.type === 'slide' || selection.type === 'transition'
            ? selection.slideId
            : slides[this.store.getActivePreviewIndex()]?.id;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          this.store.selectAllSlides();
          return;
        }

        if (e.key === 'Escape' && this.store.getMultiSelectionSummary().totalCount > 1) {
          e.preventDefault();
          this.store.clearMultiSelection();
          return;
        }

        if (e.key === 'Delete') {
          e.preventDefault();
          this.handleDeleteAction();
          return;
        }

        if ((e.altKey || e.ctrlKey || e.metaKey) && e.key === 'ArrowUp' && activeSlideId) {
          e.preventDefault();
          this.store.moveSlide(activeSlideId, 'up');
          return;
        }

        if ((e.altKey || e.ctrlKey || e.metaKey) && e.key === 'ArrowDown' && activeSlideId) {
          e.preventDefault();
          this.store.moveSlide(activeSlideId, 'down');
          return;
        }

        const isInteractiveFocused = Boolean(
          target &&
            (target.tagName === 'BUTTON' ||
              target.closest('button') ||
              target.closest('.slide-nav-item') ||
              target.closest('.filmstrip-bridge'))
        );

        if (
          e.key === 'ArrowRight' ||
          e.key === 'ArrowDown' ||
          e.key === 'PageDown' ||
          e.key.toLowerCase() === 'n' ||
          ((e.key === ' ' || e.key === 'Enter') && !isInteractiveFocused)
        ) {
          e.preventDefault();
          this.previewEngine.next();
          return;
        }

        if (
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowUp' ||
          e.key === 'PageUp' ||
          e.key.toLowerCase() === 'p' ||
          (e.key === 'Backspace' && !isInteractiveFocused)
        ) {
          e.preventDefault();
          this.previewEngine.previous();
          return;
        }

        if (e.key === 'Home') {
          e.preventDefault();
          this.previewEngine.jumpToSlide(0, true);
          return;
        }

        if (e.key === 'End') {
          e.preventDefault();
          this.previewEngine.jumpToSlide(this.store.getSlides().length - 1, true);
          return;
        }

        if (e.key.toLowerCase() === 'b' || e.key === '.') {
          e.preventDefault();
          this.previewEngine.toggleBlackout();
          return;
        }

        if (e.code === 'KeyW' || e.key.toLowerCase() === 'w' || e.key === ',' || e.key === '،') {
          e.preventDefault();
          this.previewEngine.toggleWhiteout();
          return;
        }
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.isPresentingFullscreen && !window.desktopAPI) {
        this.exitFullscreenPresentation();
      }
    });
  }

  private disposeActiveSplitSession(): void {
    if (this.activeInspectorSplitSession) {
      try {
        this.activeInspectorSplitSession.dispose();
      } catch {
        // Ignore disposal errors
      }
      this.activeInspectorSplitSession = null;
    }
  }

  private formatArabicSlideCount(count: number): string {
    return formatSlideCount(count);
  }

  private formatTimecode(sec: number): string {
    const safe = Number.isFinite(sec) && sec >= 0 ? sec : 0;
    const mins = Math.floor(safe / 60);
    const rem = safe - mins * 60;
    const whole = Math.floor(rem);
    const centis = Math.floor((rem - whole) * 100);
    return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
  }

  private async pickVideoViaDesktop(): Promise<File | null> {
    if (!window.desktopAPI?.openMediaDialog) return null;
    const selected = await window.desktopAPI.openMediaDialog();
    if (!selected || selected.length === 0) return null;

    for (const item of selected) {
      const file = new File([item.buffer], item.fileName, { type: item.mimeType });
      if (MediaValidator.validateFile(file, 'video').valid) {
        return file;
      }
    }
    this.store.notify(t('notify.pickValidVideo'), 'warning');
    return null;
  }

  private async handleOpenReelWorkflow(): Promise<void> {
    if (window.desktopAPI?.openMediaDialog) {
      try {
        const file = await this.pickVideoViaDesktop();
        if (file) {
          await this.ingestAndRouteReelVideo(file, true);
        }
      } catch (err) {
        this.store.notify(
          err instanceof Error ? err.message : t('notify.pickVideoFailed'),
          'error'
        );
      }
    } else {
      const input = this.root.querySelector('#reel-video-input') as HTMLInputElement;
      input?.click();
    }
  }

  private async ingestAndRouteReelVideo(file: File, forceReelModal = false): Promise<void> {
    try {
      this.store.notify(t('notify.analyzingVideo', { name: file.name }), 'info', 2500);
      const videoAsset = await MediaValidator.ingestFile(file, 'video');
      const slides = this.store.getSlides();

      if (slides.length === 0) {
        this.openReelCueModal(videoAsset, { mode: 'replace-all' });
        return;
      }

      if (forceReelModal) {
        this.openReelCueModal(videoAsset, { mode: 'append' });
        return;
      }

      this.openSingleVideoActionModal(videoAsset);
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.videoUnsupported'),
        'error'
      );
    }
  }

  private triggerRelinkVideo(targetSlideIds: string | string[]): void {
    if (window.desktopAPI?.openMediaDialog) {
      void (async () => {
        try {
          const file = await this.pickVideoViaDesktop();
          if (file) {
            await this.performVideoRelink(targetSlideIds, file);
          }
        } catch (err) {
          this.store.notify(
            err instanceof Error ? err.message : t('notify.relinkFailed'),
            'error'
          );
        }
      })();
      return;
    }

    this.pendingRelinkTarget = targetSlideIds;
    const input = this.root.querySelector('#relink-video-input') as HTMLInputElement;
    input?.click();
  }

  private async performVideoRelink(target: string | string[], file: File): Promise<void> {
    try {
      this.store.notify(t('notify.relinkingVideo', { name: file.name }), 'info', 3000);
      const videoAsset = await MediaValidator.ingestFile(file, 'video');
      const count = await this.store.relinkReelVideo(target, videoAsset, {
        reextractMissingImages: true,
        onProgress: (done, total) => {
          this.store.notify(
            t('notify.restoringFrames', { done, total }),
            'info',
            2500
          );
        },
      });
      this.store.notify(
        t('notify.relinkUpdatedSlides', { count: this.formatArabicSlideCount(count) }),
        'success'
      );
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.relinkCannot'),
        'error'
      );
    }
  }

  public handleDeleteAction(
    explicitSlideId?: string,
    explicitTransitionSlideId?: string
  ): void {
    const slides = this.store.getSlides();
    if (slides.length === 0) return;

    const multi = this.store.getMultiSelectionSummary();
    let slideIds = multi.slideIds;
    let transitionSlideIds = multi.transitionSlideIds;

    if (explicitSlideId) {
      slideIds = [explicitSlideId];
      transitionSlideIds = [];
    } else if (explicitTransitionSlideId) {
      slideIds = [];
      transitionSlideIds = [explicitTransitionSlideId];
    } else if (slideIds.length === 0 && transitionSlideIds.length === 0) {
      const fallbackSlide = slides[this.store.getActivePreviewIndex()];
      if (fallbackSlide) {
        slideIds = [fallbackSlide.id];
      }
    }

    if (slideIds.length === 0 && transitionSlideIds.length === 0) return;

    // Case 1: Only transition videos selected -> delete transition videos immediately
    if (slideIds.length === 0) {
      const { deletedTransitionsCount } = this.store.deleteMultipleItems([], transitionSlideIds);
      this.store.notify(
        deletedTransitionsCount > 0
          ? t('notify.batchDeletedTransitionsOnly', { count: deletedTransitionsCount })
          : t('notify.batchResetTransitions'),
        'info',
        2500
      );
      return;
    }

    // Case 2: Single slide only (no transitions selected) -> keep single-slide transition choice dialog
    if (slideIds.length === 1 && transitionSlideIds.length === 0) {
      this.promptDeleteSlide(slideIds[0]);
      return;
    }

    // Case 3: Deleting all slides at once or every deleted slide has an explicitly selected adjacent transition
    const slideIdSet = new Set(slideIds);
    const transSlideIdSet = new Set(transitionSlideIds);
    if (slideIdSet.size >= slides.length) {
      const { deletedSlidesCount, deletedTransitionsCount } = this.store.deleteMultipleItems(
        slideIds,
        transitionSlideIds,
        'below'
      );
      this.notifyBatchDeletion(deletedSlidesCount, deletedTransitionsCount);
      return;
    }

    // Check if every deleted slide has a distinct selected adjacent transition (above or below)
    let allSlidesCovered = transSlideIdSet.size > 0;
    if (allSlidesCovered) {
      const usedTransitions = new Set<string>();
      for (let i = slides.length - 1; i >= 0; i--) {
        if (!slideIdSet.has(slides[i].id)) continue;
        const aboveSlideId = i > 0 ? slides[i - 1].id : null;
        const belowSlideId = slides[i].id;
        const aboveAvail = aboveSlideId !== null && transSlideIdSet.has(aboveSlideId) && !usedTransitions.has(aboveSlideId);
        const belowAvail = transSlideIdSet.has(belowSlideId) && !usedTransitions.has(belowSlideId);
        if (belowAvail) {
          usedTransitions.add(belowSlideId);
        } else if (aboveAvail && aboveSlideId) {
          usedTransitions.add(aboveSlideId);
        } else {
          allSlidesCovered = false;
          break;
        }
      }
    }

    if (allSlidesCovered) {
      const { deletedSlidesCount, deletedTransitionsCount } = this.store.deleteMultipleItems(
        slideIds,
        transitionSlideIds,
        'below'
      );
      this.notifyBatchDeletion(deletedSlidesCount, deletedTransitionsCount);
      return;
    }

    // Case 4: Multiple slides (with or without some transitions) need transition choice
    this.promptDeleteMultiSelection(slideIds, transitionSlideIds);
  }

  private notifyBatchDeletion(deletedSlidesCount: number, deletedTransitionsCount: number): void {
    const parts: string[] = [];
    if (deletedSlidesCount > 0) {
      parts.push(this.formatArabicSlideCount(deletedSlidesCount));
    }
    if (deletedTransitionsCount > 0) {
      parts.push(
        deletedTransitionsCount === 1
          ? t('delete.summaryTransitionSingle')
          : t('delete.summaryTransitionsMany', { count: deletedTransitionsCount })
      );
    }
    const summary = formatSummaryParts(parts);
    if (summary) {
      this.store.notify(t('notify.batchDeletedCombined', { summary }), 'info', 2500);
    }
  }

  public promptDeleteMultiSelection(slideIds: string[], transitionSlideIds: string[]): void {
    this.activeModalClose?.();
    const host = this.root.querySelector('#choice-modal-host') as HTMLElement;
    if (!host) {
      const { deletedSlidesCount, deletedTransitionsCount } = this.store.deleteMultipleItems(
        slideIds,
        transitionSlideIds,
        'below'
      );
      this.notifyBatchDeletion(deletedSlidesCount, deletedTransitionsCount);
      return;
    }

    const prevFocused = document.activeElement as HTMLElement | null;
    const summaryParts: string[] = [];
    if (slideIds.length > 0) summaryParts.push(this.formatArabicSlideCount(slideIds.length));
    if (transitionSlideIds.length > 0) {
      summaryParts.push(
        transitionSlideIds.length === 1
          ? t('delete.summaryTransitionSingle')
          : t('delete.summaryTransitionsMany', { count: transitionSlideIds.length })
      );
    }
    const summaryText = summaryParts.join(' · ');

    let isClosed = false;
    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      this.isModalOpen = false;
      this.activeModalClose = null;
      window.removeEventListener('keydown', onKeyDown);
      host.innerHTML = '';
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };

    const executeBatch = (choice: 'above' | 'below' | 'bridge') => {
      cleanup();
      const { deletedSlidesCount, deletedTransitionsCount } = this.store.deleteMultipleItems(
        slideIds,
        transitionSlideIds,
        choice
      );
      this.notifyBatchDeletion(deletedSlidesCount, deletedTransitionsCount);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      } else if (e.key === '1') {
        e.preventDefault();
        executeBatch('above');
      } else if (e.key === '2') {
        e.preventDefault();
        executeBatch('below');
      } else if (e.key === '3') {
        e.preventDefault();
        executeBatch('bridge');
      }
    };

    this.isModalOpen = true;
    this.activeModalClose = cleanup;
    window.addEventListener('keydown', onKeyDown);

    host.innerHTML = `
      <div class="reel-cue-modal-backdrop" id="delete-slide-modal-backdrop">
        <div class="choice-modal" role="dialog" aria-modal="true" aria-label="${this.escapeHtml(t('delete.multiModalAria'))}">
          <div class="reel-cue-modal-header">
            <div class="reel-modal-header-lead">
              ${Icons.trash}
              <span class="reel-modal-title">${t('delete.multiModalTitle', { summary: summaryText })}</span>
            </div>
            <button class="icon-btn" id="btn-delete-slide-close" aria-label="${this.escapeHtml(t('presenter.close'))}">${Icons.close}</button>
          </div>
          <div class="choice-modal-body">
            <div class="prop-subtext" style="color:var(--label-secondary);">
              ${t('delete.multiPrompt')}
            </div>
            <button class="choice-option-btn" id="btn-delete-trans-above" data-delete-choice="above">
              <span class="choice-option-icon">${Icons.chevronUp}</span>
              <span>
                <span class="choice-option-title">${t('delete.aboveOptionTitle')}</span>
                <span class="choice-option-desc">${t('delete.aboveOptionDesc')}</span>
              </span>
            </button>
            <button class="choice-option-btn" id="btn-delete-trans-below" data-delete-choice="below">
              <span class="choice-option-icon">${Icons.chevronDown}</span>
              <span>
                <span class="choice-option-title">${t('delete.belowOptionTitle')}</span>
                <span class="choice-option-desc">${t('delete.belowOptionDesc')}</span>
              </span>
            </button>
            <button class="choice-option-btn" id="btn-delete-trans-bridge" data-delete-choice="bridge">
              <span class="choice-option-icon">${Icons.filmTransition}</span>
              <span>
                <span class="choice-option-title">${t('delete.mergeOptionTitle')}</span>
                <span class="choice-option-desc">${t('delete.mergeOptionDesc')}</span>
              </span>
            </button>
            <div style="display:flex; justify-content:flex-end; margin-top:4px;">
              <button class="btn" id="btn-delete-slide-cancel">${t('inspector.cancel')}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    host.querySelector('#btn-delete-slide-close')?.addEventListener('click', cleanup);
    host.querySelector('#btn-delete-slide-cancel')?.addEventListener('click', cleanup);
    host.querySelector('#delete-slide-modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'delete-slide-modal-backdrop') {
        cleanup();
      }
    });
    host.querySelector('#btn-delete-trans-above')?.addEventListener('click', () => executeBatch('above'));
    host.querySelector('#btn-delete-trans-below')?.addEventListener('click', () => executeBatch('below'));
    host.querySelector('#btn-delete-trans-bridge')?.addEventListener('click', () => executeBatch('bridge'));

    (host.querySelector('#btn-delete-trans-below') as HTMLElement)?.focus();
  }

  public promptDeleteSlide(slideId: string): void {
    const slides = this.store.getSlides();
    const idx = slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return;

    if (slides.length === 1) {
      this.store.deleteSlide(slideId);
      this.store.notify(t('notify.slideDeleted'), 'info', 2000);
      return;
    }

    this.activeModalClose?.();
    const host = this.root.querySelector('#choice-modal-host') as HTMLElement;
    if (!host) {
      this.store.deleteSlide(slideId);
      return;
    }

    const prevFocused = document.activeElement as HTMLElement | null;
    const slide = slides[idx];
    const prevSlide = idx > 0 ? slides[idx - 1] : null;
    const aboveSpec = prevSlide ? prevSlide.transitionToNext : null;
    const belowSpec = slide.transitionToNext;

    const fallbackKeys: Record<FallbackTransitionStyle, TranslationKey> = {
      crossfade: 'fallback.full.crossfade',
      'zoom-morph': 'fallback.full.zoom-morph',
      'slide-push': 'fallback.full.slide-push',
      'wipe-reveal': 'fallback.full.wipe-reveal',
      'iris-spotlight': 'fallback.full.iris-spotlight',
      cut: 'fallback.full.cut',
    };

    const describeTransition = (
      spec: typeof belowSpec | null,
      fromNum: number,
      toNum: number
    ): string => {
      if (!spec) return t('delete.noPrevTransition');
      const vid = spec.videoAsset;
      if (vid) {
        const hasSlice =
          typeof spec.startTimeSec === 'number' || typeof spec.endTimeSec === 'number';
        const segStart = spec.startTimeSec ?? 0;
        const segEnd = spec.endTimeSec ?? vid.durationSec;
        const dur = Math.max(0.05, hasSlice ? segEnd - segStart : vid.durationSec);
        return t('delete.descVideo', {
          from: fromNum,
          arrow: getFlowArrow(),
          to: toNum,
          duration: dur.toFixed(1),
        });
      }
      return t('delete.descFallback', {
        from: fromNum,
        arrow: getFlowArrow(),
        to: toNum,
        style: t(fallbackKeys[spec.fallbackStyle]),
      });
    };

    const canBridgeContiguousReel = Boolean(
      prevSlide &&
        aboveSpec?.videoAsset &&
        belowSpec?.videoAsset &&
        aboveSpec.videoAsset.id === belowSpec.videoAsset.id &&
        typeof aboveSpec.endTimeSec === 'number' &&
        typeof belowSpec.startTimeSec === 'number' &&
        Math.abs(aboveSpec.endTimeSec - belowSpec.startTimeSec) < 0.1 &&
        typeof belowSpec.endTimeSec === 'number' &&
        belowSpec.endTimeSec > aboveSpec.endTimeSec
    );

    const aboveDesc =
      idx > 0
        ? t('delete.singleAboveDesc', {
            desc: describeTransition(aboveSpec, idx, idx + 1),
            from: idx,
            to: idx + 2,
          })
        : t('delete.singleAboveFirstDesc');

    const belowDesc =
      idx < slides.length - 1
        ? t('delete.singleBelowDesc', {
            desc: describeTransition(belowSpec, idx + 1, idx + 2),
          })
        : t('delete.singleBelowLastDesc', {
            from: idx,
            arrow: getFlowArrow(),
            to: idx + 1,
          });

    let isClosed = false;
    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      this.isModalOpen = false;
      this.activeModalClose = null;
      window.removeEventListener('keydown', onKeyDown);
      host.innerHTML = '';
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };

    const executeChoice = (choice: 'above' | 'below' | 'bridge') => {
      cleanup();
      this.store.deleteSlide(slideId, choice);
      if (choice === 'above') {
        this.store.notify(t('notify.slideDeletedAbove', { num: idx + 1 }), 'info', 2500);
      } else if (choice === 'below') {
        this.store.notify(t('notify.slideDeletedBelow', { num: idx + 1 }), 'info', 2500);
      } else {
        this.store.notify(t('notify.slideDeletedMerge', { num: idx + 1 }), 'info', 2500);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      } else if (e.key === '1') {
        e.preventDefault();
        executeChoice('above');
      } else if (e.key === '2') {
        e.preventDefault();
        executeChoice('below');
      } else if (e.key === '3' && canBridgeContiguousReel) {
        e.preventDefault();
        executeChoice('bridge');
      }
    };

    this.isModalOpen = true;
    this.activeModalClose = cleanup;
    window.addEventListener('keydown', onKeyDown);

    host.innerHTML = `
      <div class="reel-cue-modal-backdrop" id="delete-slide-modal-backdrop">
        <div class="choice-modal" role="dialog" aria-modal="true" aria-label="${this.escapeHtml(t('delete.singleModalAria'))}">
          <div class="reel-cue-modal-header">
            <div class="reel-modal-header-lead">
              ${Icons.trash}
              <span class="reel-modal-title">${t('delete.singleModalTitle', { num: idx + 1, title: this.escapeHtml(slide.title) })}</span>
            </div>
            <button class="icon-btn" id="btn-delete-slide-close" aria-label="${this.escapeHtml(t('presenter.close'))}">${Icons.close}</button>
          </div>
          <div class="choice-modal-body">
            <div class="prop-subtext" style="color:var(--label-secondary);">
              ${t('delete.singlePrompt')}
            </div>
            <button class="choice-option-btn" id="btn-delete-trans-above" data-delete-choice="above">
              <span class="choice-option-icon">${Icons.chevronUp}</span>
              <span>
                <span class="choice-option-title">${t('delete.singleAboveTitle')}</span>
                <span class="choice-option-desc">${aboveDesc}</span>
              </span>
            </button>
            <button class="choice-option-btn" id="btn-delete-trans-below" data-delete-choice="below">
              <span class="choice-option-icon">${Icons.chevronDown}</span>
              <span>
                <span class="choice-option-title">${t('delete.singleBelowTitle')}</span>
                <span class="choice-option-desc">${belowDesc}</span>
              </span>
            </button>
            ${
              canBridgeContiguousReel
                ? `
              <button class="choice-option-btn" id="btn-delete-trans-bridge" data-delete-choice="bridge">
                <span class="choice-option-icon">${Icons.filmTransition}</span>
                <span>
                  <span class="choice-option-title">${t('delete.singleMergeTitle')}</span>
                  <span class="choice-option-desc">${t('delete.singleMergeDesc', {
                    start: (aboveSpec?.startTimeSec ?? 0).toFixed(1),
                    arrow: getFlowArrow(),
                    end: (belowSpec.endTimeSec ?? 0).toFixed(1),
                  })}</span>
                </span>
              </button>
            `
                : ''
            }
            <div style="display:flex; justify-content:flex-end; margin-top:4px;">
              <button class="btn" id="btn-delete-slide-cancel">${t('inspector.cancel')}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    host.querySelector('#btn-delete-slide-close')?.addEventListener('click', cleanup);
    host.querySelector('#btn-delete-slide-cancel')?.addEventListener('click', cleanup);
    host.querySelector('#delete-slide-modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'delete-slide-modal-backdrop') {
        cleanup();
      }
    });

    host.querySelector('#btn-delete-trans-above')?.addEventListener('click', () => {
      executeChoice('above');
    });
    host.querySelector('#btn-delete-trans-below')?.addEventListener('click', () => {
      executeChoice('below');
    });
    host.querySelector('#btn-delete-trans-bridge')?.addEventListener('click', () => {
      executeChoice('bridge');
    });

    (host.querySelector('#btn-delete-trans-below') as HTMLElement)?.focus();
  }

  private openSingleVideoActionModal(videoAsset: MediaAsset): void {
    this.activeModalClose?.();
    const host = this.root.querySelector('#choice-modal-host') as HTMLElement;
    if (!host) return;

    const prevFocused = document.activeElement as HTMLElement | null;
    const slides = this.store.getSlides();
    const selection = this.store.getSelection();
    const targetSlide =
      (selection.type === 'slide' || selection.type === 'transition')
        ? slides.find((s) => s.id === selection.slideId) || slides[this.store.getActivePreviewIndex()]
        : slides[this.store.getActivePreviewIndex()];
    const targetIdx = targetSlide ? slides.findIndex((s) => s.id === targetSlide.id) : 0;

    let isClosed = false;
    let handedOffToStoreOrModal = false;

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      this.isModalOpen = false;
      this.activeModalClose = null;
      window.removeEventListener('keydown', onKeyDown);
      host.innerHTML = '';
      if (!handedOffToStoreOrModal) {
        MediaValidator.revokeAssetUrls(videoAsset);
      }
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      }
    };

    this.isModalOpen = true;
    this.activeModalClose = cleanup;
    window.addEventListener('keydown', onKeyDown);

    const ratio =
      videoAsset.suggestedAspectRatio ??
      MediaValidator.inferAspectRatio(videoAsset.width || 1920, videoAsset.height || 1080);

    host.innerHTML = `
      <div class="reel-cue-modal-backdrop" id="choice-modal-backdrop">
        <div class="choice-modal" role="dialog" aria-modal="true" aria-label="${this.escapeHtml(t('videoChoice.aria'))}">
          <div class="reel-cue-modal-header">
            <div class="reel-modal-header-lead">
              ${Icons.filmTransition}
              <span class="reel-modal-title">${t('videoChoice.title')}</span>
            </div>
            <button class="icon-btn" id="btn-choice-close" aria-label="${this.escapeHtml(t('presenter.close'))}">${Icons.close}</button>
          </div>
          <div class="choice-modal-body">
            <div class="prop-subtext">
              ${t('videoChoice.fileLabel')} <strong style="color:var(--label-primary);">${this.escapeHtml(videoAsset.name)}</strong>
              (${videoAsset.durationSec.toFixed(1)}s · ${videoAsset.width}×${videoAsset.height})
            </div>
            <button class="choice-option-btn" id="btn-choice-append-reel">
              <span class="choice-option-icon">${Icons.plus}</span>
              <span>
                <span class="choice-option-title">${t('videoChoice.splitAppendTitle')}</span>
                <span class="choice-option-desc">${t('videoChoice.splitAppendDesc')}</span>
              </span>
            </button>
            <button class="choice-option-btn" id="btn-choice-replace-reel">
              <span class="choice-option-icon">${Icons.filmTransition}</span>
              <span>
                <span class="choice-option-title">${t('videoChoice.replaceAllTitle')}</span>
                <span class="choice-option-desc">${t('videoChoice.replaceAllDesc', { ratio })}</span>
              </span>
            </button>
            ${
              targetSlide
                ? `
              <button class="choice-option-btn" id="btn-choice-attach-transition">
                <span class="choice-option-icon">${Icons.relink}</span>
                <span>
                  <span class="choice-option-title">${t('videoChoice.attachTargetTitle', { num: targetIdx + 1 })}</span>
                  <span class="choice-option-desc">${t('videoChoice.attachTargetDesc', { title: this.escapeHtml(targetSlide.title) })}</span>
                </span>
              </button>
            `
                : ''
            }
          </div>
        </div>
      </div>
    `;

    host.querySelector('#btn-choice-close')?.addEventListener('click', cleanup);
    host.querySelector('#choice-modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'choice-modal-backdrop') {
        cleanup();
      }
    });

    host.querySelector('#btn-choice-append-reel')?.addEventListener('click', () => {
      handedOffToStoreOrModal = true;
      cleanup();
      this.openReelCueModal(videoAsset, { mode: 'append' });
    });

    host.querySelector('#btn-choice-replace-reel')?.addEventListener('click', () => {
      handedOffToStoreOrModal = true;
      cleanup();
      this.openReelCueModal(videoAsset, { mode: 'replace-all' });
    });

    host.querySelector('#btn-choice-attach-transition')?.addEventListener('click', () => {
      if (!targetSlide) return;
      handedOffToStoreOrModal = true;
      this.store.setSlideTransitionVideo(targetSlide.id, videoAsset);
      this.store.notify(t('notify.videoAttachedAfterSlide', { num: targetIdx + 1 }), 'success');
      cleanup();
    });

    (host.querySelector('#btn-choice-append-reel') as HTMLElement)?.focus();
  }

  private openReelCueModal(
    videoAsset: MediaAsset,
    options: {
      mode?: 'replace-all' | 'append' | 'replace-reel';
      targetVideoAssetId?: string;
      initialCuePoints?: number[];
      initialCueLabels?: string[];
      initialSegmentEasings?: SegmentEasing[];
      motionReelMeta?: MotionReelMetadata;
      isAlreadyOwnedByStore?: boolean;
    } = {}
  ): void {
    this.activeModalClose?.();
    const host = this.root.querySelector('#reel-modal-host') as HTMLElement;
    if (!host) return;

    const prevFocused = document.activeElement as HTMLElement | null;
    const existingSlidesCount = this.store.getSlides().length;
    const isEditingExistingReel = options.mode === 'replace-reel';
    let applyMode: 'replace-all' | 'append' | 'replace-reel' =
      options.mode ?? (existingSlidesCount > 0 ? 'append' : 'replace-all');

    let dur = videoAsset.durationSec > 0 ? videoAsset.durationSec : 1;
    let cuePoints: number[] =
      options.initialCuePoints && options.initialCuePoints.length >= 2
        ? [...options.initialCuePoints]
        : dur >= 2
          ? [0, Number((dur / 2).toFixed(2)), Number(dur.toFixed(2))]
          : [0, Number(dur.toFixed(2))];
    cuePoints = SmartPairer.normalizeCuePoints(cuePoints, dur);
    let cueLabels: string[] = options.initialCueLabels ? [...options.initialCueLabels] : [];
    const motionReelMeta = options.motionReelMeta;

    // Initialize per-segment easing curves
    let segmentEasings: SegmentEasing[] = [];
    if (options.initialSegmentEasings && options.initialSegmentEasings.length > 0) {
      segmentEasings = [...options.initialSegmentEasings];
    } else if (isEditingExistingReel) {
      const existingSlides = this.store.getSlides().filter(
        (s) => s.transitionToNext.videoAsset?.id === videoAsset.id || s.imageAsset.sourceVideoId === videoAsset.id
      );
      if (existingSlides.length > 0) {
        segmentEasings = existingSlides.map((s) => s.transitionToNext.easing ?? 'linear');
      } else if (this.store.getProject().reelMetadata?.segmentEasings) {
        segmentEasings = [...(this.store.getProject().reelMetadata?.segmentEasings || [])];
      }
    }
    const syncEasingsLength = () => {
      const required = Math.max(0, cuePoints.length - 1);
      while (segmentEasings.length < required) {
        segmentEasings.push('linear');
      }
      if (segmentEasings.length > required) {
        segmentEasings.length = required;
      }
    };
    syncEasingsLength();

    const suggestedRatio =
      videoAsset.suggestedAspectRatio ??
      MediaValidator.inferAspectRatio(videoAsset.width || 1920, videoAsset.height || 1080);
    const currentRatio = this.store.getSettings().aspectRatio;
    const showRatioToggle = suggestedRatio !== currentRatio;
    const hasAudio = videoAsset.hasAudio !== false;

    const modalAbort = new AbortController();
    let detectAbort: AbortController | null = null;
    let applyAbort: AbortController | null = null;
    let thumbSession: VideoFrameExtractorSession | null = null;
    const thumbCache = new Map<string, string>();
    let thumbGeneration = 0;
    let isThumbQueueRunning = false;
    let activeCueIdx: number | null = 0;
    let selectedCueIndices = new Set<number>([0]);
    let draggingPinIdx: number | null = null;
    let isGroupDrag = false;
    let groupDragSnapshots: Array<{ index: number; initialTime: number }> = [];
    let groupDragStartX = 0;
    let zoomLevel = 1.0;
    let rafId: number | null = null;
    let isDetecting = false;
    let isApplying = false;
    let isClosed = false;
    let wasApplied = false;
    let lastDetectionResult: CueDetectionResult | null = null;

    const findDetectedCandidate = (ptSec: number) => {
      if (!lastDetectionResult?.candidates?.length) return null;
      let best: (typeof lastDetectionResult.candidates)[number] | null = null;
      let bestDist = 0.06;
      for (const c of lastDetectionResult.candidates) {
        if (c.kind === 'start' || c.kind === 'end') continue;
        const d = Math.abs(c.timeSec - ptSec);
        if (d <= bestDist) {
          bestDist = d;
          best = c;
        }
      }
      return best;
    };

    const renderMotionSparkline = (sparklineEl: HTMLElement | null) => {
      if (!sparklineEl) return;
      const profile = lastDetectionResult?.motionProfile;
      if (!profile || dur <= 0 || profile.sampleTimes.length < 2) {
        sparklineEl.innerHTML = '';
        return;
      }

      const { sampleTimes, motionScores, stillThreshold } = profile;
      const sorted = [...motionScores].sort((a, b) => a - b);
      const p96 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.96))] ?? 0;
      const scaleMax = Math.max(stillThreshold * 3.0, p96 * 1.18, 1e-4);
      const toY = (v: number) => 96 - Math.min(1, Math.max(0, v / scaleMax)) * 90;

      const plateauRects = (lastDetectionResult?.candidates || [])
        .filter(
          (c) =>
            c.plateauStartSec !== undefined &&
            c.plateauEndSec !== undefined &&
            c.plateauEndSec > c.plateauStartSec
        )
        .map((c) => {
          const x1 = Math.max(0, Math.min(1000, ((c.plateauStartSec ?? 0) / dur) * 1000));
          const x2 = Math.max(x1, Math.min(1000, ((c.plateauEndSec ?? 0) / dur) * 1000));
          const w = Math.max(1, x2 - x1);
          return `<rect class="reel-motion-plateau-band" x="${x1.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="100" />`;
        })
        .join('');

      const coords = sampleTimes.map((t, idx) => {
        const x = Math.max(0, Math.min(1000, (t / dur) * 1000));
        const y = toY(motionScores[idx] ?? 0);
        return { x, y };
      });
      const polyPts = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const firstX = coords[0].x.toFixed(1);
      const lastX = coords[coords.length - 1].x.toFixed(1);
      const threshY = toY(stillThreshold).toFixed(1);

      sparklineEl.innerHTML = `<svg class="reel-motion-sparkline-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">${plateauRects}<line class="reel-motion-threshold-line" x1="0" y1="${threshY}" x2="1000" y2="${threshY}" /><polygon class="reel-motion-energy-area" points="${firstX},98 ${polyPts} ${lastX},98" /><polyline class="reel-motion-energy-line" points="${polyPts}" /></svg>`;
    };

    const isOwnedByStore =
      Boolean(options.isAlreadyOwnedByStore) ||
      this.store.getSlides().some((s) => s.transitionToNext.videoAsset?.objectUrl === videoAsset.objectUrl);

    host.innerHTML = `
      <div class="reel-cue-modal-backdrop" id="reel-modal-backdrop">
        <div class="reel-cue-modal" role="dialog" aria-modal="true" aria-label="${this.escapeHtml(t('reel.modalAria'))}">
          <div class="reel-cue-modal-header">
            <div class="reel-modal-header-lead">
              ${Icons.filmTransition}
              <span class="reel-modal-title">${
                isEditingExistingReel ? t('reel.titleEdit') : t('reel.titleNew')
              }</span>
              <span class="reel-modal-badge" id="reel-meta-badge">${this.escapeHtml(videoAsset.name)} · ${dur.toFixed(1)}s · ${videoAsset.width}×${videoAsset.height}</span>
              <span class="reel-audio-pill">
                ${hasAudio ? Icons.volumeOn : Icons.volumeMuted}
                <span>${hasAudio ? t('reel.audioYes') : t('reel.audioNo')}</span>
              </span>
              ${
                motionReelMeta
                  ? `
                <span class="reel-audio-pill" style="background: rgba(59,130,246,0.14); color: var(--accent-primary); border-color: rgba(59,130,246,0.3);">
                  <span>${this.escapeHtml(t('reel.motionReelBadge'))}${motionReelMeta.bpm ? ` · ${Math.round(motionReelMeta.bpm)} BPM` : ''}</span>
                </span>
                ${
                  motionReelMeta.sectionCues.length > 0
                    ? `<button class="btn btn-xs" id="btn-reel-load-sections" type="button">${this.escapeHtml(t('reel.motionReelSections', { count: motionReelMeta.sectionCues.length }))}</button>`
                    : ''
                }
                ${
                  motionReelMeta.hitCues.length > 0
                    ? `<button class="btn btn-xs" id="btn-reel-load-hits" type="button">${this.escapeHtml(t('reel.motionReelHits', { count: motionReelMeta.hitCues.length }))}</button>`
                    : ''
                }
              `
                  : ''
              }
            </div>
            <div class="reel-modal-header-trailing">
              ${
                !isEditingExistingReel && existingSlidesCount > 0
                  ? `
                <div class="reel-mode-toggle" role="group" aria-label="${this.escapeHtml(t('reel.modeGroupAria'))}">
                  <button class="reel-mode-btn ${applyMode === 'append' ? 'active' : ''}" id="btn-mode-append" type="button">${t('reel.modeAppend')}</button>
                  <button class="reel-mode-btn ${applyMode === 'replace-all' ? 'active' : ''}" id="btn-mode-replace" type="button">${t('reel.modeReplace')}</button>
                </div>
              `
                  : ''
              }
              <button class="icon-btn" id="btn-reel-modal-close" aria-label="${this.escapeHtml(t('presenter.close'))}" type="button">${Icons.close}</button>
            </div>
          </div>

          <div class="reel-cue-modal-body">
            <div class="reel-video-stage">
              <video id="reel-preview-video" src="${videoAsset.objectUrl}" playsinline preload="auto"></video>
              <div class="reel-video-error" id="reel-video-error" role="alert">
                ${Icons.alertCircle}
                <span id="reel-video-error-text">${t('reel.videoDecodeErr')}</span>
              </div>
            </div>

            <div class="reel-transport-dock">
              <div class="reel-transport-buttons">
                <button class="btn btn-xs" id="btn-reel-play-pause" type="button" title="${this.escapeHtml(t('reel.playTitle'))}">
                  ${Icons.playFill}
                  <span>${t('reel.play')}</span>
                </button>
                <button class="btn btn-xs" id="btn-reel-step-back-half" type="button" title="${this.escapeHtml(t('reel.backHalfTitle'))}">-0.5s</button>
                <button class="btn btn-xs" id="btn-reel-step-back-frame" type="button" title="${this.escapeHtml(t('reel.backFrameTitle'))}">${Icons.stepBackward}</button>
                <button class="btn btn-xs" id="btn-reel-step-fwd-frame" type="button" title="${this.escapeHtml(t('reel.fwdFrameTitle'))}">${Icons.stepForward}</button>
                <button class="btn btn-xs" id="btn-reel-step-fwd-half" type="button" title="${this.escapeHtml(t('reel.fwdHalfTitle'))}">+0.5s</button>
                <button class="btn btn-xs" id="btn-reel-mute-toggle" type="button" ${!hasAudio ? 'disabled' : ''} title="${this.escapeHtml(t('reel.muteTitle'))}">
                  ${hasAudio ? Icons.volumeOn : Icons.volumeMuted}
                </button>
                <button class="btn btn-xs" id="btn-reel-undo" type="button" title="${this.escapeHtml(t('reel.undoTitle'))}" disabled>
                  ${Icons.undo}
                  <span>${t('reel.undo')}</span>
                </button>
                <button class="btn btn-xs" id="btn-reel-redo" type="button" title="${this.escapeHtml(t('reel.redoTitle'))}" disabled>
                  ${Icons.redo}
                  <span>${t('reel.redo')}</span>
                </button>
              </div>
              <div class="reel-zoom-controls">
                <button class="btn btn-xs" id="btn-reel-zoom-out" type="button" title="${this.escapeHtml(t('reel.zoomOutTitle'))}">-</button>
                <button class="btn btn-xs" id="btn-reel-zoom-fit" type="button" title="${this.escapeHtml(t('reel.zoomFitTitle'))}">${t('reel.zoomFit')}</button>
                <button class="btn btn-xs" id="btn-reel-zoom-in" type="button" title="${this.escapeHtml(t('reel.zoomInTitle'))}">+</button>
                <span class="reel-zoom-readout" id="reel-zoom-readout">100%</span>
              </div>
              <span class="reel-timecode-readout tabular-nums" id="reel-current-time">
                00:00.00 <span class="reel-timecode-total">/ ${this.formatTimecode(dur)}</span>
              </span>
              <span class="reel-shortcut-hint">${t('reel.shortcutHint')}</span>
            </div>

            <div class="reel-timeline-shell" aria-label="${this.escapeHtml(t('reel.timelineAria'))}">
              <div class="reel-timeline-track" id="reel-timeline-track">
                <div class="reel-filmstrip-strip" id="reel-filmstrip-strip">
                  <div class="reel-filmstrip-placeholder">${t('reel.filmstripLoading')}</div>
                </div>
                <div class="reel-segments-layer" id="reel-segments-layer"></div>
                <div class="reel-motion-sparkline-layer" id="reel-motion-sparkline-layer"></div>
                <div class="reel-playhead" id="reel-playhead" style="left: 0%;"></div>
                <div id="reel-pins-layer"></div>
              </div>
            </div>

            <div class="reel-actions-bar">
              <div class="reel-actions-group">
                <button class="btn btn-prominent" id="btn-reel-add-current" type="button">
                  ${Icons.cuePin}
                  <span>${t('reel.addCueBtn')}</span>
                </button>
                <button class="btn" id="btn-reel-auto-detect" type="button" title="${this.escapeHtml(t('reel.autoDetectTitle'))}">
                  ${Icons.wand}
                  <span>${t('reel.autoDetectBtn')}</span>
                </button>
                <select class="select-field reel-sensitivity-select" id="reel-detect-sensitivity" aria-label="${this.escapeHtml(t('reel.sensitivityAria'))}">
                  <option value="low">${t('reel.sensitivityLow')}</option>
                  <option value="medium" selected>${t('reel.sensitivityMedium')}</option>
                  <option value="high">${t('reel.sensitivityHigh')}</option>
                </select>
              </div>

              <div class="reel-actions-group">
                <span class="prop-subtext">${t('reel.uniformLabel')}</span>
                <button class="btn btn-xs" id="btn-reel-split-3" type="button">3</button>
                <button class="btn btn-xs" id="btn-reel-split-4" type="button">4</button>
                <button class="btn btn-xs" id="btn-reel-split-5" type="button">5</button>
              </div>
            </div>

            <div class="reel-inline-status" id="reel-inline-status">
              <span id="reel-inline-status-text"></span>
              <button class="btn btn-xs" id="btn-reel-cancel-detect" type="button" style="display:none;">${t('reel.cancelDetect')}</button>
            </div>

            <div class="reel-cues-section">
              <div class="prop-label">
                <span>${t('reel.slidesHeading')}</span>
                <span class="prop-subtext">${t('reel.slidesSubtext')}</span>
              </div>
              <div class="reel-cue-cards-strip" id="reel-cues-list"></div>
            </div>
          </div>

          <div class="reel-cue-modal-footer">
            <div class="reel-footer-options">
              ${
                showRatioToggle
                  ? `
                <label class="reel-aspect-check">
                  <input type="checkbox" id="chk-reel-match-ratio" ${existingSlidesCount === 0 ? 'checked' : ''} />
                  <span>${t('reel.fitRatioLabel', { ratio: suggestedRatio })}</span>
                </label>
              `
                  : ''
              }
              <div class="reel-apply-progress-wrap" id="reel-apply-progress-wrap">
                <div class="reel-progress-bar-bg">
                  <div class="reel-progress-bar-fill" id="reel-apply-progress-fill"></div>
                </div>
                <span class="prop-subtext tabular-nums" id="reel-apply-progress-text">0 / 0</span>
              </div>
            </div>
            <div class="reel-footer-buttons">
              <button class="btn" id="btn-reel-cancel" type="button">${t('reel.cancel')}</button>
              <button class="btn btn-prominent" id="btn-reel-apply" type="button"></button>
            </div>
          </div>
        </div>
      </div>
    `;

    const videoEl = host.querySelector('#reel-preview-video') as HTMLVideoElement;
    const videoErrBox = host.querySelector('#reel-video-error') as HTMLElement;
    const videoErrText = host.querySelector('#reel-video-error-text') as HTMLElement;
    const metaBadge = host.querySelector('#reel-meta-badge') as HTMLElement;
    const timeDisplay = host.querySelector('#reel-current-time') as HTMLElement;
    const playPauseBtn = host.querySelector('#btn-reel-play-pause') as HTMLButtonElement;
    const muteBtn = host.querySelector('#btn-reel-mute-toggle') as HTMLButtonElement;
    const timelineTrack = host.querySelector('#reel-timeline-track') as HTMLElement;
    const filmstripStrip = host.querySelector('#reel-filmstrip-strip') as HTMLElement;
    const segmentsLayer = host.querySelector('#reel-segments-layer') as HTMLElement;
    const pinsLayer = host.querySelector('#reel-pins-layer') as HTMLElement;
    const playheadEl = host.querySelector('#reel-playhead') as HTMLElement;
    const cuesListEl = host.querySelector('#reel-cues-list') as HTMLElement;
    const inlineStatusEl = host.querySelector('#reel-inline-status') as HTMLElement;
    const inlineStatusText = host.querySelector('#reel-inline-status-text') as HTMLElement;
    const cancelDetectBtn = host.querySelector('#btn-reel-cancel-detect') as HTMLButtonElement;
    const autoDetectBtn = host.querySelector('#btn-reel-auto-detect') as HTMLButtonElement;
    const sensitivitySel = host.querySelector('#reel-detect-sensitivity') as HTMLSelectElement;
    const matchRatioChk = host.querySelector('#chk-reel-match-ratio') as HTMLInputElement | null;
    const applyBtn = host.querySelector('#btn-reel-apply') as HTMLButtonElement;
    const cancelBtn = host.querySelector('#btn-reel-cancel') as HTMLButtonElement;
    const closeIconBtn = host.querySelector('#btn-reel-modal-close') as HTMLButtonElement;
    const applyProgWrap = host.querySelector('#reel-apply-progress-wrap') as HTMLElement;
    const applyProgFill = host.querySelector('#reel-apply-progress-fill') as HTMLElement;
    const applyProgText = host.querySelector('#reel-apply-progress-text') as HTMLElement;

    const showInlineStatus = (
      msg: string,
      tone: 'info' | 'warning' | 'success' = 'info',
      showCancelDetect = false
    ) => {
      if (!inlineStatusEl || !inlineStatusText) return;
      inlineStatusText.textContent = msg;
      inlineStatusEl.className = `reel-inline-status visible ${tone === 'info' ? '' : tone}`;
      if (cancelDetectBtn) {
        cancelDetectBtn.style.display = showCancelDetect ? 'inline-flex' : 'none';
      }
    };

    const hideInlineStatus = () => {
      if (inlineStatusEl) inlineStatusEl.className = 'reel-inline-status';
    };

    const updateFooterBtn = () => {
      if (!applyBtn) return;
      const countLabel = this.formatArabicSlideCount(cuePoints.length);
      if (applyMode === 'replace-reel') {
        applyBtn.textContent = t('reel.applySave', { count: countLabel });
      } else if (applyMode === 'append') {
        applyBtn.textContent = t('reel.applyAppend', { count: countLabel });
      } else {
        applyBtn.textContent = t('reel.applyCreate', { count: countLabel });
      }
    };

    interface TimelineHistoryState {
      cuePoints: number[];
      segmentEasings: SegmentEasing[];
      activeCueIdx: number | null;
      selectedIndices: number[];
    }
    const undoStack: TimelineHistoryState[] = [];
    const redoStack: TimelineHistoryState[] = [];

    const undoBtn = host.querySelector('#btn-reel-undo') as HTMLButtonElement | null;
    const redoBtn = host.querySelector('#btn-reel-redo') as HTMLButtonElement | null;
    const zoomReadout = host.querySelector('#reel-zoom-readout') as HTMLElement | null;

    const syncUndoRedoButtonsUi = () => {
      if (undoBtn) undoBtn.disabled = undoStack.length === 0 || isApplying;
      if (redoBtn) redoBtn.disabled = redoStack.length === 0 || isApplying;
    };

    const pushHistory = () => {
      undoStack.push({
        cuePoints: [...cuePoints],
        segmentEasings: [...segmentEasings],
        activeCueIdx,
        selectedIndices: Array.from(selectedCueIndices),
      });
      if (undoStack.length > 50) undoStack.shift();
      redoStack.length = 0;
      syncUndoRedoButtonsUi();
    };

    const undo = () => {
      if (undoStack.length === 0 || isApplying) return;
      redoStack.push({
        cuePoints: [...cuePoints],
        segmentEasings: [...segmentEasings],
        activeCueIdx,
        selectedIndices: Array.from(selectedCueIndices),
      });
      const state = undoStack.pop()!;
      cuePoints = [...state.cuePoints];
      segmentEasings = [...state.segmentEasings];
      syncEasingsLength();
      activeCueIdx = state.activeCueIdx;
      selectedCueIndices = new Set(state.selectedIndices);
      if (activeCueIdx !== null && activeCueIdx < cuePoints.length) {
        seekPreviewTo(cuePoints[activeCueIdx]);
      }
      renderAllCueUi();
      syncUndoRedoButtonsUi();
      showInlineStatus(t('reel.status.undo'), 'info');
    };

    const redo = () => {
      if (redoStack.length === 0 || isApplying) return;
      undoStack.push({
        cuePoints: [...cuePoints],
        segmentEasings: [...segmentEasings],
        activeCueIdx,
        selectedIndices: Array.from(selectedCueIndices),
      });
      const state = redoStack.pop()!;
      cuePoints = [...state.cuePoints];
      segmentEasings = [...state.segmentEasings];
      syncEasingsLength();
      activeCueIdx = state.activeCueIdx;
      selectedCueIndices = new Set(state.selectedIndices);
      if (activeCueIdx !== null && activeCueIdx < cuePoints.length) {
        seekPreviewTo(cuePoints[activeCueIdx]);
      }
      renderAllCueUi();
      syncUndoRedoButtonsUi();
      showInlineStatus(t('reel.status.redo'), 'info');
    };

    interface KeyframeClipboardItem {
      offsetFromFirst: number;
      easing: SegmentEasing;
    }
    let keyframeClipboard: KeyframeClipboardItem[] | null = null;

    const copySelectedKeyframes = () => {
      const indices = Array.from(selectedCueIndices).sort((a, b) => a - b);
      if (indices.length === 0) {
        if (activeCueIdx !== null) indices.push(activeCueIdx);
        else return;
      }
      const baseTime = cuePoints[indices[0]];
      keyframeClipboard = indices.map((i) => ({
        offsetFromFirst: Number((cuePoints[i] - baseTime).toFixed(2)),
        easing: segmentEasings[i] ?? 'linear',
      }));
      showInlineStatus(t('reel.status.copied', { count: indices.length }), 'info');
    };

    const pasteKeyframes = () => {
      if (!keyframeClipboard || keyframeClipboard.length === 0 || isApplying || !videoEl) return;
      const curPlayhead = Number((Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0).toFixed(2));
      pushHistory();

      for (const item of keyframeClipboard) {
        const targetT = Number(Math.min(dur, Math.max(0, curPlayhead + item.offsetFromFirst)).toFixed(2));
        const tooClose = cuePoints.some((pt) => Math.abs(pt - targetT) < 0.08);
        if (!tooClose) {
          cuePoints.push(targetT);
        }
      }

      cuePoints = SmartPairer.normalizeCuePoints(cuePoints, dur);
      syncEasingsLength();
      activeCueIdx = findClosestCueIdx(curPlayhead);
      selectedCueIndices = new Set([activeCueIdx]);
      renderAllCueUi();
      showInlineStatus(t('reel.status.pasted', { time: curPlayhead.toFixed(2) }), 'success');
    };

    const duplicateSelectedKeyframes = () => {
      if (isApplying || !videoEl) return;
      const indices = Array.from(selectedCueIndices).sort((a, b) => a - b);
      if (indices.length === 0) {
        if (activeCueIdx !== null) indices.push(activeCueIdx);
        else return;
      }
      pushHistory();

      const curPlayhead = Number((Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0).toFixed(2));
      const firstTime = cuePoints[indices[0]];
      const usePlayhead = Math.abs(curPlayhead - firstTime) >= 0.08;

      let lastAdded = curPlayhead;
      for (const i of indices) {
        const t = cuePoints[i];
        let targetT: number;
        if (usePlayhead) {
          targetT = Number(Math.min(dur, Math.max(0, curPlayhead + (t - firstTime))).toFixed(2));
        } else {
          const next = i < cuePoints.length - 1 ? cuePoints[i + 1] : dur;
          const delta = (next - t) > 0.4 ? 0.2 : (next - t) / 2;
          targetT = Number(Math.min(dur, Math.max(0, t + delta)).toFixed(2));
        }

        const tooClose = cuePoints.some((pt) => Math.abs(pt - targetT) < 0.08);
        if (!tooClose) {
          cuePoints.push(targetT);
          lastAdded = targetT;
        }
      }

      cuePoints = SmartPairer.normalizeCuePoints(cuePoints, dur);
      syncEasingsLength();
      activeCueIdx = findClosestCueIdx(lastAdded);
      selectedCueIndices = new Set([activeCueIdx]);
      renderAllCueUi();
      showInlineStatus(t('reel.status.duplicated'), 'success');
    };

    const deleteSelectedKeyframes = () => {
      if (isApplying || cuePoints.length <= 2) return;
      const toDelete = Array.from(selectedCueIndices).sort((a, b) => b - a);
      if (toDelete.length === 0) {
        if (activeCueIdx !== null) toDelete.push(activeCueIdx);
        else return;
      }
      if (cuePoints.length - toDelete.length < 2) {
        showInlineStatus(t('reel.status.minCues'), 'warning');
        return;
      }
      pushHistory();
      for (const delIdx of toDelete) {
        if (delIdx >= 0 && delIdx < cuePoints.length) {
          cuePoints.splice(delIdx, 1);
          if (delIdx < segmentEasings.length) {
            segmentEasings.splice(delIdx, 1);
          }
        }
      }
      cuePoints = SmartPairer.normalizeCuePoints(cuePoints, dur);
      syncEasingsLength();
      activeCueIdx = Math.min(toDelete[toDelete.length - 1] ?? 0, cuePoints.length - 1);
      selectedCueIndices = new Set([activeCueIdx]);
      renderAllCueUi();
    };

    const applyZoom = (newZoom: number, anchorClientX?: number) => {
      const oldZoom = zoomLevel;
      zoomLevel = Math.min(8.0, Math.max(1.0, Number(newZoom.toFixed(2))));
      if (timelineTrack) {
        timelineTrack.style.width = `${zoomLevel * 100}%`;
      }
      const timelineShell = host.querySelector('.reel-timeline-shell') as HTMLElement | null;
      if (timelineShell) {
        timelineShell.style.overflowX = zoomLevel > 1.0 ? 'auto' : 'hidden';
        if (anchorClientX !== undefined && oldZoom !== zoomLevel) {
          const shellRect = timelineShell.getBoundingClientRect();
          const mouseRelX = anchorClientX - shellRect.left;
          const contentX = timelineShell.scrollLeft + mouseRelX;
          const scale = zoomLevel / oldZoom;
          timelineShell.scrollLeft = contentX * scale - mouseRelX;
        }
      }
      if (zoomReadout) {
        zoomReadout.textContent = `${Math.round(zoomLevel * 100)}%`;
      }
    };

    const fitToView = () => {
      applyZoom(1.0);
      const timelineShell = host.querySelector('.reel-timeline-shell') as HTMLElement | null;
      if (timelineShell) timelineShell.scrollLeft = 0;
    };

    const syncPlayheadUi = () => {
      if (isClosed || !videoEl) return;
      const cur = Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;
      const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
      if (playheadEl) {
        playheadEl.style.left = `${pct}%`;
      }
      if (timeDisplay) {
        timeDisplay.innerHTML = `${this.formatTimecode(cur)} <span class="reel-timecode-total">/ ${this.formatTimecode(dur)}</span>`;
      }

      if (draggingPinIdx === null) {
        let nearestIdx: number | null = null;
        let minDiff = 0.14;
        cuePoints.forEach((pt, idx) => {
          const diff = Math.abs(pt - cur);
          if (diff <= minDiff) {
            minDiff = diff;
            nearestIdx = idx;
          }
        });
        const highlightIdx = nearestIdx ?? activeCueIdx;
        cuesListEl?.querySelectorAll('.reel-cue-card').forEach((card, i) => {
          card.classList.toggle('active', i === highlightIdx);
          card.classList.toggle('selected', selectedCueIndices.has(i));
        });
        pinsLayer?.querySelectorAll('.reel-cue-pin').forEach((pin, i) => {
          pin.classList.toggle('active', i === highlightIdx);
          pin.classList.toggle('selected', selectedCueIndices.has(i));
        });
      }
    };

    const stopPlaybackRaf = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const startPlaybackRaf = () => {
      stopPlaybackRaf();
      const tick = () => {
        if (isClosed || !videoEl || videoEl.paused || videoEl.ended) {
          stopPlaybackRaf();
          return;
        }
        syncPlayheadUi();
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    };

    const syncPlayButtonUi = () => {
      if (!playPauseBtn || !videoEl) return;
      const paused = videoEl.paused || videoEl.ended;
      playPauseBtn.innerHTML = paused
        ? `${Icons.playFill}<span>${t('reel.play')}</span>`
        : `${Icons.pauseFill}<span>${t('reel.pause')}</span>`;
    };

    const togglePlayPause = () => {
      if (!videoEl || isApplying) return;
      if (videoEl.paused || videoEl.ended) {
        videoEl.play().catch(() => {});
      } else {
        videoEl.pause();
      }
    };

    const seekPreviewTo = (targetSec: number) => {
      if (!videoEl) return;
      const clamped = Math.min(dur, Math.max(0, targetSec));
      if (!videoEl.paused) videoEl.pause();
      try {
        videoEl.currentTime = clamped;
      } catch {
        // Ignore seek errors before ready
      }
      syncPlayheadUi();
    };

    const stepVideo = (deltaSec: number) => {
      if (!videoEl || isApplying) return;
      const nextT = (Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0) + deltaSec;
      seekPreviewTo(nextT);
    };

    const queueCueThumbnails = async () => {
      const myGen = ++thumbGeneration;
      if (isThumbQueueRunning || isClosed) return;
      isThumbQueueRunning = true;

      try {
        if (!thumbSession && !modalAbort.signal.aborted) {
          thumbSession = await FrameExtractor.createSession(videoAsset, modalAbort.signal);
        }
        while (!isClosed && !modalAbort.signal.aborted) {
          const seenGen = thumbGeneration;
          const missingTimes = cuePoints.filter((pt) => !thumbCache.has(pt.toFixed(2)));
          if (missingTimes.length === 0) break;

          for (const pt of missingTimes) {
            if (isClosed || modalAbort.signal.aborted || thumbGeneration !== seenGen) break;
            const key = pt.toFixed(2);
            if (thumbCache.has(key)) continue;
            try {
              const url = await thumbSession!.seekAndCaptureThumb(pt, 260, modalAbort.signal);
              if (url && !isClosed) {
                thumbCache.set(key, url);
                cuesListEl
                  ?.querySelectorAll(`img[data-cue-key="${key}"]`)
                  .forEach((imgEl) => {
                    const img = imgEl as HTMLImageElement;
                    img.src = url;
                    img.style.display = 'block';
                    const loader = img.parentElement?.querySelector('.reel-cue-thumb-loading') as HTMLElement | null;
                    if (loader) loader.style.display = 'none';
                  });
              }
            } catch {
              // Ignore single thumbnail capture error while modal stays interactive
            }
          }
          if (thumbGeneration === seenGen && myGen >= 0) break;
        }
      } catch {
        // Session creation aborted or unsupported
      } finally {
        isThumbQueueRunning = false;
      }
    };

    const renderTimelineOverlays = () => {
      if (segmentsLayer) {
        let segHtml = '';
        for (let i = 0; i < cuePoints.length - 1; i++) {
          const a = cuePoints[i];
          const b = cuePoints[i + 1];
          const leftPct = dur > 0 ? (a / dur) * 100 : 0;
          const widthPct = dur > 0 ? Math.max(0, ((b - a) / dur) * 100) : 0;
          const span = b - a;
          const easing = segmentEasings[i] || 'linear';
          const easingBadge = easing !== 'linear' ? `<span class="reel-segment-easing-badge" title="Easing: ${easing}">${easing}</span>` : '';
          segHtml += `
            <div class="reel-segment-band ${i % 2 === 0 ? 'even' : 'odd'}" style="left:${leftPct}%;width:${widthPct}%;">
              ${widthPct >= 9 ? `<span class="reel-segment-dur">${span.toFixed(1)}s</span>${easingBadge}` : ''}
            </div>
          `;
        }
        segmentsLayer.innerHTML = segHtml;
      }

      if (pinsLayer) {
        const sparklineEl =
          (pinsLayer.parentElement?.querySelector('#reel-motion-sparkline-layer') as HTMLElement | null) ??
          null;
        renderMotionSparkline(sparklineEl);
        const candHintMap: Record<string, string> = {
          'pause-settle': t('reel.kind.pause-settle'),
          'velocity-valley': t('reel.kind.velocity-valley'),
          'scene-cut': t('reel.kind.scene-cut'),
        };
        pinsLayer.innerHTML = cuePoints
          .map((pt, idx) => {
            const leftPct = dur > 0 ? Math.min(100, Math.max(0, (pt / dur) * 100)) : 0;
            const isAct = idx === activeCueIdx;
            const isSel = selectedCueIndices.has(idx);
            const cand = findDetectedCandidate(pt);
            const candSuffix = cand
              ? ` | ${candHintMap[cand.kind] || cand.kind} (${Math.round(cand.confidence * 100)}%)`
              : '';
            return `
              <button
                type="button"
                class="reel-cue-pin ${isAct ? 'active' : ''} ${isSel ? 'selected' : ''}"
                data-pin-idx="${idx}"
                style="left:${leftPct}%;"
                title="${this.escapeHtml(
                  t('reel.cueBadgeTitle', {
                    num: idx + 1,
                    time: pt.toFixed(2),
                    suffix: candSuffix,
                  })
                )}"
                aria-label="${this.escapeHtml(
                  t('reel.cueAria', { num: idx + 1, time: pt.toFixed(2) })
                )}"
              >
                <span class="reel-cue-pin-head">${idx + 1}</span>
                <span class="reel-cue-pin-stem"></span>
              </button>
            `;
          })
          .join('');

        pinsLayer.querySelectorAll('.reel-cue-pin').forEach((pinEl) => {
          const pin = pinEl as HTMLElement;
          const idx = parseInt(pin.dataset.pinIdx || '0', 10);

          pin.addEventListener('pointerdown', (e) => {
            if (isApplying) return;
            e.preventDefault();
            e.stopPropagation();

            if (e.shiftKey) {
              const start = activeCueIdx ?? 0;
              const [low, high] = [Math.min(start, idx), Math.max(start, idx)];
              selectedCueIndices.clear();
              for (let k = low; k <= high; k++) selectedCueIndices.add(k);
              activeCueIdx = idx;
            } else if (e.ctrlKey || e.metaKey) {
              if (selectedCueIndices.has(idx)) {
                if (selectedCueIndices.size > 1) {
                  selectedCueIndices.delete(idx);
                  activeCueIdx = Array.from(selectedCueIndices)[0];
                }
              } else {
                selectedCueIndices.add(idx);
                activeCueIdx = idx;
              }
            } else {
              if (!selectedCueIndices.has(idx)) {
                selectedCueIndices.clear();
                selectedCueIndices.add(idx);
              }
              activeCueIdx = idx;
            }

            pushHistory();
            draggingPinIdx = idx;
            pin.setPointerCapture(e.pointerId);
            seekPreviewTo(cuePoints[idx]);

            isGroupDrag = selectedCueIndices.size > 1;
            groupDragStartX = e.clientX;
            groupDragSnapshots = Array.from(selectedCueIndices).map((i) => ({
              index: i,
              initialTime: cuePoints[i],
            }));
            cuesListEl?.querySelectorAll('.reel-cue-card').forEach((card, i) => {
              card.classList.toggle('active', i === activeCueIdx);
              card.classList.toggle('selected', selectedCueIndices.has(i));
            });
            pinsLayer?.querySelectorAll('.reel-cue-pin').forEach((p, i) => {
              p.classList.toggle('active', i === activeCueIdx);
              p.classList.toggle('selected', selectedCueIndices.has(i));
            });
          });

          pin.addEventListener('click', (e) => {
            if (isApplying) return;
            const me = e as MouseEvent;
            if (me.shiftKey) {
              const start = activeCueIdx ?? 0;
              const [low, high] = [Math.min(start, idx), Math.max(start, idx)];
              selectedCueIndices.clear();
              for (let k = low; k <= high; k++) selectedCueIndices.add(k);
              activeCueIdx = idx;
            } else if (me.ctrlKey || me.metaKey) {
              if (selectedCueIndices.has(idx)) {
                if (selectedCueIndices.size > 1) {
                  selectedCueIndices.delete(idx);
                  activeCueIdx = Array.from(selectedCueIndices)[0];
                }
              } else {
                selectedCueIndices.add(idx);
                activeCueIdx = idx;
              }
            } else {
              selectedCueIndices.clear();
              selectedCueIndices.add(idx);
              activeCueIdx = idx;
            }
            seekPreviewTo(cuePoints[idx]);
            renderAllCueUi();
          });

          pin.addEventListener('pointermove', (e) => {
            if (draggingPinIdx !== idx || !timelineTrack) return;
            const rect = timelineTrack.getBoundingClientRect();
            if (rect.width <= 0) return;

            if (isGroupDrag && groupDragSnapshots.length > 1) {
              const deltaRatio = (e.clientX - groupDragStartX) / rect.width;
              let deltaT = deltaRatio * dur;

              for (const item of groupDragSnapshots) {
                if (item.initialTime + deltaT < 0) {
                  deltaT = -item.initialTime;
                }
                if (item.initialTime + deltaT > dur) {
                  deltaT = dur - item.initialTime;
                }
              }

              for (const item of groupDragSnapshots) {
                const nextT = Number(Math.min(dur, Math.max(0, item.initialTime + deltaT)).toFixed(2));
                cuePoints[item.index] = nextT;
                const pinEl = pinsLayer?.querySelector(`.reel-cue-pin[data-pin-idx="${item.index}"]`) as HTMLElement | null;
                if (pinEl) pinEl.style.left = `${(nextT / dur) * 100}%`;
                const cardTime = cuesListEl?.querySelector(`.reel-cue-card[data-idx="${item.index}"] .reel-cue-card-time`);
                if (cardTime) cardTime.textContent = `${nextT.toFixed(2)}s`;
              }
              renderTimelineOverlaysOnlySegments();
              seekPreviewTo(cuePoints[idx]);
            } else {
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              const minBound = idx > 0 ? cuePoints[idx - 1] + 0.08 : 0;
              const maxBound = idx < cuePoints.length - 1 ? cuePoints[idx + 1] - 0.08 : dur;
              if (minBound > maxBound) return;
              const nextT = Number(Math.min(maxBound, Math.max(minBound, ratio * dur)).toFixed(2));
              cuePoints[idx] = nextT;
              pin.style.left = `${(nextT / dur) * 100}%`;
              const cardTime = cuesListEl?.querySelector(`.reel-cue-card[data-idx="${idx}"] .reel-cue-card-time`);
              if (cardTime) cardTime.textContent = `${nextT.toFixed(2)}s`;
              renderTimelineOverlaysOnlySegments();
              seekPreviewTo(nextT);
            }
          });

          const finishDrag = (e: PointerEvent) => {
            if (draggingPinIdx !== idx) return;
            draggingPinIdx = null;
            isGroupDrag = false;
            groupDragSnapshots = [];
            if (pin.hasPointerCapture(e.pointerId)) {
              pin.releasePointerCapture(e.pointerId);
            }
            const targetTime = cuePoints[idx];
            cuePoints = SmartPairer.normalizeCuePoints(cuePoints, dur);
            syncEasingsLength();
            activeCueIdx = findClosestCueIdx(targetTime);
            if (!selectedCueIndices.has(activeCueIdx)) {
              selectedCueIndices = new Set([activeCueIdx]);
            }
            renderAllCueUi();
          };

          pin.addEventListener('pointerup', finishDrag);
          pin.addEventListener('pointercancel', finishDrag);
        });
      }
    };

    const renderTimelineOverlaysOnlySegments = () => {
      if (!segmentsLayer) return;
      let segHtml = '';
      for (let i = 0; i < cuePoints.length - 1; i++) {
        const a = cuePoints[i];
        const b = cuePoints[i + 1];
        const leftPct = dur > 0 ? (a / dur) * 100 : 0;
        const widthPct = dur > 0 ? Math.max(0, ((b - a) / dur) * 100) : 0;
        const span = b - a;
        const easing = segmentEasings[i] || 'linear';
        const easingBadge = easing !== 'linear' ? `<span class="reel-segment-easing-badge" title="Easing: ${easing}">${easing}</span>` : '';
        segHtml += `
          <div class="reel-segment-band ${i % 2 === 0 ? 'even' : 'odd'}" style="left:${leftPct}%;width:${widthPct}%;">
            ${widthPct >= 9 ? `<span class="reel-segment-dur">${span.toFixed(1)}s</span>${easingBadge}` : ''}
          </div>
        `;
      }
      segmentsLayer.innerHTML = segHtml;
    };

    const findClosestCueIdx = (t: number): number => {
      let best = 0;
      let minDiff = Infinity;
      cuePoints.forEach((pt, idx) => {
        const d = Math.abs(pt - t);
        if (d < minDiff) {
          minDiff = d;
          best = idx;
        }
      });
      return best;
    };

    const renderCueCards = () => {
      if (!cuesListEl) return;
      cuesListEl.innerHTML = cuePoints
        .map((point, idx) => {
          const key = point.toFixed(2);
          const cachedThumb = thumbCache.get(key) || '';
          const nextPt = idx < cuePoints.length - 1 ? cuePoints[idx + 1] : null;
          const segText = nextPt !== null ? `${getFlowArrow()} ${(nextPt - point).toFixed(1)}s` : t('reel.segEnd');
          const isAct = idx === activeCueIdx;
          const isSel = selectedCueIndices.has(idx);
          const easing = segmentEasings[idx] || 'linear';
          const cand = findDetectedCandidate(point);
          const candLabelMap: Record<string, string> = {
            'pause-settle': t('reel.kind.pause-settle'),
            'velocity-valley': t('reel.kind.velocity-valley'),
            'scene-cut': t('reel.kind.scene-cut'),
          };
          const detectBadgeHtml = cand
            ? `<div class="reel-cue-detect-badge kind-${cand.kind}" title="${this.escapeHtml(t('reel.detectBadgeTitle', { conf: Math.round(cand.confidence * 100) }))}"><span class="reel-cue-detect-dot"></span><span>${candLabelMap[cand.kind] || cand.kind} · ${Math.round(cand.confidence * 100)}%</span></div>`
            : '';
          return `
            <div
              class="reel-cue-card ${isAct ? 'active' : ''} ${isSel ? 'selected' : ''}"
              data-idx="${idx}"
              data-time="${point}"
              tabindex="0"
              role="button"
              aria-label="${this.escapeHtml(t('reel.slideCardAria', { num: idx + 1, time: point.toFixed(2) }))}"
            >
              <div class="reel-cue-card-thumb">
                <img
                  src="${cachedThumb}"
                  data-cue-key="${key}"
                  alt="${this.escapeHtml(t('reel.thumbAlt', { num: idx + 1 }))}"
                  style="${cachedThumb ? 'display:block;' : 'display:none;'}"
                />
                <span class="reel-cue-thumb-loading" style="${cachedThumb ? 'display:none;' : ''}">${t('reel.thumbLoading')}</span>
                <span class="reel-cue-card-index">${idx + 1}</span>
                ${
                  cuePoints.length > 2
                    ? `<button type="button" class="cue-chip-del" data-idx="${idx}" title="${this.escapeHtml(t('reel.delCueTitle'))}" aria-label="${this.escapeHtml(t('reel.delCueTitle'))} ${idx + 1}">${Icons.close}</button>`
                    : ''
                }
              </div>
              <div class="reel-cue-card-meta">
                <span class="reel-cue-card-time tabular-nums">${point.toFixed(2)}s</span>
                <span class="reel-cue-card-seg tabular-nums">${segText}</span>
              </div>
              ${detectBadgeHtml}
              ${
                idx < cuePoints.length - 1
                  ? `
                <div class="reel-cue-easing-row">
                  <select class="reel-segment-easing-select" data-seg-idx="${idx}" title="${this.escapeHtml(t('reel.easingSelectTitle'))}">
                    <option value="linear" ${easing === 'linear' ? 'selected' : ''}>${t('easing.linear')}</option>
                    <option value="ease-in" ${easing === 'ease-in' ? 'selected' : ''}>${t('easing.easeIn')}</option>
                    <option value="ease-out" ${easing === 'ease-out' ? 'selected' : ''}>${t('easing.easeOut')}</option>
                    <option value="ease-in-out" ${easing === 'ease-in-out' ? 'selected' : ''}>${t('easing.easeInOut')}</option>
                    <option value="hold" ${easing === 'hold' || easing === 'step' ? 'selected' : ''}>${t('easing.step')}</option>
                  </select>
                </div>
              `
                  : ''
              }
              <div class="reel-cue-nudge-row">
                <button type="button" class="reel-nudge-btn" data-nudge="-0.05" data-idx="${idx}" title="${this.escapeHtml(t('reel.nudgeBackTitle'))}">-0.05s</button>
                <button type="button" class="reel-nudge-btn" data-nudge="0.05" data-idx="${idx}" title="${this.escapeHtml(t('reel.nudgeFwdTitle'))}">+0.05s</button>
              </div>
            </div>
          `;
        })
        .join('');

      cuesListEl.querySelectorAll('.reel-cue-card').forEach((card) => {
        const idx = parseInt((card as HTMLElement).dataset.idx || '0', 10);
        card.addEventListener('click', (e) => {
          const me = e as MouseEvent;
          if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('select')) return;
          if (me.shiftKey) {
            const start = activeCueIdx ?? 0;
            const [low, high] = [Math.min(start, idx), Math.max(start, idx)];
            selectedCueIndices.clear();
            for (let k = low; k <= high; k++) selectedCueIndices.add(k);
            activeCueIdx = idx;
          } else if (me.ctrlKey || me.metaKey) {
            if (selectedCueIndices.has(idx)) {
              if (selectedCueIndices.size > 1) {
                selectedCueIndices.delete(idx);
                activeCueIdx = Array.from(selectedCueIndices)[0];
              }
            } else {
              selectedCueIndices.add(idx);
              activeCueIdx = idx;
            }
          } else {
            selectedCueIndices.clear();
            selectedCueIndices.add(idx);
            activeCueIdx = idx;
          }
          seekPreviewTo(cuePoints[idx]);
          renderAllCueUi();
        });

        card.addEventListener('keydown', (e) => {
          const ke = e as KeyboardEvent;
          if (ke.key === 'Enter') {
            ke.preventDefault();
            activeCueIdx = idx;
            selectedCueIndices.clear();
            selectedCueIndices.add(idx);
            seekPreviewTo(cuePoints[idx]);
            renderAllCueUi();
          }
        });
      });

      cuesListEl.querySelectorAll('.reel-segment-easing-select').forEach((sel) => {
        sel.addEventListener('change', (e) => {
          e.stopPropagation();
          const segIdx = parseInt((sel as HTMLElement).dataset.segIdx || '0', 10);
          const val = (sel as HTMLSelectElement).value as SegmentEasing;
          pushHistory();
          segmentEasings[segIdx] = val;
          renderTimelineOverlaysOnlySegments();
        });
      });

      cuesListEl.querySelectorAll('.cue-chip-del').forEach((delBtn) => {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isApplying || cuePoints.length <= 2) return;
          const idx = parseInt((delBtn as HTMLElement).dataset.idx || '0', 10);
          pushHistory();
          cuePoints.splice(idx, 1);
          if (idx < segmentEasings.length) {
            segmentEasings.splice(idx, 1);
          }
          cuePoints = SmartPairer.normalizeCuePoints(cuePoints, dur);
          syncEasingsLength();
          activeCueIdx = Math.min(idx, cuePoints.length - 1);
          selectedCueIndices = new Set([activeCueIdx]);
          renderAllCueUi();
        });
      });

      cuesListEl.querySelectorAll('.reel-nudge-btn').forEach((nudgeBtn) => {
        nudgeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isApplying) return;
          const idx = parseInt((nudgeBtn as HTMLElement).dataset.idx || '0', 10);
          const delta = parseFloat((nudgeBtn as HTMLElement).dataset.nudge || '0');
          const minBound = idx > 0 ? cuePoints[idx - 1] + 0.08 : 0;
          const maxBound = idx < cuePoints.length - 1 ? cuePoints[idx + 1] - 0.08 : dur;
          const proposed = Number(Math.min(maxBound, Math.max(minBound, cuePoints[idx] + delta)).toFixed(2));
          if (Math.abs(proposed - cuePoints[idx]) < 0.01) {
            showInlineStatus(t('reel.status.tooCloseDrag'), 'warning');
            return;
          }
          pushHistory();
          hideInlineStatus();
          cuePoints[idx] = proposed;
          cuePoints = SmartPairer.normalizeCuePoints(cuePoints, dur);
          syncEasingsLength();
          activeCueIdx = findClosestCueIdx(proposed);
          selectedCueIndices = new Set([activeCueIdx]);
          seekPreviewTo(proposed);
          renderAllCueUi();
        });
      });
    };

    const renderAllCueUi = () => {
      renderTimelineOverlays();
      renderCueCards();
      updateFooterBtn();
      syncPlayheadUi();
      void queueCueThumbnails();
    };

    const addCueAtPlayhead = () => {
      if (isApplying || !videoEl) return;
      const cur = Number((Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0).toFixed(2));
      const tooClose = cuePoints.find((pt) => Math.abs(pt - cur) < 0.08);
      if (tooClose !== undefined) {
        activeCueIdx = cuePoints.indexOf(tooClose);
        selectedCueIndices = new Set([activeCueIdx]);
        renderAllCueUi();
        showInlineStatus(t('reel.status.tooCloseAdd', { time: tooClose.toFixed(2) }), 'warning');
        return;
      }
      pushHistory();
      hideInlineStatus();
      cuePoints.push(cur);
      cuePoints = SmartPairer.normalizeCuePoints(cuePoints, dur);
      syncEasingsLength();
      activeCueIdx = findClosestCueIdx(cur);
      selectedCueIndices = new Set([activeCueIdx]);
      renderAllCueUi();
    };

    const closeModal = (forceCancel = false) => {
      if (isClosed) return;
      if (isApplying && !forceCancel) return;
      isClosed = true;
      this.isModalOpen = false;
      this.activeModalClose = null;
      stopPlaybackRaf();
      window.removeEventListener('keydown', onModalKeyDown, true);
      modalAbort.abort();
      detectAbort?.abort();
      applyAbort?.abort();
      if (thumbSession) {
        try {
          thumbSession.dispose();
        } catch {
          // Ignore
        }
        thumbSession = null;
      }
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      }
      host.innerHTML = '';
      if (!wasApplied && !isOwnedByStore) {
        const stillUsed = this.store
          .getSlides()
          .some((s) => s.transitionToNext.videoAsset?.objectUrl === videoAsset.objectUrl);
        if (!stillUsed) {
          MediaValidator.revokeAssetUrls(videoAsset);
        }
      }
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };

    const onModalKeyDown = (e: KeyboardEvent) => {
      if (isClosed) return;
      const target = e.target as HTMLElement;
      const isField =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (isApplying) {
          applyAbort?.abort();
        } else if (isDetecting) {
          detectAbort?.abort();
        } else {
          closeModal();
        }
        return;
      }

      if (isField || isApplying) return;

      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        togglePlayPause();
      } else if (e.key === 'ArrowLeft' || e.key === ',') {
        e.preventDefault();
        e.stopPropagation();
        stepVideo(e.shiftKey ? -0.5 : -(1 / 30));
      } else if (e.key === 'ArrowRight' || e.key === '.') {
        e.preventDefault();
        e.stopPropagation();
        stepVideo(e.shiftKey ? 0.5 : 1 / 30);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        e.stopPropagation();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        e.stopPropagation();
        copySelectedKeyframes();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        e.stopPropagation();
        pasteKeyframes();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        e.stopPropagation();
        duplicateSelectedKeyframes();
      } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        fitToView();
      } else if (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'm') {
        e.preventDefault();
        e.stopPropagation();
        addCueAtPlayhead();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && cuePoints.length > 2) {
        e.preventDefault();
        e.stopPropagation();
        deleteSelectedKeyframes();
      }
    };

    this.isModalOpen = true;
    this.activeModalClose = () => closeModal(true);
    window.addEventListener('keydown', onModalKeyDown, true);

    // Wire video element events
    videoEl?.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(videoEl.duration) && videoEl.duration > 0 && Math.abs(videoEl.duration - dur) > 0.1) {
        dur = videoEl.duration;
        cuePoints = SmartPairer.normalizeCuePoints(cuePoints, dur);
        if (metaBadge) {
          metaBadge.textContent = `${videoAsset.name} · ${dur.toFixed(1)}s · ${videoAsset.width}×${videoAsset.height}`;
        }
        renderAllCueUi();
      }
      syncPlayheadUi();
    });
    videoEl?.addEventListener('play', () => {
      syncPlayButtonUi();
      startPlaybackRaf();
    });
    videoEl?.addEventListener('pause', () => {
      syncPlayButtonUi();
      stopPlaybackRaf();
      syncPlayheadUi();
    });
    videoEl?.addEventListener('ended', () => {
      syncPlayButtonUi();
      stopPlaybackRaf();
      syncPlayheadUi();
    });
    videoEl?.addEventListener('timeupdate', syncPlayheadUi);
    videoEl?.addEventListener('seeked', syncPlayheadUi);
    videoEl?.addEventListener('click', togglePlayPause);
    videoEl?.addEventListener('error', () => {
      if (videoErrBox) videoErrBox.classList.add('visible');
      if (videoErrText) {
        videoErrText.textContent = t('reel.videoUnsupportedErr', { name: videoAsset.name });
      }
      if (applyBtn) applyBtn.disabled = true;
    });

    // Mode toggle (append vs replace)
    host.querySelector('#btn-mode-append')?.addEventListener('click', () => {
      applyMode = 'append';
      host.querySelector('#btn-mode-append')?.classList.add('active');
      host.querySelector('#btn-mode-replace')?.classList.remove('active');
      updateFooterBtn();
    });
    host.querySelector('#btn-mode-replace')?.addEventListener('click', () => {
      applyMode = 'replace-all';
      host.querySelector('#btn-mode-replace')?.classList.add('active');
      host.querySelector('#btn-mode-append')?.classList.remove('active');
      updateFooterBtn();
    });

    // Transport buttons
    playPauseBtn?.addEventListener('click', togglePlayPause);
    host.querySelector('#btn-reel-step-back-half')?.addEventListener('click', () => stepVideo(-0.5));
    host.querySelector('#btn-reel-step-back-frame')?.addEventListener('click', () => stepVideo(-(1 / 30)));
    host.querySelector('#btn-reel-step-fwd-frame')?.addEventListener('click', () => stepVideo(1 / 30));
    host.querySelector('#btn-reel-step-fwd-half')?.addEventListener('click', () => stepVideo(0.5));
    muteBtn?.addEventListener('click', () => {
      if (!videoEl) return;
      videoEl.muted = !videoEl.muted;
      muteBtn.innerHTML = videoEl.muted ? Icons.volumeMuted : Icons.volumeOn;
    });

    // Undo / Redo & Zoom Controls
    undoBtn?.addEventListener('click', undo);
    redoBtn?.addEventListener('click', redo);
    host.querySelector('#btn-reel-zoom-in')?.addEventListener('click', () => applyZoom(zoomLevel * 1.25));
    host.querySelector('#btn-reel-zoom-out')?.addEventListener('click', () => applyZoom(zoomLevel / 1.25));
    host.querySelector('#btn-reel-zoom-fit')?.addEventListener('click', fitToView);

    const timelineShellEl = host.querySelector('.reel-timeline-shell') as HTMLElement | null;
    timelineShellEl?.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.25 : 0.8;
          applyZoom(zoomLevel * factor, e.clientX);
        }
      },
      { passive: false }
    );

    // Timeline scrubbing pointer drag
    let isScrubbingTimeline = false;
    const scrubFromClientX = (clientX: number) => {
      if (!timelineTrack) return;
      const rect = timelineTrack.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      seekPreviewTo(ratio * dur);
    };
    timelineTrack?.addEventListener('pointerdown', (e) => {
      if (isApplying || (e.target as HTMLElement).closest('.reel-cue-pin')) return;
      isScrubbingTimeline = true;
      timelineTrack.setPointerCapture(e.pointerId);
      scrubFromClientX(e.clientX);
    });
    timelineTrack?.addEventListener('pointermove', (e) => {
      if (!isScrubbingTimeline) return;
      scrubFromClientX(e.clientX);
    });
    const endTimelineScrub = (e: PointerEvent) => {
      if (!isScrubbingTimeline) return;
      isScrubbingTimeline = false;
      if (timelineTrack?.hasPointerCapture(e.pointerId)) {
        timelineTrack.releasePointerCapture(e.pointerId);
      }
    };
    timelineTrack?.addEventListener('pointerup', endTimelineScrub);
    timelineTrack?.addEventListener('pointercancel', endTimelineScrub);

    // Close / Backdrop
    closeIconBtn?.addEventListener('click', () => closeModal());
    cancelBtn?.addEventListener('click', () => {
      if (isApplying) {
        applyAbort?.abort();
      } else {
        closeModal();
      }
    });
    host.querySelector('#reel-modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'reel-modal-backdrop' && !isApplying) {
        closeModal();
      }
    });

    // Cue Add & Equal Splits
    host.querySelector('#btn-reel-add-current')?.addEventListener('click', addCueAtPlayhead);
    const applyEqualSplit = (segments: number) => {
      if (isApplying) return;
      pushHistory();
      hideInlineStatus();
      lastDetectionResult = null;
      const pts: number[] = [];
      for (let i = 0; i < segments; i++) {
        pts.push(Number(((i / (segments - 1)) * dur).toFixed(2)));
      }
      cuePoints = SmartPairer.normalizeCuePoints(pts, dur);
      syncEasingsLength();
      activeCueIdx = 0;
      selectedCueIndices = new Set([0]);
      renderAllCueUi();
    };
    host.querySelector('#btn-reel-split-3')?.addEventListener('click', () => applyEqualSplit(3));
    host.querySelector('#btn-reel-split-4')?.addEventListener('click', () => applyEqualSplit(4));
    host.querySelector('#btn-reel-split-5')?.addEventListener('click', () => applyEqualSplit(5));

    // Auto-Detect Cues
    cancelDetectBtn?.addEventListener('click', () => {
      detectAbort?.abort();
    });
    autoDetectBtn?.addEventListener('click', async () => {
      if (isDetecting || isApplying) return;
      isDetecting = true;
      detectAbort = new AbortController();
      autoDetectBtn.disabled = true;
      showInlineStatus(t('reel.status.analyzingInit'), 'info', true);
      try {
        const sensitivity = (sensitivitySel?.value || 'medium') as CueDetectionSensitivity;
        const result = await SmartPairer.detectCuePointsFromVideo(videoAsset, {
          sensitivity,
          onProgress: (p) => {
            if (!isClosed) {
              showInlineStatus(
                t('reel.status.analyzingProgress', { pct: Math.round(p * 100) }),
                'info',
                true
              );
            }
          },
          signal: detectAbort.signal,
        });
        if (isClosed) return;
        pushHistory();
        lastDetectionResult = result;
        cuePoints = SmartPairer.normalizeCuePoints(result.cueTimesSec, dur);
        if (result.recommendedEasings && result.recommendedEasings.length > 0) {
          segmentEasings = result.recommendedEasings.slice(0, Math.max(0, cuePoints.length - 1));
        }
        syncEasingsLength();
        activeCueIdx = 0;
        selectedCueIndices = new Set([0]);
        const methodText: Record<string, string> = {
          'pause-plateaus': t('reel.method.pause-plateaus'),
          'scene-cuts': t('reel.method.scene-cuts'),
          hybrid: t('reel.method.hybrid'),
          'uniform-fallback': t('reel.method.uniform-fallback'),
        };
        showInlineStatus(
          t('reel.status.detected', {
            count: this.formatArabicSlideCount(cuePoints.length),
            method: methodText[result.method] || result.method,
          }),
          'success',
          false
        );
        renderAllCueUi();
      } catch (err) {
        if (!isClosed) {
          if (MediaValidator.isAbortError(err)) {
            showInlineStatus(t('reel.status.detectCancelled'), 'warning', false);
          } else {
            showInlineStatus(
              err instanceof Error ? err.message : t('reel.status.detectFailed'),
              'warning',
              false
            );
          }
        }
      } finally {
        isDetecting = false;
        detectAbort = null;
        if (!isClosed && autoDetectBtn) {
          autoDetectBtn.disabled = false;
        }
      }
    });

    // Apply Workflow with Progress & Abort
    applyBtn?.addEventListener('click', async () => {
      if (isApplying) return;
      isApplying = true;
      applyAbort = new AbortController();
      applyBtn.disabled = true;
      applyBtn.textContent = t('reel.applyingBusy');
      if (closeIconBtn) closeIconBtn.disabled = true;
      if (autoDetectBtn) autoDetectBtn.disabled = true;
      if (cancelBtn) cancelBtn.textContent = t('reel.stopExtract');
      if (applyProgWrap) applyProgWrap.classList.add('visible');
      if (applyProgFill) applyProgFill.style.width = '5%';
      if (applyProgText) applyProgText.textContent = `0 / ${cuePoints.length}`;

      try {
        await this.store.applyVideoCuePointsWorkflow(videoAsset, cuePoints, {
          mode: applyMode,
          targetVideoAssetId: options.targetVideoAssetId ?? videoAsset.id,
          matchAspectRatio: Boolean(matchRatioChk?.checked),
          preserveMetadata: applyMode === 'replace-reel',
          segmentEasings: [...segmentEasings],
          cueLabels: cueLabels.length === cuePoints.length ? [...cueLabels] : undefined,
          onProgress: (done, total) => {
            if (isClosed) return;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            if (applyProgFill) applyProgFill.style.width = `${pct}%`;
            if (applyProgText) applyProgText.textContent = `${done} / ${total}`;
          },
          signal: applyAbort.signal,
        });
        wasApplied = true;
        closeModal(true);
      } catch (err) {
        if (isClosed) return;
        isApplying = false;
        applyAbort = null;
        applyBtn.disabled = false;
        if (closeIconBtn) closeIconBtn.disabled = false;
        if (autoDetectBtn) autoDetectBtn.disabled = false;
        if (cancelBtn) cancelBtn.textContent = t('reel.cancel');
        if (applyProgWrap) applyProgWrap.classList.remove('visible');
        updateFooterBtn();
        if (MediaValidator.isAbortError(err)) {
          showInlineStatus(t('reel.status.extractAborted'), 'warning');
        } else {
          this.store.notify(
            err instanceof Error ? err.message : t('reel.status.extractFailed'),
            'error'
          );
        }
      }
    });

    const applyMotionReelCueSource = (sourceCues: Array<{ timeSec: number; label: string }>) => {
      if (!sourceCues.length) return;
      const pts: number[] = [];
      const labels: string[] = [];
      const pushUnique = (timeSec: number, label: string) => {
        const clamped = Math.min(dur, Math.max(0, timeSec));
        if (!pts.some((p) => Math.abs(p - clamped) < 0.08)) {
          pts.push(clamped);
          labels.push(label);
        }
      };
      if (sourceCues[0].timeSec > 0.08) pushUnique(0, 'Start');
      for (const c of sourceCues) pushUnique(c.timeSec, c.label);
      if (dur - pts[pts.length - 1] > 0.08) pushUnique(dur, 'End');
      cuePoints = SmartPairer.normalizeCuePoints(pts, dur);
      cueLabels = labels;
      syncEasingsLength();
      activeCueIdx = 0;
      selectedCueIndices = new Set([0]);
      renderAllCueUi();
    };

    host.querySelector('#btn-reel-load-sections')?.addEventListener('click', () => {
      if (motionReelMeta?.sectionCues.length) {
        applyMotionReelCueSource(motionReelMeta.sectionCues);
      }
    });

    host.querySelector('#btn-reel-load-hits')?.addEventListener('click', () => {
      if (motionReelMeta?.hitCues.length) {
        applyMotionReelCueSource(motionReelMeta.hitCues);
      }
    });

    // Initial render + progressive filmstrip load
    renderAllCueUi();
    playPauseBtn?.focus();

    void (async () => {
      const filmstripSlots: Array<FilmstripFrame | null> = new Array(12).fill(null);
      try {
        await FrameExtractor.extractFilmstripThumbnails(videoAsset, 12, {
          maxWidth: 160,
          signal: modalAbort.signal,
          onThumbnail: (frame, index) => {
            if (isClosed || !filmstripStrip) return;
            filmstripSlots[index] = frame;
            filmstripStrip.innerHTML = filmstripSlots
              .map((f) =>
                f
                  ? `<img class="reel-filmstrip-cell" src="${f.dataUrl}" alt="" />`
                  : `<div class="reel-filmstrip-cell" style="background:var(--surface-elevated);"></div>`
              )
              .join('');
          },
        });
      } catch {
        // Keep clean strip fallback if filmstrip fails or is aborted
      }
    })();
  }

  /* =========================================================================
   * 8. STUDIO TIMELINE DOCK, SLIDE CONTEXT MENU & COMMAND PALETTE
   * ========================================================================= */
  private openReelStudioForSelection(slideId?: string): void {
    const slides = this.store.getSlides();
    const ctx =
      this.store.getReelContextForSlide?.(slideId) ??
      this.store.getReelContextForSlide?.() ??
      null;

    if (!ctx) {
      void this.handleOpenReelWorkflow();
      return;
    }

    const easings: SegmentEasing[] = slides
      .filter((s) => s.transitionToNext.videoAsset?.id === ctx.videoAsset.id)
      .map((s) => s.transitionToNext.easing || 'ease-in-out');

    this.openReelCueModal(ctx.videoAsset, {
      mode: 'replace-reel',
      targetVideoAssetId: ctx.videoAsset.id,
      initialCuePoints: ctx.cuePointsSec,
      initialSegmentEasings: easings,
      isAlreadyOwnedByStore: true,
    });
  }

  private renderStudioTimelineDock(): void {
    const dock = this.root.querySelector('#studio-timeline-dock') as HTMLElement | null;
    if (!dock) return;

    const slides = this.store.getSlides();
    if (slides.length === 0) {
      dock.classList.add('hidden');
      dock.innerHTML = '';
      return;
    }

    dock.classList.remove('hidden');
    dock.classList.toggle('is-collapsed', this.isTimelineDockCollapsed);

    let totalTransitionSec = 0;
    for (let i = 0; i < slides.length - 1; i++) {
      const spec = slides[i].transitionToNext;
      if (spec.videoAsset) {
        if (
          typeof spec.startTimeSec === 'number' &&
          typeof spec.endTimeSec === 'number' &&
          spec.endTimeSec > spec.startTimeSec
        ) {
          totalTransitionSec += spec.endTimeSec - spec.startTimeSec;
        } else {
          totalTransitionSec += spec.videoAsset.durationSec > 0 ? spec.videoAsset.durationSec : (spec.fallbackDurationMs || 650) / 1000;
        }
      } else {
        totalTransitionSec += (spec.fallbackDurationMs || 650) / 1000;
      }
    }

    const selection = this.store.getSelection();
    const activeSlideId =
      selection.type === 'slide' || selection.type === 'transition'
        ? selection.slideId
        : slides[this.latestEngineStatus?.currentSlideIndex ?? this.store.getActivePreviewIndex()]?.id;
    const rtl = isRtlLanguage();
    const bridgeArrow = rtl ? Icons.arrowLeft : Icons.arrowRight;

    const nodesHtml = slides
      .map((slide, idx) => {
        const isSlideActive = slide.id === activeSlideId && selection.type !== 'transition';
        const thumbHtml = slide.imageAsset.objectUrl
          ? `<img src="${this.escapeHtml(slide.imageAsset.objectUrl)}" alt="" />`
          : `<span class="tabular-nums">${idx + 1}</span>`;
        const slideBtn = `
          <button
            type="button"
            class="dock-seq-node ${isSlideActive ? 'active' : ''}"
            data-dock-slide-id="${slide.id}"
            title="${this.escapeHtml(slide.title)}"
          >
            <span class="dock-seq-thumb">${thumbHtml}</span>
            <span class="dock-seq-label tabular-nums">${String(idx + 1).padStart(2, '0')} · ${this.escapeHtml(slide.title)}</span>
          </button>
        `;

        if (idx >= slides.length - 1) return slideBtn;

        const hasVideo = Boolean(slide.transitionToNext.videoAsset);
        const isTransActive = selection.type === 'transition' && selection.slideId === slide.id;
        const bridgeTitle = hasVideo
          ? slide.transitionToNext.videoAsset?.name || t('ctx.editTransition')
          : t('inspector.fallbackStyleLabel');

        return `${slideBtn}
          <button
            type="button"
            class="dock-seq-bridge ${hasVideo ? 'has-video' : ''} ${isTransActive ? 'active' : ''}"
            data-dock-trans-slide-id="${slide.id}"
            title="${this.escapeHtml(bridgeTitle)}"
            aria-label="${this.escapeHtml(bridgeTitle)}"
          >${hasVideo ? Icons.filmTransition : bridgeArrow}</button>`;
      })
      .join('');

    dock.innerHTML = `
      <div class="dock-header">
        <div class="dock-header-lead">
          <span class="dock-title">${Icons.timelineDock} <span>${this.escapeHtml(t('dock.title'))}</span></span>
          <span class="dock-stat-pill tabular-nums">${slides.length} ${this.escapeHtml(t('dock.slidesCount'))}</span>
          <span class="dock-stat-pill tabular-nums">${this.escapeHtml(t('dock.totalDuration'))}: ${this.escapeHtml(this.formatTimecode(totalTransitionSec))}</span>
        </div>
        <div class="dock-header-trailing">
          <button type="button" class="btn dock-cues-btn" id="btn-stage-open-cues" title="${this.escapeHtml(t('dock.openCuesBtn'))}">
            ${Icons.splitCue}
            <span>${this.escapeHtml(t('dock.openCuesBtn'))}</span>
          </button>
          <button
            type="button"
            class="btn btn-icon-only"
            id="btn-toggle-timeline-dock"
            aria-expanded="${!this.isTimelineDockCollapsed}"
            title="${this.escapeHtml(t('dock.toggleTitle'))}"
            aria-label="${this.escapeHtml(t('dock.toggleTitle'))}"
          >
            ${this.isTimelineDockCollapsed ? Icons.chevronUp : Icons.chevronDown}
          </button>
        </div>
      </div>
      <div class="dock-body">
        <div class="dock-sequence-track">${nodesHtml}</div>
      </div>
    `;

    dock.querySelector('#btn-stage-open-cues')?.addEventListener('click', () => {
      this.openReelStudioForSelection();
    });

    dock.querySelector('#btn-toggle-timeline-dock')?.addEventListener('click', () => {
      this.toggleTimelineDock();
    });

    dock.querySelectorAll('.dock-seq-node').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slideId = (btn as HTMLElement).dataset.dockSlideId;
        if (slideId) {
          this.store.setSelection({ type: 'slide', slideId });
        }
      });
    });

    dock.querySelectorAll('.dock-seq-bridge').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slideId = (btn as HTMLElement).dataset.dockTransSlideId;
        if (slideId) {
          this.store.setSelection({ type: 'transition', slideId });
        }
      });
    });
  }

  private syncTimelineDockActiveState(): void {
    const dock = this.root.querySelector('#studio-timeline-dock');
    if (!dock || dock.classList.contains('hidden')) return;

    const slides = this.store.getSlides();
    const selection = this.store.getSelection();
    const activeSlideId =
      selection.type === 'slide' || selection.type === 'transition'
        ? selection.slideId
        : slides[this.latestEngineStatus?.currentSlideIndex ?? this.store.getActivePreviewIndex()]?.id;

    dock.querySelectorAll('.dock-seq-node').forEach((node) => {
      const id = (node as HTMLElement).dataset.dockSlideId;
      node.classList.toggle('active', Boolean(id && id === activeSlideId && selection.type !== 'transition'));
    });
    dock.querySelectorAll('.dock-seq-bridge').forEach((bridge) => {
      const id = (bridge as HTMLElement).dataset.dockTransSlideId;
      bridge.classList.toggle('active', Boolean(id && selection.type === 'transition' && id === selection.slideId));
    });
  }

  private toggleTimelineDock(forceCollapsed?: boolean): void {
    this.isTimelineDockCollapsed =
      typeof forceCollapsed === 'boolean' ? forceCollapsed : !this.isTimelineDockCollapsed;
    const dock = this.root.querySelector('#studio-timeline-dock') as HTMLElement | null;
    if (!dock) return;
    dock.classList.toggle('is-collapsed', this.isTimelineDockCollapsed);
    const toggleBtn = dock.querySelector('#btn-toggle-timeline-dock');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', String(!this.isTimelineDockCollapsed));
      toggleBtn.innerHTML = this.isTimelineDockCollapsed ? Icons.chevronUp : Icons.chevronDown;
    }
  }

  private closeSlideContextMenu(): void {
    this.closeContextMenuFn?.();
    this.closeContextMenuFn = null;
  }

  private openSlideContextMenu(slideId: string, clientX: number, clientY: number): void {
    const host = this.root.querySelector('#context-menu-host') as HTMLElement | null;
    if (!host) return;

    const slides = this.store.getSlides();
    const idx = slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return;

    this.closeSlideContextMenu();

    const vw = typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) && window.innerHeight > 0 ? window.innerHeight : 800;
    const left = Math.max(8, Math.min(clientX, vw - 228));
    const top = Math.max(8, Math.min(clientY, vh - 290));

    const canMoveUp = idx > 0;
    const canMoveDown = idx < slides.length - 1;
    const hasReelCtx = Boolean(this.store.getReelContextForSlide?.(slideId));

    host.innerHTML = `
      <div class="studio-context-menu" id="studio-context-menu" role="menu" style="left:${left}px;top:${top}px;">
        <button type="button" class="ctx-menu-item" id="ctx-move-up" role="menuitem" ${!canMoveUp ? 'disabled' : ''}>
          ${Icons.chevronUp}
          <span>${this.escapeHtml(t('ctx.moveUp'))}</span>
        </button>
        <button type="button" class="ctx-menu-item" id="ctx-move-down" role="menuitem" ${!canMoveDown ? 'disabled' : ''}>
          ${Icons.chevronDown}
          <span>${this.escapeHtml(t('ctx.moveDown'))}</span>
        </button>
        <button type="button" class="ctx-menu-item" id="ctx-duplicate" role="menuitem">
          ${Icons.duplicate}
          <span>${this.escapeHtml(t('ctx.duplicate'))}</span>
        </button>
        <div class="ctx-menu-sep" role="separator"></div>
        <button type="button" class="ctx-menu-item" id="ctx-edit-transition" role="menuitem" ${!canMoveDown ? 'disabled' : ''}>
          ${Icons.sliders}
          <span>${this.escapeHtml(t('ctx.editTransition'))}</span>
        </button>
        <button type="button" class="ctx-menu-item" id="ctx-replace-image" role="menuitem">
          ${Icons.photoPlus}
          <span>${this.escapeHtml(t('ctx.replaceImage'))}</span>
        </button>
        <button type="button" class="ctx-menu-item" id="ctx-open-cues" role="menuitem" ${!hasReelCtx ? 'disabled' : ''}>
          ${Icons.splitCue}
          <span>${this.escapeHtml(t('ctx.openCueStudio'))}</span>
        </button>
        <div class="ctx-menu-sep" role="separator"></div>
        <button type="button" class="ctx-menu-item danger" id="ctx-delete-slide" role="menuitem">
          ${Icons.trash}
          <span>${this.escapeHtml(t('ctx.delete'))}</span>
        </button>
      </div>
    `;

    const cleanup = () => {
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('keydown', onKeyDown);
      host.innerHTML = '';
      if (this.closeContextMenuFn === cleanup) {
        this.closeContextMenuFn = null;
      }
    };

    const onDocClick = (e: Event) => {
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl || !targetEl.closest?.('#studio-context-menu')) {
        cleanup();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
      }
    };

    this.closeContextMenuFn = cleanup;
    document.addEventListener('click', onDocClick);
    window.addEventListener('keydown', onKeyDown);

    host.querySelector('#ctx-move-up')?.addEventListener('click', () => {
      cleanup();
      this.store.moveSlide(slideId, 'up');
    });
    host.querySelector('#ctx-move-down')?.addEventListener('click', () => {
      cleanup();
      this.store.moveSlide(slideId, 'down');
    });
    host.querySelector('#ctx-duplicate')?.addEventListener('click', () => {
      cleanup();
      if (this.store.duplicateSlide(slideId)) {
        this.store.notify(t('notify.slideDuplicated'), 'success', 2000);
      }
    });
    host.querySelector('#ctx-edit-transition')?.addEventListener('click', () => {
      cleanup();
      this.store.setSelection({ type: 'transition', slideId });
      if (!this.isInspectorVisible) {
        this.toggleInspectorPane();
      }
    });
    host.querySelector('#ctx-replace-image')?.addEventListener('click', () => {
      cleanup();
      const input = this.root.querySelector('#single-image-input') as HTMLInputElement | null;
      if (input) {
        input.dataset.replaceSlideId = slideId;
        input.click();
      }
    });
    host.querySelector('#ctx-open-cues')?.addEventListener('click', () => {
      cleanup();
      this.openReelStudioForSelection(slideId);
    });
    host.querySelector('#ctx-delete-slide')?.addEventListener('click', () => {
      cleanup();
      this.promptDeleteSlide(slideId);
    });
  }

  private getStudioCommandItems(): Array<{
    id: string;
    group: string;
    label: string;
    shortcut?: string;
    icon: string;
    disabled?: boolean;
    run: () => void;
  }> {
    const slides = this.store.getSlides();
    const hasSlides = slides.length > 0;
    const selection = this.store.getSelection();
    const targetSlideId =
      selection.type === 'slide' || selection.type === 'transition'
        ? selection.slideId
        : slides[this.store.getActivePreviewIndex()]?.id;

    return [
      {
        id: 'cmd-open-project',
        group: t('cmd.groupFile'),
        label: t('toolbar.openProject'),
        shortcut: 'Ctrl+O',
        icon: Icons.folderOpen,
        run: () => this.handleOpenProject(),
      },
      {
        id: 'cmd-import-media',
        group: t('cmd.groupFile'),
        label: t('toolbar.importMedia'),
        icon: Icons.folderImport,
        run: () => this.handleImportMedia(),
      },
      {
        id: 'cmd-reel-workflow',
        group: t('cmd.groupFile'),
        label: t('toolbar.reelWorkflow'),
        icon: Icons.filmTransition,
        run: () => {
          void this.handleOpenReelWorkflow();
        },
      },
      {
        id: 'cmd-add-slide',
        group: t('cmd.groupFile'),
        label: t('toolbar.addSlide'),
        icon: Icons.photoPlus,
        run: () => {
          const input = this.root.querySelector('#single-image-input') as HTMLInputElement | null;
          if (input) {
            input.dataset.replaceSlideId = '';
            input.click();
          }
        },
      },
      {
        id: 'cmd-load-demo',
        group: t('cmd.groupFile'),
        label: t('toolbar.loadDemo'),
        icon: Icons.sparkles,
        disabled: this.isGeneratingDemo,
        run: () => this.handleGenerateDemo(),
      },
      {
        id: 'cmd-save-project',
        group: t('cmd.groupFile'),
        label: t('toolbar.saveProject'),
        shortcut: 'Ctrl+S',
        icon: Icons.exportDoc,
        disabled: !hasSlides,
        run: () => {
          void this.handleSaveProject(false);
        },
      },
      {
        id: 'cmd-duplicate-slide',
        group: t('cmd.groupEdit'),
        label: t('ctx.duplicate'),
        shortcut: 'Ctrl+D',
        icon: Icons.duplicate,
        disabled: !hasSlides,
        run: () => {
          if (this.store.duplicateSlide(targetSlideId)) {
            this.store.notify(t('notify.slideDuplicated'), 'success', 2000);
          }
        },
      },
      {
        id: 'cmd-open-cues',
        group: t('cmd.groupEdit'),
        label: t('dock.openCuesBtn'),
        icon: Icons.splitCue,
        run: () => this.openReelStudioForSelection(targetSlideId),
      },
      {
        id: 'cmd-delete-slide',
        group: t('cmd.groupEdit'),
        label: t('ctx.delete'),
        shortcut: 'Del',
        icon: Icons.trash,
        disabled: !targetSlideId,
        run: () => {
          if (targetSlideId) this.promptDeleteSlide(targetSlideId);
        },
      },
      {
        id: 'cmd-toggle-theme',
        group: t('cmd.groupView'),
        label: t('cmd.toggleTheme'),
        icon: this.getThemeIcon(),
        run: () => this.toggleTheme(),
      },
      {
        id: 'cmd-toggle-lang',
        group: t('cmd.groupView'),
        label: t('cmd.toggleLang'),
        icon: Icons.globe,
        run: () => this.toggleLanguage(),
      },
      {
        id: 'cmd-toggle-dock',
        group: t('cmd.groupView'),
        label: t('cmd.toggleTimelineDock'),
        icon: Icons.timelineDock,
        disabled: !hasSlides,
        run: () => this.toggleTimelineDock(),
      },
      {
        id: 'cmd-toggle-nav',
        group: t('cmd.groupView'),
        label: t('toolbar.toggleNavTitle'),
        shortcut: 'Ctrl+1',
        icon: Icons.sidebarLeft,
        run: () => this.toggleNavigatorPane(),
      },
      {
        id: 'cmd-toggle-inspector',
        group: t('cmd.groupView'),
        label: t('toolbar.toggleInspectorTitle'),
        shortcut: 'Ctrl+I',
        icon: Icons.sidebarRight,
        run: () => this.toggleInspectorPane(),
      },
      {
        id: 'cmd-shortcuts-help',
        group: t('cmd.groupView'),
        label: t('toolbar.shortcutsTitle'),
        shortcut: '?',
        icon: Icons.keyboard,
        run: () => this.openShortcutsHelpModal(),
      },
      {
        id: 'cmd-start-fullscreen',
        group: t('cmd.groupPresent'),
        label: t('toolbar.playPresentation'),
        shortcut: 'F5',
        icon: Icons.playFill,
        disabled: !hasSlides,
        run: () => this.enterFullscreenPresentation(this.latestEngineStatus?.currentSlideIndex || 0),
      },
    ];
  }

  private openCommandPalette(preserveQuery = false): void {
    const host = (this.root.querySelector('#command-palette-host') ||
      this.root.querySelector('#reel-modal-host')) as HTMLElement | null;
    if (!host) return;

    this.closeSlideContextMenu();
    if (!preserveQuery && this.isCommandPaletteOpen) {
      this.activeModalClose?.();
      return;
    }

    this.activeModalClose?.();
    const prevFocused = document.activeElement as HTMLElement | null;
    if (!preserveQuery) {
      this.commandPaletteQuery = '';
      this.commandPaletteActiveIdx = 0;
    }

    const allItems = this.getStudioCommandItems();
    let isClosed = false;

    const getFilteredItems = () => {
      const q = this.commandPaletteQuery.trim().toLowerCase();
      if (!q) return allItems;
      return allItems.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.group.toLowerCase().includes(q) ||
          (item.shortcut && item.shortcut.toLowerCase().includes(q))
      );
    };

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      this.isModalOpen = false;
      this.isCommandPaletteOpen = false;
      this.activeModalClose = null;
      window.removeEventListener('keydown', onKeyDown);
      host.innerHTML = '';
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };

    const renderList = () => {
      const listEl = host.querySelector('#command-palette-list') as HTMLElement | null;
      if (!listEl) return;
      const filtered = getFilteredItems();
      if (filtered.length === 0) {
        listEl.innerHTML = `<div class="command-empty">${this.escapeHtml(t('cmd.empty'))}</div>`;
        return;
      }
      if (this.commandPaletteActiveIdx >= filtered.length) {
        this.commandPaletteActiveIdx = 0;
      }

      let currentGroup = '';
      const chunks: string[] = [];
      filtered.forEach((item, idx) => {
        if (item.group !== currentGroup) {
          currentGroup = item.group;
          chunks.push(`<div class="command-group-label">${this.escapeHtml(currentGroup)}</div>`);
        }
        chunks.push(`
          <button
            type="button"
            class="command-item-btn ${idx === this.commandPaletteActiveIdx ? 'active' : ''}"
            data-cmd-id="${item.id}"
            data-cmd-index="${idx}"
            ${item.disabled ? 'disabled' : ''}
          >
            <span class="command-item-lead">
              ${item.icon}
              <span>${this.escapeHtml(item.label)}</span>
            </span>
            ${item.shortcut ? `<kbd class="kbd-badge">${this.escapeHtml(item.shortcut)}</kbd>` : ''}
          </button>
        `);
      });
      listEl.innerHTML = chunks.join('');

      listEl.querySelectorAll('.command-item-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cmdId = (btn as HTMLElement).dataset.cmdId;
          const cmd = allItems.find((item) => item.id === cmdId);
          if (!cmd || cmd.disabled) return;
          cleanup();
          cmd.run();
        });
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) {
        e.preventDefault();
        cleanup();
        return;
      }
      const filtered = getFilteredItems();
      if (filtered.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.commandPaletteActiveIdx = (this.commandPaletteActiveIdx + 1) % filtered.length;
        renderList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.commandPaletteActiveIdx = (this.commandPaletteActiveIdx - 1 + filtered.length) % filtered.length;
        renderList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = filtered[this.commandPaletteActiveIdx];
        if (chosen && !chosen.disabled) {
          cleanup();
          chosen.run();
        }
      }
    };

    this.isModalOpen = true;
    this.isCommandPaletteOpen = true;
    this.activeModalClose = cleanup;
    window.addEventListener('keydown', onKeyDown);

    host.innerHTML = `
      <div class="command-palette-backdrop" id="command-palette-backdrop">
        <div class="command-palette-modal" role="dialog" aria-modal="true" aria-label="${this.escapeHtml(t('toolbar.commandPaletteTitle'))}">
          <div class="command-palette-search">
            ${Icons.search}
            <input
              type="text"
              class="command-palette-input"
              id="command-palette-input"
              value="${this.escapeHtml(this.commandPaletteQuery)}"
              placeholder="${this.escapeHtml(t('cmd.placeholder'))}"
              autocomplete="off"
            />
            <kbd class="kbd-badge">Esc</kbd>
          </div>
          <div class="command-palette-list" id="command-palette-list"></div>
        </div>
      </div>
    `;

    renderList();

    const searchInput = host.querySelector('#command-palette-input') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
      this.commandPaletteQuery = searchInput.value;
      this.commandPaletteActiveIdx = 0;
      renderList();
    });

    host.querySelector('#command-palette-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'command-palette-backdrop') {
        cleanup();
      }
    });

    searchInput?.focus();
  }

  public openShortcutsHelpModal(): void {
    this.activeModalClose?.();
    const host = (this.root.querySelector('#shortcuts-modal-host') ||
      this.root.querySelector('#choice-modal-host')) as HTMLElement | null;
    if (!host) return;

    const prevFocused = document.activeElement as HTMLElement | null;
    let isClosed = false;

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      this.isModalOpen = false;
      this.activeModalClose = null;
      window.removeEventListener('keydown', onKeyDown);
      host.innerHTML = '';
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        cleanup();
      }
    };

    this.isModalOpen = true;
    this.activeModalClose = cleanup;
    window.addEventListener('keydown', onKeyDown);

    host.innerHTML = `
      <div class="reel-cue-modal-backdrop" id="shortcuts-modal-backdrop">
        <div class="choice-modal shortcuts-modal" role="dialog" aria-modal="true" aria-label="${this.escapeHtml(t('shortcuts.modalAria'))}">
          <div class="reel-cue-modal-header">
            <div class="reel-modal-header-lead">
              ${Icons.keyboard}
              <span class="reel-modal-title">${t('shortcuts.title')}</span>
            </div>
            <button class="icon-btn" id="btn-shortcuts-close" aria-label="${this.escapeHtml(t('presenter.close'))}">${Icons.close}</button>
          </div>
          <div class="choice-modal-body shortcuts-grid">
            <div class="shortcuts-section">
              <div class="shortcuts-section-title">${t('shortcuts.studioSection')}</div>
              <div class="shortcut-row"><span>${t('shortcuts.undo')}</span><kbd class="kbd-badge">Ctrl + Z</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.redo')}</span><kbd class="kbd-badge">Ctrl + Y</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.duplicate')}</span><kbd class="kbd-badge">Ctrl + D</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.delete')}</span><kbd class="kbd-badge">Delete</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.selectAll')}</span><kbd class="kbd-badge">Ctrl + A</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.saveOpen')}</span><kbd class="kbd-badge">Ctrl + S / O</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.startPresenter')}</span><kbd class="kbd-badge">F5</kbd></div>
            </div>
            <div class="shortcuts-section">
              <div class="shortcuts-section-title">${t('shortcuts.presenterSection')}</div>
              <div class="shortcut-row"><span>${t('shortcuts.next')}</span><kbd class="kbd-badge">Space / → / Enter / N</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.prev')}</span><kbd class="kbd-badge">← / Backspace / P</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.notes')}</span><kbd class="kbd-badge">S</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.resetTimer')}</span><kbd class="kbd-badge">T</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.grid')}</span><kbd class="kbd-badge">G</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.blackWhite')}</span><kbd class="kbd-badge">B / W</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.laser')}</span><kbd class="kbd-badge">Ctrl + L</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.jumpNum')}</span><kbd class="kbd-badge">0–9 + Enter</kbd></div>
              <div class="shortcut-row"><span>${t('shortcuts.exit')}</span><kbd class="kbd-badge">Esc</kbd></div>
            </div>
          </div>
          <div class="reel-cue-modal-footer">
            <span class="prop-subtext">${t('shortcuts.footerHint')}</span>
            <button class="btn btn-prominent" id="btn-shortcuts-done" type="button">${t('shortcuts.doneBtn')}</button>
          </div>
        </div>
      </div>
    `;

    host.querySelector('#btn-shortcuts-close')?.addEventListener('click', cleanup);
    host.querySelector('#btn-shortcuts-done')?.addEventListener('click', cleanup);
    host.querySelector('#shortcuts-modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'shortcuts-modal-backdrop') {
        cleanup();
      }
    });
    (host.querySelector('#btn-shortcuts-done') as HTMLElement | null)?.focus();
  }

  public closeShortcutsHelpModal(): void {
    const backdrop = this.root.querySelector('#shortcuts-modal-backdrop');
    if (backdrop) {
      this.activeModalClose?.();
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
