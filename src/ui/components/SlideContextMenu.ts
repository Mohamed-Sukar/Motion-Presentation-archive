import { isRtlLanguage, t } from '../../core/i18n';
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
  const rtl = isRtlLanguage();
  const menuW = 224;
  const rawLeft = rtl ? clientX - menuW : clientX;
  const left = Math.max(8, Math.min(rawLeft, vw - menuW - 8));
  const top = Math.max(8, Math.min(clientY, vh - 296));

  const canMoveUp = slideIndex > 0;
  const canMoveDown = slideIndex < totalSlides - 1;

  host.innerHTML = `
    <div class="apple-glass-menu studio-context-menu" id="studio-context-menu" role="menu" style="left:${left}px;top:${top}px;">
      <button type="button" class="apple-menu-item ctx-menu-item" id="ctx-move-up" role="menuitem" ${!canMoveUp ? 'disabled' : ''}>
        <span class="apple-menu-item-main">
          <span class="apple-menu-icon">${Icons.chevronUp}</span>
          <span class="apple-menu-item-label">${escapeHtml(t('ctx.moveUp'))}</span>
        </span>
      </button>
      <button type="button" class="apple-menu-item ctx-menu-item" id="ctx-move-down" role="menuitem" ${!canMoveDown ? 'disabled' : ''}>
        <span class="apple-menu-item-main">
          <span class="apple-menu-icon">${Icons.chevronDown}</span>
          <span class="apple-menu-item-label">${escapeHtml(t('ctx.moveDown'))}</span>
        </span>
      </button>
      <button type="button" class="apple-menu-item ctx-menu-item" id="ctx-duplicate" role="menuitem">
        <span class="apple-menu-item-main">
          <span class="apple-menu-icon">${Icons.duplicate}</span>
          <span class="apple-menu-item-label">${escapeHtml(t('ctx.duplicate'))}</span>
        </span>
      </button>
      <div class="apple-menu-sep ctx-menu-sep" role="separator"></div>
      <button type="button" class="apple-menu-item ctx-menu-item" id="ctx-edit-transition" role="menuitem" ${!canMoveDown ? 'disabled' : ''}>
        <span class="apple-menu-item-main">
          <span class="apple-menu-icon">${Icons.sliders}</span>
          <span class="apple-menu-item-label">${escapeHtml(t('ctx.editTransition'))}</span>
        </span>
      </button>
      <button type="button" class="apple-menu-item ctx-menu-item" id="ctx-replace-image" role="menuitem">
        <span class="apple-menu-item-main">
          <span class="apple-menu-icon">${Icons.photoPlus}</span>
          <span class="apple-menu-item-label">${escapeHtml(t('ctx.replaceImage'))}</span>
        </span>
      </button>
      <button type="button" class="apple-menu-item ctx-menu-item" id="ctx-open-cues" role="menuitem" ${!hasReelContext ? 'disabled' : ''}>
        <span class="apple-menu-item-main">
          <span class="apple-menu-icon">${Icons.splitCue}</span>
          <span class="apple-menu-item-label">${escapeHtml(t('ctx.openCueStudio'))}</span>
        </span>
      </button>
      <div class="apple-menu-sep ctx-menu-sep" role="separator"></div>
      <button type="button" class="apple-menu-item ctx-menu-item is-danger danger" id="ctx-delete-slide" role="menuitem">
        <span class="apple-menu-item-main">
          <span class="apple-menu-icon">${Icons.trash}</span>
          <span class="apple-menu-item-label">${escapeHtml(t('ctx.delete'))}</span>
        </span>
      </button>
    </div>
  `;

  const menuEl = host.querySelector('#studio-context-menu') as HTMLElement | null;
  if (menuEl) {
    const rect = menuEl.getBoundingClientRect?.();
    const measuredW = Math.max(200, Math.round(rect?.width || menuW));
    const measuredH = Math.max(180, Math.round(rect?.height || 296));
    const clampedLeft = Math.max(8, Math.min(rawLeft, vw - measuredW - 8));
    const clampedTop = Math.max(8, Math.min(clientY, vh - measuredH - 8));
    menuEl.style.left = `${clampedLeft}px`;
    menuEl.style.top = `${clampedTop}px`;
    menuEl.style.maxHeight = `${Math.max(160, vh - 16)}px`;
  }

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
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(
          host.querySelectorAll<HTMLButtonElement>('.ctx-menu-item:not(:disabled)')
        );
        if (items.length === 0) return;
        e.preventDefault();
        const cur = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === 'ArrowDown'
            ? cur === -1
              ? 0
              : (cur + 1) % items.length
            : cur <= 0
              ? items.length - 1
              : cur - 1;
        items[next]?.focus();
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
