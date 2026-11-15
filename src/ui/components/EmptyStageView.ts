import { getLanguage, t } from '../../core/i18n';
import {
  formatRelativeSessionTime,
  RecentSessionEntry,
} from '../../core/services/RecentSessionsService';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';
import { closeActiveAppleMenu, openAppleMenu } from './AppleDropdown';

export interface EmptyStageCallbacks {
  onImportMedia: () => void;
  onOpenReelWorkflow: () => void;
  onGenerateDemo: () => void;
  onOpenProject: () => void;
  onOpenRecentSession: (entry: RecentSessionEntry) => void;
  onTogglePinRecentSession: (entry: RecentSessionEntry) => void;
  onRevealRecentSession: (entry: RecentSessionEntry) => void;
  onRemoveRecentSession: (entry: RecentSessionEntry) => void;
  onClearUnpinnedRecents: () => void;
}

const THUMB_GRADIENT_COUNT = 5;

export function renderEmptyStageView(
  overlay: HTMLElement | null,
  hud: HTMLElement | null,
  scope: ComponentScope,
  slideCount: number,
  recentSessions: RecentSessionEntry[],
  callbacks: EmptyStageCallbacks
): void {
  if (!overlay) return;

  scope.clear();
  closeActiveAppleMenu();

  if (slideCount > 0) {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    if (hud) hud.style.display = 'flex';
    return;
  }

  overlay.style.display = 'flex';
  if (hud) hud.style.display = 'none';

  const formats = ['PNG', 'JPG', 'WEBP', 'MP4', 'WEBM', 'MOV', 'MPRES'];
  const badgesHtml = formats.map((fmt) => `<span class="empty-format-chip">${fmt}</span>`).join('');
  const lang = getLanguage();

  overlay.innerHTML = `
    <div class="welcome-hub" id="empty-drop-card">
      <div class="welcome-hub-main">
        <div class="welcome-hero">
          <div class="welcome-brand-lockup" dir="ltr">
            <span class="welcome-brand-mark" aria-hidden="true">${Icons.brandMark}</span>
            <div class="welcome-brand-words">
              <span class="welcome-brand-title">MOTION</span>
              <span class="welcome-brand-sub">PRESENTATION STUDIO</span>
            </div>
          </div>
          <span class="welcome-hero-badge">
            ${Icons.sparkles}
            <span>${escapeHtml(t('welcome.badge'))}</span>
          </span>
          <h2 class="welcome-hero-heading">${escapeHtml(t('welcome.heading'))}</h2>
          <p class="welcome-hero-copy">${escapeHtml(t('welcome.subtitle'))}</p>
        </div>

        <div class="welcome-action-list">
          <button type="button" class="welcome-action-row is-featured" id="btn-empty-import">
            <span class="welcome-action-left">
              <span class="welcome-action-icon is-accent">${Icons.folderImport}</span>
              <span class="welcome-action-text">
                <span class="welcome-action-title">${escapeHtml(t('toolbar.importMedia'))}</span>
                <span class="welcome-action-sub">${escapeHtml(t('toolbar.importMediaTitle'))}</span>
              </span>
            </span>
            <kbd class="kbd-badge">Ctrl+Shift+I</kbd>
          </button>

          <button type="button" class="welcome-action-row" id="btn-empty-reel">
            <span class="welcome-action-left">
              <span class="welcome-action-icon is-film">${Icons.splitCue}</span>
              <span class="welcome-action-text">
                <span class="welcome-action-title">${escapeHtml(t('stage.emptyReelWorkflow'))}</span>
                <span class="welcome-action-sub">${escapeHtml(t('toolbar.reelWorkflowTitle'))}</span>
              </span>
            </span>
            <kbd class="kbd-badge">Ctrl+R</kbd>
          </button>

          <button type="button" class="welcome-action-row" id="btn-empty-open-project">
            <span class="welcome-action-left">
              <span class="welcome-action-icon">${Icons.folderOpen}</span>
              <span class="welcome-action-text">
                <span class="welcome-action-title">${escapeHtml(t('toolbar.openProject'))}</span>
                <span class="welcome-action-sub">${escapeHtml(t('welcome.openDesc'))}</span>
              </span>
            </span>
            <kbd class="kbd-badge">Ctrl+O</kbd>
          </button>

          <button type="button" class="welcome-action-row" id="btn-empty-demo">
            <span class="welcome-action-left">
              <span class="welcome-action-icon is-spark">${Icons.sparkles}</span>
              <span class="welcome-action-text">
                <span class="welcome-action-title">${escapeHtml(t('stage.emptyLoadDemo'))}</span>
                <span class="welcome-action-sub">${escapeHtml(t('toolbar.loadDemoTitle'))}</span>
              </span>
            </span>
            <span class="kbd-badge">Demo</span>
          </button>
        </div>

        <div class="welcome-drop-footer">
          <div class="welcome-drop-hint">${escapeHtml(t('welcome.dropHint'))}</div>
          <div class="empty-meta-line empty-format-badges">${badgesHtml}</div>
        </div>
      </div>

      <aside class="welcome-hub-sidebar" aria-label="${escapeHtml(t('welcome.recentTitle'))}">
        <div class="welcome-sidebar-head">
          <div class="welcome-sidebar-title-row">
            <span class="welcome-sidebar-title">${escapeHtml(t('welcome.recentTitle'))}</span>
            <span class="welcome-count-pill tabular-nums">${recentSessions.length}</span>
          </div>
          <button
            type="button"
            class="btn btn-icon-only btn-xs"
            id="btn-recent-menu"
            aria-label="${escapeHtml(t('toolbar.moreActions'))}"
            aria-haspopup="menu"
            aria-expanded="false"
          >
            ${Icons.moreHorizontal}
          </button>
        </div>

        <div class="welcome-search-shell">
          ${Icons.search}
          <input
            type="search"
            class="welcome-search-input"
            id="welcome-recent-search"
            placeholder="${escapeHtml(t('welcome.searchPlaceholder'))}"
            aria-label="${escapeHtml(t('welcome.searchPlaceholder'))}"
          />
        </div>

        <div class="welcome-recent-list" id="welcome-recent-list"></div>
      </aside>
    </div>
  `;

  const listEl = overlay.querySelector('#welcome-recent-list') as HTMLElement | null;
  const searchInput = overlay.querySelector('#welcome-recent-search') as HTMLInputElement | null;
  const listScope = scope.createChildScope();

  const renderRows = (queryText: string) => {
    if (!listEl) return;
    listScope.clear();

    const q = queryText.trim().toLowerCase();
    const filtered = recentSessions.filter(
      (entry) =>
        !q ||
        entry.title.toLowerCase().includes(q) ||
        entry.fileName.toLowerCase().includes(q) ||
        entry.filePath.toLowerCase().includes(q)
    );

    if (recentSessions.length === 0) {
      listEl.innerHTML = `
        <div class="welcome-recent-empty">
          <div class="welcome-recent-empty-icon">${Icons.clock}</div>
          <div class="welcome-recent-empty-title">${escapeHtml(t('welcome.recentEmptyTitle'))}</div>
          <div class="welcome-recent-empty-desc">${escapeHtml(t('welcome.recentEmptyDesc'))}</div>
        </div>
      `;
      return;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="welcome-recent-empty is-compact">
          <div class="welcome-recent-empty-desc">${escapeHtml(t('welcome.noMatches'))}</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered
      .map((entry, idx) => {
        const gradIdx = (idx % THUMB_GRADIENT_COUNT) + 1;
        const relative = formatRelativeSessionTime(entry.lastOpenedAt, lang);
        const slidesLabel = t('welcome.slidesCount', { count: entry.slideCount || 0 });
        const thumbContent = entry.thumbnailDataUrl
          ? `<img src="${escapeHtml(entry.thumbnailDataUrl)}" alt="" loading="lazy" />`
          : `<div class="welcome-thumb-art is-grad-${gradIdx}">
               <div class="welcome-thumb-bars"><span></span><span class="is-short"></span></div>
             </div>`;

        return `
          <div
            class="welcome-recent-row ${entry.exists === false ? 'is-missing' : ''}"
            data-recent-id="${escapeHtml(entry.id)}"
            tabindex="0"
            role="button"
          >
            <div class="welcome-recent-thumb">
              ${thumbContent}
              <span class="welcome-thumb-ratio">${escapeHtml(entry.aspectRatio || '16:9')}</span>
            </div>
            <div class="welcome-recent-info">
              <div class="welcome-recent-title-line">
                <span class="welcome-recent-name" dir="auto">${escapeHtml(entry.title)}</span>
                ${entry.pinned ? `<span class="welcome-pin-badge" title="${escapeHtml(t('welcome.unpin'))}">${Icons.pin}</span>` : ''}
              </div>
              <div class="welcome-recent-meta">
                <span>${escapeHtml(slidesLabel)}</span>
                ${relative ? `<span>·</span><span>${escapeHtml(relative)}</span>` : ''}
              </div>
              <div class="welcome-recent-file" dir="ltr">
                ${
                  entry.exists === false
                    ? `<span class="welcome-missing-pill">${escapeHtml(t('welcome.missingBadge'))}</span>`
                    : escapeHtml(entry.fileName)
                }
              </div>
            </div>
            <button
              type="button"
              class="btn btn-icon-only btn-xs welcome-recent-more"
              data-recent-more="${escapeHtml(entry.id)}"
              aria-label="${escapeHtml(t('toolbar.moreActions'))}"
            >
              ${Icons.moreHorizontal}
            </button>
          </div>
        `;
      })
      .join('');

    const openEntryContextMenu = (
      entry: RecentSessionEntry,
      anchorOrPoint: { anchorEl?: HTMLElement; point?: { x: number; y: number } }
    ) => {
      const hasDiskPath =
        Boolean(entry.filePath) &&
        !entry.filePath.startsWith('local://') &&
        entry.exists !== false;

      const closeFn = openAppleMenu({
        ...anchorOrPoint,
        align: 'end',
        minWidth: 204,
        items: [
          {
            label: t('toolbar.openProject'),
            icon: Icons.folderOpen,
            disabled: entry.exists === false,
            onSelect: () => callbacks.onOpenRecentSession(entry),
          },
          {
            label: entry.pinned ? t('welcome.unpin') : t('welcome.pin'),
            icon: Icons.pin,
            onSelect: () => callbacks.onTogglePinRecentSession(entry),
          },
          {
            label: t('welcome.revealFolder'),
            icon: Icons.folderImport,
            disabled: !hasDiskPath,
            onSelect: () => callbacks.onRevealRecentSession(entry),
          },
          {
            label: t('welcome.removeRecent'),
            icon: Icons.trash,
            danger: true,
            separatorBefore: true,
            onSelect: () => callbacks.onRemoveRecentSession(entry),
          },
        ],
      });
      listScope.addCleanup(closeFn);
    };

    listEl.querySelectorAll<HTMLElement>('.welcome-recent-row').forEach((row) => {
      const id = row.dataset.recentId || '';
      const entry = filtered.find((item) => item.id === id);
      if (!entry) return;

      listScope.listen(row, 'click', (e) => {
        if ((e.target as HTMLElement | null)?.closest('.welcome-recent-more')) return;
        callbacks.onOpenRecentSession(entry);
      });

      listScope.listen<KeyboardEvent>(row, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if ((e.target as HTMLElement | null)?.closest('.welcome-recent-more')) return;
          e.preventDefault();
          callbacks.onOpenRecentSession(entry);
        }
      });

      listScope.listen<MouseEvent>(row, 'contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openEntryContextMenu(entry, { point: { x: e.clientX, y: e.clientY } });
      });

      const moreBtn = row.querySelector<HTMLElement>('.welcome-recent-more');
      listScope.listen(moreBtn, 'click', (e) => {
        e.stopPropagation();
        if (moreBtn) {
          openEntryContextMenu(entry, { anchorEl: moreBtn });
        }
      });
    });
  };

  renderRows('');

  scope.listen(searchInput, 'input', () => {
    renderRows(searchInput?.value || '');
  });

  const recentMenuBtn = overlay.querySelector('#btn-recent-menu') as HTMLElement | null;
  scope.listen(recentMenuBtn, 'click', (e) => {
    e.stopPropagation();
    if (!recentMenuBtn) return;
    const hasUnpinned = recentSessions.some((entry) => !entry.pinned);
    const closeFn = openAppleMenu({
      anchorEl: recentMenuBtn,
      align: 'end',
      minWidth: 196,
      items: [
        {
          label: t('toolbar.openProject'),
          icon: Icons.folderOpen,
          shortcut: 'Ctrl+O',
          onSelect: callbacks.onOpenProject,
        },
        {
          label: t('welcome.clearUnpinned'),
          icon: Icons.trash,
          danger: true,
          separatorBefore: true,
          disabled: !hasUnpinned,
          onSelect: callbacks.onClearUnpinnedRecents,
        },
      ],
    });
    scope.addCleanup(closeFn);
  });

  scope.listen(overlay.querySelector('#btn-empty-import'), 'click', callbacks.onImportMedia);
  scope.listen(overlay.querySelector('#btn-empty-reel'), 'click', callbacks.onOpenReelWorkflow);
  scope.listen(overlay.querySelector('#btn-empty-demo'), 'click', callbacks.onGenerateDemo);
  scope.listen(
    overlay.querySelector('#btn-empty-open-project'),
    'click',
    callbacks.onOpenProject
  );
}
