import { t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';

export interface EmptyStageCallbacks {
  onImportMedia: () => void;
  onOpenReelWorkflow: () => void;
  onGenerateDemo: () => void;
  onOpenProject: () => void;
}

export function renderEmptyStageView(
  overlay: HTMLElement | null,
  hud: HTMLElement | null,
  scope: ComponentScope,
  slideCount: number,
  callbacks: EmptyStageCallbacks
): void {
  if (!overlay) return;

  scope.clear();

  if (slideCount > 0) {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    if (hud) hud.style.display = 'flex';
    return;
  }

  overlay.style.display = 'flex';
  if (hud) hud.style.display = 'none';

  const formats = ['PNG', 'JPG', 'WEBP', 'MP4', 'WEBM', 'MOV', 'MPRES'];
  const badgesHtml = formats
    .map((fmt) => `<span class="empty-format-chip">${fmt}</span>`)
    .join('');

  overlay.innerHTML = `
    <div class="empty-sheet-card empty-launchpad" id="empty-drop-card">
      <div class="empty-launchpad-hero">
        <div class="empty-symbol-circle">${Icons.filmTransition}</div>
        <h2 class="empty-heading">${escapeHtml(t('stage.emptyHeading'))}</h2>
        <p class="empty-copy">${escapeHtml(t('stage.emptyDesc'))}</p>
        <div class="empty-meta-line empty-format-badges">${badgesHtml}</div>
      </div>

      <div class="empty-launchpad-grid">
        <button type="button" class="empty-workflow-card is-primary" id="btn-empty-import">
          <span class="empty-workflow-icon">${Icons.folderImport}</span>
          <span class="empty-workflow-title">${escapeHtml(t('stage.emptyPickFiles'))}</span>
          <span class="empty-workflow-sub">${escapeHtml(t('toolbar.importMediaTitle'))}</span>
        </button>

        <button type="button" class="empty-workflow-card is-film" id="btn-empty-reel">
          <span class="empty-workflow-icon">${Icons.splitCue}</span>
          <span class="empty-workflow-title">${escapeHtml(t('stage.emptyReelWorkflow'))}</span>
          <span class="empty-workflow-sub">${escapeHtml(t('toolbar.reelWorkflowTitle'))}</span>
        </button>

        <button type="button" class="empty-workflow-card is-spark" id="btn-empty-demo">
          <span class="empty-workflow-icon">${Icons.sparkles}</span>
          <span class="empty-workflow-title">${escapeHtml(t('stage.emptyLoadDemo'))}</span>
          <span class="empty-workflow-sub">${escapeHtml(t('toolbar.loadDemoTitle'))}</span>
        </button>
      </div>

      <div class="empty-launchpad-footer">
        <button type="button" class="btn btn-xs" id="btn-empty-open-project">
          ${Icons.folderOpen}
          <span>${escapeHtml(t('toolbar.openProject'))}</span>
        </button>
        <kbd class="kbd-badge">Ctrl+O</kbd>
      </div>
    </div>
  `;

  scope.listen(overlay.querySelector('#btn-empty-import'), 'click', callbacks.onImportMedia);
  scope.listen(overlay.querySelector('#btn-empty-reel'), 'click', callbacks.onOpenReelWorkflow);
  scope.listen(overlay.querySelector('#btn-empty-demo'), 'click', callbacks.onGenerateDemo);
  scope.listen(
    overlay.querySelector('#btn-empty-open-project'),
    'click',
    callbacks.onOpenProject
  );
}
