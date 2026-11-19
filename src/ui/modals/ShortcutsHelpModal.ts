import { t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import type { LayerStack } from '../core/LayerStack';
import { attachModalDialogBehavior } from '../core/ModalDialog';
import { Icons } from '../icons';

export function openShortcutsHelpModalView(
  host: HTMLElement,
  scope: ComponentScope,
  onBeforeClose: () => void,
  layerStack?: LayerStack
): () => void {
  scope.clear();

  host.innerHTML = `
    <div class="modal-backdrop" id="shortcuts-modal-backdrop" role="presentation">
      <div class="modal-card apple-sheet-modal shortcuts-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('shortcuts.modalAria'))}">
        <div class="modal-header">
          <div class="modal-title">
            ${Icons.keyboard}
            <span>${escapeHtml(t('shortcuts.title'))}</span>
          </div>
          <button class="btn btn-icon-only" id="btn-shortcuts-close" type="button" aria-label="${escapeHtml(t('presenter.close'))}">${Icons.close}</button>
        </div>
        <div class="modal-body shortcuts-grid">
          <div class="shortcuts-section">
            <div class="shortcuts-section-title">${escapeHtml(t('shortcuts.studioSection'))}</div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.undo'))}</span><kbd class="kbd-badge">Ctrl + Z</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.redo'))}</span><kbd class="kbd-badge">Ctrl + Y</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.duplicate'))}</span><kbd class="kbd-badge">Ctrl + D</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.delete'))}</span><kbd class="kbd-badge">Delete</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.selectAll'))}</span><kbd class="kbd-badge">Ctrl + A</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.save'))}</span><kbd class="kbd-badge">Ctrl + S</kbd></div>
        <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.open'))}</span><kbd class="kbd-badge">Ctrl + O</kbd></div>
        <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.importMedia'))}</span><kbd class="kbd-badge">Ctrl + Shift + I</kbd></div>
        <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.editCues'))}</span><kbd class="kbd-badge">Ctrl + R</kbd></div>
        <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.playSpace'))}</span><kbd class="kbd-badge">Space</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.startPresenter'))}</span><kbd class="kbd-badge">F5</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.commandPalette'))}</span><kbd class="kbd-badge">Ctrl + K</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.help'))}</span><kbd class="kbd-badge">?</kbd></div>
          </div>
          <div class="shortcuts-section">
            <div class="shortcuts-section-title">${escapeHtml(t('shortcuts.presenterSection'))}</div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.next'))}</span><kbd class="kbd-badge">Space / → / Enter / N</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.prev'))}</span><kbd class="kbd-badge">← / Backspace / P</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.notes'))}</span><kbd class="kbd-badge">S</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.resetTimer'))}</span><kbd class="kbd-badge">T</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.grid'))}</span><kbd class="kbd-badge">G</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.blackWhite'))}</span><kbd class="kbd-badge">B / W</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.laser'))}</span><kbd class="kbd-badge">Ctrl + L</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.jumpNum'))}</span><kbd class="kbd-badge">0–9 + Enter</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.exit'))}</span><kbd class="kbd-badge">Esc</kbd></div>
          </div>
        </div>
        <div class="modal-footer reel-cue-modal-footer">
          <span class="prop-subtext">${escapeHtml(t('shortcuts.footerHint')).replace('{key}', '<kbd class="kbd-badge">Esc</kbd>')}</span>
        </div>
      </div>
    </div>
  `;

  const backdrop = host.querySelector('#shortcuts-modal-backdrop') as HTMLElement;
  const dialog = host.querySelector('.shortcuts-modal') as HTMLElement | null;
  const closeBtn = host.querySelector('#btn-shortcuts-close') as HTMLElement | null;

  const cleanup = attachModalDialogBehavior({
    host,
    scope,
    backdropEl: backdrop,
    dialogEl: dialog,
    layerStack,
    layerId: 'shortcuts-modal',
    layerKind: 'modal',
    initialFocusEl: closeBtn,
    onBeforeClose,
  });

  if (closeBtn) scope.listen(closeBtn, 'click', cleanup);
  if (typeof window !== 'undefined') {
    scope.listen<KeyboardEvent>(window, 'keydown', (e) => {
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
      }
    });
  }

  return cleanup;
}
