import { t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';

export interface StudioCommandItem {
  id: string;
  group: string;
  label: string;
  shortcut?: string;
  icon: string;
  disabled?: boolean;
  run: () => void;
}

export interface CommandPaletteOpenProps {
  host: HTMLElement;
  scope: ComponentScope;
  items: StudioCommandItem[];
  initialQuery: string;
  initialActiveIdx: number;
  onStateChange: (query: string, activeIdx: number) => void;
  onBeforeClose: () => void;
}

export function openCommandPaletteModal(props: CommandPaletteOpenProps): () => void {
  const { host, scope, items: allItems, onStateChange, onBeforeClose } = props;

  scope.clear();
  let query = props.initialQuery;
  let activeIdx = props.initialActiveIdx;
  let isClosed = false;
  const prevFocused =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  const listScope = scope.createChildScope();

  const getFilteredItems = () => {
    const q = query.trim().toLowerCase();
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
    onBeforeClose();
    scope.clear();
    host.innerHTML = '';
    if (prevFocused && (prevFocused as any).isConnected) {
      prevFocused.focus?.();
    }
  };

  const renderList = () => {
    const listEl = host.querySelector('#command-palette-list') as HTMLElement | null;
    if (!listEl) return;

    listScope.clear();
    const filtered = getFilteredItems();
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="command-empty">${escapeHtml(t('cmd.empty'))}</div>`;
      return;
    }
    if (activeIdx >= filtered.length) {
      activeIdx = 0;
      onStateChange(query, activeIdx);
    }

    let currentGroup = '';
    const chunks: string[] = [];
    filtered.forEach((item, idx) => {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        chunks.push(`<div class="command-group-label">${escapeHtml(currentGroup)}</div>`);
      }
      chunks.push(`
        <button
          type="button"
          class="command-item-btn ${idx === activeIdx ? 'active' : ''}"
          data-cmd-id="${escapeHtml(item.id)}"
          data-cmd-index="${idx}"
          ${item.disabled ? 'disabled' : ''}
        >
          <span class="command-item-lead">
            ${item.icon}
            <span>${escapeHtml(item.label)}</span>
          </span>
          ${item.shortcut ? `<kbd class="kbd-badge">${escapeHtml(item.shortcut)}</kbd>` : ''}
        </button>
      `);
    });
    listEl.innerHTML = chunks.join('');

    listEl.querySelectorAll('.command-item-btn').forEach((btn) => {
      listScope.listen(btn, 'click', () => {
        const cmdId = (btn as HTMLElement).dataset.cmdId;
        const cmd = allItems.find((item) => item.id === cmdId);
        if (!cmd || cmd.disabled) return;
        cleanup();
        cmd.run();
      });
    });
  };

  if (typeof window !== 'undefined') {
    scope.listen<KeyboardEvent>(window, 'keydown', (e) => {
      if (
        e.key === 'Escape' ||
        ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))
      ) {
        e.preventDefault();
        cleanup();
        return;
      }
      const filtered = getFilteredItems();
      if (filtered.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = (activeIdx + 1) % filtered.length;
        onStateChange(query, activeIdx);
        renderList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = (activeIdx - 1 + filtered.length) % filtered.length;
        onStateChange(query, activeIdx);
        renderList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = filtered[activeIdx];
        if (chosen && !chosen.disabled) {
          cleanup();
          chosen.run();
        }
      }
    });
  }

  host.innerHTML = `
    <div class="command-palette-backdrop" id="command-palette-backdrop">
      <div class="command-palette-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('toolbar.commandPaletteTitle'))}">
        <div class="command-palette-search">
          ${Icons.search}
          <input
            type="text"
            class="command-palette-input"
            id="command-palette-input"
            value="${escapeHtml(query)}"
            placeholder="${escapeHtml(t('cmd.placeholder'))}"
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
  scope.listen(searchInput, 'input', () => {
    if (!searchInput) return;
    query = searchInput.value;
    activeIdx = 0;
    onStateChange(query, activeIdx);
    renderList();
  });

  scope.listen<MouseEvent>(host.querySelector('#command-palette-backdrop'), 'click', (e) => {
    if ((e.target as HTMLElement | null)?.id === 'command-palette-backdrop') {
      cleanup();
    }
  });

  searchInput?.focus?.();
  return cleanup;
}
