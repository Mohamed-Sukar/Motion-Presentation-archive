import { t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';

export function openShortcutsHelpModalView(
  host: HTMLElement,
  scope: ComponentScope,
  onBeforeClose: () => void
): () => void {
  scope.clear();
  let isClosed = false;
  const prevFocused =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

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

  if (typeof window !== 'undefined') {
    scope.listen<KeyboardEvent>(window, 'keydown', (e) => {
      if (e.key === 'Escape' || e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        cleanup();
      }
    });
  }

  host.innerHTML = `
    <div class="reel-cue-modal-backdrop" id="shortcuts-modal-backdrop">
      <div class="choice-modal shortcuts-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('shortcuts.modalAria'))}">
        <div class="reel-cue-modal-header">
          <div class="reel-modal-header-lead">
            ${Icons.keyboard}
            <span class="reel-modal-title">${escapeHtml(t('shortcuts.title'))}</span>
          </div>
          <button class="icon-btn" id="btn-shortcuts-close" aria-label="${escapeHtml(t('presenter.close'))}">${Icons.close}</button>
        </div>
        <div class="choice-modal-body shortcuts-grid">
          <div class="shortcuts-section">
            <div class="shortcuts-section-title">${escapeHtml(t('shortcuts.studioSection'))}</div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.undo'))}</span><kbd class="kbd-badge">Ctrl + Z</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.redo'))}</span><kbd class="kbd-badge">Ctrl + Y</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.duplicate'))}</span><kbd class="kbd-badge">Ctrl + D</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.delete'))}</span><kbd class="kbd-badge">Delete</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.selectAll'))}</span><kbd class="kbd-badge">Ctrl + A</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.saveOpen'))}</span><kbd class="kbd-badge">Ctrl + S / O</kbd></div>
            <div class="shortcut-row"><span>${escapeHtml(t('shortcuts.startPresenter'))}</span><kbd class="kbd-badge">F5</kbd></div>
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
        <div class="reel-cue-modal-footer">
          <span class="prop-subtext">${escapeHtml(t('shortcuts.footerHint'))}</span>
          <button class="btn btn-prominent" id="btn-shortcuts-done" type="button">${escapeHtml(t('shortcuts.doneBtn'))}</button>
        </div>
      </div>
    </div>
  `;

  scope.listen(host.querySelector('#btn-shortcuts-close'), 'click', cleanup);
  scope.listen(host.querySelector('#btn-shortcuts-done'), 'click', cleanup);
  scope.listen<MouseEvent>(host.querySelector('#shortcuts-modal-backdrop'), 'click', (e) => {
    if ((e.target as HTMLElement | null)?.id === 'shortcuts-modal-backdrop') {
      cleanup();
    }
  });
  (host.querySelector('#btn-shortcuts-done') as HTMLElement | null)?.focus?.();

  return cleanup;
}
