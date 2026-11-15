import { StagePlaybackEngine } from '../../core/engine/StagePlaybackEngine';
import {
  AppLanguage,
  EngineStatus,
  MediaAsset,
  PresentationSettings,
  SlideNode,
} from '../../core/domain/types';
import { isRtlLanguage, setLanguage, t } from '../../core/i18n';
import { escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';

export interface SerializedBlobAsset {
  buffer: ArrayBuffer;
  mimeType: string;
  name: string;
}

export interface PresenterWindowPayload {
  slides: SlideNode[];
  settings: PresentationSettings;
  startSlideIndex: number;
  language: AppLanguage;
  theme: 'dark' | 'light';
  blobAssets?: Record<string, SerializedBlobAsset>;
}

/**
 * Dedicated Presenter Window controller mounted when `window.location.search`
 * contains `?presenter=1`. Mirrors full keyboard, mouse, notes, grid,
 * blackout, and live Studio remote-control semantics without Studio chrome collisions.
 */
export class PresenterWindowApp {
  private root: HTMLElement;
  private engine: StagePlaybackEngine | null = null;
  private slides: SlideNode[] = [];
  private settings: PresentationSettings | null = null;
  private createdObjectUrls: string[] = [];
  private isNotesOpen = false;
  private isGridOpen = false;
  private isLaserActive = false;
  private notesFontSize = 15;
  private hudHideTimer: number | null = null;
  private indicatorHideTimer: number | null = null;
  private unsubInit: (() => void) | null = null;
  private unsubCommand: (() => void) | null = null;
  private lastSlideIndex = 0;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  mount(): void {
    document.documentElement.classList.add('presenter-window-mode');
    this.renderShell();
    this.bindGlobalEvents();

    const api = (window as unknown as {
      desktopAPI?: {
        signalPresenterReady?: () => void;
        onPresenterInit?: (cb: (payload: PresenterWindowPayload) => void) => () => void;
        onPresenterCommand?: (cb: (cmd: { type: string; slideIndex?: number }) => void) => () => void;
      };
    }).desktopAPI;

    if (api?.onPresenterInit) {
      this.unsubInit = api.onPresenterInit((payload) => {
        void this.loadPayload(payload);
      });
    }

    if (api?.onPresenterCommand) {
      this.unsubCommand = api.onPresenterCommand((cmd) => {
        this.handleRemoteCommand(cmd);
      });
    }

    api?.signalPresenterReady?.();
  }

  dispose(): void {
    this.unsubInit?.();
    this.unsubCommand?.();
    this.engine?.destroy();
    this.engine = null;
    for (const url of this.createdObjectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revoke cleanup errors
      }
    }
    this.createdObjectUrls = [];
  }

  private renderShell(): void {
    const rtl = isRtlLanguage();
    this.root.innerHTML = `
      <div class="fullscreen-presenter" id="fs-presenter" tabindex="0">
        <div class="presenter-top-progress" id="fs-top-progress">
          <div class="presenter-top-progress-bar" id="fs-top-bar" style="width:0%"></div>
        </div>
        <canvas class="presenter-canvas" id="fs-canvas"></canvas>
        <div class="presenter-blank-overlay hidden" id="fs-blank-overlay"></div>
        <div class="presenter-laser-dot hidden" id="fs-laser-dot" aria-hidden="true"></div>
        <div class="presenter-slide-indicator hidden" id="fs-slide-indicator" aria-live="polite"></div>

        <div class="presenter-hud" id="fs-hud">
          <button class="hud-transport-btn" id="fs-btn-prev" title="${escapeHtml(t('presenter.prevTitle'))}" aria-label="${escapeHtml(t('presenter.prevAria'))}" type="button">
            ${rtl ? Icons.chevronRight : Icons.chevronLeft}
          </button>
          <span id="fs-hud-label" class="tabular-nums" style="font-weight:600; min-width:86px; text-align:center;">01 / 01</span>
          <button class="hud-step-btn" id="fs-btn-next" title="${escapeHtml(t('presenter.nextTitle'))}" aria-label="${escapeHtml(t('presenter.nextAria'))}" type="button">
            <span>${escapeHtml(t('presenter.nextLabel'))}</span>
            ${rtl ? Icons.chevronLeft : Icons.chevronRight}
          </button>
          <div class="toolbar-divider"></div>
          <button class="hud-transport-btn" id="fs-btn-blackout" title="${escapeHtml(t('presenter.blackoutLabel'))}" type="button">${Icons.moon}</button>
          <button class="hud-transport-btn" id="fs-btn-laser" title="Ctrl+L" type="button">${Icons.cuePin}</button>
          <button class="hud-transport-btn" id="fs-btn-notes" title="${escapeHtml(t('presenter.notesTitle'))}" aria-label="${escapeHtml(t('presenter.notesAria'))}" type="button">${Icons.notes}</button>
          <button class="hud-transport-btn" id="fs-btn-grid" title="${escapeHtml(t('presenter.gridTitle'))}" aria-label="${escapeHtml(t('presenter.gridAria'))}" type="button">${Icons.grid}</button>
          <button class="hud-transport-btn" id="fs-btn-exit" title="${escapeHtml(t('presenter.exitTitle'))}" aria-label="${escapeHtml(t('presenter.exitAria'))}" type="button">${Icons.close}</button>
        </div>

        <div class="presenter-notes-drawer hidden" id="fs-notes-drawer" role="region" aria-label="${escapeHtml(t('presenter.notesDrawerAria'))}">
          <div class="presenter-notes-header">
            <span class="presenter-notes-title" id="fs-notes-slide-title" dir="auto">${escapeHtml(t('presenter.notesHeader'))}</span>
            <div class="presenter-notes-controls">
              <button class="btn btn-xs" id="fs-notes-font-dec" type="button" title="${escapeHtml(t('presenter.notesFontDec'))}">A-</button>
              <button class="btn btn-xs" id="fs-notes-font-inc" type="button" title="${escapeHtml(t('presenter.notesFontInc'))}">A+</button>
              <button class="btn btn-xs" id="fs-notes-close" type="button" title="${escapeHtml(t('presenter.closeShortcut'))}">${Icons.close}</button>
            </div>
          </div>
          <div class="presenter-notes-body" id="fs-notes-body" dir="auto" style="font-size:${this.notesFontSize}px;"></div>
          <div class="presenter-notes-footer" id="fs-notes-next-slide" dir="auto"></div>
        </div>
        <div id="fs-grid-host"></div>
      </div>
    `;
  }

  private async loadPayload(payload: PresenterWindowPayload): Promise<void> {
    if (!payload) return;
    if (payload.language) {
      setLanguage(payload.language, { persist: false, syncDesktop: false });
      document.documentElement.dir = isRtlLanguage() ? 'rtl' : 'ltr';
      document.documentElement.lang = payload.language;
    }
    document.documentElement.setAttribute('data-theme', payload.theme || 'dark');

    // Rehydrate blob: object URLs transferred across BrowserWindow contexts
    for (const url of this.createdObjectUrls) {
      URL.revokeObjectURL(url);
    }
    this.createdObjectUrls = [];

    const blobMap = payload.blobAssets || {};
    const rehydrateAsset = (asset: MediaAsset | null | undefined): MediaAsset | null | undefined => {
      if (!asset) return asset;
      const entry = blobMap[asset.id];
      if (!entry) return asset;
      const url = URL.createObjectURL(new Blob([entry.buffer], { type: entry.mimeType }));
      this.createdObjectUrls.push(url);
      return { ...asset, objectUrl: url, thumbnailUrl: asset.thumbnailUrl?.startsWith('blob:') ? url : asset.thumbnailUrl };
    };

    this.slides = (payload.slides || []).map((slide) => ({
      ...slide,
      imageAsset: rehydrateAsset(slide.imageAsset) as MediaAsset,
      idleLoopAsset: rehydrateAsset(slide.idleLoopAsset),
      transitionToNext: {
        ...slide.transitionToNext,
        videoAsset: rehydrateAsset(slide.transitionToNext?.videoAsset) ?? null,
      },
    }));
    this.settings = payload.settings;
    this.lastSlideIndex = Math.max(0, Math.min(payload.startSlideIndex || 0, Math.max(0, this.slides.length - 1)));

    const fsRoot = this.root.querySelector('#fs-presenter') as HTMLElement | null;
    if (fsRoot && this.settings) {
      const ratioMap: Record<PresentationSettings['aspectRatio'], number> = {
        '16:9': 16 / 9,
        '16:10': 16 / 10,
        '4:3': 4 / 3,
        '9:16': 9 / 16,
      };
      fsRoot.style.setProperty('--presenter-aspect-ratio', String(ratioMap[this.settings.aspectRatio] || 16 / 9));
    }

    const canvas = this.root.querySelector('#fs-canvas') as HTMLCanvasElement | null;
    if (!canvas || !this.settings) return;

    this.engine?.destroy();
    this.engine = new StagePlaybackEngine(canvas, this.settings);
    this.engine.onStatusChange((st) => {
      this.lastSlideIndex = st.currentSlideIndex;
      this.updateHud(st);
      const api = (window as unknown as {
        desktopAPI?: { emitPresenterStatus?: (status: Record<string, unknown>) => void };
      }).desktopAPI;
      api?.emitPresenterStatus?.({
        slideIndex: st.currentSlideIndex,
        totalSlides: this.slides.length,
        phase: st.phase,
        isBlank: st.phase === 'BLACKOUT' || st.phase === 'WHITEOUT',
      });
    });

    await this.engine.loadProject(this.slides, this.settings, this.lastSlideIndex);
    fsRoot?.focus();
    this.wakeHud();
  }

  private handleRemoteCommand(cmd: { type: string; slideIndex?: number }): void {
    if (!cmd) return;
    switch (cmd.type) {
      case 'next':
        this.engine?.next();
        break;
      case 'prev':
        this.engine?.previous();
        break;
      case 'go-to-slide':
        if (typeof cmd.slideIndex === 'number') {
          this.engine?.jumpToSlide(cmd.slideIndex, true);
        }
        break;
      case 'toggle-blank':
        this.engine?.toggleBlackout();
        break;
      case 'exit':
        this.requestExit();
        break;
    }
  }

  private updateHud(st: EngineStatus): void {
    const label = this.root.querySelector('#fs-hud-label') as HTMLElement | null;
    const topBar = this.root.querySelector('#fs-top-bar') as HTMLElement | null;
    const blankOverlay = this.root.querySelector('#fs-blank-overlay') as HTMLElement | null;
    const total = this.slides.length;
    const currentStr = String(st.currentSlideIndex + 1).padStart(2, '0');
    const totalStr = String(Math.max(1, total)).padStart(2, '0');

    if (label) {
      if (st.phase === 'BLACKOUT') {
        label.textContent = t('presenter.blackoutLabel');
      } else if (st.phase === 'WHITEOUT') {
        label.textContent = t('presenter.whiteoutLabel');
      } else {
        label.textContent = `${currentStr} / ${totalStr}`;
      }
    }

    if (topBar && total > 0) {
      const pct = Math.min(100, Math.max(0, ((st.currentSlideIndex + 1) / total) * 100));
      topBar.style.width = `${pct}%`;
    }

    if (blankOverlay) {
      blankOverlay.classList.toggle('hidden', st.phase !== 'BLACKOUT' && st.phase !== 'WHITEOUT');
      blankOverlay.classList.toggle('black', st.phase === 'BLACKOUT');
      blankOverlay.classList.toggle('white', st.phase === 'WHITEOUT');
    }

    this.root.querySelector('#fs-btn-blackout')?.classList.toggle('active', st.phase === 'BLACKOUT');

    const activeSlide = this.slides[st.currentSlideIndex];
    const nextSlide = this.slides[st.currentSlideIndex + 1];
    const notesTitle = this.root.querySelector('#fs-notes-slide-title');
    if (notesTitle) {
      notesTitle.textContent = activeSlide?.title || t('presenter.notesHeader');
    }
    const notesBody = this.root.querySelector('#fs-notes-body');
    if (notesBody) {
      notesBody.textContent = activeSlide?.notes?.trim() || t('presenter.notesEmpty');
    }
    const notesFooter = this.root.querySelector('#fs-notes-next-slide');
    if (notesFooter) {
      notesFooter.textContent = nextSlide
        ? t('presenter.notesNextSlide', { title: nextSlide.title })
        : t('presenter.notesEnd');
    }
  }

  private toggleNotes(): void {
    this.isNotesOpen = !this.isNotesOpen;
    this.root.querySelector('#fs-notes-drawer')?.classList.toggle('hidden', !this.isNotesOpen);
    this.root.querySelector('#fs-btn-notes')?.classList.toggle('active', this.isNotesOpen);
  }

  private toggleGrid(): void {
    this.isGridOpen = !this.isGridOpen;
    const host = this.root.querySelector('#fs-grid-host') as HTMLElement | null;
    this.root.querySelector('#fs-btn-grid')?.classList.toggle('active', this.isGridOpen);
    if (!host) return;
    if (!this.isGridOpen) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = `
      <div class="presenter-grid-overlay" id="fs-grid-overlay">
        <div class="presenter-grid-header">
          <span>${escapeHtml(t('presenter.gridTitle'))}</span>
          <button class="btn btn-sm" id="fs-grid-close" type="button">${Icons.close}</button>
        </div>
        <div class="presenter-grid-cards">
          ${this.slides
            .map((slide, i) => {
              const url = slide.imageAsset?.thumbnailUrl || slide.imageAsset?.objectUrl || '';
              return `
                <button class="grid-jump-card ${i === this.lastSlideIndex ? 'active' : ''}" data-index="${i}" type="button">
                  ${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(slide.title)}" />` : '<div class="grid-card-placeholder"></div>'}
                  <span class="grid-jump-label" dir="auto">${i + 1}. ${escapeHtml(slide.title)}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
    host.querySelector('#fs-grid-close')?.addEventListener('click', () => this.toggleGrid());
    host.querySelectorAll('.grid-jump-card').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = Number((card as HTMLElement).dataset.index);
        if (Number.isFinite(idx)) {
          this.engine?.jumpToSlide(idx, true);
        }
        this.toggleGrid();
      });
    });
  }

  private wakeHud(): void {
    const hud = this.root.querySelector('#fs-hud');
    const fsRoot = this.root.querySelector('#fs-presenter');
    hud?.classList.remove('hide-cursor');
    fsRoot?.classList.remove('hide-cursor');
    if (this.hudHideTimer) window.clearTimeout(this.hudHideTimer);
    this.hudHideTimer = window.setTimeout(() => {
      fsRoot?.classList.add('hide-cursor');
    }, 2800);
  }

  private flashIndicator(text: string): void {
    const el = this.root.querySelector('#fs-slide-indicator') as HTMLElement | null;
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.add('visible');
    if (this.indicatorHideTimer) window.clearTimeout(this.indicatorHideTimer);
    this.indicatorHideTimer = window.setTimeout(() => {
      el.classList.remove('visible');
      el.classList.add('hidden');
    }, 1200);
  }

  private requestExit(): void {
    const api = (window as unknown as {
      desktopAPI?: { requestClosePresenter?: (lastSlideIndex: number) => void };
    }).desktopAPI;
    if (api?.requestClosePresenter) {
      api.requestClosePresenter(this.lastSlideIndex);
    } else {
      window.close();
    }
  }

  private bindGlobalEvents(): void {
    const canvas = this.root.querySelector('#fs-canvas');
    const blank = this.root.querySelector('#fs-blank-overlay');
    const fsRoot = this.root.querySelector('#fs-presenter') as HTMLElement | null;
    const laserDot = this.root.querySelector('#fs-laser-dot') as HTMLElement | null;

    canvas?.addEventListener('click', () => {
      if (!this.isGridOpen) this.engine?.next();
    });
    canvas?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.isGridOpen) this.engine?.previous();
    });
    blank?.addEventListener('click', () => {
      if (!this.isGridOpen) this.engine?.next();
    });

    this.root.querySelector('#fs-btn-prev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.engine?.previous();
    });
    this.root.querySelector('#fs-btn-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.engine?.next();
    });
    this.root.querySelector('#fs-btn-blackout')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.engine?.toggleBlackout();
    });
    this.root.querySelector('#fs-btn-laser')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleLaser();
    });
    this.root.querySelector('#fs-btn-notes')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleNotes();
    });
    this.root.querySelector('#fs-btn-grid')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleGrid();
    });
    this.root.querySelector('#fs-btn-exit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.requestExit();
    });

    this.root.querySelector('#fs-notes-close')?.addEventListener('click', () => this.toggleNotes());
    this.root.querySelector('#fs-notes-font-inc')?.addEventListener('click', () => {
      this.notesFontSize = Math.min(28, this.notesFontSize + 2);
      const body = this.root.querySelector('#fs-notes-body') as HTMLElement | null;
      if (body) body.style.fontSize = `${this.notesFontSize}px`;
    });
    this.root.querySelector('#fs-notes-font-dec')?.addEventListener('click', () => {
      this.notesFontSize = Math.max(12, this.notesFontSize - 2);
      const body = this.root.querySelector('#fs-notes-body') as HTMLElement | null;
      if (body) body.style.fontSize = `${this.notesFontSize}px`;
    });

    fsRoot?.addEventListener('mousemove', (e) => {
      this.wakeHud();
      if (this.isLaserActive && laserDot) {
        laserDot.style.left = `${e.clientX}px`;
        laserDot.style.top = `${e.clientY}px`;
      }
    });

    window.addEventListener('keydown', (e) => {
      this.wakeHud();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.isGridOpen) this.toggleGrid();
        else if (this.isLaserActive) this.toggleLaser(false);
        else this.requestExit();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (isRtlLanguage() && e.key === 'ArrowRight') this.engine?.previous();
        else this.engine?.next();
        this.flashIndicator(`${this.lastSlideIndex + 1} / ${this.slides.length}`);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace' || e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (isRtlLanguage() && e.key === 'ArrowLeft') this.engine?.next();
        else this.engine?.previous();
        this.flashIndicator(`${this.lastSlideIndex + 1} / ${this.slides.length}`);
        return;
      }
      if (e.key.toLowerCase() === 'b' || e.key === '.') {
        e.preventDefault();
        this.engine?.toggleBlackout();
        return;
      }
      if (e.key.toLowerCase() === 'w' || e.key === ',' || e.key === '،') {
        e.preventDefault();
        this.engine?.toggleWhiteout();
        return;
      }
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.toggleNotes();
        return;
      }
      if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        this.toggleGrid();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.toggleLaser();
      }
    });
  }

  private toggleLaser(force?: boolean): void {
    this.isLaserActive = typeof force === 'boolean' ? force : !this.isLaserActive;
    const laserDot = this.root.querySelector('#fs-laser-dot');
    const fsRoot = this.root.querySelector('#fs-presenter');
    laserDot?.classList.toggle('hidden', !this.isLaserActive);
    laserDot?.classList.toggle('visible', this.isLaserActive);
    fsRoot?.classList.toggle('laser-active', this.isLaserActive);
    this.root.querySelector('#fs-btn-laser')?.classList.toggle('active', this.isLaserActive);
  }
}
