import {
  AspectRatioOption,
  BackwardBehavior,
  FallbackTransitionStyle,
  FitMode,
  HudVisibility,
  InterruptBehavior,
  PresentationSettings,
  SlideNode,
} from '../../core/domain/types';
import { isRtlLanguage, t } from '../../core/i18n';
import { FrameExtractor, VideoFrameExtractorSession } from '../../core/services/FrameExtractor';
import { enhanceAppleSelects } from '../components/AppleDropdown';
import { STAGE_COLOR_SWATCHES } from '../theme';
import {
  renderSurgicalAiPromptMarkup,
  SurgicalAiPromptWireCallbacks,
  SurgicalAiScope,
  wireSurgicalAiPromptView,
} from '../components/SurgicalAiPromptView';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import type { LayerStack } from '../core/LayerStack';
import { attachModalDialogBehavior } from '../core/ModalDialog';
import { Icons } from '../icons';

export type SequenceLayoutPreference = 'auto' | 'bottom' | 'side' | 'hidden';

export interface StageSettingsPopoverProps {
  host: HTMLElement | null;
  scope: ComponentScope;
  settings: PresentationSettings;
  sequenceLayoutPref: SequenceLayoutPreference;
  anchorEl?: HTMLElement | null;
  layerStack?: LayerStack;
  onUpdateSettings: (partial: Partial<PresentationSettings>) => void;
  onChangeSequenceLayout: (pref: SequenceLayoutPreference) => void;
  onClose: () => void;
}

export function openStageSettingsPopover(props: StageSettingsPopoverProps): () => void {
  const { host, scope, settings } = props;
  if (!host) return () => {};
  scope.clear();

  const ratios: Array<{ id: AspectRatioOption; label: string; w: number; h: number }> = [
    { id: '16:9', label: '16:9', w: 22, h: 13 },
    { id: '16:10', label: '16:10', w: 21, h: 14 },
    { id: '4:3', label: '4:3', w: 19, h: 15 },
    { id: '9:16', label: '9:16', w: 13, h: 22 },
  ];

  const layouts: Array<{ id: SequenceLayoutPreference; label: string }> = [
    { id: 'auto', label: t('layout.autoMode') },
    { id: 'bottom', label: t('layout.bottomMode') },
    { id: 'side', label: t('layout.sideMode') },
    { id: 'hidden', label: t('layout.hiddenMode') },
  ];

  host.innerHTML = `
    <div class="apple-popover-backdrop" id="stage-settings-backdrop">
      <div class="stage-settings-popover" id="stage-settings-card" role="dialog" aria-label="${escapeHtml(t('modal.stageSettingsTitle'))}">
        <div class="skin-popover-head">
          <div class="skin-popover-title">
            ${Icons.ratio}
            <span>${escapeHtml(t('modal.stageSettingsTitle'))}</span>
          </div>
          <button type="button" class="btn btn-icon-only" id="btn-close-stage-popover" aria-label="${escapeHtml(t('modal.close'))}">
            ${Icons.close}
          </button>
        </div>

        <div class="stage-pop-section">
          <span class="prop-label">${escapeHtml(t('settings.aspectRatioLabel'))}</span>
          <div class="stage-ratio-grid">
            ${ratios
              .map(
                (r) => `
              <button
                type="button"
                class="stage-ratio-pill ${settings.aspectRatio === r.id ? 'active' : ''}"
                data-pick-ratio="${r.id}"
              >
                <span class="stage-ratio-glyph" style="width:${r.w}px;height:${r.h}px;"></span>
                <span class="tabular-nums">${r.label}</span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="stage-pop-section">
          <span class="prop-label">${escapeHtml(t('settings.fitModeLabel'))}</span>
          <div class="skin-mode-segmented is-two-col" role="group" aria-label="${escapeHtml(t('settings.fitModeLabel'))}">
            <button type="button" class="skin-mode-btn ${settings.fitMode === 'contain' ? 'active' : ''}" data-pick-fit="contain">
              <span>${escapeHtml(t('settings.fitContain'))}</span>
            </button>
            <button type="button" class="skin-mode-btn ${settings.fitMode === 'cover' ? 'active' : ''}" data-pick-fit="cover">
              <span>${escapeHtml(t('settings.fitCover'))}</span>
            </button>
          </div>
        </div>

        <div class="stage-pop-section">
          <span class="prop-label">${escapeHtml(t('layout.sequenceLabel'))}</span>
          <div class="stage-layout-grid">
            ${layouts
              .map(
                (l) => `
              <button
                type="button"
                class="stage-layout-pill ${props.sequenceLayoutPref === l.id ? 'active' : ''}"
                data-pick-layout="${l.id}"
              >
                <span>${escapeHtml(l.label)}</span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="stage-pop-section">
          <div class="prop-label">
            <span>${escapeHtml(t('settings.stageBgLabel'))}</span>
            <div class="stage-color-composite">
              <input type="color" id="pop-stage-bg" class="stage-color-picker" value="${escapeHtml(settings.stageBackground || '#05070B')}" aria-label="${escapeHtml(t('settings.stageBgLabel'))}" />
              <input type="text" id="pop-stage-bg-text" class="stage-hex-input tabular-nums" dir="ltr" value="${escapeHtml(settings.stageBackground || '#05070B')}" aria-label="Hex" />
            </div>
          </div>
          <div class="stage-color-swatches" role="group" aria-label="${escapeHtml(t('settings.stageSwatchesLabel'))}">
            ${STAGE_COLOR_SWATCHES.map((sw) => {
              const active = (settings.stageBackground || '#05070B').toUpperCase() === sw.hex.toUpperCase();
              const label = t(sw.labelKey);
              const isLightSwatch = sw.id === 'paper' || sw.id === 'daylight';
              return `<button type="button" class="stage-swatch-btn ${active ? 'active' : ''}" data-stage-hex="${sw.hex}" data-light-swatch="${isLightSwatch ? 'true' : 'false'}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" aria-pressed="${active ? 'true' : 'false'}" style="background:${sw.hex};"></button>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  const card = host.querySelector('#stage-settings-card') as HTMLElement | null;
  if (card && typeof window !== 'undefined') {
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const measuredRect = card.getBoundingClientRect?.();
    const cardHeight = Math.min(vh - 24, Math.max(260, Math.round(measuredRect?.height || 460)));
    const cardWidth = Math.min(vw - 24, Math.max(280, Math.round(measuredRect?.width || 320)));
    const rtl = isRtlLanguage();
    const rect = props.anchorEl?.getBoundingClientRect?.();
    const desiredTop = rect && rect.width > 0 ? rect.bottom + 8 : 54;
    const top = Math.max(12, Math.min(vh - cardHeight - 12, desiredTop));
    card.style.top = `${top}px`;
    card.style.maxHeight = `${Math.max(220, vh - top - 12)}px`;
    if (rect && rect.width > 0) {
      if (rtl) {
        card.style.left = `${Math.max(12, Math.min(vw - cardWidth - 12, rect.left))}px`;
        card.style.right = 'auto';
      } else {
        card.style.right = `${Math.max(12, Math.min(vw - cardWidth - 12, vw - rect.right))}px`;
        card.style.left = 'auto';
      }
    } else {
      card.style.left = `${Math.max(12, Math.round((vw - cardWidth) / 2))}px`;
      card.style.right = 'auto';
    }
  }

  const backdrop = host.querySelector('#stage-settings-backdrop') as HTMLElement;
  const dialog = host.querySelector('#stage-settings-card') as HTMLElement | null;
  const closeBtn = host.querySelector('#btn-close-stage-popover') as HTMLElement | null;

  const close = attachModalDialogBehavior({
    host,
    scope,
    backdropEl: backdrop,
    dialogEl: dialog,
    layerStack: props.layerStack,
    layerId: 'stage-settings-popover',
    layerKind: 'popover',
    initialFocusEl: closeBtn,
    onAfterClose: props.onClose,
  });

  if (closeBtn) scope.listen(closeBtn, 'click', close);

  host.querySelectorAll('[data-pick-ratio]').forEach((btn) => {
    scope.listen(btn, 'click', () => {
      const ratio = (btn as HTMLElement).dataset.pickRatio as AspectRatioOption | undefined;
      if (!ratio) return;
      host.querySelectorAll('[data-pick-ratio]').forEach((b) =>
        b.classList.toggle('active', (b as HTMLElement).dataset.pickRatio === ratio)
      );
      props.onUpdateSettings({ aspectRatio: ratio });
    });
  });

  host.querySelectorAll('[data-pick-fit]').forEach((btn) => {
    scope.listen(btn, 'click', () => {
      const fit = (btn as HTMLElement).dataset.pickFit as FitMode | undefined;
      if (!fit) return;
      host.querySelectorAll('[data-pick-fit]').forEach((b) =>
        b.classList.toggle('active', (b as HTMLElement).dataset.pickFit === fit)
      );
      props.onUpdateSettings({ fitMode: fit });
    });
  });

  host.querySelectorAll('[data-pick-layout]').forEach((btn) => {
    scope.listen(btn, 'click', () => {
      const pref = (btn as HTMLElement).dataset.pickLayout as SequenceLayoutPreference | undefined;
      if (!pref) return;
      host.querySelectorAll('[data-pick-layout]').forEach((b) =>
        b.classList.toggle('active', (b as HTMLElement).dataset.pickLayout === pref)
      );
      props.onChangeSequenceLayout(pref);
    });
  });

  const colorPick = host.querySelector('#pop-stage-bg') as HTMLInputElement | null;
  const colorText = host.querySelector('#pop-stage-bg-text') as HTMLInputElement | null;

  const syncBg = (hex: string) => {
    if (colorPick) colorPick.value = hex;
    if (colorText) colorText.value = hex;
    host.querySelectorAll('[data-stage-hex]').forEach((b) => {
      const active = ((b as HTMLElement).dataset.stageHex || '').toUpperCase() === hex.toUpperCase();
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };

  scope.listen(colorPick, 'input', () => {
    if (!colorPick) return;
    syncBg(colorPick.value);
    props.onUpdateSettings({ stageBackground: colorPick.value });
  });
  scope.listen(colorText, 'change', () => {
    const val = (colorText?.value || '').trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      syncBg(val);
      props.onUpdateSettings({ stageBackground: val });
    }
  });
  host.querySelectorAll('[data-stage-hex]').forEach((btn) => {
    scope.listen(btn, 'click', () => {
      const hex = (btn as HTMLElement).dataset.stageHex;
      if (!hex) return;
      syncBg(hex);
      props.onUpdateSettings({ stageBackground: hex });
    });
  });

  return close;
}

export interface EnginePreferencesModalProps {
  host: HTMLElement | null;
  scope: ComponentScope;
  settings: PresentationSettings;
  layerStack?: LayerStack;
  onUpdateSettings: (partial: Partial<PresentationSettings>) => void;
  onClose: () => void;
}

export function openEnginePreferencesModal(props: EnginePreferencesModalProps): void {
  const { host, scope, settings } = props;
  if (!host) return;
  scope.clear();

  host.innerHTML = `
    <div class="modal-backdrop" id="workspace-modal-backdrop">
      <div class="modal-card apple-sheet-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('modal.enginePrefsTitle'))}">
        <div class="modal-header">
          <span class="modal-title">${Icons.sliders} <span>${escapeHtml(t('modal.enginePrefsTitle'))}</span></span>
          <button type="button" class="btn btn-icon-only" id="btn-close-workspace-modal" aria-label="${escapeHtml(t('modal.close'))}">
            ${Icons.close}
          </button>
        </div>

        <div class="modal-body apple-sheet-grid">
          <div class="apple-sheet-card">
            <div class="inspector-group-title"><span>${escapeHtml(t('settings.behaviorSection'))}</span></div>

            <div class="prop-row">
              <label class="prop-label" for="mod-interrupt-behavior">${escapeHtml(t('settings.interruptLabel'))}</label>
              <select class="select-field" id="mod-interrupt-behavior">
                <option value="skip" ${settings.interruptBehavior === 'skip' ? 'selected' : ''}>${escapeHtml(t('settings.interruptSkip'))}</option>
                <option value="lock" ${settings.interruptBehavior === 'lock' ? 'selected' : ''}>${escapeHtml(t('settings.interruptLock'))}</option>
                <option value="fast-forward" ${settings.interruptBehavior === 'fast-forward' ? 'selected' : ''}>${escapeHtml(t('settings.interruptFF'))}</option>
              </select>
            </div>

            <div class="prop-row">
              <label class="prop-label" for="mod-backward-behavior">${escapeHtml(t('settings.backwardLabel'))}</label>
              <select class="select-field" id="mod-backward-behavior">
                <option value="reverse-step" ${settings.backwardBehavior === 'reverse-step' ? 'selected' : ''}>${escapeHtml(t('settings.backwardReverse'))}</option>
                <option value="crossfade" ${settings.backwardBehavior === 'crossfade' ? 'selected' : ''}>${escapeHtml(t('settings.backwardCrossfade'))}</option>
                <option value="instant" ${settings.backwardBehavior === 'instant' ? 'selected' : ''}>${escapeHtml(t('settings.backwardInstant'))}</option>
              </select>
            </div>

            <div class="prop-row">
              <label class="prop-label" for="mod-global-speed">
                <span>${escapeHtml(t('settings.globalSpeedLabel'))}</span>
                <span class="tabular-nums" id="mod-lbl-global-speed">${settings.globalPlaybackSpeed.toFixed(2)}×</span>
              </label>
              <input type="range" id="mod-global-speed" min="0.5" max="2.0" step="0.05" value="${settings.globalPlaybackSpeed}" />
            </div>

            <div class="prop-row-inline">
              <label class="prop-label" for="mod-loop" style="cursor:pointer;">${escapeHtml(t('settings.loopLabel'))}</label>
              <input type="checkbox" id="mod-loop" ${settings.loopPresentation ? 'checked' : ''} />
            </div>
          </div>

          <div class="apple-sheet-card">
            <div class="inspector-group-title"><span>${escapeHtml(t('settings.displayAudioSection'))}</span></div>

            <div class="prop-row">
              <label class="prop-label" for="mod-hud">${escapeHtml(t('settings.hudLabel'))}</label>
              <select class="select-field" id="mod-hud">
                <option value="minimal" ${settings.showPresenterHud === 'minimal' ? 'selected' : ''}>${escapeHtml(t('settings.hudMinimal'))}</option>
                <option value="progress-bar" ${settings.showPresenterHud === 'progress-bar' ? 'selected' : ''}>${escapeHtml(t('settings.hudProgress'))}</option>
                <option value="hidden" ${settings.showPresenterHud === 'hidden' ? 'selected' : ''}>${escapeHtml(t('settings.hudHidden'))}</option>
              </select>
            </div>

            <div class="prop-row">
              <label class="prop-label" for="mod-preload-strategy">${escapeHtml(t('settings.preloadLabel'))}</label>
              <select class="select-field" id="mod-preload-strategy">
                <option value="all" ${settings.preloadStrategy === 'all' ? 'selected' : ''}>${escapeHtml(t('settings.preloadAll'))}</option>
                <option value="adjacent" ${settings.preloadStrategy === 'adjacent' ? 'selected' : ''}>${escapeHtml(t('settings.preloadAdjacent'))}</option>
              </select>
            </div>

            <div class="prop-row">
              <label class="prop-label" for="mod-default-fallback-style">${escapeHtml(t('settings.defaultFallbackLabel'))}</label>
              <select class="select-field" id="mod-default-fallback-style">
                <option value="crossfade" ${settings.defaultFallbackStyle === 'crossfade' ? 'selected' : ''}>${escapeHtml(t('fallback.full.crossfade'))}</option>
                <option value="zoom-morph" ${settings.defaultFallbackStyle === 'zoom-morph' ? 'selected' : ''}>${escapeHtml(t('fallback.full.zoom-morph'))}</option>
                <option value="slide-push" ${settings.defaultFallbackStyle === 'slide-push' ? 'selected' : ''}>${escapeHtml(t('fallback.full.slide-push'))}</option>
                <option value="wipe-reveal" ${settings.defaultFallbackStyle === 'wipe-reveal' ? 'selected' : ''}>${escapeHtml(t('fallback.full.wipe-reveal'))}</option>
                <option value="iris-spotlight" ${settings.defaultFallbackStyle === 'iris-spotlight' ? 'selected' : ''}>${escapeHtml(t('fallback.full.iris-spotlight'))}</option>
                <option value="cut" ${settings.defaultFallbackStyle === 'cut' ? 'selected' : ''}>${escapeHtml(t('fallback.full.cut'))}</option>
              </select>
            </div>

            <div class="prop-row">
              <label class="prop-label" for="mod-default-fallback-dur">${escapeHtml(t('settings.defaultFallbackDurLabel'))}</label>
              <input type="number" id="mod-default-fallback-dur" class="input-field tabular-nums" min="100" max="3000" step="50" value="${settings.defaultFallbackDurationMs}" />
            </div>

            <div class="prop-row-inline">
              <label class="prop-label" for="mod-autohide-cursor" style="cursor:pointer;">${escapeHtml(t('settings.autohideCursorLabel'))}</label>
              <input type="checkbox" id="mod-autohide-cursor" ${settings.autoHideCursor ? 'checked' : ''} />
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-prominent" id="btn-done-workspace-modal">${escapeHtml(t('modal.done'))}</button>
        </div>
      </div>
    </div>
  `;

  enhanceAppleSelects(host, scope, props.layerStack);

  const backdrop = host.querySelector('#workspace-modal-backdrop') as HTMLElement;
  const dialog = host.querySelector('.modal-card') as HTMLElement | null;
  const closeBtn = host.querySelector('#btn-close-workspace-modal') as HTMLElement | null;
  const doneBtn = host.querySelector('#btn-done-workspace-modal') as HTMLElement | null;

  const close = attachModalDialogBehavior({
    host,
    scope,
    backdropEl: backdrop,
    dialogEl: dialog,
    layerStack: props.layerStack,
    layerId: 'workspace-modal',
    layerKind: 'modal',
    initialFocusEl: host.querySelector('#mod-interrupt-behavior') as HTMLElement | null ?? closeBtn,
    onAfterClose: props.onClose,
  });

  if (closeBtn) scope.listen(closeBtn, 'click', close);
  if (doneBtn) scope.listen(doneBtn, 'click', close);

  const interruptSel = host.querySelector('#mod-interrupt-behavior') as HTMLSelectElement | null;
  const backwardSel = host.querySelector('#mod-backward-behavior') as HTMLSelectElement | null;
  const globalSpeedIn = host.querySelector('#mod-global-speed') as HTMLInputElement | null;
  const globalSpeedLbl = host.querySelector('#mod-lbl-global-speed') as HTMLElement | null;
  const loopChk = host.querySelector('#mod-loop') as HTMLInputElement | null;
  const hudSel = host.querySelector('#mod-hud') as HTMLSelectElement | null;
  const preloadSel = host.querySelector('#mod-preload-strategy') as HTMLSelectElement | null;
  const defFallbackSel = host.querySelector('#mod-default-fallback-style') as HTMLSelectElement | null;
  const defFallbackDur = host.querySelector('#mod-default-fallback-dur') as HTMLInputElement | null;
  const autohideChk = host.querySelector('#mod-autohide-cursor') as HTMLInputElement | null;

  scope.listen(interruptSel, 'change', () => {
    if (interruptSel) props.onUpdateSettings({ interruptBehavior: interruptSel.value as InterruptBehavior });
  });
  scope.listen(backwardSel, 'change', () => {
    if (backwardSel) props.onUpdateSettings({ backwardBehavior: backwardSel.value as BackwardBehavior });
  });
  scope.listen(globalSpeedIn, 'input', () => {
    const val = parseFloat(globalSpeedIn?.value || '1');
    if (globalSpeedLbl) globalSpeedLbl.textContent = `${val.toFixed(2)}×`;
    props.onUpdateSettings({ globalPlaybackSpeed: val });
  });
  scope.listen(loopChk, 'change', () => {
    if (loopChk) props.onUpdateSettings({ loopPresentation: loopChk.checked });
  });
  scope.listen(hudSel, 'change', () => {
    if (hudSel) props.onUpdateSettings({ showPresenterHud: hudSel.value as HudVisibility });
  });
  scope.listen(preloadSel, 'change', () => {
    if (preloadSel) props.onUpdateSettings({ preloadStrategy: preloadSel.value as 'all' | 'adjacent' });
  });
  scope.listen(defFallbackSel, 'change', () => {
    if (defFallbackSel) props.onUpdateSettings({ defaultFallbackStyle: defFallbackSel.value as FallbackTransitionStyle });
  });
  scope.listen(defFallbackDur, 'change', () => {
    const val = parseInt(defFallbackDur?.value || '700', 10);
    if (Number.isFinite(val)) {
      props.onUpdateSettings({ defaultFallbackDurationMs: Math.max(100, Math.min(3000, val)) });
    }
  });
  scope.listen(autohideChk, 'change', () => {
    if (autohideChk) props.onUpdateSettings({ autoHideCursor: autohideChk.checked });
  });
}

export interface DeckDiagnosticsSummary {
  slideCount: number;
  videoTransitionCount: number;
  proceduralTransitionCount: number;
  notesCount: number;
  estimatedDurationSec: number;
  totalMediaBytes: number;
}

export function renderDiagnosticsGridMarkup(diagnostics: DeckDiagnosticsSummary): string {
  const mins = Math.floor(diagnostics.estimatedDurationSec / 60);
  const secs = diagnostics.estimatedDurationSec % 60;
  const durText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const mbText =
    diagnostics.totalMediaBytes >= 1024 * 1024
      ? `${(diagnostics.totalMediaBytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.round(diagnostics.totalMediaBytes / 1024)} KB`;

  return `
    <div class="diagnostics-grid">
      <div class="stat-card">
        <span class="stat-value tabular-nums">${diagnostics.slideCount}</span>
        <span class="stat-label">${escapeHtml(t('settings.statTotalSlides'))}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value tabular-nums">${diagnostics.videoTransitionCount}</span>
        <span class="stat-label">${escapeHtml(t('settings.statVideoTrans'))}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value tabular-nums">${diagnostics.proceduralTransitionCount}</span>
        <span class="stat-label">${escapeHtml(t('settings.statCssTrans'))}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value tabular-nums">${diagnostics.notesCount}</span>
        <span class="stat-label">${escapeHtml(t('settings.statWithNotes'))}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value tabular-nums">${durText}</span>
        <span class="stat-label">${escapeHtml(t('settings.statEstDuration'))}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value tabular-nums">${mbText}</span>
        <span class="stat-label">${escapeHtml(t('settings.statMediaSize'))}</span>
      </div>
    </div>
  `;
}

export interface TransitionTrimModalProps {
  host: HTMLElement | null;
  scope: ComponentScope;
  slide: SlideNode;
  nextSlide: SlideNode | null;
  currentStageVideoTimeSec?: number;
  layerStack?: LayerStack;
  onCommitRange: (nextStart: number, nextEnd: number) => boolean;
  onSplitAtTime: (chosenSec: number) => Promise<boolean>;
  onExtractEndFrame: () => Promise<void>;
  onOpenReelCues?: () => void;
  onNotify: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
  onClose: () => void;
}

export function openTransitionTrimModal(props: TransitionTrimModalProps): void {
  const { host, scope, slide, nextSlide } = props;
  const spec = slide.transitionToNext;
  const vid = spec.videoAsset;
  if (!host || !vid) return;
  scope.clear();

  const hasSlice = typeof spec.startTimeSec === 'number' || typeof spec.endTimeSec === 'number';
  const segStart = Math.max(0, spec.startTimeSec ?? 0);
  const segEnd = Math.max(segStart, spec.endTimeSec ?? vid.durationSec);
  const segDur = Math.max(0, segEnd - segStart);
  const canSplit = segDur >= 0.18;
  const midTime = Number(((segStart + segEnd) / 2).toFixed(2));
  const startFrameUrl =
    hasSlice && slide.imageAsset ? slide.imageAsset.thumbnailUrl || slide.imageAsset.objectUrl : vid.thumbnailUrl || '';
  const endFrameUrl =
    hasSlice && nextSlide ? nextSlide.imageAsset.thumbnailUrl || nextSlide.imageAsset.objectUrl : vid.lastFrameUrl || vid.thumbnailUrl || '';

  let splitSession: VideoFrameExtractorSession | null = null;
  const disposeSession = () => {
    if (splitSession) {
      try {
        splitSession.dispose();
      } catch {
        // Ignore cleanup errors
      }
      splitSession = null;
    }
  };
  scope.addCleanup(disposeSession);

  host.innerHTML = `
    <div class="modal-backdrop" id="workspace-modal-backdrop" role="presentation">
      <div class="modal-card apple-sheet-modal ${canSplit ? 'is-wide' : 'is-compact'}" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('modal.trimSplitTitle'))}">
        <div class="modal-header">
          <span class="modal-title">${Icons.splitCue} <span>${escapeHtml(t('modal.trimSplitTitle'))}</span></span>
          <button type="button" class="btn btn-icon-only" id="btn-close-workspace-modal" aria-label="${escapeHtml(t('modal.close'))}">
            ${Icons.close}
          </button>
        </div>

        <div class="modal-body ${canSplit ? 'trim-modal-grid' : ''}" style="${canSplit ? '' : 'display:flex;flex-direction:column;gap:12px;'}">
          <div class="trim-modal-col">
            <div class="inspector-filmstrip-box" style="margin-bottom:0;">
              <div class="inspector-frame-pair">
                <div class="inspector-frame-cell">
                  <img src="${startFrameUrl}" alt="${escapeHtml(t('inspector.startFrameAlt'))}" />
                  <span>${hasSlice ? t('inspector.startFrameSlice', { time: segStart.toFixed(2) }) : t('inspector.startFrameVideo')}</span>
                </div>
                <div style="text-align:center;color:var(--label-secondary);">${isRtlLanguage() ? Icons.arrowLeft : Icons.arrowRight}</div>
                <div class="inspector-frame-cell">
                  <img src="${endFrameUrl}" alt="${escapeHtml(t('inspector.endFrameAlt'))}" />
                  <span>${hasSlice ? t('inspector.endFrameSlice', { time: segEnd.toFixed(2) }) : t('inspector.endFrameVideo')}</span>
                </div>
              </div>
              <div class="prop-subtext" style="word-break:break-all;">${escapeHtml(vid.name)} (${vid.width}×${vid.height})</div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="prop-row" style="margin-bottom:0;">
                <label class="prop-label" for="mod-trans-start">${escapeHtml(t('inspector.sliceStartLabel'))}</label>
                <input type="number" min="0" max="${vid.durationSec.toFixed(2)}" step="0.05" class="input-field tabular-nums" id="mod-trans-start" value="${segStart.toFixed(2)}" />
              </div>
              <div class="prop-row" style="margin-bottom:0;">
                <label class="prop-label" for="mod-trans-end">${escapeHtml(t('inspector.sliceEndLabel'))}</label>
                <input type="number" min="0" max="${vid.durationSec.toFixed(2)}" step="0.05" class="input-field tabular-nums" id="mod-trans-end" value="${segEnd.toFixed(2)}" />
              </div>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" class="btn" id="btn-mod-extract-end" style="flex:1;">
                ${Icons.extractFrame}
                <span>${escapeHtml(hasSlice ? t('inspector.extractEndSlice') : t('inspector.extractEndVideo'))}</span>
              </button>
              ${
                props.onOpenReelCues
                  ? `<button type="button" class="btn" id="btn-mod-open-reel-cues" style="flex:1;">${Icons.sliders}<span>${escapeHtml(t('inspector.editReelCues'))}</span></button>`
                  : ''
              }
            </div>
          </div>

          <div class="trim-modal-col" style="display:${canSplit ? 'flex' : 'none'};">
            <div class="apple-sheet-card" id="mod-split-box" style="display:flex;flex-direction:column;gap:8px;">
              <div class="prop-label">
                <span>${escapeHtml(t('inspector.splitPopoverHeading'))}</span>
                <span class="tabular-nums" id="mod-split-readout" style="color:var(--signal-film);">${midTime.toFixed(2)}s</span>
              </div>
              <div class="split-preview-frame">
                <img id="mod-split-preview-img" src="${startFrameUrl}" alt="${escapeHtml(t('inspector.splitPreviewAlt'))}" />
              </div>
              <div class="split-scrubber-row">
                <span class="prop-subtext tabular-nums">${(segStart + 0.08).toFixed(2)}s</span>
                <input type="range" id="mod-split-range" min="${(segStart + 0.08).toFixed(2)}" max="${Math.max(segStart + 0.09, segEnd - 0.08).toFixed(2)}" step="0.02" value="${midTime}" />
                <span class="prop-subtext tabular-nums">${Math.max(segStart + 0.09, segEnd - 0.08).toFixed(2)}s</span>
              </div>
              <div style="display:flex;gap:6px;align-items:center;">
                <input type="number" class="input-field tabular-nums" id="mod-split-num" min="${(segStart + 0.08).toFixed(2)}" max="${Math.max(segStart + 0.09, segEnd - 0.08).toFixed(2)}" step="0.02" value="${midTime.toFixed(2)}" style="width:92px;" />
                <button type="button" class="btn btn-xs" id="btn-mod-split-stage-time" style="flex:1;">${escapeHtml(t('inspector.splitUseStageTime'))}</button>
                <button type="button" class="btn btn-xs" id="btn-mod-confirm-split">${escapeHtml(t('inspector.splitConfirm'))}</button>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-prominent" id="btn-done-workspace-modal">${escapeHtml(t('modal.done'))}</button>
        </div>
      </div>
    </div>
  `;

  const backdrop = host.querySelector('#workspace-modal-backdrop') as HTMLElement;
  const dialog = host.querySelector('.modal-card') as HTMLElement | null;
  const closeBtn = host.querySelector('#btn-close-workspace-modal') as HTMLElement | null;
  const doneBtn = host.querySelector('#btn-done-workspace-modal') as HTMLElement | null;

  const close = attachModalDialogBehavior({
    host,
    scope,
    backdropEl: backdrop,
    dialogEl: dialog,
    layerStack: props.layerStack,
    layerId: 'workspace-modal',
    layerKind: 'modal',
    initialFocusEl: host.querySelector('#mod-trans-start') as HTMLElement | null ?? closeBtn,
    onAfterClose: props.onClose,
  });

  if (closeBtn) scope.listen(closeBtn, 'click', close);
  if (doneBtn) scope.listen(doneBtn, 'click', close);

  const startIn = host.querySelector('#mod-trans-start') as HTMLInputElement | null;
  const endIn = host.querySelector('#mod-trans-end') as HTMLInputElement | null;
  const commitRange = () => {
    const rawStart = parseFloat(startIn?.value ?? '');
    const rawEnd = parseFloat(endIn?.value ?? '');
    const ok = props.onCommitRange(
      Number.isFinite(rawStart) ? rawStart : segStart,
      Number.isFinite(rawEnd) ? rawEnd : segEnd
    );
    if (!ok) {
      if (startIn) startIn.value = segStart.toFixed(2);
      if (endIn) endIn.value = segEnd.toFixed(2);
      props.onNotify(t('notify.rangeInvalid'), 'warning');
    }
  };
  scope.listen(startIn, 'change', commitRange);
  scope.listen(endIn, 'change', commitRange);

  const splitRange = host.querySelector('#mod-split-range') as HTMLInputElement | null;
  const splitNum = host.querySelector('#mod-split-num') as HTMLInputElement | null;
  const splitReadout = host.querySelector('#mod-split-readout') as HTMLElement | null;
  const splitPreviewImg = host.querySelector('#mod-split-preview-img') as HTMLImageElement | null;

  let pendingTime: number | null = null;
  let previewRunning = false;
  const flushPreview = async () => {
    if (previewRunning) return;
    previewRunning = true;
    try {
      while (pendingTime !== null) {
        const target = pendingTime;
        pendingTime = null;
        if (!splitSession) {
          splitSession = await FrameExtractor.createSession(vid);
        }
        if (!splitSession) break;
        const thumb = await splitSession.seekAndCaptureThumb(target, 320);
        if (thumb && splitPreviewImg?.isConnected) {
          splitPreviewImg.src = thumb;
        }
      }
    } catch {
      // Keep fallback thumbnail
    } finally {
      previewRunning = false;
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
      pendingTime = clamped;
      void flushPreview();
    }
  };

  if (canSplit) {
    const curT = props.currentStageVideoTimeSec;
    const minT = parseFloat(splitRange?.min || '0.08');
    const maxT = parseFloat(splitRange?.max || String(vid.durationSec));
    if (typeof curT === 'number' && curT >= minT && curT <= maxT) {
      setSplitTime(curT, true);
    }
  }

  scope.listen(splitRange, 'input', () => {
    const val = parseFloat(splitRange?.value || '0');
    if (Number.isFinite(val)) setSplitTime(val, true);
  });
  scope.listen(splitNum, 'change', () => {
    const val = parseFloat(splitNum?.value || '0');
    if (Number.isFinite(val)) setSplitTime(val, true);
  });
  scope.listen(host.querySelector('#btn-mod-split-stage-time'), 'click', () => {
    const curT = props.currentStageVideoTimeSec;
    const minT = parseFloat(splitRange?.min || '0.08');
    const maxT = parseFloat(splitRange?.max || String(vid.durationSec));
    if (typeof curT === 'number' && curT >= minT && curT <= maxT) {
      setSplitTime(curT, true);
    } else {
      props.onNotify(t('notify.stageTimeOutOfRange'), 'info');
    }
  });
  scope.listen(host.querySelector('#btn-mod-confirm-split'), 'click', async () => {
    const confirmBtn = host.querySelector('#btn-mod-confirm-split') as HTMLButtonElement | null;
    const chosenSec = parseFloat(splitNum?.value || splitRange?.value || '0');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = t('inspector.splitConfirmBusy');
    }
    try {
      const ok = await props.onSplitAtTime(chosenSec);
      if (ok) {
        close();
      } else if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = t('inspector.splitConfirm');
      }
    } catch (err) {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = t('inspector.splitConfirm');
      }
      props.onNotify(err instanceof Error ? err.message : t('notify.splitFailed'), 'error');
    }
  });
  scope.listen(host.querySelector('#btn-mod-extract-end'), 'click', async () => {
    const btn = host.querySelector('#btn-mod-extract-end') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      await props.onExtractEndFrame();
      close();
    } catch (err) {
      if (btn) btn.disabled = false;
      props.onNotify(err instanceof Error ? err.message : t('notify.extractFailed'), 'error');
    }
  });
  scope.listen(host.querySelector('#btn-mod-open-reel-cues'), 'click', () => {
    close();
    props.onOpenReelCues?.();
  });
}

export interface SurgicalAiModalProps {
  host: HTMLElement | null;
  scope: ComponentScope;
  activeSlide: SlideNode;
  slideIdx: number;
  totalSlides: number;
  defaultScope: 'slide' | 'transition';
  scopeOverride: SurgicalAiScope | null;
  draftInstruction: string;
  aiMeta: import('../../core/domain/types').ProjectAiSourceMeta | undefined;
  currentVideoTimeSec: number | null;
  layerStack?: LayerStack;
  callbacks: SurgicalAiPromptWireCallbacks;
  onClose: () => void;
}

export function openSurgicalAiModal(props: SurgicalAiModalProps): void {
  const { host, scope } = props;
  if (!host) return;
  scope.clear();

  const innerHtml = renderSurgicalAiPromptMarkup({
    activeSlide: props.activeSlide,
    slideIdx: props.slideIdx,
    totalSlides: props.totalSlides,
    defaultScope: props.defaultScope,
    scopeOverride: props.scopeOverride,
    draftInstruction: props.draftInstruction,
    aiMeta: props.aiMeta,
    currentVideoTimeSec: props.currentVideoTimeSec,
    hideGroupHeader: true,
    hideCopyAction: true,
  });

  host.innerHTML = `
    <div class="modal-backdrop" id="workspace-modal-backdrop" role="presentation">
      <div class="modal-card apple-sheet-modal is-medium" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('modal.aiEditTitle'))}">
        <div class="modal-header">
          <span class="modal-title">${Icons.wand} <span>${escapeHtml(t('modal.aiEditTitle'))}</span></span>
          <button type="button" class="btn btn-icon-only" id="btn-close-workspace-modal" aria-label="${escapeHtml(t('modal.close'))}">
            ${Icons.close}
          </button>
        </div>
        <div class="modal-body" id="surgical-ai-modal-body">
          ${innerHtml}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn" id="btn-done-workspace-modal">${escapeHtml(t('modal.close'))}</button>
          <button type="button" class="btn btn-prominent" id="btn-copy-ai-prompt">
            ${Icons.duplicate}
            <span>${escapeHtml(t('inspector.aiCopyBtn'))}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const backdrop = host.querySelector('#workspace-modal-backdrop') as HTMLElement;
  const dialogCard = host.querySelector('.modal-card') as HTMLElement | null;
  const body = host.querySelector('#surgical-ai-modal-body') as HTMLElement | null;
  if (dialogCard) {
    wireSurgicalAiPromptView(dialogCard, scope, props.activeSlide, props.slideIdx, props.totalSlides, props.callbacks);
  }
  if (body) {
    enhanceAppleSelects(body, scope, props.layerStack);
  }

  const closeBtn = host.querySelector('#btn-close-workspace-modal') as HTMLElement | null;
  const doneBtn = host.querySelector('#btn-done-workspace-modal') as HTMLElement | null;

  const close = attachModalDialogBehavior({
    host,
    scope,
    backdropEl: backdrop,
    dialogEl: dialogCard,
    layerStack: props.layerStack,
    layerId: 'workspace-modal',
    layerKind: 'modal',
    initialFocusEl: host.querySelector('#insp-ai-custom-input') as HTMLElement | null ?? closeBtn,
    onAfterClose: props.onClose,
  });

  if (closeBtn) scope.listen(closeBtn, 'click', close);
  if (doneBtn) scope.listen(doneBtn, 'click', close);
}
