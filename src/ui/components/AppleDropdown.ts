import { isRtlLanguage } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import type { LayerStack } from '../core/LayerStack';
import { Icons } from '../icons';

export interface AppleMenuItem {
  id?: string;
  label: string;
  icon?: string;
  shortcut?: string;
  sublabel?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  sectionLabel?: string;
  onSelect: () => void;
}

export interface AppleMenuOpenOptions {
  anchorEl?: HTMLElement | null;
  point?: { x: number; y: number };
  items: AppleMenuItem[];
  minWidth?: number;
  align?: 'start' | 'end';
  role?: 'menu' | 'listbox';
  ariaLabel?: string;
  host?: HTMLElement | null;
  scope?: ComponentScope;
  menuId?: string;
  menuClass?: string;
  layerStack?: LayerStack;
  layerId?: string;
  onClose?: () => void;
}

interface ActiveMenuHandle {
  el: HTMLElement;
  trigger?: HTMLElement | null;
  close: () => void;
}

let currentActiveMenu: ActiveMenuHandle | null = null;

export function closeActiveAppleMenu(): void {
  if (currentActiveMenu) {
    currentActiveMenu.close();
  }
}

export function openAppleMenu(options: AppleMenuOpenOptions): () => void {
  closeActiveAppleMenu();

  if (typeof document === 'undefined' || !document.body) {
    return () => {};
  }

  const {
    anchorEl,
    point,
    items,
    minWidth = 216,
    align = 'start',
    role = 'menu',
    ariaLabel,
    host,
    scope,
    menuId,
    menuClass,
    layerStack,
    layerId = menuId || 'apple-active-menu',
    onClose,
  } = options;

  const mountTarget = host ?? document.body;
  if (!mountTarget) {
    return () => {};
  }

  const menuEl = document.createElement('div');
  menuEl.className = menuClass ? `apple-glass-menu ${menuClass}` : 'apple-glass-menu';
  if (menuId) {
    menuEl.id = menuId;
  }
  menuEl.setAttribute('role', role);
  if (ariaLabel) {
    menuEl.setAttribute('aria-label', ariaLabel);
  }
  menuEl.style.minWidth = `${minWidth}px`;
  menuEl.style.visibility = 'hidden';

  const hasAnyChecks = items.some((it) => typeof it.checked === 'boolean');

  menuEl.innerHTML = items
    .map((item, idx) => {
      const parts: string[] = [];
      if (item.separatorBefore && idx > 0) {
        parts.push('<div class="apple-menu-sep" role="separator"></div>');
      }
      if (item.sectionLabel) {
        parts.push(`<div class="apple-menu-section-label">${escapeHtml(item.sectionLabel)}</div>`);
      }

      const itemRole = role === 'listbox' ? 'option' : 'menuitem';
      const checkedAttr =
        role === 'listbox' && typeof item.checked === 'boolean'
          ? `aria-selected="${item.checked ? 'true' : 'false'}"`
          : '';
      const classes = [
        'apple-menu-item',
        menuId === 'studio-context-menu' ? 'ctx-menu-item' : '',
        item.checked ? 'is-checked' : '',
        item.danger ? 'is-danger danger' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const checkSlot = hasAnyChecks
        ? `<span class="apple-menu-check" aria-hidden="true">${item.checked ? Icons.check : ''}</span>`
        : '';
      const iconSlot = item.icon
        ? `<span class="apple-menu-icon" aria-hidden="true">${item.icon}</span>`
        : '';
      const trailing = item.shortcut
        ? `<kbd class="apple-menu-kbd">${escapeHtml(item.shortcut)}</kbd>`
        : item.sublabel
          ? `<span class="apple-menu-sublabel">${escapeHtml(item.sublabel)}</span>`
          : '';

      parts.push(`
        <button
          type="button"
          class="${classes}"
          ${item.id ? `id="${escapeHtml(item.id)}"` : ''}
          data-apple-menu-idx="${idx}"
          role="${itemRole}"
          ${checkedAttr}
          ${item.disabled ? 'disabled' : ''}
        >
          <span class="apple-menu-item-main">
            ${checkSlot}
            ${iconSlot}
            <span class="apple-menu-item-label">${escapeHtml(item.label)}</span>
          </span>
          ${trailing}
        </button>
      `);
      return parts.join('');
    })
    .join('');

  mountTarget.appendChild(menuEl);

  if (anchorEl) {
    anchorEl.setAttribute('aria-expanded', 'true');
  }

  // Position cleanly within viewport bounds
  const vw =
    typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
      ? window.innerWidth
      : 1280;
  const vh =
    typeof window !== 'undefined' && Number.isFinite(window.innerHeight) && window.innerHeight > 0
      ? window.innerHeight
      : 800;
  const menuRect = menuEl.getBoundingClientRect?.();
  const menuW = Math.max(minWidth, menuRect?.width || minWidth);
  const menuH = Math.max(180, menuRect?.height || 260);
  const rtl = isRtlLanguage();

  let left = 12;
  let top = 12;

  if (anchorEl) {
    const aRect = anchorEl.getBoundingClientRect();
    const useRightEdge = (align === 'end' && !rtl) || (align === 'start' && rtl);
    left = useRightEdge ? aRect.right - menuW : aRect.left;

    const spaceBelow = vh - aRect.bottom - 10;
    const spaceAbove = aRect.top - 10;
    if (spaceBelow >= menuH || spaceBelow >= spaceAbove) {
      top = aRect.bottom + 5;
      menuEl.dataset.placement = 'bottom';
    } else {
      top = Math.max(8, aRect.top - menuH - 5);
      menuEl.dataset.placement = 'top';
    }
  } else if (point) {
    left = rtl ? point.x - menuW : point.x;
    top = point.y + menuH > vh - 10 ? Math.max(8, point.y - menuH) : point.y;
  }

  left = Math.max(8, Math.min(left, vw - menuW - 8));
  top = Math.max(8, Math.min(top, vh - menuH - 8));

  menuEl.style.left = `${Math.round(left)}px`;
  menuEl.style.top = `${Math.round(top)}px`;
  menuEl.style.maxHeight = `${Math.max(160, vh - 16)}px`;
  menuEl.style.visibility = 'visible';

  const prevFocused =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  let closed = false;
  const cleanupListeners: Array<() => void> = [];

  const close = (restoreFocus = false) => {
    if (closed) return;
    closed = true;
    layerStack?.remove(layerId);
    cleanupListeners.forEach((fn) => fn());
    cleanupListeners.length = 0;
    scope?.clear();
    if (anchorEl) {
      anchorEl.setAttribute('aria-expanded', 'false');
    }
    menuEl.remove();
    if (currentActiveMenu?.el === menuEl) {
      currentActiveMenu = null;
    }
    onClose?.();
    if (restoreFocus && anchorEl && typeof anchorEl.focus === 'function') {
      anchorEl.focus();
    } else if (
      restoreFocus &&
      prevFocused &&
      (prevFocused as { isConnected?: boolean }).isConnected !== false
    ) {
      prevFocused.focus?.();
    }
  };

  if (layerStack) {
    const topmostPriority = layerStack.getTopmost()?.priority ?? 0;
    layerStack.push({
      id: layerId,
      kind: 'context-menu',
      priority: Math.max(40, topmostPriority + 1),
      close: () => close(true),
    });
  }

  currentActiveMenu = { el: menuEl, trigger: anchorEl, close: () => close(false) };

  menuEl.querySelectorAll<HTMLButtonElement>('.apple-menu-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.appleMenuIdx);
      const item = items[idx];
      if (!item || item.disabled) return;
      close(false);
      item.onSelect();
    });
  });

  const handleDocMouseDown = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (menuEl.contains?.(target) ||
        target.closest?.(`#${menuEl.id || '__none__'}`) ||
        (anchorEl && anchorEl.contains?.(target)))
    ) {
      return;
    }
    close(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      const enabledBtns = Array.from(
        menuEl.querySelectorAll<HTMLButtonElement>('.apple-menu-item:not(:disabled)')
      );
      if (enabledBtns.length === 0) return;
      e.preventDefault();
      const curIdx = enabledBtns.indexOf(document.activeElement as HTMLButtonElement);
      let nextIdx = 0;
      if (e.key === 'ArrowDown') {
        nextIdx = curIdx === -1 ? 0 : (curIdx + 1) % enabledBtns.length;
      } else if (e.key === 'ArrowUp') {
        nextIdx = curIdx <= 0 ? enabledBtns.length - 1 : curIdx - 1;
      } else if (e.key === 'End') {
        nextIdx = enabledBtns.length - 1;
      }
      enabledBtns[nextIdx]?.focus();
    }
  };

  const handleResizeOrScroll = (e: Event) => {
    const target = e.target;
    if (target instanceof Node && menuEl.contains(target)) return;
    close(false);
  };

  const bindGlobal = () => {
    if (closed) return;
    if (scope) {
      scope.listen(document, 'mousedown', handleDocMouseDown, true);
      scope.listen(window, 'keydown', (ev) => handleKeyDown(ev as KeyboardEvent), true);
      scope.listen(window, 'resize', handleResizeOrScroll);
      scope.listen(window, 'scroll', handleResizeOrScroll, true);
    } else {
      document.addEventListener('mousedown', handleDocMouseDown, true);
      window.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('resize', handleResizeOrScroll);
      window.addEventListener('scroll', handleResizeOrScroll, true);
      cleanupListeners.push(() => {
        document.removeEventListener('mousedown', handleDocMouseDown, true);
        window.removeEventListener('keydown', handleKeyDown, true);
        window.removeEventListener('resize', handleResizeOrScroll);
        window.removeEventListener('scroll', handleResizeOrScroll, true);
      });
    }
  };

  // Context menus (point-anchored) can bind immediately so unit tests & keyboard work right away;
  // button-anchored menus defer one frame so the opening click doesn't self-dismiss.
  if (point || typeof window.requestAnimationFrame !== 'function') {
    bindGlobal();
  } else {
    const rafId = window.requestAnimationFrame(bindGlobal);
    cleanupListeners.push(() => window.cancelAnimationFrame(rafId));
  }

  // Focus active item or first enabled item for keyboard accessibility
  const initialFocus =
    menuEl.querySelector<HTMLButtonElement>('.apple-menu-item.is-checked:not(:disabled)') ||
    menuEl.querySelector<HTMLButtonElement>('.apple-menu-item:not(:disabled)');
  initialFocus?.focus?.({ preventScroll: true });

  return () => close(false);
}

function getSelectOptions(selectEl: HTMLSelectElement): HTMLOptionElement[] {
  if (selectEl.options && typeof selectEl.options.length === 'number') {
    return Array.from(selectEl.options);
  }
  return typeof selectEl.querySelectorAll === 'function'
    ? Array.from(selectEl.querySelectorAll<HTMLOptionElement>('option'))
    : [];
}

export function syncAppleSelectDisplay(selectEl: HTMLSelectElement): void {
  const wrap = selectEl.closest?.('.apple-select-wrap');
  const labelEl = wrap?.querySelector<HTMLElement>('.apple-select-label');
  if (!labelEl) return;
  const options = getSelectOptions(selectEl);
  const idx = typeof selectEl.selectedIndex === 'number' ? selectEl.selectedIndex : -1;
  const selected =
    options.find((opt) => opt.value === selectEl.value) ||
    (idx >= 0 ? options[idx] : undefined) ||
    options.find((opt) => opt.selected) ||
    options[0];
  labelEl.textContent = selected ? selected.textContent?.trim() || selected.value : selectEl.value || '';
}

export function enhanceAppleSelects(
  container: HTMLElement | null,
  scope: ComponentScope,
  layerStack?: LayerStack
): void {
  if (
    !container ||
    typeof document === 'undefined' ||
    typeof document.createElement !== 'function' ||
    typeof container.querySelectorAll !== 'function'
  ) {
    return;
  }

  const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('select'));
  for (const selectEl of selects) {
    if (selectEl.dataset?.appleEnhanced === 'true' || selectEl.dataset?.appleSkip === 'true') {
      syncAppleSelectDisplay(selectEl);
      continue;
    }

    const parent = selectEl.parentElement;
    if (!parent || typeof parent.insertBefore !== 'function') continue;

    if (selectEl.dataset) {
      selectEl.dataset.appleEnhanced = 'true';
    }
    const isCompact =
      selectEl.classList.contains('reel-segment-easing-select') ||
      selectEl.classList.contains('reel-sensitivity-select') ||
      selectEl.classList.contains('is-compact');

    const wrap = document.createElement('div');
    wrap.className = `apple-select-wrap ${isCompact ? 'is-compact' : ''}`;

    parent.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);

    selectEl.classList.add('apple-native-select-hidden');
    selectEl.setAttribute('aria-hidden', 'true');
    selectEl.tabIndex = -1;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `apple-popup-btn ${isCompact ? 'is-compact' : ''}`;
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (selectEl.disabled) btn.disabled = true;

    const ariaLabel = selectEl.getAttribute('aria-label') || selectEl.getAttribute('title');
    if (ariaLabel) {
      btn.setAttribute('aria-label', ariaLabel);
      btn.setAttribute('title', ariaLabel);
    }

    btn.innerHTML = `
      <span class="apple-select-label"></span>
      <span class="apple-select-chevrons" aria-hidden="true">${Icons.chevronsUpDown}</span>
    `;
    wrap.appendChild(btn);
    syncAppleSelectDisplay(selectEl);

    const openPopup = () => {
      if (selectEl.disabled) return;
      const options = getSelectOptions(selectEl);
      const rect = btn.getBoundingClientRect();
      const closeFn = openAppleMenu({
        anchorEl: btn,
        role: 'listbox',
        layerStack,
        layerId: 'apple-select-menu',
        minWidth: Math.max(isCompact ? 132 : 176, Math.round(rect.width)),
        ariaLabel: ariaLabel || undefined,
        items: options.map((opt) => ({
          id: opt.value,
          label: opt.textContent?.trim() || opt.value,
          checked: opt.value === selectEl.value,
          disabled: Boolean(opt.disabled),
          onSelect: () => {
            if (selectEl.value !== opt.value) {
              selectEl.value = opt.value;
              syncAppleSelectDisplay(selectEl);
              selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
          },
        })),
      });
      scope.addCleanup(closeFn);
    };

    scope.listen(btn, 'click', (e) => {
      e.stopPropagation();
      if (currentActiveMenu?.trigger === btn) {
        closeActiveAppleMenu();
      } else {
        openPopup();
      }
    });

    scope.listen<KeyboardEvent>(btn, 'keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        openPopup();
      }
    });

    scope.listen(selectEl, 'change', () => {
      syncAppleSelectDisplay(selectEl);
    });
  }
}
