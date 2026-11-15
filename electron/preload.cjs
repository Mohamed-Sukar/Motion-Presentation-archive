const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktopApp: true,
  setFullScreen: (flag) => ipcRenderer.invoke('window:set-fullscreen', flag),
  isFullScreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  setWindowTitle: (title) => ipcRenderer.invoke('window:set-title', title),
  setProjectDirty: (dirty) => ipcRenderer.send('window:set-project-dirty', Boolean(dirty)),
  onSaveBeforeQuit: (callback) => subscribe('app:save-before-quit', callback),
  confirmQuit: (payload) => ipcRenderer.send('app:confirm-quit', payload),
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  onWindowState: (callback) => subscribe('window:state', callback),
  setZoomFactor: (factor) => ipcRenderer.invoke('window:set-zoom', factor),
  stepZoom: (direction) => ipcRenderer.invoke('window:step-zoom', direction),
  resetZoom: () => ipcRenderer.invoke('window:reset-zoom'),
  getDisplays: () => ipcRenderer.invoke('window:get-displays'),
  reloadStudio: () => ipcRenderer.invoke('window:reload-studio'),

  // Dedicated Presenter Window channels
  openPresenterWindow: (payload) => ipcRenderer.invoke('presenter:open', payload),
  closePresenterWindow: () => ipcRenderer.invoke('presenter:close'),
  setPresenterDisplay: (displayId) => ipcRenderer.invoke('presenter:set-display', displayId),
  sendPresenterCommand: (command) => ipcRenderer.invoke('presenter:command', command),
  onPresenterStatus: (callback) => subscribe('presenter:status', callback),
  onPresenterClosed: (callback) => subscribe('presenter:closed', callback),
  signalPresenterReady: () => ipcRenderer.send('presenter:ready'),
  onPresenterInit: (callback) => subscribe('presenter:init', callback),
  onPresenterCommand: (callback) => subscribe('presenter:command', callback),
  emitPresenterStatus: (status) => ipcRenderer.send('presenter:status', status),
  requestClosePresenter: (lastSlideIndex) => ipcRenderer.send('presenter:request-close', lastSlideIndex),

  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getSystemLocale: () => ipcRenderer.invoke('app:get-locale'),
  setLanguage: (lang) => ipcRenderer.invoke('app:set-language', lang),
  setTheme: (themePref) => ipcRenderer.invoke('app:set-theme', themePref),

  // Streaming open/save & mpres:// media channels (Phase 1)
  openProjectStreamedDialog: () => ipcRenderer.invoke('project:open-dialog'),
  openProjectByPath: (filePath) => ipcRenderer.invoke('project:open-path', filePath),
  openDemoProject: () => ipcRenderer.invoke('project:open-demo'),
  saveProjectStreamed: (payload) => ipcRenderer.invoke('project:save-streamed', payload),
  closeProjectToken: (projectToken) => ipcRenderer.invoke('project:close-token', projectToken),
  autosaveProject: (payload) => ipcRenderer.invoke('project:autosave', payload),
  clearAutosave: () => ipcRenderer.invoke('project:clear-autosave'),
  onAutosaveRecovery: (callback) => subscribe('project:recover-autosave', callback),
  onSaveProgress: (callback) => subscribe('project:save-progress', callback),
  openMediaPathsDialog: () => ipcRenderer.invoke('media:open-dialog'),
  registerMediaPaths: (pathsList) => ipcRenderer.invoke('media:register-paths', pathsList),

  // Startup / OS file association channels
  consumePendingProjectFile: () => ipcRenderer.invoke('project:consume-pending'),
  onOpenProjectFile: (callback) => {
    ipcRenderer.on('project:open-file', (_event, payload) => callback(payload));
  },
  onMenuCommand: (callback) => {
    ipcRenderer.on('menu:command', (_event, cmd) => callback(cmd));
  },
  getPathForFile: (file) => {
    try {
      return webUtils?.getPathForFile ? webUtils.getPathForFile(file) : null;
    } catch {
      return null;
    }
  },

  // Recent sessions history (Welcome Workspace)
  listRecentProjects: () => ipcRenderer.invoke('recent:list'),
  upsertRecentProject: (entry) => ipcRenderer.invoke('recent:upsert', entry),
  togglePinRecentProject: (filePath) => ipcRenderer.invoke('recent:toggle-pin', filePath),
  removeRecentProject: (filePath) => ipcRenderer.invoke('recent:remove', filePath),
  clearRecentProjects: () => ipcRenderer.invoke('recent:clear'),
  revealRecentProject: (filePath) => ipcRenderer.invoke('recent:reveal', filePath),

  // Legacy channels kept during transition
  openProjectDialog: () => ipcRenderer.invoke('dialog:open-project'),
  saveProjectDialog: (payload) => ipcRenderer.invoke('dialog:save-project', payload),
  saveProjectDirect: (payload) => ipcRenderer.invoke('project:save-direct', payload),
  openMediaDialog: () => ipcRenderer.invoke('dialog:open-media'),
});
