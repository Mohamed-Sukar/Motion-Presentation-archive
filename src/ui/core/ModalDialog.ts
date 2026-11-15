import type { ComponentScope } from './ComponentLifecycle';
import type { LayerKind, LayerStack } from './LayerStack';

export interface ModalDialogOptions {
  host: HTMLElement;
  scope: ComponentScope;
  backdropEl: HTMLElement;
  dialogEl: HTMLElement | null;
  layerStack?: LayerStack;
  layerId?: string;
  layerKind?: LayerKind;
  initialFocusEl?: HTMLElement | null;
  trapFocus?: boolean;
  closeOnBackdropClick?: boolean;
  onBeforeClose?: () => void;
  onAfterClose?: () => void;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
  return nodes.filter((el) => {
    if ((el as HTMLButtonElement).disabled || el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const style = window.getComputedStyle(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) {
          return false;
        }
      } catch {
        // Ignore in lightweight mock DOM
      }
    }
    return true;
  });
}

/**
 * Wires shared lifecycle, LayerStack registration, focus entry/trap/restoration,
 * backdrop click dismissal, and topmost-only Escape handling for modals & popovers.
 */
export function attachModalDialogBehavior(options: ModalDialogOptions): () => void {
  const {
    host,
    scope,
    backdropEl,
    dialogEl,
    layerStack,
    layerId,
    layerKind = 'modal',
    initialFocusEl,
    trapFocus = true,
    closeOnBackdropClick = true,
    onBeforeClose,
    onAfterClose,
  } = options;

  const doc = typeof document !== 'undefined' ? document : null;
  const prevFocused = (doc?.activeElement as HTMLElement | null) ?? null;
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;

    if (layerStack && layerId) {
      layerStack.remove(layerId);
    }
    onBeforeClose?.();
    scope.clear();
    host.innerHTML = '';
    onAfterClose?.();

    if (
      prevFocused &&
      prevFocused !== (doc?.body as HTMLElement | null) &&
      (prevFocused as { isConnected?: boolean }).isConnected !== false &&
      typeof prevFocused.focus === 'function'
    ) {
      try {
        prevFocused.focus();
      } catch {
        // Ignore if previous trigger element was detached
      }
    }
  };

  if (layerStack && layerId) {
    layerStack.push({
      id: layerId,
      kind: layerKind,
      close,
    });
  }

  if (dialogEl && !dialogEl.hasAttribute('tabindex')) {
    dialogEl.setAttribute('tabindex', '-1');
  }

  const focusTarget = initialFocusEl ?? dialogEl ?? backdropEl;

  if (focusTarget && typeof focusTarget.focus === 'function') {
    try {
      focusTarget.focus();
    } catch {
      // Ignore focus errors in mock DOM
    }
  }

  if (closeOnBackdropClick) {
    scope.listen(backdropEl, 'click', (e) => {
      if (e.target === backdropEl) {
        close();
      }
    });
  }

  scope.listen(
    window,
    'keydown',
    (e) => {
      const ke = e as KeyboardEvent;

      if (layerStack && layerId) {
        const topmost = layerStack.getTopmost();
        if (topmost && topmost.id !== layerId) {
          return;
        }
      }

      if (ke.key === 'Escape') {
        ke.preventDefault();
        ke.stopPropagation();
        close();
        return;
      }

      if (ke.key === 'Tab' && trapFocus && dialogEl && doc) {
        const focusables = getFocusableElements(dialogEl);
        if (focusables.length === 0) {
          ke.preventDefault();
          dialogEl.focus?.();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = doc.activeElement as HTMLElement | null;
        const isInside = Boolean(active && dialogEl.contains?.(active));

        if (!isInside) {
          ke.preventDefault();
          (ke.shiftKey ? last : first).focus?.();
          return;
        }

        if (ke.shiftKey && (active === first || active === dialogEl)) {
          ke.preventDefault();
          last.focus?.();
        } else if (!ke.shiftKey && active === last) {
          ke.preventDefault();
          first.focus?.();
        }
      }
    },
    true
  );

  return close;
}
