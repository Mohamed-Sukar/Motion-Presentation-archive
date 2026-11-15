import { EngineStatus } from '../../core/domain/types';
import { isRtlLanguage, t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';

export interface StageHudCallbacks {
  onPrev: () => void;
  onNext: () => void;
  onReplay: () => void;
}

export function ensureStageHudStructure(
  hud: HTMLElement | null,
  scope: ComponentScope,
  callbacks: StageHudCallbacks
): void {
  if (!hud || hud.querySelector('#btn-hud-next')) return;

  scope.clear();

  const rtl = isRtlLanguage();
  const prevIcon = rtl ? Icons.chevronRight : Icons.chevronLeft;
  const nextIcon = rtl ? Icons.chevronLeft : Icons.chevronRight;

  hud.innerHTML = `
    <button
      class="hud-transport-btn"
      id="btn-hud-prev"
      title="${escapeHtml(t('hud.prevTitle'))}"
      aria-label="${escapeHtml(t('hud.prevAria'))}"
    >
      ${prevIcon}
    </button>

    <div class="hud-status-readout">
      <span class="hud-phase-dot" id="hud-phase-dot"></span>
      <span class="tabular-nums" id="hud-slide-counter">
        01 / 01
      </span>
    </div>

    <button
      class="hud-step-btn"
      id="btn-hud-next"
      title="${escapeHtml(t('hud.nextTitle'))}"
      aria-label="${escapeHtml(t('hud.nextAria'))}"
    >
      <span id="hud-next-label">${escapeHtml(t('hud.nextLabel'))}</span>
      ${nextIcon}
    </button>

    <div class="toolbar-divider"></div>

    <button
      class="hud-transport-btn"
      id="btn-hud-replay"
      title="${escapeHtml(t('hud.replayTitle'))}"
      aria-label="${escapeHtml(t('hud.replayAria'))}"
    >
      ${Icons.replay}
    </button>
  `;

  scope.listen(hud.querySelector('#btn-hud-prev'), 'click', callbacks.onPrev);
  scope.listen(hud.querySelector('#btn-hud-next'), 'click', callbacks.onNext);
  scope.listen(hud.querySelector('#btn-hud-replay'), 'click', callbacks.onReplay);
}

export function resetStageHudStructure(
  hud: HTMLElement | null,
  scope: ComponentScope
): void {
  scope.clear();
  if (hud) {
    hud.innerHTML = '';
  }
}

export function renderStageHudView(
  hud: HTMLElement | null,
  scope: ComponentScope,
  slideCount: number,
  status: EngineStatus | undefined,
  loopPresentation: boolean,
  callbacks: StageHudCallbacks
): number {
  if (!hud) return status?.currentSlideIndex ?? 0;

  if (slideCount === 0) {
    hud.style.display = 'none';
    return 0;
  }
  hud.style.display = 'flex';

  ensureStageHudStructure(hud, scope, callbacks);

  const idx = status?.currentSlideIndex ?? 0;
  const isTransitioning = status?.phase === 'PLAYING_TRANSITION';
  const currentFormatted = String(idx + 1).padStart(2, '0');
  const totalFormatted = String(slideCount).padStart(2, '0');

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

  const prevBtn = hud.querySelector('#btn-hud-prev') as HTMLButtonElement | null;
  if (prevBtn) {
    prevBtn.disabled = idx === 0 && !loopPresentation;
  }

  const replayBtn = hud.querySelector('#btn-hud-replay') as HTMLButtonElement | null;
  if (replayBtn) {
    replayBtn.disabled = slideCount < 2;
  }

  return idx;
}
