import { t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';

export interface SlideContextMenuOpenProps {
  host: HTMLElement;
  scope: ComponentScope;
  slideId: string;
  slideIndex: number;
  totalSlides: number;
  hasReelContext: boolean;
  clientX: number;
  clientY: number;
}

export interface SlideContextMenuCallbacks {
  onMoveUp: (slideId: string) => void;
  onMoveDown: (slideId: string) => void;
  onDuplicate: (slideId: string) => void;
  onEditTransition: (slideId: string) => void;
  onReplaceImage: (slideId: string) => void;
  onOpenCues: (slideId: string) => void;
  onDelete: (slideId: string) => void;
}

export function closeSlideContextMenuView(
  host: HTMLElement | null,
  scope: ComponentScope
): void {
  scope.clear();
  if (host) {
    host.innerHTML = '';
  }
}

export function openSlideContextMenuView(
  props: SlideContextMenuOpenProps,
  callbacks: SlideContextMenuCallbacks
): () => void {
  const { host, scope, slideId, slideIndex, totalSlides, hasReelContext, clientX, clientY } =
    props;

  closeSlideContextMenuView(host, scope);

  const vw =
    typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
      ? window.innerWidth
      : 1280;
  const vh =
    typeof window !== 'undefined' &&
    Number.isFinite(window.innerHeight) &&
    window.innerHeight > 0
      ? window.innerHeight
      : 800;
  const left = Math.max(8, Math.min(clientX, vw - 228));
  const top = Math.max(8, Math.min(clientY, vh - 290));

  const canMoveUp = slideIndex > 0;
  const canMoveDown = slideIndex < totalSlides - 1;

  host.innerHTML = `
    <div class="studio-context-menu" id="studio-context-menu" role="menu" style="left:${left}px;top:${top}px;">
      <button type="button" class="ctx-menu-item" id="ctx-move-up" role="menuitem" ${!canMoveUp ? 'disabled' : ''}>
        ${Icons.chevronUp}
        <span>${escapeHtml(t('ctx.moveUp'))}</span>
      </button>
      <button type="button" class="ctx-menu-item" id="ctx-move-down" role="menuitem" ${!canMoveDown ? 'disabled' : ''}>
        ${Icons.chevronDown}
        <span>${escapeHtml(t('ctx.moveDown'))}</span>
      </button>
      <button type="button" class="ctx-menu-item" id="ctx-duplicate" role="menuitem">
        ${Icons.duplicate}
        <span>${escapeHtml(t('ctx.duplicate'))}</span>
      </button>
      <div class="ctx-menu-sep" role="separator"></div>
      <button type="button" class="ctx-menu-item" id="ctx-edit-transition" role="menuitem" ${!canMoveDown ? 'disabled' : ''}>
        ${Icons.sliders}
        <span>${escapeHtml(t('ctx.editTransition'))}</span>
      </button>
      <button type="button" class="ctx-menu-item" id="ctx-replace-image" role="menuitem">
        ${Icons.photoPlus}
        <span>${escapeHtml(t('ctx.replaceImage'))}</span>
      </button>
      <button type="button" class="ctx-menu-item" id="ctx-open-cues" role="menuitem" ${!hasReelContext ? 'disabled' : ''}>
        ${Icons.splitCue}
        <span>${escapeHtml(t('ctx.openCueStudio'))}</span>
      </button>
      <div class="ctx-menu-sep" role="separator"></div>
      <button type="button" class="ctx-menu-item danger" id="ctx-delete-slide" role="menuitem">
        ${Icons.trash}
        <span>${escapeHtml(t('ctx.delete'))}</span>
      </button>
    </div>
  `;

  const close = () => {
    closeSlideContextMenuView(host, scope);
  };

  if (typeof document !== 'undefined') {
    scope.listen<Event>(document, 'click', (e) => {
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl || !targetEl.closest?.('#studio-context-menu')) {
        close();
      }
    });
  }

  if (typeof window !== 'undefined') {
    scope.listen<KeyboardEvent>(window, 'keydown', (e) => {
      if (e.key === 'Escape') {
        close();
      }
    });
  }

  scope.listen(host.querySelector('#ctx-move-up'), 'click', () => {
    close();
    callbacks.onMoveUp(slideId);
  });
  scope.listen(host.querySelector('#ctx-move-down'), 'click', () => {
    close();
    callbacks.onMoveDown(slideId);
  });
  scope.listen(host.querySelector('#ctx-duplicate'), 'click', () => {
    close();
    callbacks.onDuplicate(slideId);
  });
  scope.listen(host.querySelector('#ctx-edit-transition'), 'click', () => {
    close();
    callbacks.onEditTransition(slideId);
  });
  scope.listen(host.querySelector('#ctx-replace-image'), 'click', () => {
    close();
    callbacks.onReplaceImage(slideId);
  });
  scope.listen(host.querySelector('#ctx-open-cues'), 'click', () => {
    close();
    callbacks.onOpenCues(slideId);
  });
  scope.listen(host.querySelector('#ctx-delete-slide'), 'click', () => {
    close();
    callbacks.onDelete(slideId);
  });

  return close;
}
