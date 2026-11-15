import { SlideNode } from '../../core/domain/types';
import { isRtlLanguage, t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';

export interface TimelineDockRenderProps {
  slides: SlideNode[];
  activeSlideId: string | undefined;
  isTransitionSelected: boolean;
  selectedTransitionSlideId: string | undefined;
  isCollapsed: boolean;
  formattedTotalDuration: string;
}

export interface TimelineDockCallbacks {
  onOpenCues: () => void;
  onToggleCollapse: () => void;
  onSwitchToSide?: () => void;
  onSelectSlide: (slideId: string) => void;
  onContextMenuSlide?: (slideId: string, clientX: number, clientY: number) => void;
  onSelectTransition: (slideId: string) => void;
}

export function renderTimelineDockView(
  dock: HTMLElement | null,
  scope: ComponentScope,
  props: TimelineDockRenderProps,
  callbacks: TimelineDockCallbacks
): void {
  if (!dock) return;

  scope.clear();

  const { slides } = props;
  if (slides.length === 0) {
    dock.classList.add('hidden');
    dock.innerHTML = '';
    return;
  }

  dock.classList.remove('hidden');
  dock.classList.toggle('is-collapsed', props.isCollapsed);

  const rtl = isRtlLanguage();
  const bridgeArrow = rtl ? Icons.arrowLeft : Icons.arrowRight;

  const nodesHtml = slides
    .map((slide, idx) => {
      const isSlideActive = slide.id === props.activeSlideId && !props.isTransitionSelected;
      const numLabel = String(idx + 1).padStart(2, '0');
      const hasLoop = Boolean(slide.idleLoopAsset);
      const holdBadge = slide.holdDurationSec ? `${slide.holdDurationSec}s` : '';
      const thumbHtml = slide.imageAsset.objectUrl
        ? `<img src="${escapeHtml(slide.imageAsset.objectUrl)}" alt="" />`
        : `<span class="tabular-nums dock-thumb-fallback">${numLabel}</span>`;

      const slideBtn = `
        <button
          type="button"
          class="dock-seq-node dock-ribbon-card ${isSlideActive ? 'active' : ''}"
          data-dock-slide-id="${escapeHtml(slide.id)}"
          title="${escapeHtml(slide.title)}"
        >
          <span class="dock-seq-thumb">
            ${thumbHtml}
            <span class="dock-seq-num tabular-nums">${numLabel}</span>
            ${hasLoop ? `<span class="dock-seq-loop-tag" title="Idle Loop">${Icons.replay}</span>` : ''}
          </span>
          <span class="dock-seq-meta">
            <span class="dock-seq-label" dir="auto">${escapeHtml(slide.title)}</span>
            ${holdBadge ? `<span class="dock-seq-hold tabular-nums">${holdBadge}</span>` : ''}
          </span>
        </button>
      `;

      if (idx >= slides.length - 1) return slideBtn;

      const spec = slide.transitionToNext;
      const vid = spec.videoAsset;
      const hasVideo = Boolean(vid);
      const isTransActive =
        props.isTransitionSelected && props.selectedTransitionSlideId === slide.id;
      const bridgeTitle = hasVideo
        ? vid?.name || t('ctx.editTransition')
        : t('inspector.fallbackStyleLabel');

      let durText = `${((spec.fallbackDurationMs || 700) / 1000).toFixed(1)}s`;
      if (vid) {
        const segStart = Math.max(0, spec.startTimeSec ?? 0);
        const segEnd = Math.max(segStart, spec.endTimeSec ?? vid.durationSec);
        const eff = (segEnd - segStart) / Math.max(0.25, spec.playbackSpeed || 1);
        durText = `${eff.toFixed(1)}s`;
      }

      return `${slideBtn}
        <button
          type="button"
          class="dock-seq-bridge ${hasVideo ? 'has-video' : ''} ${isTransActive ? 'active' : ''}"
          data-dock-trans-slide-id="${escapeHtml(slide.id)}"
          title="${escapeHtml(bridgeTitle)}"
          aria-label="${escapeHtml(bridgeTitle)}"
        >
          <span class="dock-bridge-ico">${hasVideo ? Icons.filmTransition : bridgeArrow}</span>
          <span class="dock-bridge-dur tabular-nums">${durText}</span>
        </button>`;
    })
    .join('');

  dock.innerHTML = `
    <div class="dock-header">
      <div class="dock-header-lead">
        <span class="dock-title">${Icons.timelineDock} <span>${escapeHtml(t('dock.title'))}</span></span>
        <span class="dock-stat-pill tabular-nums">${slides.length} ${escapeHtml(t('dock.slidesCount'))}</span>
        <span class="dock-stat-pill tabular-nums">${escapeHtml(t('dock.totalDuration'))}: ${escapeHtml(props.formattedTotalDuration)}</span>
      </div>
      <div class="dock-header-trailing">
        <button type="button" class="btn dock-cues-btn" id="btn-stage-open-cues" title="${escapeHtml(t('dock.openCuesBtn'))}">
          ${Icons.splitCue}
          <span>${escapeHtml(t('dock.openCuesBtn'))}</span>
        </button>
        ${
          callbacks.onSwitchToSide
            ? `<button
          type="button"
          class="btn btn-icon-only"
          id="btn-dock-to-side"
          title="${escapeHtml(t('layout.switchToSide'))}"
          aria-label="${escapeHtml(t('layout.switchToSide'))}"
        >
          ${rtl ? Icons.sidebarRight : Icons.sidebarLeft}
        </button>`
            : ''
        }
        <button
          type="button"
          class="btn btn-icon-only"
          id="btn-toggle-timeline-dock"
          aria-expanded="${!props.isCollapsed}"
          title="${escapeHtml(t('dock.toggleTitle'))}"
          aria-label="${escapeHtml(t('dock.toggleTitle'))}"
        >
          ${props.isCollapsed ? Icons.chevronUp : Icons.chevronDown}
        </button>
      </div>
    </div>
    <div class="dock-body">
      <div class="dock-sequence-track">${nodesHtml}</div>
    </div>
  `;

  scope.listen(dock.querySelector('#btn-stage-open-cues'), 'click', callbacks.onOpenCues);
  scope.listen(dock.querySelector('#btn-dock-to-side'), 'click', () => callbacks.onSwitchToSide?.());
  scope.listen(
    dock.querySelector('#btn-toggle-timeline-dock'),
    'click',
    callbacks.onToggleCollapse
  );

  dock.querySelectorAll('.dock-seq-node').forEach((btn) => {
    scope.listen(btn, 'click', () => {
      const slideId = (btn as HTMLElement).dataset.dockSlideId;
      if (slideId) callbacks.onSelectSlide(slideId);
    });
    if (callbacks.onContextMenuSlide) {
      scope.listen(btn, 'contextmenu', (e) => {
        const ev = e as MouseEvent;
        ev.preventDefault();
        const slideId = (btn as HTMLElement).dataset.dockSlideId;
        if (slideId) callbacks.onContextMenuSlide?.(slideId, ev.clientX, ev.clientY);
      });
    }
  });

  dock.querySelectorAll('.dock-seq-bridge').forEach((btn) => {
    scope.listen(btn, 'click', () => {
      const slideId = (btn as HTMLElement).dataset.dockTransSlideId;
      if (slideId) callbacks.onSelectTransition(slideId);
    });
  });
}

export function syncTimelineDockActiveView(
  dock: HTMLElement | null,
  activeSlideId: string | undefined,
  isTransitionSelected: boolean,
  selectedTransitionSlideId: string | undefined
): void {
  if (!dock || dock.classList.contains('hidden')) return;

  dock.querySelectorAll('.dock-seq-node').forEach((node) => {
    const id = (node as HTMLElement).dataset.dockSlideId;
    node.classList.toggle('active', Boolean(id && id === activeSlideId && !isTransitionSelected));
  });
  dock.querySelectorAll('.dock-seq-bridge').forEach((bridge) => {
    const id = (bridge as HTMLElement).dataset.dockTransSlideId;
    bridge.classList.toggle(
      'active',
      Boolean(id && isTransitionSelected && id === selectedTransitionSlideId)
    );
  });
}

export function syncTimelineDockCollapseView(
  dock: HTMLElement | null,
  isCollapsed: boolean
): void {
  if (!dock) return;
  dock.classList.toggle('is-collapsed', isCollapsed);
  const toggleBtn = dock.querySelector('#btn-toggle-timeline-dock') as HTMLButtonElement | null;
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
    toggleBtn.innerHTML = isCollapsed ? Icons.chevronUp : Icons.chevronDown;
  }
}
