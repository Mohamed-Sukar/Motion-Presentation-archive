import { t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import type { LayerStack } from '../core/LayerStack';
import { attachModalDialogBehavior } from '../core/ModalDialog';
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
  layerStack?: LayerStack;
}

export function openCommandPaletteModal(props: CommandPaletteOpenProps): () => void {
  const { host, scope, items: allItems, onStateChange, onBeforeClose, layerStack } = props;

  scope.clear();
  let query = props.initialQuery;
  let activeIdx = props.initialActiveIdx;
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

  const backdrop = host.querySelector('#command-palette-backdrop') as HTMLElement;
  const dialog = host.querySelector('.command-palette-modal') as HTMLElement | null;
  const searchInput = host.querySelector('#command-palette-input') as HTMLInputElement | null;

  const cleanup = attachModalDialogBehavior({
    host,
    scope,
    backdropEl: backdrop,
    dialogEl: dialog,
    layerStack,
    layerId: 'command-palette',
    layerKind: 'command-palette',
    initialFocusEl: searchInput,
    trapFocus: false,
    onBeforeClose,
  });

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

    const activeBtn = listEl.querySelector('.command-item-btn.active') as HTMLElement | null;
    if (activeBtn && typeof (activeBtn as { scrollIntoView?: unknown }).scrollIntoView === 'function') {
      activeBtn.scrollIntoView({ block: 'nearest' });
    }
  };

  if (typeof window !== 'undefined') {
    scope.listen<KeyboardEvent>(window, 'keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
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

  renderList();

  scope.listen(searchInput, 'input', () => {
    if (!searchInput) return;
    query = searchInput.value;
    activeIdx = 0;
    onStateChange(query, activeIdx);
    renderList();
  });

  return cleanup;
}
