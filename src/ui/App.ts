import {
  AspectRatioOption,
  EngineStatus,
  FallbackTransitionStyle,
  FitMode,
  MediaAsset,
  MediaKind,
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
import {
  OpenedProjectDescriptor,
  RegisteredMediaDescriptor,
  StreamingSavePayload,
  StreamingSaveResult,
  projectFiles,
} from '../core/services/ProjectFileService';
import {
  clearUnpinnedRecentSessions,
  listRecentSessions,
  RecentSessionEntry,
  recordRecentSession,
  removeRecentSession,
  revealRecentSessionInFolder,
  togglePinRecentSession,
} from '../core/services/RecentSessionsService';
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
import { ComponentScope, escapeHtml } from './core/ComponentLifecycle';
import { LayerStack } from './core/LayerStack';
import {
  computeLayoutPlan,
  computeStageFrameSize,
  FocusPaneTab,
  LayoutPlan,
} from './layout/LayoutGovernor';
import type { PresenterWindowPayload, SerializedBlobAsset } from './components/PresenterWindowApp';
import {
  renderWindowToolbarView,
  syncToolbarUndoRedoState as syncToolbarUndoRedoView,
} from './components/ToolbarView';
import { renderEmptyStageView } from './components/EmptyStageView';
import {
  closeActiveAppleMenu,
  enhanceAppleSelects,
  openAppleMenu,
} from './components/AppleDropdown';
import {
  renderStageHudView,
  resetStageHudStructure,
} from './components/StageHudView';
import {
  renderTimelineDockView,
  syncTimelineDockActiveView,
  syncTimelineDockCollapseView,
} from './components/TimelineDockView';
import {
  SurgicalAiScope,
} from './components/SurgicalAiPromptView';
import {
  openSlideContextMenuView,
} from './components/SlideContextMenu';
import {
  openCommandPaletteModal,
  StudioCommandItem,
} from './modals/CommandPaletteModal';
import { openShortcutsHelpModalView } from './modals/ShortcutsHelpModal';
import { FALLBACK_APP_VERSION, openAboutModalView } from './modals/AboutModal';
import {
  openDeckDiagnosticsModal,
  openEnginePreferencesModal,
  openIdleLoopModal,
  openStageSettingsPopover,
  openSurgicalAiModal,
  openTransitionTrimModal,
  SequenceLayoutPreference,
} from './modals/WorkspaceModals';
import { Icons } from './icons';
import { getStudioSkin, STUDIO_SKINS, StudioSkinId } from './skins';
import {
  cycleThemePreference,
  detectInitialTheme,
  getThemePreference,
  selectStudioSkin,
  setThemePreference,
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
      getWindowState?: () => Promise<{
        mode: string;
        isFullScreen: boolean;
        isMaximized: boolean;
        isMinimized: boolean;
        zoomFactor: number;
        presenterOpen?: boolean;
        presenterDisplayId?: number | null;
      }>;
      onWindowState?: (
        callback: (state: {
          mode: string;
          isFullScreen: boolean;
          isMaximized: boolean;
          isMinimized: boolean;
          zoomFactor: number;
          presenterOpen?: boolean;
          presenterDisplayId?: number | null;
        }) => void
      ) => () => void;
      setZoomFactor?: (factor: number) => Promise<number>;
      stepZoom?: (direction: number) => Promise<number>;
      resetZoom?: () => Promise<number>;
      getDisplays?: () => Promise<
        Array<{
          id: number;
          label: string;
          isPrimary: boolean;
          isStudioDisplay: boolean;
        }>
      >;
      reloadStudio?: () => Promise<boolean>;
      openPresenterWindow?: (payload: PresenterWindowPayload) => Promise<{
        ok: boolean;
        displayId: number | null;
        dualDisplay: boolean;
      }>;
      closePresenterWindow?: () => Promise<boolean>;
      setPresenterDisplay?: (displayId: number | null) => Promise<{ ok: boolean; displayId: number | null }>;
      sendPresenterCommand?: (command: { type: string; slideIndex?: number }) => Promise<boolean>;
      onPresenterStatus?: (
        callback: (status: {
          slideIndex: number;
          totalSlides?: number;
          phase?: string;
          isBlank?: boolean;
          open?: boolean;
        }) => void
      ) => () => void;
      onPresenterClosed?: (callback: (info: { slideIndex?: number }) => void) => () => void;
      getAppVersion?: () => Promise<string>;
      getSystemLocale?: () => Promise<'ar' | 'en'>;
      setLanguage?: (lang: 'ar' | 'en') => Promise<'ar' | 'en'>;
      setTheme?: (theme: 'system' | 'dark' | 'light') => Promise<'dark' | 'light'>;
      openProjectStreamedDialog?: () => Promise<OpenedProjectDescriptor | null>;
      openProjectByPath?: (filePath: string) => Promise<OpenedProjectDescriptor>;
      openDemoProject?: () => Promise<OpenedProjectDescriptor | null>;
      saveProjectStreamed?: (payload: StreamingSavePayload) => Promise<StreamingSaveResult | null>;
      closeProjectToken?: (projectToken: string) => Promise<void>;
      onSaveProgress?: (
        callback: (progress: {
          bytesWritten: number;
          totalBytes: number;
          percent: number;
          currentFile: string;
        }) => void
      ) => () => void;
      openMediaPathsDialog?: () => Promise<RegisteredMediaDescriptor[] | null>;
      registerMediaPaths?: (pathsList: string[]) => Promise<RegisteredMediaDescriptor[]>;
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
      consumePendingProjectFile?: () => Promise<
        (OpenedProjectDescriptor & { buffer?: ArrayBuffer }) | null
      >;
      onOpenProjectFile?: (
        callback: (payload: OpenedProjectDescriptor & { buffer?: ArrayBuffer }) => void
      ) => void;
      openMediaDialog?: () => Promise<Array<{ fileName: string; mimeType: string; buffer: ArrayBuffer }> | null>;
      onMenuCommand?: (callback: (command: string) => void) => void;
      getPathForFile?: (file: File) => string | null;
      listRecentProjects?: () => Promise<RecentSessionEntry[]>;
      upsertRecentProject?: (entry: Partial<RecentSessionEntry> & { filePath: string }) => Promise<RecentSessionEntry[]>;
      togglePinRecentProject?: (filePath: string) => Promise<RecentSessionEntry[]>;
      removeRecentProject?: (filePath: string) => Promise<RecentSessionEntry[]>;
      clearRecentProjects?: () => Promise<RecentSessionEntry[]>;
      revealRecentProject?: (filePath: string) => Promise<boolean>;
    };
  }
}

const SEQUENCE_LAYOUT_STORAGE_KEY = 'mpres_sequence_layout_v1';

export class MotionPresentationApp {
  private root: HTMLElement;
  private store: PresentationStore;

  private previewCanvas!: HTMLCanvasElement;
  private previewEngine!: StagePlaybackEngine;
  private latestEngineStatus!: EngineStatus;

  private isNavigatorVisible = false;
  private isInspectorVisible = true;
  private isInspectorOverlayMode = false;
  private sequenceLayoutPref: SequenceLayoutPreference = 'auto';
  private isStageOverviewOpen = false;
  private isSkinPopoverOpen = false;
  private skinPopoverFromRail = false;
  private isStageSettingsOpen = false;
  private navigatorWidth = 264;
  private inspectorWidth = 280;
  private readonly defaultNavigatorWidth = 264;
  private readonly defaultInspectorWidth = 280;
  private readonly minNavigatorWidth = 200;
  private readonly maxNavigatorWidth = 440;
  private readonly minInspectorWidth = 240;
  private readonly maxInspectorWidth = 440;
  private isPresentingFullscreen = false;
  private isSlideGridOpen = false;
  private isGeneratingDemo = false;
  private isSavingProject = false;
  private aiEditDraftInstruction = '';
  private aiEditScopeOverride: SurgicalAiScope | null = null;
  private currentProjectFilePath: string | null = null;
  private recentSessions: RecentSessionEntry[] = [];
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
  private readonly rootScope = new ComponentScope();
  private readonly toolbarScope = this.rootScope.createChildScope();
  private readonly activityRailScope = this.rootScope.createChildScope();
  private readonly overviewGridScope = this.rootScope.createChildScope();
  private readonly skinPopoverScope = this.rootScope.createChildScope();
  private readonly emptyStageScope = this.rootScope.createChildScope();
  private readonly stageHudScope = this.rootScope.createChildScope();
  private readonly timelineDockScope = this.rootScope.createChildScope();
  private readonly inspectorSelectsScope = this.rootScope.createChildScope();
  private readonly reelSelectsScope = this.rootScope.createChildScope();
  private readonly contextMenuScope = this.rootScope.createChildScope();
  private readonly modalScope = this.rootScope.createChildScope();
  private readonly workspaceModalScope = this.rootScope.createChildScope();
  private readonly stagePopoverScope = this.rootScope.createChildScope();
  private readonly layerStack = new LayerStack();
  private currentZoomFactor = 1.0;
  private lastLayoutPlan: LayoutPlan | null = null;
  private focusPaneTab: FocusPaneTab = 'stage';
  private resizeRafId: number | null = null;
  private presentEpoch = 0;
  private isPresenterEnteringWindow = false;
  private isDedicatedPresenterOpen = false;
  private presenterConsoleStatus: {
    slideIndex: number;
    totalSlides: number;
    isBlank?: boolean;
  } | null = null;

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
    this.loadSequenceLayoutPref();
    this.mountInitialShell();
    this.applyPanelWidths(false);
    this.bindPaneResizers();
    this.bindViewportResizeSync();
    this.bindDesktopWindowSync();
    this.bindGlobalShortcuts();
    this.bindNativeMenuCommands();
    this.bindDesktopProjectOpenEvents();
    this.store.subscribe((changeType) => this.onStoreUpdated(changeType));
    this.onStoreUpdated();
    void this.refreshRecentSessions();
    void this.syncDesktopLanguageAndLocale(initialLang);
    void this.consumeInitialProjectFile();
  }

  public dispose(): void {
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }
    this.activeModalClose?.();
    this.closeStageSettingsPopover();
    this.closeSlideContextMenu();
    closeActiveAppleMenu();
    this.workspaceModalScope.clear();
    this.stagePopoverScope.clear();
    this.rootScope.dispose();
    this.previewEngine?.destroy?.();
    this.presenterEngine?.destroy?.();
    if (this.isDedicatedPresenterOpen) {
      void window.desktopAPI?.closePresenterWindow?.();
      this.isDedicatedPresenterOpen = false;
    }
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

  private loadSequenceLayoutPref(): void {
    try {
      const saved = this.getLocalStorageSafe()?.getItem(SEQUENCE_LAYOUT_STORAGE_KEY);
      if (saved === 'auto' || saved === 'bottom' || saved === 'side' || saved === 'hidden') {
        this.sequenceLayoutPref = saved;
      }
    } catch {
      // Ignore storage errors
    }
    this.isNavigatorVisible = this.sequenceLayoutPref === 'side';
  }

  private setSequenceLayoutPreference(pref: SequenceLayoutPreference): void {
    this.sequenceLayoutPref = pref;
    if (pref === 'bottom') {
      this.isTimelineDockCollapsed = false;
    }
    try {
      this.getLocalStorageSafe()?.setItem(SEQUENCE_LAYOUT_STORAGE_KEY, pref);
    } catch {
      // Ignore storage errors
    }
    this.reconcileWorkspaceLayout();
    this.renderWindowToolbar();
    this.renderActivityRail();
    this.renderNavigatorPane();
    this.renderStudioTimelineDock();
    this.handleViewportResize();
  }

  private resolveEffectiveSequenceMode(
    splitWidth: number,
    splitHeight: number
  ): 'bottom' | 'side' | 'hidden' {
    const slides = this.store.getSlides();
    if (slides.length === 0) return 'hidden';

    const ratio = this.store.getSettings().aspectRatio;
    const pref = this.sequenceLayoutPref;

    if (pref === 'hidden') return 'hidden';

    if (pref === 'bottom') {
      if (splitHeight > 0 && splitHeight < 430) {
        return splitWidth >= 880 ? 'side' : 'hidden';
      }
      return 'bottom';
    }

    if (pref === 'side') {
      if (splitWidth > 0 && splitWidth < 740) {
        return splitHeight >= 480 ? 'bottom' : 'hidden';
      }
      return 'side';
    }

    // 'auto' mode: adapt intelligently to slide aspect ratio + window geometry
    if (splitWidth > 0 && splitHeight > 0) {
      if (splitWidth < 640 && splitHeight < 500) {
        return 'hidden';
      }
      if (ratio === '9:16' && splitWidth >= 780) {
        return 'side';
      }
      if (splitHeight < 520 && splitWidth >= 880) {
        return 'side';
      }
      return 'bottom';
    }

    return this.isNavigatorVisible ? 'side' : 'bottom';
  }

  private reconcileWorkspaceLayout(): void {
    const splitView = this.root.querySelector('.split-view') as HTMLElement | null;
    if (!splitView) return;

    const rect = splitView.getBoundingClientRect?.();
    const vw = window?.innerWidth || 1280;
    const vh = window?.innerHeight || 720;
    const splitW = rect?.width && rect.width > 0 ? rect.width : vw;
    const splitH = rect?.height && rect.height > 0 ? rect.height : Math.max(240, vh - 44);
    const slides = this.store.getSlides();

    if (slides.length === 0) {
      this.isInspectorOverlayMode = false;
      splitView.classList.remove(
        'is-inspector-overlay',
        'is-inspector-sheet',
        'is-focus-mode',
        'is-compact-height',
        'is-compact-width'
      );
      splitView.removeAttribute('data-focus-tab');
      const focusBar = this.root.querySelector('#focus-mode-bar') as HTMLElement | null;
      if (focusBar) focusBar.style.display = 'none';
      const emptyPlan = computeLayoutPlan({
        viewportWidth: vw,
        viewportHeight: vh,
        isRtl: isRtlLanguage(),
        requestedSequenceMode: 'collapsed',
        requestedNavigatorOpen: false,
        requestedInspectorOpen: false,
        floatingSequenceSize: { width: 620, height: 176 },
        inspectorWidth: this.inspectorWidth,
        previousFocusMode: this.lastLayoutPlan?.focusMode,
        previousToolbarTier: this.lastLayoutPlan?.toolbarTier,
      });
      if (this.lastLayoutPlan?.toolbarTier !== emptyPlan.toolbarTier) {
        this.lastLayoutPlan = emptyPlan;
        const toolbar = this.root.querySelector('#window-toolbar') as HTMLElement | null;
        if (toolbar) toolbar.dataset.toolbarTier = emptyPlan.toolbarTier;
      } else {
        this.lastLayoutPlan = emptyPlan;
      }
      return;
    }

    const effectiveSeq = this.resolveEffectiveSequenceMode(splitW, splitH);
    const plan = computeLayoutPlan({
      viewportWidth: vw,
      viewportHeight: vh,
      isRtl: isRtlLanguage(),
      requestedSequenceMode: effectiveSeq === 'bottom' ? 'docked' : 'collapsed',
      requestedNavigatorOpen: effectiveSeq === 'side',
      requestedInspectorOpen: this.isInspectorVisible,
      floatingSequenceSize: { width: 620, height: 176 },
      inspectorWidth: this.inspectorWidth,
      previousFocusMode: this.lastLayoutPlan?.focusMode,
      previousToolbarTier: this.lastLayoutPlan?.toolbarTier,
    });
    const prevToolbarTier = this.lastLayoutPlan?.toolbarTier;
    this.lastLayoutPlan = plan;

    if (plan.focusMode) {
      splitView.classList.add('is-focus-mode');
      splitView.setAttribute('data-focus-tab', this.focusPaneTab);
      this.renderFocusModeBar(true);
    } else {
      splitView.classList.remove('is-focus-mode');
      splitView.removeAttribute('data-focus-tab');
      this.focusPaneTab = 'stage';
      this.renderFocusModeBar(false);
    }

    const shouldShowSideNav = plan.focusMode
      ? this.focusPaneTab === 'slides'
      : effectiveSeq === 'side';
    const shouldShowBottomDock = !plan.focusMode && effectiveSeq === 'bottom';

    this.isNavigatorVisible = effectiveSeq === 'side' && !plan.focusMode;

    const navPane = this.root.querySelector('#navigator-pane') as HTMLElement | null;
    const navResizer = this.root.querySelector('#navigator-resizer') as HTMLElement | null;
    navPane?.classList.toggle('collapsed', !shouldShowSideNav);
    navResizer?.classList.toggle('collapsed', plan.focusMode || !shouldShowSideNav);

    const dock = this.root.querySelector('#studio-timeline-dock') as HTMLElement | null;
    if (dock) {
      dock.classList.toggle('hidden', !shouldShowBottomDock);
      dock.classList.toggle('is-collapsed', this.isTimelineDockCollapsed);
    }

    const stagePane = this.root.querySelector('#stage-pane') as HTMLElement | null;
    const compactHeight = splitH > 0 && splitH < 640;
    const compactWidth = splitW > 0 && splitW < 760;
    splitView.classList.toggle('is-compact-height', compactHeight);
    splitView.classList.toggle('is-compact-width', compactWidth);
    stagePane?.classList.toggle('is-compact-height', compactHeight);

    const toolbar = this.root.querySelector('#window-toolbar') as HTMLElement | null;
    if (toolbar) {
      toolbar.dataset.toolbarTier = plan.toolbarTier;
    } else if (prevToolbarTier && prevToolbarTier !== plan.toolbarTier) {
      this.renderWindowToolbar();
    }

    const restoreBtn = this.root.querySelector('#btn-stage-show-sequence') as HTMLElement | null;
    if (restoreBtn) {
      restoreBtn.style.display = !plan.focusMode && effectiveSeq === 'hidden' ? 'inline-flex' : 'none';
    }
  }

  private renderFocusModeBar(visible: boolean): void {
    const bar = this.root.querySelector('#focus-mode-bar') as HTMLElement | null;
    if (!bar) return;
    if (!visible) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const tabs: Array<{ id: FocusPaneTab; label: string }> = [
      { id: 'stage', label: t('focus.tabStage') },
      { id: 'slides', label: t('focus.tabSlides') },
      { id: 'inspector', label: t('focus.tabInspector') },
    ];
    bar.innerHTML = `
      <div class="focus-mode-segmented" role="tablist">
        ${tabs
          .map(
            (tab) => `<button
              type="button"
              role="tab"
              aria-selected="${this.focusPaneTab === tab.id ? 'true' : 'false'}"
              class="focus-mode-tab ${this.focusPaneTab === tab.id ? 'active' : ''}"
              data-focus-tab-btn="${tab.id}"
            >${this.escapeHtml(tab.label)}</button>`
          )
          .join('')}
      </div>
    `;
    bar.querySelectorAll('[data-focus-tab-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextTab = (btn as HTMLElement).dataset.focusTabBtn as FocusPaneTab | undefined;
        if (nextTab) {
          this.setFocusPaneTab(nextTab);
        }
      });
    });
  }

  private setFocusPaneTab(tab: FocusPaneTab): void {
    this.focusPaneTab = tab;
    const splitView = this.root.querySelector('.split-view') as HTMLElement | null;
    splitView?.setAttribute('data-focus-tab', tab);
    if (tab === 'inspector') {
      this.isInspectorVisible = true;
      this.root.querySelector('#inspector-pane')?.classList.remove('collapsed');
      this.renderInspectorPane();
    } else if (tab === 'slides') {
      this.renderNavigatorPane();
    }
    this.reconcileWorkspaceLayout();
    this.applyPanelWidths(false);
    this.updateCanvasFrameDimensions(this.store.getSettings());
  }

  private getResponsivePanelWidths(splitView: HTMLElement | null): {
    navigatorWidth: number;
    inspectorWidth: number;
    overlayInspector: boolean;
    sheetInspector: boolean;
  } {
    let navW = this.navigatorWidth;
    let inspW = this.inspectorWidth;
    let overlayInspector = false;
    let sheetInspector = false;

    const splitWidth = splitView?.getBoundingClientRect?.().width || 0;
    const vw = window?.innerWidth || splitWidth || 1280;
    const focusMode = Boolean(this.lastLayoutPlan?.focusMode);

    if (focusMode) {
      return {
        navigatorWidth: navW,
        inspectorWidth: Math.min(vw, 480),
        overlayInspector: this.focusPaneTab === 'inspector',
        sheetInspector: this.focusPaneTab === 'inspector',
      };
    }

    if (splitWidth > 0 && !splitView?.classList.contains('is-deck-empty')) {
      const compactW = splitWidth < 760;
      const railWidth = compactW ? 0 : 42;
      const guaranteedStageWidth = Math.min(
        splitWidth - railWidth - 20,
        Math.max(420, Math.floor(splitWidth * 0.60))
      );
      const budget = Math.max(0, splitWidth - railWidth - guaranteedStageWidth);
      const activeNav = this.isNavigatorVisible ? navW : 0;
      const activeInsp = this.isInspectorVisible ? inspW : 0;

      if (activeNav + activeInsp > budget) {
        if (this.isInspectorVisible && activeNav + this.minInspectorWidth > budget) {
          overlayInspector = true;
          sheetInspector = false;
          inspW = Math.min(inspW, Math.max(260, Math.min(320, splitWidth - 28)));
        }

        const remainingActiveNav = this.isNavigatorVisible ? navW : 0;
        const remainingActiveInsp = this.isInspectorVisible && !overlayInspector ? inspW : 0;
        const remainingTotal = remainingActiveNav + remainingActiveInsp;

        if (remainingTotal > budget && remainingTotal > 0) {
          const scale = budget / remainingTotal;
          if (this.isNavigatorVisible) {
            navW = Math.max(180, Math.floor(navW * scale));
          }
          if (this.isInspectorVisible && !overlayInspector) {
            inspW = Math.max(220, Math.floor(inspW * scale));
          }
        }
      }
    }

    return { navigatorWidth: navW, inspectorWidth: inspW, overlayInspector, sheetInspector };
  }

  private applyPanelWidths(persist = false): void {
    const splitView = this.root.querySelector('.split-view') as HTMLElement | null;
    const effective = this.getResponsivePanelWidths(splitView);
    const wasOverlay = this.isInspectorOverlayMode;
    this.isInspectorOverlayMode = effective.overlayInspector;

    if (splitView) {
      splitView.style?.setProperty?.('--navigator-width', `${effective.navigatorWidth}px`);
      splitView.style?.setProperty?.('--inspector-width', `${effective.inspectorWidth}px`);
      splitView.classList.toggle('is-inspector-overlay', effective.overlayInspector);
      splitView.classList.toggle('is-inspector-sheet', effective.sheetInspector);
    }

    const inspPane = this.root.querySelector('#inspector-pane') as HTMLElement | null;
    inspPane?.classList.toggle('is-overlay-drawer', effective.overlayInspector);
    inspPane?.classList.toggle('is-sheet-drawer', effective.sheetInspector);
    if (this.lastLayoutPlan?.focusMode) {
      inspPane?.classList.toggle('collapsed', this.focusPaneTab !== 'inspector');
    } else {
      inspPane?.classList.toggle('collapsed', !this.isInspectorVisible);
    }

    const navResizer = this.root.querySelector('#navigator-resizer') as HTMLElement | null;
    if (navResizer) {
      navResizer.setAttribute('aria-valuenow', String(this.navigatorWidth));
      navResizer.classList.toggle('collapsed', !this.isNavigatorVisible);
    }

    const inspResizer = this.root.querySelector('#inspector-resizer') as HTMLElement | null;
    if (inspResizer) {
      inspResizer.setAttribute('aria-valuenow', String(this.inspectorWidth));
      inspResizer.classList.toggle('collapsed', !this.isInspectorVisible || effective.overlayInspector);
    }

    if (wasOverlay !== effective.overlayInspector && this.isInspectorVisible) {
      this.renderInspectorPane();
    }

    if (persist) {
      this.savePanelWidths();
    }
  }

  private scheduleViewportResize(): void {
    if (typeof requestAnimationFrame !== 'function') {
      this.handleViewportResize();
      return;
    }
    if (this.resizeRafId !== null) return;
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = null;
      this.handleViewportResize();
    });
  }

  private handleViewportResize(): void {
    this.reconcileWorkspaceLayout();
    this.applyPanelWidths(false);
    this.updateCanvasFrameDimensions(this.store.getSettings());
    this.previewEngine?.resize?.();
  }

  private bindViewportResizeSync(): void {
    this.rootScope.listen(window, 'resize', () => {
      this.scheduleViewportResize();
    });

    if (typeof ResizeObserver !== 'undefined') {
      const areaEl = this.root.querySelector('.stage-canvas-area') as HTMLElement | null;
      const splitView = this.root.querySelector('.split-view') as HTMLElement | null;
      const observer = new ResizeObserver(() => {
        this.scheduleViewportResize();
      });
      if (areaEl) observer.observe(areaEl);
      if (splitView) observer.observe(splitView);
      this.rootScope.addCleanup(() => observer.disconnect());
    }
  }

  private bindDesktopWindowSync(): void {
    const api = window.desktopAPI;
    if (!api) return;

    void api.getWindowState?.()?.then?.((state) => {
      if (state && typeof state.zoomFactor === 'number') {
        this.currentZoomFactor = state.zoomFactor;
        this.renderWindowToolbar();
      }
    }).catch?.(() => {});

    const unsubState = api.onWindowState?.((state) => {
      if (!state) return;
      if (typeof state.zoomFactor === 'number' && Math.abs(state.zoomFactor - this.currentZoomFactor) > 0.005) {
        this.currentZoomFactor = state.zoomFactor;
        this.renderWindowToolbar();
        this.scheduleViewportResize();
      }
      if (
        this.isPresentingFullscreen &&
        !this.isDedicatedPresenterOpen &&
        !this.isPresenterEnteringWindow &&
        !state.isFullScreen
      ) {
        void this.exitFullscreenPresentation();
      }
    });
    if (unsubState) this.rootScope.addCleanup(unsubState);

    const unsubStatus = api.onPresenterStatus?.((status) => {
      if (!status) return;
      this.presenterConsoleStatus = {
        slideIndex: status.slideIndex ?? 0,
        totalSlides: status.totalSlides ?? this.store.getSlides().length,
        isBlank: status.isBlank,
      };
      if (this.isDedicatedPresenterOpen) {
        this.renderPresenterConsoleBanner();
      }
    });
    if (unsubStatus) this.rootScope.addCleanup(unsubStatus);

    const unsubClosed = api.onPresenterClosed?.((info) => {
      if (!this.isDedicatedPresenterOpen) return;
      const lastIdx = typeof info?.slideIndex === 'number' ? info.slideIndex : 0;
      void this.handleDedicatedPresenterClosed(lastIdx);
    });
    if (unsubClosed) this.rootScope.addCleanup(unsubClosed);
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

    const hud = this.root.querySelector('#floating-stage-hud') as HTMLElement | null;
    resetStageHudStructure(hud, this.stageHudScope);

    this.syncWindowTitle();
    this.renderWindowToolbar();
    this.renderActivityRail();
    this.renderNavigatorPane();
    this.renderEmptyOverlay();
    this.renderStageOverviewGrid();
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
    this.renderActivityRail();
    this.renderInspectorPane();
    this.store.notify(
      t('notify.themeSwitched', { theme: t(`theme.${next}`) }),
      'info',
      1800
    );
  }

  private mountInitialShell(): void {
    this.root.innerHTML = `
      <header class="window-toolbar" id="window-toolbar" role="toolbar" aria-label="${this.escapeHtml(t('shell.toolbarAria'))}"></header>
      <main class="split-view is-deck-empty">
        <nav class="activity-rail" id="activity-rail" aria-label="Workspace tools"></nav>
        <aside class="navigator-pane collapsed" id="navigator-pane" aria-label="${this.escapeHtml(t('shell.navigatorAria'))}"></aside>
        <div
          class="pane-resizer pane-resizer-navigator collapsed"
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
          <div class="focus-mode-bar" id="focus-mode-bar" style="display:none;"></div>
          <div class="presenter-console-banner hidden" id="presenter-console-banner" role="region"></div>
          <div class="stage-canvas-area">
            <div class="stage-canvas-frame" id="canvas-frame">
              <canvas class="stage-canvas" id="preview-canvas"></canvas>
            </div>
            <div class="stage-overview-grid" id="stage-overview-grid" style="display:none;"></div>
            <div class="stage-drop-overlay" id="stage-drop-overlay">
              ${Icons.folderImport}
              <span>${this.escapeHtml(t('shell.dropOverlayText'))}</span>
            </div>
            <div class="empty-canvas-sheet" id="empty-overlay" style="display:none;"></div>
            <div class="floating-stage-hud" id="floating-stage-hud" role="region" aria-label="${this.escapeHtml(t('shell.hudAria'))}"></div>
            <button type="button" class="btn stage-restore-seq-btn" id="btn-stage-show-sequence" style="display:none;" title="${escapeHtml(t('toolbar.showSlidesTitle'))}">
              ${Icons.timelineDock}
              <span>${escapeHtml(t('layout.restoreSequence'))}</span>
            </button>
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
      <div id="skin-popover-host"></div>
      <div id="stage-popover-host"></div>
      <div id="workspace-modal-host"></div>
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

    this.rootScope.listen(this.root.querySelector('#btn-stage-show-sequence'), 'click', () => {
      this.setSequenceLayoutPreference('bottom');
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
      this.reconcileWorkspaceLayout();
      this.applyPanelWidths(false);
      this.updateCanvasFrameDimensions(settings);
      this.previewEngine.updateSettingsLive(settings);
      this.presenterEngine?.updateSettingsLive(settings);
      this.syncToolbarUndoRedoState();
      this.renderInspectorPane();
      return;
    }

    // Structural changes (slides added/removed, full project loaded)
    const slides = this.store.getSlides();
    const splitViewEl = this.root.querySelector('.split-view') as HTMLElement | null;
    splitViewEl?.classList.toggle('is-deck-empty', slides.length === 0);
    if (slides.length === 0) {
      this.isStageOverviewOpen = false;
    }

    this.reconcileWorkspaceLayout();
    this.applyPanelWidths(false);
    this.renderWindowToolbar();
    this.renderActivityRail();
    this.renderNavigatorPane();
    this.renderEmptyOverlay();
    this.renderStageOverviewGrid();
    this.renderStudioTimelineDock();
    this.renderInspectorPane();
    this.renderToast();

    const settings = this.store.getSettings();
    const targetIdx = this.store.getActivePreviewIndex();

    this.updateCanvasFrameDimensions(settings);
    this.previewEngine.updateSettingsLive(settings);
    await this.previewEngine.loadProject(slides, settings, targetIdx);
  }

  private updateCanvasFrameDimensions(settings: PresentationSettings): void {
    const frameEl = this.root.querySelector('#canvas-frame') as HTMLElement | null;
    if (!frameEl) return;
    const ratioMap: Record<AspectRatioOption, { css: string; num: number }> = {
      '16:9': { css: '16 / 9', num: 16 / 9 },
      '16:10': { css: '16 / 10', num: 16 / 10 },
      '4:3': { css: '4 / 3', num: 4 / 3 },
      '9:16': { css: '9 / 16', num: 9 / 16 },
    };
    const r = ratioMap[settings.aspectRatio as AspectRatioOption] || ratioMap['16:9'];
    frameEl.style.aspectRatio = r.css;

    const areaEl = this.root.querySelector('.stage-canvas-area') as HTMLElement | null;
    if (areaEl && typeof window.getComputedStyle === 'function') {
      const rect = areaEl.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) {
        const cs = window.getComputedStyle(areaEl);
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const sized = computeStageFrameSize({
          containerWidth: rect.width,
          containerHeight: rect.height,
          aspectRatio: r.num,
          padHorizontal: padX,
          padVertical: padY,
          hudReservedPx: 0,
          fillRatio: 1,
        });
        frameEl.style.width = `${sized.width}px`;
        frameEl.style.height = `${sized.height}px`;
        return;
      }
    }

    const fallbackPlan = this.lastLayoutPlan;
    const safeW = fallbackPlan?.stageSafeWidth ?? Math.max(240, (window?.innerWidth || 1280) - 320);
    const safeH = fallbackPlan?.stageSafeHeight ?? Math.max(180, (window?.innerHeight || 720) - 180);
    const sized = computeStageFrameSize({
      containerWidth: safeW,
      containerHeight: safeH,
      aspectRatio: r.num,
      hudReservedPx: 64,
    });
    frameEl.style.width = `${sized.width}px`;
    frameEl.style.height = `${sized.height}px`;
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
    syncToolbarUndoRedoView(
      this.root,
      this.store.canUndo?.() ?? false,
      this.store.canRedo?.() ?? false
    );
  }

  /* =========================================================================
   * 1. INTEGRATED WINDOW TOOLBAR (Studio Design System v3.0)
   * ========================================================================= */
  private renderWindowToolbar(): void {
    const toolbar = this.root.querySelector('#window-toolbar') as HTMLElement | null;
    const project = this.store.getProject();
    const themePref = getThemePreference();

    renderWindowToolbarView(
      toolbar,
      this.toolbarScope,
      {
        projectTitle: project.title,
        hasSlides: project.slides.length > 0,
        isNavigatorVisible: this.isNavigatorVisible,
        isInspectorVisible: this.isInspectorVisible,
        isStagePopoverOpen: this.isStageSettingsOpen,
        isGeneratingDemo: this.isGeneratingDemo,
        canUndo: this.store.canUndo?.() ?? false,
        canRedo: this.store.canRedo?.() ?? false,
        themeIcon: this.getThemeIcon(themePref),
        themePref,
        zoomFactor: this.currentZoomFactor,
        toolbarTier: this.lastLayoutPlan?.toolbarTier || 'full',
        focusMode: Boolean(this.lastLayoutPlan?.focusMode),
      },
      {
        onProjectTitleChange: (title) => this.store.setProjectTitle(title),
        onToggleNavigator: () => this.toggleNavigatorPane(),
        onToggleInspector: () => this.toggleInspectorPane(),
        onOpenProject: () => {
          void this.handleOpenProject();
        },
        onImportMedia: () => {
          void this.handleImportMedia();
        },
        onOpenReelWorkflow: () => {
          void this.handleOpenReelWorkflow();
        },
        onAddSlide: () => {
          const input = this.root.querySelector('#single-image-input') as HTMLInputElement | null;
          if (input) {
            input.dataset.replaceSlideId = '';
            input.click();
          }
        },
        onGenerateDemo: () => {
          void this.handleGenerateDemo();
        },
        onSaveProject: () => {
          void this.handleSaveProject(false);
        },
        onUndo: () => {
          if (this.store.undo()) {
            this.store.notify(t('notify.undoDone'), 'info', 2000);
          }
        },
        onRedo: () => {
          if (this.store.redo()) {
            this.store.notify(t('notify.redoDone'), 'info', 2000);
          }
        },
        onOpenShortcuts: () => this.openShortcutsHelpModal(),
        onOpenCommandPalette: () => this.openCommandPalette(),
        onToggleTheme: () => this.toggleTheme(),
        onToggleLanguage: () => this.toggleLanguage(),
        onOpenStageSettings: (anchorEl) => this.toggleStageSettingsPopover(anchorEl),
        onOpenMoreMenu: (anchorEl) => this.openToolbarMoreMenu(anchorEl),
        onResetZoom: () => {
          void window.desktopAPI?.resetZoom?.();
        },
        onStartFullscreen: () => {
          void this.enterFullscreenPresentation(this.latestEngineStatus?.currentSlideIndex || 0);
        },
      }
    );
  }

  private openToolbarMoreMenu(anchorEl: HTMLElement): void {
    const hasSlides = this.store.getSlides().length > 0;
    const tier = this.lastLayoutPlan?.toolbarTier || 'full';
    const isCompactOrMinimal = tier === 'compact' || tier === 'minimal';
    const isMinimal = tier === 'minimal';
    const overflowItems: Parameters<typeof openAppleMenu>[0]['items'] = [];

    if (isMinimal) {
      overflowItems.push(
        {
          label: t('toolbar.importMedia'),
          icon: Icons.folderImport,
          shortcut: 'Ctrl+Shift+I',
          onSelect: () => {
            void this.handleImportMedia();
          },
        },
        {
          label: t('toolbar.reelWorkflow'),
          icon: Icons.filmTransition,
          shortcut: 'Ctrl+R',
          onSelect: () => {
            void this.handleOpenReelWorkflow();
          },
        },
        {
          label: t('toolbar.addSlide'),
          icon: Icons.photoPlus,
          onSelect: () => {
            const input = this.root.querySelector('#single-image-input') as HTMLInputElement | null;
            if (input) {
              input.dataset.replaceSlideId = '';
              input.click();
            }
          },
        },
        {
          label: t('toolbar.stageRatio'),
          icon: Icons.ratio,
          onSelect: () => this.toggleStageSettingsPopover(anchorEl),
        }
      );
    }

    if (isCompactOrMinimal) {
      overflowItems.push(
        {
          label: t('toolbar.undoTitle'),
          icon: Icons.undo,
          shortcut: 'Ctrl+Z',
          disabled: !(this.store.canUndo?.() ?? false),
          separatorBefore: isMinimal,
          onSelect: () => {
            if (this.store.undo()) {
              this.store.notify(t('notify.undoDone'), 'info', 2000);
            }
          },
        },
        {
          label: t('toolbar.redoTitle'),
          icon: Icons.redo,
          shortcut: 'Ctrl+Y',
          disabled: !(this.store.canRedo?.() ?? false),
          onSelect: () => {
            if (this.store.redo()) {
              this.store.notify(t('notify.redoDone'), 'info', 2000);
            }
          },
        }
      );
    }

    if (isMinimal) {
      overflowItems.push(
        {
          label: t('toolbar.themeToggleTitle'),
          icon: this.getThemeIcon(getThemePreference()),
          separatorBefore: true,
          onSelect: () => this.toggleTheme(),
        },
        {
          label: t('toolbar.langToggleTitle'),
          icon: Icons.globe,
          onSelect: () => this.toggleLanguage(),
        }
      );
    }

    const zoomItems: Parameters<typeof openAppleMenu>[0]['items'] = window.desktopAPI?.stepZoom
      ? [
          {
            label: t('zoom.inTitle'),
            icon: Icons.plus,
            shortcut: 'Ctrl+=',
            separatorBefore: true,
            onSelect: () => {
              void window.desktopAPI?.stepZoom?.(1);
            },
          },
          {
            label: t('zoom.outTitle'),
            icon: Icons.chevronDown,
            shortcut: 'Ctrl+-',
            onSelect: () => {
              void window.desktopAPI?.stepZoom?.(-1);
            },
          },
          {
            label: t('zoom.resetMenu'),
            icon: Icons.replay,
            shortcut: 'Ctrl+0',
            disabled: Math.round(this.currentZoomFactor * 100) === 100,
            onSelect: () => {
              void window.desktopAPI?.resetZoom?.();
            },
          },
        ]
      : [];

    openAppleMenu({
      anchorEl,
      align: 'end',
      minWidth: 246,
      ariaLabel: t('toolbar.moreActions'),
      items: [
        ...overflowItems,
        {
          label: t('toolbar.saveProject'),
          icon: Icons.exportDoc,
          shortcut: 'Ctrl+S',
          separatorBefore: overflowItems.length > 0,
          disabled: !hasSlides,
          onSelect: () => {
            void this.handleSaveProject(false);
          },
        },
        {
          label: t('toolbar.saveAs'),
          icon: Icons.duplicate,
          shortcut: 'Ctrl+Shift+S',
          disabled: !hasSlides,
          onSelect: () => {
            void this.handleSaveProject(true);
          },
        },
        {
          label: t('toolbar.loadDemo'),
          icon: Icons.sparkles,
          disabled: this.isGeneratingDemo,
          onSelect: () => {
            void this.handleGenerateDemo();
          },
        },
        {
          label: t('inspector.enginePrefsBtn'),
          icon: Icons.sliders,
          separatorBefore: true,
          onSelect: () => this.openEnginePrefsSheet(),
        },
        {
          label: t('inspector.deckStatsBtn'),
          icon: Icons.info,
          onSelect: () => this.openDeckStatsSheet(),
        },
        {
          label: t('toolbar.studioSkins'),
          icon: Icons.palette,
          onSelect: () => this.toggleSkinPopover(),
        },
        {
          label: t('toolbar.shortcutsTitle'),
          icon: Icons.keyboard,
          separatorBefore: true,
          onSelect: () => this.openShortcutsHelpModal(),
        },
        {
          label: t('toolbar.commandPaletteTitle'),
          icon: Icons.command,
          shortcut: 'Ctrl+K',
          onSelect: () => this.openCommandPalette(),
        },
        ...zoomItems,
        {
          label: t('toolbar.about'),
          icon: Icons.info,
          separatorBefore: true,
          onSelect: () => {
            void this.openAboutModal();
          },
        },
        {
          label: t('toolbar.closeSession'),
          icon: Icons.close,
          danger: true,
          separatorBefore: true,
          disabled: !hasSlides,
          onSelect: () => this.closeSessionToWelcome(),
        },
      ],
    });
  }

  private closeStageSettingsPopover(): void {
    this.isStageSettingsOpen = false;
    this.stagePopoverScope.clear();
    const host = this.root.querySelector('#stage-popover-host') as HTMLElement | null;
    if (host) host.innerHTML = '';
    this.root.querySelector('#btn-stage-settings')?.classList.remove('active-pane');
  }

  private toggleStageSettingsPopover(anchorEl?: HTMLElement): void {
    if (this.isStageSettingsOpen) {
      this.closeStageSettingsPopover();
      return;
    }
    const host = this.root.querySelector('#stage-popover-host') as HTMLElement | null;
    if (!host) return;
    this.isStageSettingsOpen = true;
    this.root.querySelector('#btn-stage-settings')?.classList.add('active-pane');
    openStageSettingsPopover({
      host,
      scope: this.stagePopoverScope,
      settings: this.store.getSettings(),
      sequenceLayoutPref: this.sequenceLayoutPref,
      anchorEl,
      onUpdateSettings: (partial) => this.store.updateSettings(partial),
      onChangeSequenceLayout: (pref) => this.setSequenceLayoutPreference(pref),
      onClose: () => this.closeStageSettingsPopover(),
    });
  }

  private openEnginePrefsSheet(): void {
    const host = this.root.querySelector('#workspace-modal-host') as HTMLElement | null;
    openEnginePreferencesModal({
      host,
      scope: this.workspaceModalScope,
      settings: this.store.getSettings(),
      onUpdateSettings: (partial) => this.store.updateSettings(partial),
      onClose: () => {},
    });
  }

  private openDeckStatsSheet(): void {
    const host = this.root.querySelector('#workspace-modal-host') as HTMLElement | null;
    const slides = this.store.getSlides();
    const diag = this.store.getProjectDiagnostics?.() ?? {
      slideCount: slides.length,
      videoTransitionCount: 0,
      proceduralTransitionCount: 0,
      notesCount: 0,
      estimatedDurationSec: 0,
      totalMediaBytes: 0,
    };
    const missing = this.store.getMissingVideoAssets?.() ?? [];
    openDeckDiagnosticsModal({
      host,
      scope: this.workspaceModalScope,
      diagnostics: diag,
      missingVideosCount: missing.length,
      firstMissingFileName: missing[0]?.videoFileName,
      onRelinkMissing: () => {
        if (missing[0]) this.triggerRelinkVideo(missing[0].slideIds);
      },
      onClose: () => {},
    });
  }

  private openSurgicalAiSheet(activeSlide: SlideNode, slideIdx: number, defaultScope: 'slide' | 'transition'): void {
    const host = this.root.querySelector('#workspace-modal-host') as HTMLElement | null;
    const totalSlides = this.store.getSlides().length;
    openSurgicalAiModal({
      host,
      scope: this.workspaceModalScope,
      activeSlide,
      slideIdx,
      totalSlides,
      defaultScope,
      scopeOverride: this.aiEditScopeOverride,
      draftInstruction: this.aiEditDraftInstruction,
      aiMeta: this.store.getProjectAiSourceMeta(),
      currentVideoTimeSec: this.previewEngine?.getActiveVideoTimeSec?.() ?? null,
      callbacks: {
        getAiMeta: () => this.store.getProjectAiSourceMeta(),
        setAiMeta: (meta) => this.store.setProjectAiSourceMeta(meta),
        getCurrentVideoTimeSec: () => this.previewEngine?.getActiveVideoTimeSec?.() ?? null,
        onDraftChange: (draft, scope) => {
          this.aiEditDraftInstruction = draft;
          this.aiEditScopeOverride = scope;
        },
        onNotifyCopied: () => {
          this.store.notify(t('notify.aiPromptCopied'), 'success', 2500);
        },
      },
      onClose: () => {},
    });
  }

  private closeSessionToWelcome(): void {
    if (this.store.getSlides().length === 0) return;
    this.store.clearAllSlides();
    this.currentProjectFilePath = null;
    this.syncWindowTitle();
    void this.refreshRecentSessions();
  }

  private async refreshRecentSessions(): Promise<void> {
    this.recentSessions = await listRecentSessions();
    if (this.store.getSlides().length === 0) {
      this.renderEmptyOverlay();
    }
  }

  private async captureFirstSlideThumbnailDataUrl(): Promise<string | undefined> {
    try {
      const firstSlide = this.store.getSlides()[0];
      const url = firstSlide?.imageAsset?.objectUrl;
      if (!url || typeof document === 'undefined') return undefined;

      const img = await new Promise<HTMLImageElement | null>((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        const timer = window.setTimeout(() => resolve(null), 1200);
        image.onload = () => {
          window.clearTimeout(timer);
          resolve(image);
        };
        image.onerror = () => {
          window.clearTimeout(timer);
          resolve(null);
        };
        image.src = url;
      });

      if (!img || !img.naturalWidth || !img.naturalHeight) return undefined;
      const canvas = document.createElement('canvas');
      const targetW = 192;
      const targetH = 108;
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;

      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, targetW, targetH);
      const scale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return undefined;
    }
  }

  private async recordCurrentProjectAsRecent(
    filePath: string | null | undefined,
    fileName?: string | null
  ): Promise<void> {
    if (!filePath || !filePath.trim()) return;
    const project = this.store.getProject();
    const fallbackName = filePath.split(/[\\/]/).pop() || 'presentation.mpres';
    const thumb = await this.captureFirstSlideThumbnailDataUrl();
    this.recentSessions = await recordRecentSession({
      title: project.title || fallbackName,
      filePath,
      fileName: fileName || fallbackName,
      slideCount: project.slides.length,
      aspectRatio: project.settings.aspectRatio,
      ...(thumb ? { thumbnailDataUrl: thumb } : {}),
    });
  }

  private async openRecentSessionEntry(entry: RecentSessionEntry): Promise<void> {
    if (entry.exists === false) {
      this.store.notify(t('welcome.missingError', { path: entry.filePath }), 'warning', 4500);
      return;
    }
    if (window.desktopAPI?.openProjectByPath) {
      try {
        const opened = await window.desktopAPI.openProjectByPath(entry.filePath);
        await this.openDesktopStreamedProject(opened);
      } catch (err) {
        this.store.notify(
          err instanceof Error ? err.message : t('notify.openProjectError'),
          'error',
          4500
        );
        void this.refreshRecentSessions();
      }
    } else {
      await this.handleOpenProject();
    }
  }

  private async togglePinRecentSessionEntry(entry: RecentSessionEntry): Promise<void> {
    this.recentSessions = await togglePinRecentSession(entry.filePath);
    if (this.store.getSlides().length === 0) {
      this.renderEmptyOverlay();
    }
  }

  private async revealRecentSessionEntry(entry: RecentSessionEntry): Promise<void> {
    const ok = await revealRecentSessionInFolder(entry.filePath);
    if (!ok) {
      this.store.notify(t('welcome.missingError', { path: entry.filePath }), 'warning', 3500);
    }
  }

  private async removeRecentSessionEntry(entry: RecentSessionEntry): Promise<void> {
    this.recentSessions = await removeRecentSession(entry.filePath);
    if (this.store.getSlides().length === 0) {
      this.renderEmptyOverlay();
    }
  }

  private async clearUnpinnedRecentEntries(): Promise<void> {
    this.recentSessions = await clearUnpinnedRecentSessions();
    if (this.store.getSlides().length === 0) {
      this.renderEmptyOverlay();
    }
  }

  private toggleNavigatorPane(): void {
    if (this.lastLayoutPlan?.focusMode) {
      this.setFocusPaneTab(this.focusPaneTab === 'slides' ? 'stage' : 'slides');
      return;
    }
    const nextPref: SequenceLayoutPreference = this.isNavigatorVisible ? 'bottom' : 'side';
    this.setSequenceLayoutPreference(nextPref);
  }

  private toggleInspectorPane(): void {
    if (this.lastLayoutPlan?.focusMode) {
      this.setFocusPaneTab(this.focusPaneTab === 'inspector' ? 'stage' : 'inspector');
      return;
    }
    this.isInspectorVisible = !this.isInspectorVisible;
    const inspPane = this.root.querySelector('#inspector-pane');
    inspPane?.classList.toggle('collapsed', !this.isInspectorVisible);
    const inspResizer = this.root.querySelector('#inspector-resizer');
    inspResizer?.classList.toggle('collapsed', !this.isInspectorVisible);
    const btn = this.root.querySelector('#btn-toggle-inspector');
    btn?.classList.toggle('active-pane', this.isInspectorVisible);
    this.handleViewportResize();
  }

  private toggleStageOverviewGrid(force?: boolean): void {
    const next = typeof force === 'boolean' ? force : !this.isStageOverviewOpen;
    if (this.store.getSlides().length === 0) {
      this.isStageOverviewOpen = false;
    } else {
      this.isStageOverviewOpen = next;
    }
    this.renderStageOverviewGrid();
    this.renderActivityRail();
  }

  private applySkinSelection(skinId: StudioSkinId): void {
    selectStudioSkin(skinId);
    this.renderWindowToolbar();
    this.renderActivityRail();
    this.renderInspectorPane();
    if (this.isSkinPopoverOpen) {
      this.renderSkinPopover();
    }
  }

  private toggleSkinPopover(fromRail = false): void {
    if (this.isSkinPopoverOpen) {
      this.closeSkinPopover();
      return;
    }
    this.isSkinPopoverOpen = true;
    this.skinPopoverFromRail = fromRail;
    this.renderSkinPopover(fromRail);
  }

  private closeSkinPopover(): void {
    this.isSkinPopoverOpen = false;
    this.skinPopoverFromRail = false;
    this.skinPopoverScope.clear();
    const host = this.root.querySelector('#skin-popover-host') as HTMLElement | null;
    if (host) host.innerHTML = '';
  }

  private renderSkinPopover(fromRail = this.skinPopoverFromRail): void {
    const host = this.root.querySelector('#skin-popover-host') as HTMLElement | null;
    if (!host) return;
    this.skinPopoverScope.clear();
    const activeSkin = getStudioSkin();
    const themePref = getThemePreference();
    const railBtnRect = (this.root.querySelector('#rail-btn-skins') as HTMLElement | null)?.getBoundingClientRect?.();
    const anchorToRail = Boolean(fromRail && railBtnRect && railBtnRect.width > 0);

    host.innerHTML = `
      <div class="skin-popover-backdrop apple-popover-backdrop ${anchorToRail ? '' : 'is-centered'}" id="skin-popover-backdrop">
        <div class="skin-popover-card apple-skin-popover" id="skin-popover-card" role="dialog" aria-label="${this.escapeHtml(t('skin.popoverTitle'))}">
          <div class="skin-popover-head">
            <span>${Icons.palette} <span>${this.escapeHtml(t('skin.popoverTitle'))}</span></span>
            <button type="button" class="btn btn-icon-only btn-xs" id="btn-close-skin-popover" aria-label="${this.escapeHtml(t('modal.close'))}">
              ${Icons.close}
            </button>
          </div>
          <div class="skin-mode-segmented" role="group" aria-label="${this.escapeHtml(t('skin.popoverTitle'))}">
            <button type="button" class="skin-mode-btn ${themePref === 'system' ? 'active' : ''}" data-pick-theme="system">${escapeHtml(t('skin.modeAuto'))}</button>
            <button type="button" class="skin-mode-btn ${themePref === 'dark' ? 'active' : ''}" data-pick-theme="dark">${escapeHtml(t('skin.modeDark'))}</button>
            <button type="button" class="skin-mode-btn ${themePref === 'light' ? 'active' : ''}" data-pick-theme="light">${escapeHtml(t('skin.modeLight'))}</button>
          </div>
          <div class="apple-menu-sep" style="margin:2px 0;"></div>
          <div class="skin-popover-list">
            ${STUDIO_SKINS.map((sk) => {
              const active = sk.id === activeSkin;
              return `
                <button type="button" class="skin-option-row ${active ? 'active' : ''}" data-pick-skin="${sk.id}">
                  <span class="skin-swatch-pair">
                    <span class="skin-swatch-bg" style="background:${sk.swatchBg};"></span>
                    <span class="skin-swatch-acc" style="background:${sk.swatchAccent};"></span>
                  </span>
                  <span class="skin-option-text">
                    <strong>${this.escapeHtml(sk.name)}</strong>
                    <span>${this.escapeHtml(sk.tagline)}</span>
                  </span>
                  ${active ? `<span class="skin-active-check">${Icons.check}</span>` : ''}
                </button>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    const backdrop = host.querySelector('#skin-popover-backdrop');
    const card = host.querySelector('#skin-popover-card');
    this.skinPopoverScope.listen(backdrop, 'click', (e) => {
      if (e.target === backdrop) this.closeSkinPopover();
    });
    this.skinPopoverScope.listen(card, 'click', (e) => e.stopPropagation());
    this.skinPopoverScope.listen(host.querySelector('#btn-close-skin-popover'), 'click', () => {
      this.closeSkinPopover();
    });
    host.querySelectorAll('[data-pick-theme]').forEach((btn) => {
      this.skinPopoverScope.listen(btn, 'click', () => {
        const nextPref = (btn as HTMLElement).dataset.pickTheme as ThemePreference | undefined;
        if (!nextPref) return;
        setThemePreference(nextPref);
        this.syncThemeToDesktop(nextPref);
        this.renderWindowToolbar();
        this.renderActivityRail();
        this.renderInspectorPane();
        this.renderSkinPopover();
      });
    });
    host.querySelectorAll('[data-pick-skin]').forEach((btn) => {
      this.skinPopoverScope.listen(btn, 'click', () => {
        const id = (btn as HTMLElement).dataset.pickSkin as StudioSkinId | undefined;
        if (id) {
          this.applySkinSelection(id);
          this.closeSkinPopover();
        }
      });
    });
    this.skinPopoverScope.listen(window, 'keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Escape') {
        this.closeSkinPopover();
      }
    });
  }

  private renderActivityRail(): void {
    const rail = this.root.querySelector('#activity-rail') as HTMLElement | null;
    if (!rail) return;
    this.activityRailScope.clear();

    const slides = this.store.getSlides();
    if (slides.length === 0) {
      rail.classList.add('hidden');
      rail.innerHTML = '';
      return;
    }

    rail.classList.remove('hidden');
    rail.innerHTML = `
      <div class="rail-group">
        <button
          type="button"
          class="rail-btn ${!this.isStageOverviewOpen ? 'active' : ''}"
          id="rail-btn-stage"
          title="${this.escapeHtml(t('shell.stageAria'))}"
          aria-label="${this.escapeHtml(t('shell.stageAria'))}"
        >
          ${Icons.layers}
        </button>
        <button
          type="button"
          class="rail-btn ${this.isStageOverviewOpen ? 'active' : ''}"
          id="rail-btn-overview"
          title="${this.escapeHtml(t('presenter.gridAria'))}"
          aria-label="${this.escapeHtml(t('presenter.gridAria'))}"
        >
          ${Icons.grid}
        </button>
        <button
          type="button"
          class="rail-btn ${this.isNavigatorVisible ? 'active' : ''}"
          id="rail-btn-nav-drawer"
          title="${this.escapeHtml(t('toolbar.toggleNavTitle'))}"
          aria-label="${this.escapeHtml(t('toolbar.toggleNavTitle'))}"
        >
          ${isRtlLanguage() ? Icons.sidebarRight : Icons.sidebarLeft}
        </button>
      </div>
      <div class="rail-sep"></div>
      <div class="rail-group">
        <button
          type="button"
          class="rail-btn"
          id="rail-btn-add-slide"
          title="${this.escapeHtml(t('toolbar.addSlideTitle'))}"
          aria-label="${this.escapeHtml(t('toolbar.addSlideTitle'))}"
        >
          ${Icons.photoPlus}
        </button>
        <button
          type="button"
          class="rail-btn"
          id="rail-btn-reel-slicer"
          title="${this.escapeHtml(t('toolbar.reelWorkflowTitle'))}"
          aria-label="${this.escapeHtml(t('toolbar.reelWorkflowTitle'))}"
        >
          ${Icons.splitCue}
        </button>
      </div>
      <div class="rail-spacer"></div>
      <div class="rail-group">
        <button
          type="button"
          class="rail-btn ${this.isSkinPopoverOpen ? 'active' : ''}"
          id="rail-btn-skins"
          title="Studio Skins"
          aria-label="Studio Skins"
        >
          ${Icons.palette}
        </button>
        <button
          type="button"
          class="rail-btn"
          id="rail-btn-shortcuts"
          title="${this.escapeHtml(t('toolbar.shortcutsTitle'))}"
          aria-label="${this.escapeHtml(t('toolbar.shortcutsTitle'))}"
        >
          ${Icons.keyboard}
        </button>
      </div>
    `;

    this.activityRailScope.listen(rail.querySelector('#rail-btn-stage'), 'click', () => {
      this.toggleStageOverviewGrid(false);
    });
    this.activityRailScope.listen(rail.querySelector('#rail-btn-overview'), 'click', () => {
      this.toggleStageOverviewGrid();
    });
    this.activityRailScope.listen(rail.querySelector('#rail-btn-nav-drawer'), 'click', () => {
      this.toggleNavigatorPane();
    });
    this.activityRailScope.listen(rail.querySelector('#rail-btn-add-slide'), 'click', () => {
      const input = this.root.querySelector('#single-image-input') as HTMLInputElement | null;
      if (input) {
        input.dataset.replaceSlideId = '';
        input.click();
      }
    });
    this.activityRailScope.listen(rail.querySelector('#rail-btn-reel-slicer'), 'click', () => {
      void this.handleOpenReelWorkflow();
    });
    this.activityRailScope.listen(rail.querySelector('#rail-btn-skins'), 'click', () => {
      this.toggleSkinPopover(true);
    });
    this.activityRailScope.listen(rail.querySelector('#rail-btn-shortcuts'), 'click', () => {
      this.openShortcutsHelpModal();
    });
  }

  private renderStageOverviewGrid(): void {
    const gridHost = this.root.querySelector('#stage-overview-grid') as HTMLElement | null;
    const frameEl = this.root.querySelector('#canvas-frame') as HTMLElement | null;
    if (!gridHost) return;
    this.overviewGridScope.clear();

    const slides = this.store.getSlides();
    if (!this.isStageOverviewOpen || slides.length === 0) {
      gridHost.style.display = 'none';
      gridHost.innerHTML = '';
      if (frameEl) frameEl.style.display = '';
      return;
    }

    if (frameEl) frameEl.style.display = 'none';
    gridHost.style.display = 'flex';
    const activeIdx = this.store.getActivePreviewIndex();

    gridHost.innerHTML = `
      <div class="overview-grid-header">
        <div class="overview-grid-title">
          ${Icons.grid}
          <span>${this.escapeHtml(t('presenter.gridAria'))}</span>
          <span class="dock-stat-pill tabular-nums">${slides.length}</span>
        </div>
        <button type="button" class="btn btn-xs" id="btn-close-overview-grid">
          ${Icons.close}
          <span>${this.escapeHtml(t('nav.clearSelection'))}</span>
        </button>
      </div>
      <div class="overview-bento-cards">
        ${slides
          .map((slide, idx) => {
            const isCurrent = idx === activeIdx;
            const hasLoop = Boolean(slide.idleLoopAsset);
            const vid = slide.transitionToNext.videoAsset;
            const transDur = vid
              ? `${((vid.durationSec ?? 1) / Math.max(0.25, slide.transitionToNext.playbackSpeed || 1)).toFixed(1)}s`
              : `${((slide.transitionToNext.fallbackDurationMs || 700) / 1000).toFixed(1)}s`;
            return `
              <button type="button" class="overview-bento-card ${isCurrent ? 'active' : ''}" data-ov-slide-id="${this.escapeHtml(slide.id)}">
                <div class="overview-thumb-box">
                  ${
                    slide.imageAsset.objectUrl
                      ? `<img src="${this.escapeHtml(slide.imageAsset.objectUrl)}" alt="" />`
                      : `<span class="tabular-nums">${idx + 1}</span>`
                  }
                  <div class="overview-badges-top">
                    <span class="overview-pill tabular-nums">${String(idx + 1).padStart(2, '0')}</span>
                    ${hasLoop ? `<span class="overview-pill is-loop">Loop</span>` : ''}
                    ${idx < slides.length - 1 ? `<span class="overview-pill is-trans tabular-nums">${transDur}</span>` : ''}
                  </div>
                </div>
                <div class="overview-card-foot">
                  <span class="overview-card-title">${this.escapeHtml(slide.title)}</span>
                </div>
              </button>
            `;
          })
          .join('')}
      </div>
    `;

    this.overviewGridScope.listen(gridHost.querySelector('#btn-close-overview-grid'), 'click', () => {
      this.toggleStageOverviewGrid(false);
    });
    gridHost.querySelectorAll('.overview-bento-card').forEach((card) => {
      this.overviewGridScope.listen(card, 'click', () => {
        const slideId = (card as HTMLElement).dataset.ovSlideId;
        if (slideId) {
          this.store.setSelection({ type: 'slide', slideId });
          this.toggleStageOverviewGrid(false);
        }
      });
    });
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
      if (!payload) return;
      if (payload.projectToken && typeof payload.manifestJson === 'string') {
        void this.openDesktopStreamedProject(payload);
        return;
      }
      if (payload.buffer) {
        void this.openProjectFromBytes(
          new Uint8Array(payload.buffer),
          payload.fileName,
          payload.filePath
        );
      }
    });
  }

  private async consumeInitialProjectFile(): Promise<void> {
    try {
      const pending = await window.desktopAPI?.consumePendingProjectFile?.();
      if (!pending) return;
      if (pending.projectToken && typeof pending.manifestJson === 'string') {
        await this.openDesktopStreamedProject(pending);
      } else if (pending.buffer) {
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

  private async openDesktopStreamedProject(opened: OpenedProjectDescriptor): Promise<void> {
    try {
      if (this.isPresentingFullscreen) {
        await this.exitFullscreenPresentation();
      }
      if (this.isModalOpen && this.activeModalClose) {
        this.activeModalClose();
      }
      this.store.notify(t('notify.openProjectProgress', { name: opened.fileName }), 'info', 2500);
      const data = await this.store.loadOpenedDesktopProject(opened);
      this.currentProjectFilePath = opened.filePath || null;
      this.syncWindowTitle();
      void this.recordCurrentProjectAsRecent(opened.filePath, opened.fileName);
      if (opened.recoveredFromBackup) {
        this.store.notify(t('notify.projectRestoredFromBackup'), 'warning', 7000);
      } else {
        this.store.notify(t('notify.openProjectSuccess', { title: data.title }), 'success');
      }
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.openProjectError'),
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
      void this.recordCurrentProjectAsRecent(filePath, fileName);
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
    let unsubscribeProgress: (() => void) | null = null;
    try {
      this.store.notify(t('notify.saveProjectProgress'), 'info', 4000);

      if (projectFiles.isDesktop()) {
        let lastToastAt = 0;
        unsubscribeProgress =
          window.desktopAPI?.onSaveProgress?.((progress) => {
            const now = Date.now();
            if (progress.percent < 100 && now - lastToastAt < 90) return;
            lastToastAt = now;
            this.store.notify(
              t('notify.saveProjectProgressPercent', {
                percent: progress.percent,
                file: progress.currentFile || 'manifest.json',
              }),
              'info',
              4000
            );
          }) || null;

        const result = await projectFiles.saveProject(project, {
          forceSaveAs: saveAs,
          currentFilePath: this.currentProjectFilePath,
          activeProjectToken: this.store.getProjectToken(),
        });

        if (!result) return;
        if (!result.ok) {
          const names = result.missingFiles.map((m) => m.fileName || m.path).join(', ');
          this.store.notify(t('notify.saveMissingSources', { files: names }), 'error', 8000);
          return;
        }

        this.currentProjectFilePath = result.filePath;
        this.store.setProjectToken(result.projectToken);
        this.syncWindowTitle();
        void this.recordCurrentProjectAsRecent(result.filePath, result.fileName);
        this.store.notify(t('notify.saveProjectSuccess', { name: result.fileName }), 'success');
        return;
      }

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
        void this.recordCurrentProjectAsRecent(result.filePath, result.fileName);
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
      unsubscribeProgress?.();
      this.isSavingProject = false;
    }
  }

  private async handleOpenProject(): Promise<void> {
    try {
      if (window.desktopAPI?.openProjectStreamedDialog) {
        const res = await window.desktopAPI.openProjectStreamedDialog();
        if (!res) return;
        await this.openDesktopStreamedProject(res);
      } else if (window.desktopAPI?.openProjectDialog) {
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
    if (window.desktopAPI?.openMediaPathsDialog) {
      try {
        const selected = await window.desktopAPI.openMediaPathsDialog();
        if (selected && selected.length > 0) {
          await this.handleBatchDesktopDescriptors(selected);
        }
      } catch (err) {
        this.store.notify(
          err instanceof Error ? err.message : t('notify.importMediaError'),
          'error'
        );
      }
    } else if (window.desktopAPI?.openMediaDialog) {
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
              <span class="slide-caption-title" dir="auto">${this.escapeHtml(slide.title)}</span>
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
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span class="tabular-nums">${slides.length}</span>
          <button
            type="button"
            class="btn btn-icon-only btn-nav-switch-bottom"
            id="btn-nav-to-bottom"
            title="${this.escapeHtml(t('layout.switchToBottom'))}"
            aria-label="${this.escapeHtml(t('layout.switchToBottom'))}"
          >
            ${Icons.timelineDock}
          </button>
        </span>
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

    pane.querySelector('#btn-nav-to-bottom')?.addEventListener('click', () => {
      this.setSequenceLayoutPreference('bottom');
    });

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
    const overlay = this.root.querySelector('#empty-overlay') as HTMLElement | null;
    const hud = this.root.querySelector('#floating-stage-hud') as HTMLElement | null;
    renderEmptyStageView(
      overlay,
      hud,
      this.emptyStageScope,
      this.store.getSlides().length,
      this.recentSessions,
      {
        onImportMedia: () => {
          void this.handleImportMedia();
        },
        onOpenReelWorkflow: () => {
          void this.handleOpenReelWorkflow();
        },
        onGenerateDemo: () => {
          void this.handleGenerateDemo();
        },
        onOpenProject: () => {
          void this.handleOpenProject();
        },
        onOpenRecentSession: (entry) => {
          void this.openRecentSessionEntry(entry);
        },
        onTogglePinRecentSession: (entry) => {
          void this.togglePinRecentSessionEntry(entry);
        },
        onRevealRecentSession: (entry) => {
          void this.revealRecentSessionEntry(entry);
        },
        onRemoveRecentSession: (entry) => {
          void this.removeRecentSessionEntry(entry);
        },
        onClearUnpinnedRecents: () => {
          void this.clearUnpinnedRecentEntries();
        },
      }
    );
  }

  private renderFloatingStageHud(): void {
    const hud = this.root.querySelector('#floating-stage-hud') as HTMLElement | null;
    const slides = this.store.getSlides();
    if (!hud) return;

    const idx = renderStageHudView(
      hud,
      this.stageHudScope,
      slides.length,
      this.latestEngineStatus,
      this.store.getSettings().loopPresentation,
      {
        onPrev: () => this.previewEngine.previous(),
        onNext: () => this.previewEngine.next(),
        onReplay: () => this.previewEngine.jumpToSlide(0, true),
      }
    );

    if (slides.length > 0) {
      this.syncNavigatorActiveSlide(idx);
    }
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
    const pane = this.root.querySelector('#inspector-pane') as HTMLElement;
    if (!pane) return;

    pane.classList.toggle('collapsed', !this.isInspectorVisible);
    pane.classList.toggle('is-overlay-drawer', this.isInspectorOverlayMode && this.isInspectorVisible);

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
      const hasLoop = Boolean(activeSlide.idleLoopAsset);
      contentHtml = `
        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${t('inspector.basicsSection')} · ${t('inspector.slideHeader', { num: slideIdx + 1 })}</span>
            <span class="tabular-nums">${activeSlide.imageAsset.width}×${activeSlide.imageAsset.height}</span>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="insp-slide-title">${t('inspector.slideTitleLabel')}</label>
            <input
              type="text"
              class="input-field"
              id="insp-slide-title"
              dir="auto"
              value="${this.escapeHtml(activeSlide.title)}"
            />
          </div>

          <div class="prop-row">
            <span class="prop-label">${t('inspector.imageFileLabel')}</span>
            <div class="inspector-file-row">
              <span class="prop-subtext inspector-file-name" title="${this.escapeHtml(activeSlide.imageAsset.name)}">
                <bdi dir="ltr">${this.escapeHtml(activeSlide.imageAsset.name)}</bdi>
              </span>
              <button type="button" class="btn btn-xs" id="btn-replace-slide-img">
                ${t('inspector.replaceImage')}
              </button>
            </div>
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
          </div>

          <div class="prop-row" style="margin-bottom: 0;">
            <label class="prop-label" for="insp-slide-notes">
              <span>${t('inspector.notesSection')}</span>
              ${Icons.notes}
            </label>
            <textarea
              class="textarea-field"
              id="insp-slide-notes"
              dir="auto"
              rows="3"
              placeholder="${this.escapeHtml(t('inspector.notesPlaceholder'))}"
            >${this.escapeHtml(activeSlide.notes || '')}</textarea>
          </div>
        </div>

        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${t('inspector.advancedToolsSection')}</span>
          </div>
          <div class="inspector-tools-stack">
            <button type="button" class="btn inspector-tool-btn" id="btn-open-idle-loop-modal">
              ${Icons.infinityLoop}
              <span>${t('inspector.idleLoopBtn')}</span>
              <span class="inspector-tool-badge ${hasLoop ? 'is-active' : ''}">${hasLoop ? t('inspector.idleLoopActive') : t('inspector.idleLoopOff')}</span>
            </button>
            <button type="button" class="btn inspector-tool-btn" id="btn-open-ai-edit-modal">
              ${Icons.sparkles}
              <span>${t('inspector.aiEditModalBtn')}</span>
            </button>
          </div>
        </div>

        <div class="inspector-tools-row">
          <button type="button" class="btn" id="btn-insp-duplicate-slide">
            ${Icons.duplicate}
            <span>${t('inspector.duplicateSlide')}</span>
          </button>
          <button type="button" class="btn btn-destructive" id="btn-insp-delete-slide">
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
      const spec = activeSlide.transitionToNext;
      const vid = spec.videoAsset;
      const segStart = vid ? Math.max(0, spec.startTimeSec ?? 0) : 0;
      const segEnd = vid ? Math.max(segStart, spec.endTimeSec ?? vid.durationSec) : 0;
      const segDur = vid ? Math.max(0, segEnd - segStart) : 0;

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
            <div class="inspector-video-compact">
              <img src="${vid.thumbnailUrl || ''}" alt="${this.escapeHtml(t('inspector.startFrameAlt'))}" />
              <div class="inspector-video-compact-meta">
                <span class="inspector-file-name" title="${this.escapeHtml(vid.name)}"><bdi dir="ltr">${this.escapeHtml(vid.name)}</bdi></span>
                <span class="prop-subtext tabular-nums">${vid.width}×${vid.height} · ${segStart.toFixed(1)}s–${segEnd.toFixed(1)}s</span>
              </div>
            </div>
            <div class="inspector-tools-row" style="margin-bottom: 8px;">
              <button type="button" class="btn btn-xs" id="btn-replace-trans-video">${t('inspector.replaceTransVideo')}</button>
              <button type="button" class="btn btn-xs btn-destructive" id="btn-remove-trans-video">${t('inspector.removeTransVideo')}</button>
            </div>
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
                <button type="button" class="btn btn-prominent" id="btn-insp-relink-video" style="width:100%;">
                  ${Icons.relink}
                  <span>${t('inspector.relinkVideoBtn')}</span>
                </button>
              </div>
            `
                : `<div class="prop-subtext" style="margin-bottom: 6px;">${t('inspector.noVideoHint')}</div>`
            }
            <button type="button" class="btn ${spec.expectedVideoFileName ? '' : 'btn-prominent'}" id="btn-replace-trans-video" style="width: 100%; margin-bottom: 8px;">
              ${Icons.filmTransition}
              <span>${t('inspector.linkVideoBtn')}</span>
            </button>
          `
          }

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

          <div class="prop-row-inline" style="margin-bottom: 0;">
            <label class="prop-label" for="insp-trans-muted" style="cursor: pointer;">${t('inspector.muteTransAudio')}</label>
            <input type="checkbox" id="insp-trans-muted" ${spec.muted ? 'checked' : ''} />
          </div>
        </div>

        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${t('inspector.speedFallbackSection')}</span>
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

          <button type="button" class="btn" id="btn-apply-trans-all" style="width: 100%; margin-top: 8px;" title="${this.escapeHtml(t('inspector.applyAllTransTitle'))}">
            ${Icons.checkAll}
            <span>${t('inspector.applyAllTrans')}</span>
          </button>
        </div>

        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${t('inspector.advancedToolsSection')}</span>
          </div>
          <div class="inspector-tools-stack">
            ${
              vid
                ? `<button type="button" class="btn inspector-tool-btn" id="btn-open-trim-split-modal">
                    ${Icons.splitCue}
                    <span>${t('inspector.trimSplitBtn')}</span>
                  </button>`
                : ''
            }
            <button type="button" class="btn inspector-tool-btn" id="btn-generate-trans-video" title="${this.escapeHtml(t('inspector.generateTransTitle'))}">
              ${Icons.sparkles}
              <span>${t('inspector.generateTransBtn')}</span>
            </button>
            <button type="button" class="btn inspector-tool-btn" id="btn-open-ai-edit-modal">
              ${Icons.wand}
              <span>${t('inspector.aiEditModalBtn')}</span>
            </button>
          </div>
        </div>
      `;
    } else {
      const currentSkin = getStudioSkin();
      contentHtml = `
        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${t('inspector.stageQuickSection')}</span>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <div class="prop-row">
              <label class="prop-label" for="set-aspect-ratio">${t('settings.aspectRatioLabel')}</label>
              <select class="select-field" id="set-aspect-ratio">
                <option value="16:9" ${settings.aspectRatio === '16:9' ? 'selected' : ''}>16:9</option>
                <option value="16:10" ${settings.aspectRatio === '16:10' ? 'selected' : ''}>16:10</option>
                <option value="4:3" ${settings.aspectRatio === '4:3' ? 'selected' : ''}>4:3</option>
                <option value="9:16" ${settings.aspectRatio === '9:16' ? 'selected' : ''}>9:16</option>
              </select>
            </div>
            <div class="prop-row">
              <label class="prop-label" for="set-fit-mode">${t('settings.fitModeLabel')}</label>
              <select class="select-field" id="set-fit-mode">
                <option value="contain" ${settings.fitMode === 'contain' ? 'selected' : ''}>${t('settings.fitContain')}</option>
                <option value="cover" ${settings.fitMode === 'cover' ? 'selected' : ''}>${t('settings.fitCover')}</option>
              </select>
            </div>
          </div>

          <div class="prop-row">
            <label class="prop-label" for="set-stage-bg">${t('settings.stageBgLabel')}</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="color" id="set-stage-bg" value="${settings.stageBackground || '#05070B'}" style="width: 34px; height: 26px; padding: 0; border: none; background: transparent; cursor: pointer;" />
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

          <div class="prop-row-inline" style="margin-bottom: 0;">
            <label class="prop-label" for="set-loop" style="cursor: pointer;">${t('settings.loopLabel')}</label>
            <input type="checkbox" id="set-loop" ${settings.loopPresentation ? 'checked' : ''} />
          </div>
        </div>

        <div class="inspector-group">
          <div class="inspector-group-title">
            <span>${t('inspector.advancedToolsSection')}</span>
          </div>
          <div class="inspector-tools-stack">
            <button type="button" class="btn inspector-tool-btn" id="btn-open-engine-prefs-modal">
              ${Icons.sliders}
              <span>${t('inspector.enginePrefsBtn')}</span>
            </button>
            <button type="button" class="btn inspector-tool-btn" id="btn-open-deck-stats-modal">
              ${Icons.info}
              <span>${t('inspector.deckStatsBtn')}</span>
            </button>
            <button type="button" class="btn inspector-tool-btn" id="btn-open-skins-from-insp">
              ${Icons.palette}
              <span>${t('inspector.skinBtn')}</span>
              <span class="inspector-tool-badge">${this.escapeHtml(currentSkin)}</span>
            </button>
          </div>
        </div>
      `;
    }

    // Equal-width noun-only Segmented Control per segmented-controls.md › Content
    pane.innerHTML = `
      <div class="segmented-control-wrap">
        <div class="segmented-control" role="tablist" aria-label="${this.escapeHtml(t('inspector.tabsAria'))}" style="flex: 1;">
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
        ${
          this.isInspectorOverlayMode
            ? `<button type="button" class="btn btn-icon-only" id="btn-close-floating-inspector" title="${this.escapeHtml(t('inspector.closeFloating'))}" aria-label="${this.escapeHtml(t('inspector.closeFloating'))}">${Icons.close}</button>`
            : ''
        }
      </div>
      <div class="inspector-scroll">
        ${contentHtml}
      </div>
    `;

    pane.querySelector('#btn-close-floating-inspector')?.addEventListener('click', () => {
      this.toggleInspectorPane();
    });

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
      const slideIdx = slides.findIndex((s) => s.id === activeSlide.id);
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

      pane.querySelector('#btn-open-idle-loop-modal')?.addEventListener('click', () => {
        const host = this.root.querySelector('#workspace-modal-host') as HTMLElement | null;
        openIdleLoopModal({
          host,
          scope: this.workspaceModalScope,
          slide: activeSlide,
          onAssignLoop: () => {
            const input = this.root.querySelector('#single-video-input') as HTMLInputElement;
            if (!input) return;
            delete input.dataset.targetSlideId;
            input.dataset.idleLoopSlideId = activeSlide.id;
            input.click();
          },
          onRemoveLoop: () => {
            this.store.setSlideIdleLoopVideo(activeSlide.id, null);
            this.store.notify(t('notify.idleLoopRemoved'), 'info');
          },
          onClose: () => {},
        });
      });

      pane.querySelector('#btn-open-ai-edit-modal')?.addEventListener('click', () => {
        this.openSurgicalAiSheet(activeSlide, slideIdx, 'slide');
      });

      pane.querySelector('#btn-insp-duplicate-slide')?.addEventListener('click', () => {
        if (this.store.duplicateSlide(activeSlide.id)) {
          this.store.notify(t('notify.slideDuplicated'), 'success', 2000);
        }
      });

      pane.querySelector('#btn-insp-delete-slide')?.addEventListener('click', () => {
        this.promptDeleteSlide(activeSlide.id);
      });
    }

    if (activeSegment === 'transition' && activeSlide) {
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
        pane.querySelector('#btn-open-trim-split-modal')?.addEventListener('click', () => {
          const host = this.root.querySelector('#workspace-modal-host') as HTMLElement | null;
          const slideReelContext = this.store.getReelContextForSlide?.(activeSlide.id);
          openTransitionTrimModal({
            host,
            scope: this.workspaceModalScope,
            slide: activeSlide,
            nextSlide,
            currentStageVideoTimeSec: this.latestEngineStatus?.currentVideoTimeSec ?? undefined,
            onCommitRange: (nextStart, nextEnd) =>
              this.store.updateTransitionRange(activeSlide.id, nextStart, nextEnd),
            onSplitAtTime: async (chosenSec) =>
              Boolean(await this.store.splitTransitionAtTime(activeSlide.id, chosenSec)),
            onExtractEndFrame: async () => {
              await this.store.extractNextSlideFromTransitionEnd(activeSlide.id, spec.endTimeSec);
            },
            onOpenReelCues: slideReelContext
              ? () => {
                  this.openReelCueModal(slideReelContext.videoAsset, {
                    mode: 'replace-reel',
                    targetVideoAssetId: slideReelContext.videoAsset.id,
                    initialCuePoints: slideReelContext.cuePointsSec,
                    isAlreadyOwnedByStore: true,
                  });
                }
              : undefined,
            onNotify: (msg, kind) => this.store.notify(msg, kind),
            onClose: () => {},
          });
        });
      }

      pane.querySelector('#btn-open-ai-edit-modal')?.addEventListener('click', () => {
        this.openSurgicalAiSheet(activeSlide, slideIdx, 'transition');
      });

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
      const ratioSel = pane.querySelector('#set-aspect-ratio') as HTMLSelectElement;
      ratioSel?.addEventListener('change', () => {
        this.store.updateSettings({ aspectRatio: ratioSel.value as AspectRatioOption });
      });

      const fitSel = pane.querySelector('#set-fit-mode') as HTMLSelectElement;
      fitSel?.addEventListener('change', () => {
        this.store.updateSettings({ fitMode: fitSel.value as FitMode });
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

      const muteCheck = pane.querySelector('#set-master-muted') as HTMLInputElement;
      muteCheck?.addEventListener('change', () => {
        this.store.updateSettings({ masterMuted: muteCheck.checked });
      });

      const loopCheck = pane.querySelector('#set-loop') as HTMLInputElement;
      loopCheck?.addEventListener('change', () => {
        this.store.updateSettings({ loopPresentation: loopCheck.checked });
      });

      pane.querySelector('#btn-open-engine-prefs-modal')?.addEventListener('click', () => {
        this.openEnginePrefsSheet();
      });

      pane.querySelector('#btn-open-deck-stats-modal')?.addEventListener('click', () => {
        this.openDeckStatsSheet();
      });

      pane.querySelector('#btn-open-skins-from-insp')?.addEventListener('click', () => {
        this.toggleSkinPopover();
      });
    }

    this.inspectorSelectsScope.clear();
    enhanceAppleSelects(pane, this.inspectorSelectsScope);
  }

  private renderToast(): void {
    const container = this.root.querySelector('#toast-container') as HTMLElement;
    if (!container) return;

    if (this.layerStack.shouldSuppressToasts()) {
      container.innerHTML = '';
      return;
    }

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
      const filePath = window.desktopAPI?.getPathForFile?.(file) || null;
      if (filePath && window.desktopAPI?.openProjectByPath) {
        try {
          const opened = await window.desktopAPI.openProjectByPath(filePath);
          await this.openDesktopStreamedProject(opened);
          return;
        } catch {
          // Fall back to byte parsing if path open fails
        }
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.openProjectFromBytes(bytes, file.name, filePath);
    });

    const singleImgInput = this.root.querySelector('#single-image-input') as HTMLInputElement;
    singleImgInput?.addEventListener('change', async () => {
      if (!singleImgInput.files?.length) return;
      const file = singleImgInput.files[0];
      const replaceId = singleImgInput.dataset.replaceSlideId;
      singleImgInput.value = '';

      try {
        const asset = await this.ingestMediaFilePreferDesktop(file, 'image');
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

  private async ingestMediaFilePreferDesktop(
    file: File,
    expectedKind?: MediaKind
  ): Promise<MediaAsset> {
    const check = MediaValidator.validateFile(file, expectedKind);
    if (!check.valid || !check.kind) {
      throw new Error(check.errorReason || t('core.invalidFile'));
    }

    const filePath = window.desktopAPI?.getPathForFile?.(file) || null;
    if (filePath && window.desktopAPI?.registerMediaPaths) {
      const registered = await window.desktopAPI.registerMediaPaths([filePath]);
      if (registered.length > 0) {
        const reg = registered[0];
        return await MediaValidator.ingestFromUrl(reg.url, expectedKind || check.kind, {
          fileName: reg.fileName || file.name,
          mimeType: reg.mimeType || file.type || '',
          size: reg.size || file.size,
          source: { kind: 'file', path: reg.path },
        });
      }
    }

    return await MediaValidator.ingestFile(file, expectedKind);
  }

  private async attachIdleLoopVideoToSlide(slideId: string, file: File): Promise<void> {
    try {
      this.store.notify(t('notify.analyzingVideo', { name: file.name }), 'info', 2000);
      const videoAsset = await this.ingestMediaFilePreferDesktop(file, 'video');
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
      const videoAsset = await this.ingestMediaFilePreferDesktop(file, 'video');
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

  private async handleBatchDesktopDescriptors(
    descriptors: RegisteredMediaDescriptor[]
  ): Promise<void> {
    if (!descriptors.length) return;
    this.store.notify(t('notify.batchScanning', { count: descriptors.length }), 'info', 3000);
    try {
      const { newSlides, unpairedVideos, report } = await SmartPairer.processBatchMediaDescriptors(
        descriptors,
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
      const firstPath = descriptors[0]?.path;
      if (firstPath) {
        const sepIdx = Math.max(firstPath.lastIndexOf('\\'), firstPath.lastIndexOf('/'));
        if (sepIdx > 0) inferredDir = firstPath.slice(0, sepIdx);
      }

      this.applyBatchImportResult(newSlides, unpairedVideos, report, null, inferredDir);
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.importFilesError'),
        'error'
      );
    }
  }

  private async handleBatchFiles(files: File[]): Promise<void> {
    if (files.length === 1) {
      const file = files[0];
      if (/\.(mpres|mpres\.json)$/i.test(file.name)) {
        const filePath = window.desktopAPI?.getPathForFile?.(file) || null;
        if (filePath && window.desktopAPI?.openProjectByPath) {
          try {
            const opened = await window.desktopAPI.openProjectByPath(filePath);
            await this.openDesktopStreamedProject(opened);
            return;
          } catch {
            // Fall back to byte parsing if direct path streaming fails
          }
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
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
          const videoAsset = await this.ingestMediaFilePreferDesktop(
            reelBundle.primaryVideoFile,
            'video'
          );
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

    const regByNormPath = new Map<string, RegisteredMediaDescriptor>();
    const normalizePathKey = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    if (window.desktopAPI?.getPathForFile && window.desktopAPI?.registerMediaPaths) {
      const candidatePaths: string[] = [];
      for (const f of mediaFiles) {
        const p = window.desktopAPI.getPathForFile(f);
        if (p) candidatePaths.push(p);
      }
      if (candidatePaths.length > 0) {
        const registered = await window.desktopAPI.registerMediaPaths(candidatePaths).catch(() => []);
        for (const reg of registered) {
          regByNormPath.set(normalizePathKey(reg.path), reg);
        }
      }
    }

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
          resolveMediaSource:
            regByNormPath.size > 0
              ? (file) => {
                  const p = window.desktopAPI?.getPathForFile?.(file);
                  if (!p) return null;
                  const reg = regByNormPath.get(normalizePathKey(p));
                  return reg ? { path: reg.path, url: reg.url, size: reg.size } : null;
                }
              : undefined,
        }
      );

      let inferredDir: string | undefined;
      const firstPath = window.desktopAPI?.getPathForFile?.(mediaFiles[0]);
      if (firstPath) {
        const sepIdx = Math.max(firstPath.lastIndexOf('\\'), firstPath.lastIndexOf('/'));
        if (sepIdx > 0) inferredDir = firstPath.slice(0, sepIdx);
      }

      this.applyBatchImportResult(newSlides, unpairedVideos, report, parsedManifest, inferredDir);
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.importFilesError'),
        'error'
      );
    }
  }

  private applyBatchImportResult(
    newSlides: SlideNode[],
    unpairedVideos: MediaAsset[],
    report: {
      slidesAdded: number;
      transitionsMatched: number;
      rejectedFiles: Array<{ name: string; reason: string }>;
    },
    parsedManifest: ReturnType<typeof MotionReelImporter.parsePresentationManifest>,
    inferredDir?: string
  ): void {
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
  }

  private async handleGenerateDemo(): Promise<void> {
    if (this.isGeneratingDemo) return;
    this.isGeneratingDemo = true;
    this.renderWindowToolbar();

    try {
      if (this.isPresentingFullscreen) {
        await this.exitFullscreenPresentation();
      }
      if (this.isModalOpen && this.activeModalClose) {
        this.activeModalClose();
      }

      if (window.desktopAPI?.openDemoProject) {
        const opened = await window.desktopAPI.openDemoProject();
        if (opened) {
          await this.store.loadOpenedDesktopProject(opened);
          this.currentProjectFilePath = null;
          this.syncWindowTitle();
          this.store.notify(t('notify.demoReady'), 'success', 4500);
          return;
        }
      }

      if (typeof fetch === 'function') {
        try {
          const res = await fetch('./demo/studio-showcase.mpres');
          if (res.ok) {
            const bytes = new Uint8Array(await res.arrayBuffer());
            const parsed = ProjectSerializer.parseProjectBytes(bytes);
            await this.store.loadProjectBundle(parsed);
            this.currentProjectFilePath = null;
            this.syncWindowTitle();
            this.store.notify(t('notify.demoReady'), 'success', 4500);
            return;
          }
        } catch {
          // Fall back to procedural demo generator when bundled .mpres is unavailable
        }
      }

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

    const myEpoch = ++this.presentEpoch;
    this.activeModalClose?.();
    this.closeStageSettingsPopover();
    this.closeSlideContextMenu();
    closeActiveAppleMenu();

    // Pause studio preview engine to avoid dual hardware decoding and resource contention
    this.previewEngine.pause();

    this.isPresentingFullscreen = true;
    this.layerStack.setPresenting(true);
    this.renderToast();

    // Multi-window / dual-display dedicated presenter path when running inside Electron desktop shell
    if (typeof window.desktopAPI?.openPresenterWindow === 'function') {
      try {
        const blobAssets: Record<string, SerializedBlobAsset> = {};
        const captureBlob = async (asset: MediaAsset | null | undefined) => {
          if (!asset || !asset.objectUrl?.startsWith('blob:') || !asset.rawFile || blobAssets[asset.id]) {
            return;
          }
          const buffer = await asset.rawFile.arrayBuffer();
          blobAssets[asset.id] = {
            buffer,
            mimeType: asset.mimeType || asset.rawFile.type || 'application/octet-stream',
            name: asset.name,
          };
        };

        for (const s of slides) {
          await captureBlob(s.imageAsset);
          await captureBlob(s.idleLoopAsset);
          await captureBlob(s.transitionToNext?.videoAsset);
        }

        if (myEpoch !== this.presentEpoch || !this.isPresentingFullscreen) return;

        const payload: PresenterWindowPayload = {
          slides: slides.map((s) => ({
            ...s,
            imageAsset: { ...s.imageAsset, rawFile: undefined },
            idleLoopAsset: s.idleLoopAsset ? { ...s.idleLoopAsset, rawFile: undefined } : s.idleLoopAsset,
            transitionToNext: {
              ...s.transitionToNext,
              videoAsset: s.transitionToNext?.videoAsset
                ? { ...s.transitionToNext.videoAsset, rawFile: undefined }
                : null,
            },
          })),
          settings: this.store.getSettings(),
          startSlideIndex: startIndex,
          language: getLanguage(),
          theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
          blobAssets,
        };

        const res = await window.desktopAPI.openPresenterWindow(payload);
        if (myEpoch !== this.presentEpoch || !this.isPresentingFullscreen) {
          await window.desktopAPI.closePresenterWindow?.();
          return;
        }
        if (res?.ok) {
          this.isDedicatedPresenterOpen = true;
          this.presenterConsoleStatus = {
            slideIndex: startIndex,
            totalSlides: slides.length,
            isBlank: false,
          };
          this.renderPresenterConsoleBanner();
          return;
        }
      } catch {
        // Fall through seamlessly to hardened in-page fullscreen presenter if dedicated window open fails
      }
    }

    this.isPresenterEnteringWindow = true;
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
    const ratioNumMap: Record<AspectRatioOption, number> = {
      '16:9': 16 / 9,
      '16:10': 16 / 10,
      '4:3': 4 / 3,
      '9:16': 9 / 16,
    };
    const numericRatio = ratioNumMap[settings.aspectRatio] || 16 / 9;

    fsRoot.innerHTML = `
      <div class="fullscreen-presenter" id="fs-presenter" style="--presenter-aspect-ratio:${numericRatio};">
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
            <span class="presenter-notes-title" id="fs-notes-slide-title" dir="auto">${t('presenter.notesHeader')}</span>
            <div class="presenter-notes-controls">
              <button class="btn btn-xs" id="fs-notes-font-dec" type="button" title="${this.escapeHtml(t('presenter.notesFontDec'))}">A-</button>
              <button class="btn btn-xs" id="fs-notes-font-inc" type="button" title="${this.escapeHtml(t('presenter.notesFontInc'))}">A+</button>
              <button class="btn btn-xs" id="fs-notes-close" type="button" title="${this.escapeHtml(t('presenter.closeShortcut'))}">${Icons.close}</button>
            </div>
          </div>
          <div class="presenter-notes-body" id="fs-notes-body" dir="auto" style="font-size:${this.presenterNotesFontSize}px;"></div>
          <div class="presenter-notes-footer" id="fs-notes-next-slide" dir="auto"></div>
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
    if (myEpoch !== this.presentEpoch || !this.isPresentingFullscreen || !this.presenterOverlayEl) {
      this.isPresenterEnteringWindow = false;
      return;
    }

    try {
      if (window.desktopAPI?.setFullScreen) {
        await window.desktopAPI.setFullScreen(true);
      } else if (this.presenterOverlayEl.requestFullscreen) {
        await this.presenterOverlayEl.requestFullscreen();
      }
    } catch {
      // Fallback to maximized overlay
    } finally {
      this.isPresenterEnteringWindow = false;
    }

    if (myEpoch !== this.presentEpoch || !this.isPresentingFullscreen || !this.presenterOverlayEl) {
      return;
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

  private renderPresenterConsoleBanner(): void {
    const banner = this.root.querySelector('#presenter-console-banner') as HTMLElement | null;
    if (!banner) return;
    if (!this.isDedicatedPresenterOpen) {
      banner.classList.add('hidden');
      banner.innerHTML = '';
      return;
    }

    const st = this.presenterConsoleStatus || {
      slideIndex: 0,
      totalSlides: this.store.getSlides().length,
      isBlank: false,
    };
    const slideNum = `${st.slideIndex + 1} / ${Math.max(1, st.totalSlides)}`;

    banner.classList.remove('hidden');
    banner.innerHTML = `
      <div class="presenter-console-info">
        <span class="presenter-console-dot"></span>
        <div>
          <div class="presenter-console-title">${this.escapeHtml(t('presenter.consoleActiveTitle'))} · <span class="tabular-nums">${slideNum}</span></div>
          <div class="presenter-console-sub">${this.escapeHtml(t('presenter.consoleSubtitle'))}</div>
        </div>
      </div>
      <div class="presenter-console-actions">
        <button type="button" class="btn btn-xs" id="btn-pc-prev">${Icons.chevronLeft}</button>
        <button type="button" class="btn btn-xs" id="btn-pc-next">${Icons.chevronRight}</button>
        <button type="button" class="btn btn-xs ${st.isBlank ? 'active-pane' : ''}" id="btn-pc-blank">${this.escapeHtml(t('presenter.consoleBlackoutBtn'))}</button>
        <button type="button" class="btn btn-xs btn-destructive" id="btn-pc-end">${this.escapeHtml(t('presenter.consoleEndBtn'))}</button>
      </div>
    `;

    banner.querySelector('#btn-pc-prev')?.addEventListener('click', () => {
      void window.desktopAPI?.sendPresenterCommand?.({ type: 'prev' });
    });
    banner.querySelector('#btn-pc-next')?.addEventListener('click', () => {
      void window.desktopAPI?.sendPresenterCommand?.({ type: 'next' });
    });
    banner.querySelector('#btn-pc-blank')?.addEventListener('click', () => {
      void window.desktopAPI?.sendPresenterCommand?.({ type: 'toggle-blank' });
    });
    banner.querySelector('#btn-pc-end')?.addEventListener('click', () => {
      void this.exitFullscreenPresentation();
    });
  }

  private async handleDedicatedPresenterClosed(lastIdx: number): Promise<void> {
    if (!this.isDedicatedPresenterOpen && !this.isPresentingFullscreen) return;
    ++this.presentEpoch;
    this.isDedicatedPresenterOpen = false;
    this.isPresentingFullscreen = false;
    this.presenterConsoleStatus = null;
    this.layerStack.setPresenting(false);
    this.renderPresenterConsoleBanner();
    this.renderToast();

    const safeIdx = Math.max(0, Math.min(lastIdx, Math.max(0, this.store.getSlides().length - 1)));
    this.store.setActivePreviewIndex(safeIdx);
    const slide = this.store.getSlideByIndex(safeIdx);
    if (slide) {
      this.store.setSelection({ type: 'slide', slideId: slide.id });
    }
    this.syncNavigatorActiveSlide(safeIdx);
    await this.previewEngine.jumpToSlide(safeIdx, true);
  }

  private async exitFullscreenPresentation(): Promise<void> {
    if (!this.isPresentingFullscreen) return;
    ++this.presentEpoch;
    this.isPresenterEnteringWindow = false;

    if (this.isDedicatedPresenterOpen) {
      const lastIdx = this.presenterConsoleStatus?.slideIndex ?? 0;
      await window.desktopAPI?.closePresenterWindow?.();
      await this.handleDedicatedPresenterClosed(lastIdx);
      return;
    }

    const lastIdx = this.presenterEngine?.getStatus().currentSlideIndex ?? 0;

    this.isPresentingFullscreen = false;
    this.layerStack.setPresenting(false);
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
    this.renderToast();
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
      if (this.isPresentingFullscreen && !this.isDedicatedPresenterOpen) {
        if (cmd === 'start-presentation') {
          return;
        }
        return;
      }
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
        case 'open-shortcuts':
          this.openShortcutsHelpModal();
          break;
        case 'open-about':
          void this.openAboutModal();
          break;
      }
    });
  }

  private bindGlobalShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      if (this.isModalOpen) {
        return;
      }

      if (this.isPresentingFullscreen && !this.isDedicatedPresenterOpen) {
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

        // Block studio chrome shortcuts while presenting fullscreen
        if (
          (e.ctrlKey || e.metaKey) &&
          ['1', 'i', 'o', 's', 'k', 'r', 'd', 'z', 'y'].includes(e.key.toLowerCase())
        ) {
          e.preventDefault();
          return;
        }
      } else {
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
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          void this.handleImportMedia();
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
        if ((e.ctrlKey || e.metaKey) && !isInputFocused && (e.key === 'r' || e.key === 'R')) {
          e.preventDefault();
          void this.handleOpenReelWorkflow();
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
          this.enterFullscreenPresentation(
            this.latestEngineStatus?.currentSlideIndex || 0
          );
          return;
        }
      }

      const target = e.target as HTMLElement;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');

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

  private async pickVideoAssetViaDesktop(): Promise<MediaAsset | null> {
    if (window.desktopAPI?.openMediaPathsDialog) {
      const selected = await window.desktopAPI.openMediaPathsDialog();
      if (!selected || selected.length === 0) return null;

      for (const item of selected) {
        if (MediaValidator.validateDescriptor(item.fileName, item.mimeType, item.size, 'video').valid) {
          this.store.notify(t('notify.analyzingVideo', { name: item.fileName }), 'info', 2500);
          return await MediaValidator.ingestFromUrl(item.url, 'video', {
            fileName: item.fileName,
            mimeType: item.mimeType,
            size: item.size,
            source: { kind: 'file', path: item.path },
          });
        }
      }
      this.store.notify(t('notify.pickValidVideo'), 'warning');
      return null;
    }

    if (!window.desktopAPI?.openMediaDialog) return null;
    const selected = await window.desktopAPI.openMediaDialog();
    if (!selected || selected.length === 0) return null;

    for (const item of selected) {
      const file = new File([item.buffer], item.fileName, { type: item.mimeType });
      if (MediaValidator.validateFile(file, 'video').valid) {
        this.store.notify(t('notify.analyzingVideo', { name: file.name }), 'info', 2500);
        return await MediaValidator.ingestFile(file, 'video');
      }
    }
    this.store.notify(t('notify.pickValidVideo'), 'warning');
    return null;
  }

  private async handleOpenReelWorkflow(): Promise<void> {
    if (window.desktopAPI?.openMediaPathsDialog || window.desktopAPI?.openMediaDialog) {
      try {
        const videoAsset = await this.pickVideoAssetViaDesktop();
        if (videoAsset) {
          this.routeIngestedReelVideoAsset(videoAsset, true);
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

  private routeIngestedReelVideoAsset(videoAsset: MediaAsset, forceReelModal = false): void {
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
  }

  private async ingestAndRouteReelVideo(file: File, forceReelModal = false): Promise<void> {
    try {
      this.store.notify(t('notify.analyzingVideo', { name: file.name }), 'info', 2500);
      const videoAsset = await this.ingestMediaFilePreferDesktop(file, 'video');
      this.routeIngestedReelVideoAsset(videoAsset, forceReelModal);
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.videoUnsupported'),
        'error'
      );
    }
  }

  private triggerRelinkVideo(targetSlideIds: string | string[]): void {
    if (window.desktopAPI?.openMediaPathsDialog || window.desktopAPI?.openMediaDialog) {
      void (async () => {
        try {
          const videoAsset = await this.pickVideoAssetViaDesktop();
          if (videoAsset) {
            await this.relinkVideoAsset(targetSlideIds, videoAsset);
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
      const videoAsset = await this.ingestMediaFilePreferDesktop(file, 'video');
      await this.relinkVideoAsset(target, videoAsset);
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : t('notify.relinkCannot'),
        'error'
      );
    }
  }

  private async relinkVideoAsset(
    target: string | string[],
    videoAsset: MediaAsset
  ): Promise<void> {
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
    this.reelSelectsScope.clear();
    enhanceAppleSelects(host.querySelector('.reel-actions-bar') as HTMLElement | null, this.reelSelectsScope);
    const reelCardsSelectsScope = this.reelSelectsScope.createChildScope();
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

      reelCardsSelectsScope.clear();
      enhanceAppleSelects(cuesListEl, reelCardsSelectsScope);
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
      this.reelSelectsScope.clear();
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
    const slides = this.store.getSlides();

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
          totalTransitionSec +=
            spec.videoAsset.durationSec > 0
              ? spec.videoAsset.durationSec
              : (spec.fallbackDurationMs || 650) / 1000;
        }
      } else {
        totalTransitionSec += (spec.fallbackDurationMs || 650) / 1000;
      }
    }

    const selection = this.store.getSelection();
    const activeSlideId =
      selection.type === 'slide' || selection.type === 'transition'
        ? selection.slideId
        : slides[this.latestEngineStatus?.currentSlideIndex ?? this.store.getActivePreviewIndex()]
            ?.id;

    renderTimelineDockView(
      dock,
      this.timelineDockScope,
      {
        slides,
        activeSlideId,
        isTransitionSelected: selection.type === 'transition',
        selectedTransitionSlideId:
          selection.type === 'transition' ? selection.slideId : undefined,
        isCollapsed: this.isTimelineDockCollapsed,
        formattedTotalDuration: this.formatTimecode(totalTransitionSec),
      },
      {
        onOpenCues: () => this.openReelStudioForSelection(),
        onToggleCollapse: () => this.toggleTimelineDock(),
        onSwitchToSide: () => this.setSequenceLayoutPreference('side'),
        onSelectSlide: (slideId) => this.store.setSelection({ type: 'slide', slideId }),
        onContextMenuSlide: (slideId, clientX, clientY) =>
          this.openSlideContextMenu(slideId, clientX, clientY),
        onSelectTransition: (slideId) =>
          this.store.setSelection({ type: 'transition', slideId }),
      }
    );
    this.reconcileWorkspaceLayout();
  }

  private syncTimelineDockActiveState(): void {
    const dock = this.root.querySelector('#studio-timeline-dock') as HTMLElement | null;
    const slides = this.store.getSlides();
    const selection = this.store.getSelection();
    const activeSlideId =
      selection.type === 'slide' || selection.type === 'transition'
        ? selection.slideId
        : slides[this.latestEngineStatus?.currentSlideIndex ?? this.store.getActivePreviewIndex()]
            ?.id;

    syncTimelineDockActiveView(
      dock,
      activeSlideId,
      selection.type === 'transition',
      selection.type === 'transition' ? selection.slideId : undefined
    );
  }

  private toggleTimelineDock(forceCollapsed?: boolean): void {
    this.isTimelineDockCollapsed =
      typeof forceCollapsed === 'boolean' ? forceCollapsed : !this.isTimelineDockCollapsed;
    const dock = this.root.querySelector('#studio-timeline-dock') as HTMLElement | null;
    syncTimelineDockCollapseView(dock, this.isTimelineDockCollapsed);
    this.updateCanvasFrameDimensions(this.store.getSettings());
    this.previewEngine?.resize?.();
  }

  private closeSlideContextMenu(): void {
    this.closeContextMenuFn?.();
    this.closeContextMenuFn = null;
    this.contextMenuScope.clear();
  }

  private openSlideContextMenu(slideId: string, clientX: number, clientY: number): void {
    const host = this.root.querySelector('#context-menu-host') as HTMLElement | null;
    if (!host) return;

    const slides = this.store.getSlides();
    const idx = slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return;

    this.closeSlideContextMenu();

    const closeMenu = openSlideContextMenuView(
      {
        host,
        scope: this.contextMenuScope,
        slideId,
        slideIndex: idx,
        totalSlides: slides.length,
        hasReelContext: Boolean(this.store.getReelContextForSlide?.(slideId)),
        clientX,
        clientY,
      },
      {
        onMoveUp: (id) => this.store.moveSlide(id, 'up'),
        onMoveDown: (id) => this.store.moveSlide(id, 'down'),
        onDuplicate: (id) => {
          if (this.store.duplicateSlide(id)) {
            this.store.notify(t('notify.slideDuplicated'), 'success', 2000);
          }
        },
        onEditTransition: (id) => {
          this.store.setSelection({ type: 'transition', slideId: id });
          if (!this.isInspectorVisible) {
            this.toggleInspectorPane();
          }
        },
        onReplaceImage: (id) => {
          const input = this.root.querySelector('#single-image-input') as HTMLInputElement | null;
          if (input) {
            input.dataset.replaceSlideId = id;
            input.click();
          }
        },
        onOpenCues: (id) => this.openReelStudioForSelection(id),
        onDelete: (id) => this.promptDeleteSlide(id),
      }
    );

    this.closeContextMenuFn = () => {
      if (this.closeContextMenuFn) {
        this.closeContextMenuFn = null;
      }
      closeMenu();
    };
  }

  private getStudioCommandItems(): StudioCommandItem[] {
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
        id: 'cmd-toggle-overview',
        group: t('cmd.groupView'),
        label: t('presenter.gridAria'),
        icon: Icons.grid,
        disabled: !hasSlides,
        run: () => this.toggleStageOverviewGrid(),
      },
      ...STUDIO_SKINS.map((sk) => ({
        id: `cmd-skin-${sk.id}`,
        group: 'Studio Skins',
        label: `Skin: ${sk.name}`,
        icon: Icons.palette,
        run: () => this.applySkinSelection(sk.id),
      })),
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
        id: 'cmd-about-app',
        group: t('cmd.groupView'),
        label: t('toolbar.about'),
        icon: Icons.info,
        run: () => {
          void this.openAboutModal();
        },
      },
      {
        id: 'cmd-start-fullscreen',
        group: t('cmd.groupPresent'),
        label: t('toolbar.playPresentation'),
        shortcut: 'F5',
        icon: Icons.playFill,
        disabled: !hasSlides,
        run: () =>
          this.enterFullscreenPresentation(this.latestEngineStatus?.currentSlideIndex || 0),
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
    if (!preserveQuery) {
      this.commandPaletteQuery = '';
      this.commandPaletteActiveIdx = 0;
    }

    this.isModalOpen = true;
    this.isCommandPaletteOpen = true;
    this.activeModalClose = openCommandPaletteModal({
      host,
      scope: this.modalScope,
      items: this.getStudioCommandItems(),
      initialQuery: this.commandPaletteQuery,
      initialActiveIdx: this.commandPaletteActiveIdx,
      onStateChange: (query, activeIdx) => {
        this.commandPaletteQuery = query;
        this.commandPaletteActiveIdx = activeIdx;
      },
      onBeforeClose: () => {
        this.isModalOpen = false;
        this.isCommandPaletteOpen = false;
        this.activeModalClose = null;
      },
    });
  }

  public async openAboutModal(): Promise<void> {
    this.activeModalClose?.();
    const host = (this.root.querySelector('#shortcuts-modal-host') ||
      this.root.querySelector('#choice-modal-host')) as HTMLElement | null;
    if (!host) return;

    let version = FALLBACK_APP_VERSION;
    try {
      const resolved = await window.desktopAPI?.getAppVersion?.();
      if (resolved && resolved.trim()) {
        version = resolved.trim();
      }
    } catch {
      // Fallback to compile-time version when desktopAPI is absent
    }

    this.isModalOpen = true;
    this.activeModalClose = openAboutModalView(host, this.modalScope, version, () => {
      this.isModalOpen = false;
      this.activeModalClose = null;
    });
  }

  public openShortcutsHelpModal(): void {
    this.activeModalClose?.();
    const host = (this.root.querySelector('#shortcuts-modal-host') ||
      this.root.querySelector('#choice-modal-host')) as HTMLElement | null;
    if (!host) return;

    this.isModalOpen = true;
    this.activeModalClose = openShortcutsHelpModalView(host, this.modalScope, () => {
      this.isModalOpen = false;
      this.activeModalClose = null;
    });
  }

  public closeShortcutsHelpModal(): void {
    const backdrop = this.root.querySelector('#shortcuts-modal-backdrop');
    if (backdrop) {
      this.activeModalClose?.();
    }
  }

  private escapeHtml(str: string): string {
    return escapeHtml(str);
  }
}
