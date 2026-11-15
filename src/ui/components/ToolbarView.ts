import { isRtlLanguage, t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';
import { getResolvedTheme, getThemePreference, ThemePreference } from '../theme';

export interface ToolbarRenderState {
  projectTitle: string;
  hasSlides: boolean;
  isNavigatorVisible: boolean;
  isInspectorVisible: boolean;
  isGeneratingDemo: boolean;
  canUndo: boolean;
  canRedo: boolean;
  themeIcon: string;
  themePref: ThemePreference;
}

export interface ToolbarCallbacks {
  onProjectTitleChange: (title: string) => void;
  onToggleNavigator: () => void;
  onToggleInspector: () => void;
  onOpenProject: () => void;
  onImportMedia: () => void;
  onOpenReelWorkflow: () => void;
  onAddSlide: () => void;
  onGenerateDemo: () => void;
  onSaveProject: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenShortcuts: () => void;
  onOpenCommandPalette: () => void;
  onToggleTheme: () => void;
  onToggleLanguage: () => void;
  onStartFullscreen: () => void;
}

export function renderWindowToolbarView(
  toolbar: HTMLElement | null,
  scope: ComponentScope,
  state: ToolbarRenderState,
  callbacks: ToolbarCallbacks
): void {
  if (!toolbar) return;

  scope.clear();

  const rtl = isRtlLanguage();
  const navIcon = rtl ? Icons.sidebarRight : Icons.sidebarLeft;
  const inspIcon = rtl ? Icons.sidebarLeft : Icons.sidebarRight;
  const themeTitle = `${t('toolbar.themeToggleTitle')} (${t(`theme.${state.themePref}`)})`;

  toolbar.innerHTML = `
    <div class="toolbar-group-leading">
      <button
        class="btn btn-toolbar btn-icon-only ${state.isNavigatorVisible ? 'active-pane' : ''}"
        id="btn-toggle-navigator"
        title="${escapeHtml(t('toolbar.toggleNavTitle'))}"
        aria-label="${escapeHtml(t('toolbar.toggleNavTitle'))}"
      >
        ${navIcon}
      </button>
      <div class="toolbar-divider"></div>
      <div class="doc-title-shell">
        <span class="doc-brand-dot" aria-hidden="true"></span>
        <input
          type="text"
          class="doc-title-input"
          id="project-title-input"
          value="${escapeHtml(state.projectTitle)}"
          aria-label="${escapeHtml(t('toolbar.projectTitleAria'))}"
          placeholder="${escapeHtml(t('toolbar.projectTitlePlaceholder'))}"
        />
      </div>
    </div>

    <div class="toolbar-group-center">
      <div class="toolbar-cluster toolbar-io-cluster">
        <button class="btn btn-toolbar is-compactable" id="btn-open-project" title="${escapeHtml(t('toolbar.openProjectTitle'))}" aria-label="${escapeHtml(t('toolbar.openProjectTitle'))}">
          ${Icons.folderOpen}
          <span class="btn-label">${escapeHtml(t('toolbar.openProject'))}</span>
        </button>
        <button class="btn btn-toolbar is-compactable" id="btn-export-manifest" ${!state.hasSlides ? 'disabled' : ''} title="${escapeHtml(t('toolbar.saveProjectTitle'))}" aria-label="${escapeHtml(t('toolbar.saveProjectTitle'))}">
          ${Icons.exportDoc}
          <span class="btn-label">${escapeHtml(t('toolbar.saveProject'))}</span>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-cluster toolbar-creation-cluster">
        <button class="btn btn-toolbar is-compactable-md" id="btn-batch-import" title="${escapeHtml(t('toolbar.importMediaTitle'))}" aria-label="${escapeHtml(t('toolbar.importMediaTitle'))}">
          ${Icons.folderImport}
          <span class="btn-label">${escapeHtml(t('toolbar.importMedia'))}</span>
        </button>

        <button class="btn btn-toolbar is-compactable-md" id="btn-reel-workflow" title="${escapeHtml(t('toolbar.reelWorkflowTitle'))}" aria-label="${escapeHtml(t('toolbar.reelWorkflowTitle'))}">
          ${Icons.filmTransition}
          <span class="btn-label">${escapeHtml(t('toolbar.reelWorkflow'))}</span>
        </button>

        <button class="btn btn-toolbar is-compactable" id="btn-add-slide" title="${escapeHtml(t('toolbar.addSlideTitle'))}" aria-label="${escapeHtml(t('toolbar.addSlideTitle'))}">
          ${Icons.photoPlus}
          <span class="btn-label">${escapeHtml(t('toolbar.addSlide'))}</span>
        </button>

        <button class="btn btn-toolbar is-compactable" id="btn-load-demo" ${state.isGeneratingDemo ? 'disabled' : ''} title="${escapeHtml(t('toolbar.loadDemoTitle'))}" aria-label="${escapeHtml(t('toolbar.loadDemoTitle'))}">
          ${Icons.sparkles}
          <span class="btn-label">${escapeHtml(state.isGeneratingDemo ? t('toolbar.loadDemoBusy') : t('toolbar.loadDemo'))}</span>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-cluster toolbar-history-cluster">
        <button class="btn btn-toolbar btn-icon-only" id="btn-studio-undo" ${!state.canUndo ? 'disabled' : ''} title="${escapeHtml(t('toolbar.undoTitle'))}" aria-label="${escapeHtml(t('toolbar.undoTitle'))}">
          ${Icons.undo}
        </button>
        <button class="btn btn-toolbar btn-icon-only" id="btn-studio-redo" ${!state.canRedo ? 'disabled' : ''} title="${escapeHtml(t('toolbar.redoTitle'))}" aria-label="${escapeHtml(t('toolbar.redoTitle'))}">
          ${Icons.redo}
        </button>
        <button class="btn btn-toolbar btn-icon-only" id="btn-shortcuts-help" title="${escapeHtml(t('toolbar.shortcutsTitle'))}" aria-label="${escapeHtml(t('toolbar.shortcutsTitle'))}">
          ${Icons.keyboard}
        </button>
      </div>
    </div>

    <div class="toolbar-group-trailing">
      <button
        class="btn btn-toolbar btn-cmd-trigger"
        id="btn-command-palette"
        type="button"
        title="${escapeHtml(t('toolbar.commandPaletteTitle'))}"
        aria-label="${escapeHtml(t('toolbar.commandPaletteTitle'))}"
      >
        ${Icons.command}
        <kbd class="btn-cmd-kbd">Ctrl+K</kbd>
      </button>
      <div class="toolbar-cluster toolbar-env-cluster">
        <button
          class="btn btn-toolbar btn-theme-toggle"
          id="btn-theme-toggle"
          type="button"
          data-theme-pref="${getThemePreference()}"
          data-theme-resolved="${getResolvedTheme()}"
          title="${escapeHtml(themeTitle)}"
          aria-label="${escapeHtml(themeTitle)}"
        >
          ${state.themeIcon}
        </button>
        <button
          class="btn btn-toolbar btn-lang-toggle"
          id="btn-lang-toggle"
          type="button"
          title="${escapeHtml(t('toolbar.langToggleTitle'))}"
          aria-label="${escapeHtml(t('toolbar.langToggleTitle'))}"
        >
          ${Icons.globe}
          <span class="lang-toggle-code">${escapeHtml(t('toolbar.langCurrent'))}</span>
        </button>
        <button
          class="btn btn-toolbar btn-icon-only ${state.isInspectorVisible ? 'active-pane' : ''}"
          id="btn-toggle-inspector"
          title="${escapeHtml(t('toolbar.toggleInspectorTitle'))}"
          aria-label="${escapeHtml(t('toolbar.toggleInspectorTitle'))}"
        >
          ${inspIcon}
        </button>
      </div>
      <button class="btn btn-prominent btn-hero-present" id="btn-start-fullscreen" ${!state.hasSlides ? 'disabled' : ''} title="${escapeHtml(t('toolbar.playPresentationTitle'))}">
        ${Icons.playFill}
        <span>${escapeHtml(t('toolbar.playPresentation'))}</span>
      </button>
    </div>
  `;

  const titleInput = toolbar.querySelector('#project-title-input') as HTMLInputElement | null;
  scope.listen(titleInput, 'change', () => {
    if (titleInput) callbacks.onProjectTitleChange(titleInput.value);
  });

  scope.listen(toolbar.querySelector('#btn-command-palette'), 'click', callbacks.onOpenCommandPalette);
  scope.listen(toolbar.querySelector('#btn-theme-toggle'), 'click', callbacks.onToggleTheme);
  scope.listen(toolbar.querySelector('#btn-lang-toggle'), 'click', callbacks.onToggleLanguage);
  scope.listen(toolbar.querySelector('#btn-toggle-navigator'), 'click', callbacks.onToggleNavigator);
  scope.listen(toolbar.querySelector('#btn-toggle-inspector'), 'click', callbacks.onToggleInspector);
  scope.listen(toolbar.querySelector('#btn-open-project'), 'click', callbacks.onOpenProject);
  scope.listen(toolbar.querySelector('#btn-load-demo'), 'click', callbacks.onGenerateDemo);
  scope.listen(toolbar.querySelector('#btn-batch-import'), 'click', callbacks.onImportMedia);
  scope.listen(toolbar.querySelector('#btn-reel-workflow'), 'click', callbacks.onOpenReelWorkflow);
  scope.listen(toolbar.querySelector('#btn-add-slide'), 'click', callbacks.onAddSlide);
  scope.listen(toolbar.querySelector('#btn-export-manifest'), 'click', callbacks.onSaveProject);
  scope.listen(toolbar.querySelector('#btn-studio-undo'), 'click', callbacks.onUndo);
  scope.listen(toolbar.querySelector('#btn-studio-redo'), 'click', callbacks.onRedo);
  scope.listen(toolbar.querySelector('#btn-shortcuts-help'), 'click', callbacks.onOpenShortcuts);
  scope.listen(toolbar.querySelector('#btn-start-fullscreen'), 'click', callbacks.onStartFullscreen);
}

export function syncToolbarUndoRedoState(
  root: HTMLElement,
  canUndo: boolean,
  canRedo: boolean
): void {
  const undoBtn = root.querySelector('#btn-studio-undo') as HTMLButtonElement | null;
  const redoBtn = root.querySelector('#btn-studio-redo') as HTMLButtonElement | null;
  if (undoBtn) undoBtn.disabled = !canUndo;
  if (redoBtn) redoBtn.disabled = !canRedo;
}
