const { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme, protocol, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { extractProjectPathFromArgv, isSupportedProjectFile } = require('./argvHelper.cjs');
const {
  approveProjectPath,
  isApprovedProjectPath,
  approveMediaPath,
  isApprovedMediaPath,
} = require('./lib/pathRegistry.cjs');
const { writeAtomic, writeBufferAtomic } = require('./lib/atomicWrite.cjs');
const { indexBundle } = require('./lib/bundleIndex.cjs');
const { writeBundleToFile } = require('./lib/bundleWriter.cjs');
const {
  setCacheBaseDir,
  registerArchiveToken,
  updateArchiveToken,
  getArchiveEntryRef,
  closeArchiveToken,
  registerMediaFile,
  handleMpresRequest,
} = require('./lib/mediaProtocol.cjs');

// Register mpres:// as a privileged streaming scheme before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mpres',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

let mainWindow = null;
let rendererReady = false;
let pendingProjectFilePath = null;
let currentMenuLanguage = null;

function resolveSystemLanguage() {
  try {
    const preferred =
      (typeof app.getPreferredSystemLanguages === 'function' &&
        app.getPreferredSystemLanguages()[0]) ||
      (typeof app.getLocale === 'function' && app.getLocale()) ||
      '';
    return String(preferred).trim().toLowerCase().startsWith('ar') ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

function getActiveLanguage() {
  return currentMenuLanguage || resolveSystemLanguage();
}

const MENU_TEXT = {
  ar: {
    file: 'ملف',
    openProject: 'فتح مشروع...',
    importMedia: 'استيراد وسائط...',
    newSlide: 'إضافة شريحة صورة...',
    loadDemo: 'توليد عرض تجريبي',
    saveProject: 'حفظ المشروع',
    saveAs: 'حفظ باسم...',
    quit: 'خروج',
    edit: 'تحرير',
    undo: 'تراجع',
    redo: 'إعادة',
    duplicateSlide: 'تكرار الشريحة المحددة',
    view: 'عرض',
    toggleNavigator: 'إظهار/إخفاء متصفح الشرائح',
    toggleInspector: 'إظهار/إخفاء لوحة الخصائص',
    playPresentation: 'تشغيل العرض بملء الشاشة',
    resetZoom: 'الحجم الافتراضي للواجهة',
    zoomIn: 'تكبير الواجهة',
    zoomOut: 'تصغير الواجهة',
    toggleFullscreen: 'ملء نافذة النظام',
    openProjectTitle: 'فتح ملف مشروع العرض الحركي',
    saveProjectTitle: 'حفظ ملف العرض التقديمي',
    importMediaTitle: 'استيراد وسائط العرض (صور وفيديوهات)',
    invalidSavePath: 'مسار الحفظ غير صالح أو غير مصرح به.',
    projectFilterLabel: 'مشروع عرض حركي',
    mediaFilesFilter: 'ملفات الوسائط',
    imagesFilter: 'الصور',
    videosFilter: 'الفيديوهات',
    allFilesFilter: 'كافة الملفات',
    backupFoundTitle: 'استعادة نسخة احتياطية للمشروع',
    backupFoundMessage: 'تعذّر قراءة ملف المشروع، لكن تم العثور على نسخة احتياطية (.bak) من آخر حفظ مكتمل.',
    backupFoundDetail: 'هل تريد استعادة النسخة الاحتياطية وفتح المشروع؟',
    backupRestoreBtn: 'استعادة وفتح',
    backupCancelBtn: 'إلغاء',
    help: 'مساعدة',
    shortcuts: 'اختصارات لوحة المفاتيح',
    about: 'حول Motion Presentation Studio',
  },
  en: {
    file: 'File',
    openProject: 'Open Project...',
    importMedia: 'Import Media...',
    newSlide: 'New Image Slide...',
    loadDemo: 'Load Demo Deck',
    saveProject: 'Save Project',
    saveAs: 'Save As...',
    quit: 'Quit',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    duplicateSlide: 'Duplicate Selected Slide',
    view: 'View',
    toggleNavigator: 'Toggle Slide Navigator',
    toggleInspector: 'Toggle Inspector Panel',
    playPresentation: 'Play Fullscreen Presentation',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    toggleFullscreen: 'Toggle Window Fullscreen',
    openProjectTitle: 'Open Motion Presentation Project',
    saveProjectTitle: 'Save Presentation Project',
    importMediaTitle: 'Import Presentation Media (Images & Videos)',
    invalidSavePath: 'Invalid or unapproved save file path.',
    projectFilterLabel: 'Motion Presentation Project',
    mediaFilesFilter: 'Media Files',
    imagesFilter: 'Images',
    videosFilter: 'Videos',
    allFilesFilter: 'All Files',
    backupFoundTitle: 'Restore Project Backup',
    backupFoundMessage: 'The project file could not be opened, but a valid backup (.bak) from the last completed save was found.',
    backupFoundDetail: 'Restore the backup and open the project?',
    backupRestoreBtn: 'Restore & Open',
    backupCancelBtn: 'Cancel',
    help: 'Help',
    shortcuts: 'Keyboard Shortcuts',
    about: 'About Motion Presentation Studio',
  },
};

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function normalizeFinalMpresPath(targetPath) {
  const cleanBase = String(targetPath).replace(/(\.mpres\.json|\.json)$/i, '');
  return cleanBase.toLowerCase().endsWith('.mpres') ? cleanBase : `${cleanBase}.mpres`;
}

/**
 * Indexes a project file for zero-copy `mpres://` streaming, offering `.bak` recovery if needed.
 */
async function openProjectStreaming(filePath) {
  const resolved = path.resolve(filePath);
  const bakPath = `${resolved}.bak`;
  let indexResult;
  let recoveredFromBackup = false;

  try {
    indexResult = await indexBundle(resolved);
  } catch (primaryErr) {
    if (fs.existsSync(bakPath)) {
      let bakIndex;
      try {
        bakIndex = await indexBundle(bakPath);
      } catch {
        bakIndex = null;
      }

      if (bakIndex) {
        const L = MENU_TEXT[getActiveLanguage()];
        const choice = mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: L.backupFoundTitle,
              message: L.backupFoundMessage,
              detail: `${L.backupFoundDetail}\n(${path.basename(bakPath)})`,
              buttons: [L.backupRestoreBtn, L.backupCancelBtn],
              defaultId: 0,
              cancelId: 1,
            })
          : { response: 1 };

        if (choice.response === 0) {
          await writeAtomic(
            resolved,
            async (tmpPath) => {
              await fs.promises.copyFile(bakPath, tmpPath);
              const fh = await fs.promises.open(tmpPath, 'r+');
              try {
                await fh.sync();
              } finally {
                await fh.close();
              }
            },
            {
              keepBackup: false,
              verifyFn: async (tmpPath) => {
                await indexBundle(tmpPath);
              },
            }
          );
          indexResult = await indexBundle(resolved);
          recoveredFromBackup = true;
        } else {
          throw primaryErr;
        }
      } else {
        throw primaryErr;
      }
    } else {
      throw primaryErr;
    }
  }

  const { projectToken, assets } = registerArchiveToken(resolved, indexResult);
  approveProjectPath(resolved);

  return {
    projectToken,
    filePath: resolved,
    fileName: path.basename(resolved),
    format: indexResult.format,
    manifestJson: indexResult.manifestJson,
    assets,
    recoveredFromBackup,
  };
}

async function enqueueOrSendProjectFile(filePath) {
  if (!filePath || !isSupportedProjectFile(filePath)) return;
  if (mainWindow && rendererReady && !mainWindow.isDestroyed()) {
    try {
      const payload = await openProjectStreaming(filePath);
      mainWindow.webContents.send('project:open-file', payload);
      return;
    } catch (err) {
      console.error('Failed to open project file:', err);
    }
  }
  pendingProjectFilePath = filePath;
}

function buildNativeMenu(lang = getActiveLanguage()) {
  const L = MENU_TEXT[lang === 'en' ? 'en' : 'ar'];
  const sendCommand = (cmd) => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('menu:command', cmd);
    }
  };

  const template = [
    {
      label: L.file,
      submenu: [
        {
          label: L.openProject,
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendCommand('open-project'),
        },
        {
          label: L.importMedia,
          accelerator: 'CmdOrCtrl+O',
          click: () => sendCommand('import-media'),
        },
        {
          label: L.newSlide,
          accelerator: 'CmdOrCtrl+N',
          click: () => sendCommand('add-slide'),
        },
        {
          label: L.loadDemo,
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => sendCommand('load-demo'),
        },
        { type: 'separator' },
        {
          label: L.saveProject,
          accelerator: 'CmdOrCtrl+S',
          click: () => sendCommand('save-project'),
        },
        {
          label: L.saveAs,
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendCommand('save-project-as'),
        },
        { type: 'separator' },
        { role: 'quit', label: L.quit },
      ],
    },
    {
      label: L.edit,
      submenu: [
        {
          label: L.undo,
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendCommand('undo'),
        },
        {
          label: L.redo,
          accelerator: 'CmdOrCtrl+Y',
          click: () => sendCommand('redo'),
        },
        { type: 'separator' },
        {
          label: L.duplicateSlide,
          accelerator: 'CmdOrCtrl+D',
          click: () => sendCommand('duplicate-slide'),
        },
      ],
    },
    {
      label: L.view,
      submenu: [
        {
          label: L.toggleNavigator,
          accelerator: 'CmdOrCtrl+1',
          click: () => sendCommand('toggle-navigator'),
        },
        {
          label: L.toggleInspector,
          accelerator: 'CmdOrCtrl+I',
          click: () => sendCommand('toggle-inspector'),
        },
        { type: 'separator' },
        {
          label: L.playPresentation,
          accelerator: 'F5',
          click: () => sendCommand('start-presentation'),
        },
        { type: 'separator' },
        { role: 'resetZoom', label: L.resetZoom },
        { role: 'zoomIn', label: L.zoomIn },
        { role: 'zoomOut', label: L.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: L.toggleFullscreen },
      ],
    },
    {
      label: L.help,
      submenu: [
        {
          label: L.shortcuts,
          accelerator: 'F1',
          click: () => sendCommand('open-shortcuts'),
        },
        { type: 'separator' },
        {
          label: L.about,
          click: () => sendCommand('open-about'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

const WINDOW_MIN_WIDTH = 720;
const WINDOW_MIN_HEIGHT = 500;

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function resolveInitialWindowState() {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const defaultWidth = Math.min(
    1360,
    Math.max(WINDOW_MIN_WIDTH, Math.round(primaryWorkArea.width * 0.88))
  );
  const defaultHeight = Math.min(
    840,
    Math.max(WINDOW_MIN_HEIGHT, Math.round(primaryWorkArea.height * 0.88))
  );
  const fallback = {
    width: defaultWidth,
    height: defaultHeight,
    isMaximized: false,
  };

  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;

    const width = Math.max(
      WINDOW_MIN_WIDTH,
      Math.min(primaryWorkArea.width, Math.round(Number(parsed.width) || defaultWidth))
    );
    const height = Math.max(
      WINDOW_MIN_HEIGHT,
      Math.min(primaryWorkArea.height, Math.round(Number(parsed.height) || defaultHeight))
    );
    const isMaximized = Boolean(parsed.isMaximized);

    const hasCoords = Number.isFinite(parsed.x) && Number.isFinite(parsed.y);
    if (hasCoords) {
      const candidate = {
        x: Math.round(parsed.x),
        y: Math.round(parsed.y),
        width,
        height,
      };
      const isVisible = screen.getAllDisplays().some((d) => {
        const wa = d.workArea;
        return (
          candidate.x + 80 > wa.x &&
          candidate.x < wa.x + wa.width - 80 &&
          candidate.y + 40 > wa.y &&
          candidate.y < wa.y + wa.height - 40
        );
      });
      if (isVisible) {
        return { ...candidate, isMaximized };
      }
    }

    return { width, height, isMaximized };
  } catch {
    return fallback;
  }
}

function bindWindowStatePersistence(win) {
  let saveTimer = null;

  const persistNow = () => {
    if (!win || win.isDestroyed()) return;
    try {
      const isMaximized = win.isMaximized();
      const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
      const payload = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized,
      };
      fs.writeFileSync(getWindowStatePath(), JSON.stringify(payload), 'utf-8');
    } catch {
      // Ignore non-critical window-state write errors
    }
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistNow();
    }, 250);
  };

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', persistNow);
  win.on('unmaximize', persistNow);
  win.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistNow();
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  rendererReady = false;
  const initialState = resolveInitialWindowState();

  mainWindow = new BrowserWindow({
    width: initialState.width,
    height: initialState.height,
    ...(Number.isFinite(initialState.x) && Number.isFinite(initialState.y)
      ? { x: initialState.x, y: initialState.y }
      : {}),
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    resizable: true,
    maximizable: true,
    minimizable: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0A0A0A' : '#f8f8fa',
    title: 'Motion Presentation Studio',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (initialState.isMaximized) {
    mainWindow.maximize();
  }
  bindWindowStatePersistence(mainWindow);

  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });

  buildNativeMenu();

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5175';
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');

  if (fs.existsSync(distIndex) && !process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadFile(distIndex);
  } else {
    mainWindow.loadURL(devUrl);
  }
}

function getRecentProjectsFilePath() {
  return path.join(app.getPath('userData'), 'recent-projects.json');
}

function normalizeRecentId(filePath) {
  return String(filePath || '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase();
}

function sortRecentProjects(entries) {
  return [...entries].sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff !== 0) return pinDiff;
    return (Number(b.lastOpenedAt) || 0) - (Number(a.lastOpenedAt) || 0);
  });
}

async function readRecentProjectsRaw() {
  try {
    const raw = await fs.promises.readFile(getRecentProjectsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortRecentProjects(
      parsed.filter(
        (item) =>
          item &&
          typeof item.filePath === 'string' &&
          item.filePath.trim() &&
          typeof item.title === 'string'
      )
    ).slice(0, 20);
  } catch {
    return [];
  }
}

async function writeRecentProjectsRaw(entries) {
  const sorted = sortRecentProjects(entries).slice(0, 20);
  const filePath = getRecentProjectsFilePath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
  await writeAtomic(filePath, async (tmpPath) => {
    await fs.promises.writeFile(tmpPath, JSON.stringify(sorted, null, 2), 'utf8');
  });
  return sorted;
}

async function hydrateRecentProjectsExistence(entries) {
  return await Promise.all(
    entries.map(async (item) => {
      const stat = await fs.promises.stat(item.filePath).catch(() => null);
      return {
        ...item,
        exists: Boolean(stat && stat.isFile()),
      };
    })
  );
}

async function writeProjectToDisk(targetPath, payload) {
  const finalPath = normalizeFinalMpresPath(targetPath);
  const data = Buffer.from(payload.bundleBytes);
  await writeBufferAtomic(finalPath, data, {
    keepBackup: true,
    verifyFn: async (tmpPath) => {
      await indexBundle(tmpPath);
    },
  });
  approveProjectPath(finalPath);
  return finalPath;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  pendingProjectFilePath = extractProjectPathFromArgv(process.argv, {
    appPath: app.getAppPath(),
  });

  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const nextPath = extractProjectPathFromArgv(commandLine, {
      appPath: app.getAppPath(),
    });
    if (nextPath) {
      void enqueueOrSendProjectFile(nextPath);
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (isSupportedProjectFile(filePath)) {
      void enqueueOrSendProjectFile(filePath);
    }
  });

  ipcMain.handle('window:set-fullscreen', (_event, flag) => {
    if (mainWindow) {
      mainWindow.setFullScreen(Boolean(flag));
      return mainWindow.isFullScreen();
    }
    return false;
  });

  ipcMain.handle('window:is-fullscreen', () => {
    return mainWindow ? mainWindow.isFullScreen() : false;
  });

  ipcMain.handle('window:set-title', (_event, title) => {
    if (mainWindow && !mainWindow.isDestroyed() && typeof title === 'string' && title.trim()) {
      mainWindow.setTitle(title.trim());
    }
  });

  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:get-locale', () => {
    return resolveSystemLanguage();
  });

  ipcMain.handle('app:set-language', (_event, lang) => {
    const next = lang === 'en' ? 'en' : 'ar';
    currentMenuLanguage = next;
    buildNativeMenu(next);
    return next;
  });

  ipcMain.handle('app:set-theme', (_event, themePref) => {
    const source = themePref === 'light' || themePref === 'dark' ? themePref : 'system';
    nativeTheme.themeSource = source;
    const resolved = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(resolved === 'dark' ? '#0A0A0A' : '#f8f8fa');
    }
    return resolved;
  });

  ipcMain.handle('project:consume-pending', async () => {
    rendererReady = true;
    const nextPath = pendingProjectFilePath;
    pendingProjectFilePath = null;
    if (!nextPath) return null;
    try {
      return await openProjectStreaming(nextPath);
    } catch {
      return null;
    }
  });

  ipcMain.handle('recent:list', async () => {
    const entries = await readRecentProjectsRaw();
    return await hydrateRecentProjectsExistence(entries);
  });

  ipcMain.handle('recent:upsert', async (_event, entry) => {
    if (!entry || typeof entry.filePath !== 'string' || !entry.filePath.trim()) {
      return await hydrateRecentProjectsExistence(await readRecentProjectsRaw());
    }
    const resolved = path.resolve(entry.filePath);
    const id = normalizeRecentId(resolved);
    const existing = await readRecentProjectsRaw();
    const prev = existing.find((item) => normalizeRecentId(item.filePath) === id || item.id === id);
    const nextItem = {
      id,
      title: String(entry.title || path.basename(resolved)),
      filePath: resolved,
      fileName: String(entry.fileName || path.basename(resolved)),
      slideCount: Math.max(0, Math.round(Number(entry.slideCount) || 0)),
      aspectRatio: typeof entry.aspectRatio === 'string' ? entry.aspectRatio : '16:9',
      lastOpenedAt: Number(entry.lastOpenedAt) || Date.now(),
      pinned: typeof entry.pinned === 'boolean' ? entry.pinned : Boolean(prev?.pinned),
      ...(typeof entry.thumbnailDataUrl === 'string' && entry.thumbnailDataUrl.startsWith('data:image/')
        ? { thumbnailDataUrl: entry.thumbnailDataUrl.slice(0, 180000) }
        : prev?.thumbnailDataUrl
          ? { thumbnailDataUrl: prev.thumbnailDataUrl }
          : {}),
    };
    const saved = await writeRecentProjectsRaw([
      nextItem,
      ...existing.filter((item) => normalizeRecentId(item.filePath) !== id && item.id !== id),
    ]);
    return await hydrateRecentProjectsExistence(saved);
  });

  ipcMain.handle('recent:toggle-pin', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return await hydrateRecentProjectsExistence(await readRecentProjectsRaw());
    }
    const id = normalizeRecentId(path.resolve(filePath));
    const existing = await readRecentProjectsRaw();
    const updated = existing.map((item) =>
      normalizeRecentId(item.filePath) === id || item.id === id
        ? { ...item, pinned: !item.pinned }
        : item
    );
    const saved = await writeRecentProjectsRaw(updated);
    return await hydrateRecentProjectsExistence(saved);
  });

  ipcMain.handle('recent:remove', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return await hydrateRecentProjectsExistence(await readRecentProjectsRaw());
    }
    const id = normalizeRecentId(path.resolve(filePath));
    const existing = await readRecentProjectsRaw();
    const saved = await writeRecentProjectsRaw(
      existing.filter((item) => normalizeRecentId(item.filePath) !== id && item.id !== id)
    );
    return await hydrateRecentProjectsExistence(saved);
  });

  ipcMain.handle('recent:clear', async () => {
    const existing = await readRecentProjectsRaw();
    const saved = await writeRecentProjectsRaw(existing.filter((item) => Boolean(item.pinned)));
    return await hydrateRecentProjectsExistence(saved);
  });

  ipcMain.handle('recent:reveal', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) return false;
    const resolved = path.resolve(filePath);
    if (!isSupportedProjectFile(resolved)) return false;
    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat) return false;
    shell.showItemInFolder(resolved);
    return true;
  });

  ipcMain.handle('project:open-dialog', async () => {
    if (!mainWindow) return null;
    const L = MENU_TEXT[getActiveLanguage()];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: L.openProjectTitle,
      properties: ['openFile'],
      filters: [
        { name: `${L.projectFilterLabel} (*.mpres, *.mpres.json)`, extensions: ['mpres', 'json'] },
        { name: L.allFilesFilter, extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return await openProjectStreaming(result.filePaths[0]);
  });

  ipcMain.handle('project:save-streamed', async (_event, payload) => {
    if (!mainWindow || !payload) return null;
    const L = MENU_TEXT[getActiveLanguage()];
    let targetPath;

    if (payload.mode === 'direct') {
      if (
        typeof payload.filePath !== 'string' ||
        !payload.filePath.trim() ||
        !isApprovedProjectPath(payload.filePath)
      ) {
        throw new Error(L.invalidSavePath);
      }
      targetPath = normalizeFinalMpresPath(payload.filePath);
    } else {
      let defaultTarget =
        payload.currentFilePath || payload.defaultFileName || 'presentation.mpres';
      defaultTarget = normalizeFinalMpresPath(defaultTarget);
      const result = await dialog.showSaveDialog(mainWindow, {
        title: L.saveProjectTitle,
        defaultPath: defaultTarget,
        filters: [{ name: `${L.projectFilterLabel} (*.mpres)`, extensions: ['mpres'] }],
      });
      if (result.canceled || !result.filePath) return null;
      targetPath = normalizeFinalMpresPath(result.filePath);
    }

    const rawAssets = Array.isArray(payload.assets) ? payload.assets : [];
    const missingFiles = [];
    const resolvedAssets = [];

    for (const item of rawAssets) {
      if (!item || typeof item.archivePath !== 'string') continue;
      if (item.source === 'file') {
        if (!item.path || !isApprovedMediaPath(item.path)) {
          missingFiles.push({
            archivePath: item.archivePath,
            fileName: item.fileName || path.basename(String(item.path || item.archivePath)),
            path: item.path || '',
          });
          continue;
        }
        resolvedAssets.push({
          archivePath: item.archivePath,
          source: 'file',
          path: item.path,
        });
      } else if (item.source === 'archive') {
        const ref = getArchiveEntryRef(item.projectToken, item.archiveEntry);
        if (!ref) {
          missingFiles.push({
            archivePath: item.archivePath,
            fileName: item.fileName || path.basename(item.archiveEntry || item.archivePath),
            path: '',
          });
          continue;
        }
        resolvedAssets.push({
          archivePath: item.archivePath,
          source: 'archive',
          bundlePath: ref.bundlePath,
          archiveEntry: ref.archiveEntry,
          dataOffset: ref.dataOffset,
          size: ref.size,
          compressionMethod: ref.compressionMethod,
        });
      } else if (item.source === 'bytes') {
        resolvedAssets.push({
          archivePath: item.archivePath,
          source: 'bytes',
          bytes: item.bytes,
        });
      }
    }

    if (missingFiles.length > 0) {
      return {
        ok: false,
        code: 'MISSING_SOURCES',
        missingFiles,
      };
    }

    const emitProgress = (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const percent = Math.min(
          100,
          Math.max(0, Math.round((progress.bytesWritten / Math.max(1, progress.totalBytes)) * 100))
        );
        mainWindow.webContents.send('project:save-progress', {
          ...progress,
          percent,
        });
      }
    };

    await writeAtomic(
      targetPath,
      (tmpPath) =>
        writeBundleToFile(
          tmpPath,
          {
            manifestJson: payload.manifestJson,
            assets: resolvedAssets,
          },
          emitProgress
        ),
      {
        keepBackup: true,
        verifyFn: async (tmpPath) => {
          await indexBundle(tmpPath);
        },
      }
    );

    const newIndex = await indexBundle(targetPath);
    const updated = payload.activeProjectToken
      ? updateArchiveToken(payload.activeProjectToken, targetPath, newIndex)
      : registerArchiveToken(targetPath, newIndex);

    approveProjectPath(targetPath);

    return {
      ok: true,
      filePath: targetPath,
      fileName: path.basename(targetPath),
      projectToken: updated.projectToken,
    };
  });

  ipcMain.handle('project:close-token', async (_event, projectToken) => {
    if (typeof projectToken === 'string' && projectToken) {
      await closeArchiveToken(projectToken);
    }
  });

  ipcMain.handle('project:open-path', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error(MENU_TEXT[getActiveLanguage()].invalidSavePath);
    }
    const resolved = path.resolve(filePath);
    if (!isSupportedProjectFile(resolved)) {
      throw new Error(MENU_TEXT[getActiveLanguage()].invalidSavePath);
    }
    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new Error(MENU_TEXT[getActiveLanguage()].invalidSavePath);
    }
    return await openProjectStreaming(resolved);
  });

  ipcMain.handle('project:open-demo', async () => {
    const candidates = [
      process.resourcesPath
        ? path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'dist',
            'demo',
            'studio-showcase.mpres'
          )
        : null,
      path.join(__dirname, '..', 'dist', 'demo', 'studio-showcase.mpres'),
      path.join(__dirname, '..', 'public', 'demo', 'studio-showcase.mpres'),
      path.resolve(__dirname, '..', '..', 'Motion Presentation Studio Demo.mpres'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const stat = await fs.promises.stat(candidate).catch(() => null);
      if (stat && stat.isFile()) {
        return await openProjectStreaming(candidate);
      }
    }
    return null;
  });

  ipcMain.handle('media:open-dialog', async () => {
    if (!mainWindow) return null;
    const L = MENU_TEXT[getActiveLanguage()];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: L.importMediaTitle,
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: L.mediaFilesFilter,
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'webp',
            'avif',
            'svg',
            'bmp',
            'mp4',
            'webm',
            'mov',
            'm4v',
            'mkv',
            'ogv',
          ],
        },
        { name: L.imagesFilter, extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg', 'bmp'] },
        { name: L.videosFilter, extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'] },
        { name: L.allFilesFilter, extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const files = [];
    for (const filePath of result.filePaths) {
      const approved = approveMediaPath(filePath);
      if (!approved) continue;
      files.push(await registerMediaFile(approved));
    }
    return files;
  });

  ipcMain.handle('media:register-paths', async (_event, pathsList) => {
    if (!Array.isArray(pathsList)) return [];
    const results = [];
    for (const rawPath of pathsList) {
      const approved = approveMediaPath(rawPath);
      if (!approved) continue;
      results.push(await registerMediaFile(approved));
    }
    return results;
  });

  // Legacy wrappers kept for compatibility during transition
  ipcMain.handle('dialog:open-project', async () => {
    if (!mainWindow) return null;
    const L = MENU_TEXT[getActiveLanguage()];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: L.openProjectTitle,
      properties: ['openFile'],
      filters: [
        { name: `${L.projectFilterLabel} (*.mpres, *.mpres.json)`, extensions: ['mpres', 'json'] },
        { name: L.allFilesFilter, extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    approveProjectPath(filePath);
    const buf = await fs.promises.readFile(filePath);
    return {
      filePath,
      fileName: path.basename(filePath),
      buffer: toArrayBuffer(buf),
    };
  });

  ipcMain.handle('dialog:save-project', async (_event, payload) => {
    if (!mainWindow || !payload) return null;
    const L = MENU_TEXT[getActiveLanguage()];
    const defaultTarget = normalizeFinalMpresPath(
      payload.currentFilePath || payload.defaultFileName || 'presentation.mpres'
    );
    const result = await dialog.showSaveDialog(mainWindow, {
      title: L.saveProjectTitle,
      defaultPath: defaultTarget,
      filters: [{ name: `${L.projectFilterLabel} (*.mpres)`, extensions: ['mpres'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const savedPath = await writeProjectToDisk(result.filePath, payload);
    return {
      filePath: savedPath,
      fileName: path.basename(savedPath),
    };
  });

  ipcMain.handle('project:save-direct', async (_event, payload) => {
    const L = MENU_TEXT[getActiveLanguage()];
    if (
      !payload ||
      typeof payload.filePath !== 'string' ||
      !payload.filePath.trim() ||
      !isApprovedProjectPath(payload.filePath)
    ) {
      throw new Error(L.invalidSavePath);
    }
    const savedPath = await writeProjectToDisk(payload.filePath, payload);
    return {
      filePath: savedPath,
      fileName: path.basename(savedPath),
    };
  });

  ipcMain.handle('dialog:open-media', async () => {
    if (!mainWindow) return null;
    const L = MENU_TEXT[getActiveLanguage()];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: L.importMediaTitle,
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: L.mediaFilesFilter,
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'webp',
            'avif',
            'svg',
            'bmp',
            'mp4',
            'webm',
            'mov',
            'm4v',
            'mkv',
            'ogv',
          ],
        },
        { name: L.imagesFilter, extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg', 'bmp'] },
        { name: L.videosFilter, extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'] },
        { name: L.allFilesFilter, extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const files = [];
    for (const filePath of result.filePaths) {
      const approved = approveMediaPath(filePath);
      if (!approved) continue;
      const buf = await fs.promises.readFile(approved);
      const reg = await registerMediaFile(approved);
      files.push({
        fileName: reg.fileName,
        mimeType: reg.mimeType,
        buffer: toArrayBuffer(buf),
        path: reg.path,
        url: reg.url,
      });
    }
    return files;
  });

  app.whenReady().then(() => {
    setCacheBaseDir(path.join(app.getPath('userData'), 'media-cache'));
    protocol.handle('mpres', (request) => handleMpresRequest(request));

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
