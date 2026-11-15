const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktopApp: true,
  setFullScreen: (flag) => ipcRenderer.invoke('window:set-fullscreen', flag),
  isFullScreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  setWindowTitle: (title) => ipcRenderer.invoke('window:set-title', title),
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
  onSaveProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('project:save-progress', listener);
    return () => ipcRenderer.removeListener('project:save-progress', listener);
  },
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
