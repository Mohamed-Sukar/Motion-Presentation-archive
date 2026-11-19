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
const { resolveStreamingAssets } = require('./lib/streamingAssets.cjs');
const { indexBundle } = require('./lib/bundleIndex.cjs');
const {
  clampZoomFactor,
  stepZoomFactor,
  computeScaledMinSize,
  clampWindowBoundsToWorkArea,
  resolveBoundsForDisplays,
  shouldPersistBounds,
  choosePresenterDisplay,
} = require('./lib/windowController.cjs');
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
let presenterWindow = null;
let pendingPresenterPayload = null;
let presenterDisplayId = null;
let presenterLastSlideIndex = 0;
let rendererReady = false;
let pendingProjectFilePath = null;
let currentMenuLanguage = null;
let currentZoomFactor = 1.0;
let prePresentationMode = 'normal';
let isPresentingFullscreenInStudio = false;
let lastKnownNormalBounds = null;
let unresponsiveDialogOpen = false;
let projectDirty = false;
let allowMainWindowClose = false;
let unsavedDialogOpen = false;

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
    recoveryTitle: 'توقّف عارض الاستوديو',
    recoverySubtitle: 'تعرّض محرك العرض لعطل غير متوقع. يمكنك إعادة تحميل الاستوديو بأمان.',
    recoveryReload: 'إعادة تحميل الاستوديو',
    unresponsiveTitle: 'الاستوديو لا يستجيب',
    unresponsiveMessage: 'توقفت النافذة عن الاستجابة مؤقتاً. هل تريد الانتظار أم إعادة التحميل؟',
    unresponsiveWait: 'انتظار',
    unresponsiveReload: 'إعادة التحميل',
    unsavedTitle: 'تغييرات لم تُحفظ',
    unsavedMessage: 'هل تريد حفظ التغييرات قبل الخروج؟',
    unsavedDetail: 'ستفقد كل التعديلات التي أجريتها على هذا العرض إن خرجت دون حفظ.',
    unsavedSave: 'حفظ ثم خروج',
    unsavedDiscard: 'خروج دون حفظ',
    unsavedCancel: 'إلغاء',
    autosaveTitle: 'استعادة العمل غير المحفوظ',
    autosaveMessage: 'تم العثور على تغييرات لم تُحفظ من الجلسة السابقة. هل تريد استعادتها؟',
    autosaveDetail: 'آخر حفظ تلقائي:',
    autosaveRecover: 'استعادة',
    autosaveDiscard: 'تجاهل وحذف',
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
    recoveryTitle: 'Studio View Crashed',
    recoverySubtitle: 'The renderer process encountered an unexpected interruption. You can reload Studio safely.',
    recoveryReload: 'Reload Studio',
    unresponsiveTitle: 'Studio Window Unresponsive',
    unresponsiveMessage: 'The window stopped responding temporarily. Wait for it or reload Studio?',
    unresponsiveWait: 'Wait',
    unresponsiveReload: 'Reload',
    unsavedTitle: 'Unsaved Changes',
    unsavedMessage: 'Do you want to save your changes before closing?',
    unsavedDetail: 'All edits to this presentation will be lost if you close without saving.',
    unsavedSave: 'Save & Close',
    unsavedDiscard: 'Close Without Saving',
    unsavedCancel: 'Cancel',
    autosaveTitle: 'Recover Unsaved Work',
    autosaveMessage: 'Unsaved changes from your last session were found. Do you want to recover them?',
    autosaveDetail: 'Last autosave:',
    autosaveRecover: 'Recover',
    autosaveDiscard: 'Discard & Delete',
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

function getMenuLabels(lang = getActiveLanguage()) {
  return MENU_TEXT[lang === 'en' ? 'en' : 'ar'];
}

function buildNativeMenu(lang = getActiveLanguage()) {
  const L = getMenuLabels(lang);
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
        {
          label: L.resetZoom,
          accelerator: 'CmdOrCtrl+0',
          click: () => applyStudioZoom(1.0),
        },
        {
          label: L.zoomIn,
          accelerator: 'CmdOrCtrl+=',
          click: () => applyStudioZoom(stepZoomFactor(currentZoomFactor, 1)),
        },
        {
          label: L.zoomOut,
          accelerator: 'CmdOrCtrl+-',
          click: () => applyStudioZoom(stepZoomFactor(currentZoomFactor, -1)),
        },
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

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function getAppStartUrl(queryParams = '') {
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5175';
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
  if (fs.existsSync(distIndex) && !process.env.VITE_DEV_SERVER_URL) {
    return { type: 'file', target: distIndex, search: queryParams };
  }
  const suffix = queryParams ? `?${queryParams.replace(/^\?/, '')}` : '';
  return { type: 'url', target: `${devUrl}${suffix}` };
}

function loadAppEntry(win, queryParams = '') {
  const entry = getAppStartUrl(queryParams);
  if (entry.type === 'file') {
    const query = queryParams ? Object.fromEntries(new URLSearchParams(queryParams)) : undefined;
    return win.loadFile(entry.target, query ? { query } : undefined);
  }
  return win.loadURL(entry.target);
}

function getCurrentWindowMode(win) {
  if (!win || win.isDestroyed()) return 'normal';
  if (win.isFullScreen()) return 'fullscreen';
  if (win.isMinimized()) return 'minimized';
  if (win.isMaximized()) return 'maximized';
  return 'normal';
}

function getWindowStateSnapshot(win = mainWindow) {
  if (!win || win.isDestroyed()) {
    return {
      mode: 'normal',
      isFullScreen: false,
      isMaximized: false,
      isMinimized: false,
      zoomFactor: currentZoomFactor,
      presenterOpen: Boolean(presenterWindow && !presenterWindow.isDestroyed()),
      presenterDisplayId,
    };
  }
  const isFullScreen = win.isFullScreen();
  const isMaximized = win.isMaximized();
  const isMinimized = win.isMinimized();
  return {
    mode: getCurrentWindowMode(win),
    isFullScreen,
    isMaximized,
    isMinimized,
    zoomFactor: currentZoomFactor,
    presenterOpen: Boolean(presenterWindow && !presenterWindow.isDestroyed()),
    presenterDisplayId,
  };
}

function emitWindowState(win = mainWindow) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('window:state', getWindowStateSnapshot(win));
  } catch {
    // Ignore send errors when webContents is tearing down
  }
}

function resolveInitialWindowState() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  let savedState;
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf-8');
    savedState = JSON.parse(raw);
  } catch {
    savedState = null;
  }
  return resolveBoundsForDisplays({ savedState, displays, primaryDisplay });
}

function persistWindowStateNow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const isMaximized = win.isMaximized();
    const canSampleBounds = shouldPersistBounds({
      isDestroyed: win.isDestroyed(),
      isFullScreen: win.isFullScreen(),
      isMinimized: win.isMinimized(),
      isPresenting: isPresentingFullscreenInStudio,
    });

    if (canSampleBounds) {
      const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        lastKnownNormalBounds = { ...bounds };
      }
    }

    const boundsToWrite =
      lastKnownNormalBounds ||
      (!win.isFullScreen() && !win.isMinimized()
        ? isMaximized
          ? win.getNormalBounds()
          : win.getBounds()
        : null);
    if (!boundsToWrite) return;

    const currentMode = win.isFullScreen() || isPresentingFullscreenInStudio ? prePresentationMode : isMaximized ? 'maximized' : 'normal';
    const display = screen.getDisplayMatching(boundsToWrite);
    const payload = {
      x: Math.round(boundsToWrite.x),
      y: Math.round(boundsToWrite.y),
      width: Math.round(boundsToWrite.width),
      height: Math.round(boundsToWrite.height),
      mode: currentMode === 'maximized' ? 'maximized' : 'normal',
      isMaximized: currentMode === 'maximized',
      displayId: display ? display.id : null,
      zoomFactor: currentZoomFactor,
    };
    // `writeAtomic` takes a writer callback, not a payload: passing the JSON string here used to
    // throw "writeFn is not a function", so the window geometry was never persisted and every
    // resize produced an unhandled rejection.
    void writeBufferAtomic(getWindowStatePath(), JSON.stringify(payload, null, 2), {
      keepBackup: false,
    }).catch(() => {
      // Losing remembered bounds is cosmetic; never let it break a resize handler.
    });
  } catch {
    // Ignore non-critical window-state write errors
  }
}

function applyStudioZoom(nextZoom, win = mainWindow) {
  const clamped = clampZoomFactor(nextZoom);
  currentZoomFactor = clamped;
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.setZoomFactor(clamped);
    } catch {
      // Ignore during teardown
    }
    const { minWidth, minHeight } = computeScaledMinSize(clamped);
    try {
      win.setMinimumSize(minWidth, minHeight);
      if (!win.isMaximized() && !win.isFullScreen()) {
        const currentBounds = win.getBounds();
        const display = screen.getDisplayMatching(currentBounds);
        const clampedBounds = clampWindowBoundsToWorkArea(
          currentBounds,
          display.workArea,
          { width: minWidth, height: minHeight }
        );
        if (
          clampedBounds.x !== currentBounds.x ||
          clampedBounds.y !== currentBounds.y ||
          clampedBounds.width !== currentBounds.width ||
          clampedBounds.height !== currentBounds.height
        ) {
          win.setBounds(clampedBounds);
        }
      }
    } catch {
      // Ignore bounds resize failures on minimized/hidden windows
    }
    persistWindowStateNow(win);
    emitWindowState(win);
  }
  return clamped;
}

/**
 * Asked from the window `close` handler when the renderer reports unsaved changes.
 * Save → hand control back to the renderer; it saves, then calls `app:confirm-quit`.
 * Discard → bypass the guard once, drop the autosave snapshot and close. Cancel → stay open.
 */
async function promptUnsavedChanges() {
  if (unsavedDialogOpen || !mainWindow || mainWindow.isDestroyed()) return;
  unsavedDialogOpen = true;
  try {
    const L = getMenuLabels();
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: L.unsavedTitle,
      message: L.unsavedMessage,
      detail: L.unsavedDetail,
      buttons: [L.unsavedSave, L.unsavedDiscard, L.unsavedCancel],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 1) {
      allowMainWindowClose = true;
      await clearAutosaveFiles();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      return;
    }
    if (response === 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:save-before-quit');
    }
  } finally {
    unsavedDialogOpen = false;
  }
}

function renderRecoveryPage(win, reasonDetail = '') {
  if (!win || win.isDestroyed()) return;
  const L = getMenuLabels();
  const safeReason = String(reasonDetail || '').replace(/[<>&"]/g, '');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0c0d10;color:#f4f4f6;font-family:system-ui,-apple-system,sans-serif;padding:24px;box-sizing:border-box;}
    .card{max-width:460px;width:100%;background:#16181f;border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:24px;text-align:center;}
    h2{margin:0 0 10px;font-size:18px;} p{margin:0 0 18px;font-size:13px;color:rgba(244,244,246,0.72);line-height:1.5;}
    code{display:block;margin:0 0 16px;font-size:11px;color:#ff8a80;word-break:break-word;}
    button{background:#0a84ff;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;}
  </style></head><body><div class="card"><h2>${L.recoveryTitle}</h2><p>${L.recoverySubtitle}</p>${safeReason ? `<code>${safeReason}</code>` : ''}<button onclick="window.location.href=window.location.href">${L.recoveryReload}</button></div></body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function bindWindowStatePersistence(win) {
  let saveTimer = null;

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistWindowStateNow(win);
    }, 250);
  };

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', () => {
    persistWindowStateNow(win);
    emitWindowState(win);
  });
  win.on('unmaximize', () => {
    persistWindowStateNow(win);
    emitWindowState(win);
  });
  win.on('minimize', () => {
    emitWindowState(win);
  });
  win.on('restore', () => {
    emitWindowState(win);
  });
  win.on('enter-full-screen', () => {
    emitWindowState(win);
  });
  win.on('leave-full-screen', () => {
    isPresentingFullscreenInStudio = false;
    emitWindowState(win);
  });
  win.on('close', (event) => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!allowMainWindowClose && projectDirty) {
      event.preventDefault();
      void promptUnsavedChanges();
      return;
    }
    persistWindowStateNow(win);
    if (presenterWindow && !presenterWindow.isDestroyed()) {
      presenterWindow.close();
    }
  });
}

function ensureWindowOnValidDisplay(win = mainWindow) {
  if (!win || win.isDestroyed()) return;
  try {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    const minSize = computeScaledMinSize(currentZoomFactor);
    const rawBounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    const matched = screen.getDisplayMatching(rawBounds);
    const targetDisplay = displays.find((d) => matched && d.id === matched.id) || primaryDisplay;
    const nextBounds = clampWindowBoundsToWorkArea(rawBounds, targetDisplay.workArea, {
      width: minSize.minWidth,
      height: minSize.minHeight,
    });
    if (!win.isMaximized() && !win.isFullScreen()) {
      win.setBounds(nextBounds);
    } else {
      lastKnownNormalBounds = { ...nextBounds };
    }
    emitWindowState(win);
  } catch {
    // Ignore display reconciliation errors
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  rendererReady = false;
  const initialState = resolveInitialWindowState();
  currentZoomFactor = clampZoomFactor(initialState.zoomFactor);
  lastKnownNormalBounds = {
    x: initialState.x,
    y: initialState.y,
    width: initialState.width,
    height: initialState.height,
  };

  mainWindow = new BrowserWindow({
    x: initialState.x,
    y: initialState.y,
    width: initialState.width,
    height: initialState.height,
    minWidth: initialState.minWidth,
    minHeight: initialState.minHeight,
    show: false,
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

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    applyStudioZoom(currentZoomFactor, mainWindow);
    if (initialState.mode === 'maximized') {
      mainWindow.maximize();
    }
    mainWindow.show();
    emitWindowState(mainWindow);
    void maybeOfferAutosaveRecovery(mainWindow);
  });

  bindWindowStatePersistence(mainWindow);

  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    applyStudioZoom(currentZoomFactor, mainWindow);
  });

  mainWindow.webContents.on('zoom-changed', (_event, zoomDirection) => {
    const dir = zoomDirection === 'in' ? 1 : -1;
    applyStudioZoom(stepZoomFactor(currentZoomFactor, dir), mainWindow);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererReady = false;
    // The renderer's in-memory project is gone with it; keeping the guard armed would leave the
    // user with a window that can never be closed.
    projectDirty = false;
    if (details && details.reason !== 'clean-exit') {
      renderRecoveryPage(mainWindow, `${details.reason || 'crashed'} (${details.exitCode ?? ''})`);
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3 && !String(validatedURL || '').startsWith('data:text/html')) {
      renderRecoveryPage(mainWindow, `${errorCode}: ${errorDescription}`);
    }
  });

  mainWindow.on('unresponsive', async () => {
    if (unresponsiveDialogOpen || !mainWindow || mainWindow.isDestroyed()) return;
    unresponsiveDialogOpen = true;
    try {
      const L = getMenuLabels();
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: L.unresponsiveTitle,
        message: L.unresponsiveMessage,
        buttons: [L.unresponsiveWait, L.unresponsiveReload],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === 1 && mainWindow && !mainWindow.isDestroyed()) {
        void loadAppEntry(mainWindow);
      }
    } finally {
      unresponsiveDialogOpen = false;
    }
  });

  mainWindow.on('responsive', () => {
    unresponsiveDialogOpen = false;
  });

  buildNativeMenu();
  void loadAppEntry(mainWindow);
}

function sendPresenterCommand(command) {
  if (presenterWindow && !presenterWindow.isDestroyed()) {
    presenterWindow.webContents.send('presenter:command', command);
  }
}

function createPresenterWindow(payload = {}) {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const studioDisplay =
    mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : primaryDisplay;
  const targetDisplay =
    choosePresenterDisplay({
      displays,
      primaryDisplay,
      studioDisplay,
      preferredDisplayId: payload.displayId ?? presenterDisplayId,
    }) || primaryDisplay;

  presenterDisplayId = targetDisplay.id;
  pendingPresenterPayload = payload;
  presenterLastSlideIndex = Number(payload.startSlideIndex) || 0;

  if (presenterWindow && !presenterWindow.isDestroyed()) {
    const wa = targetDisplay.bounds || targetDisplay.workArea;
    presenterWindow.setBounds({
      x: wa.x,
      y: wa.y,
      width: wa.width,
      height: wa.height,
    });
    presenterWindow.show();
    presenterWindow.focus();
    presenterWindow.webContents.send('presenter:init', payload);
    emitWindowState(mainWindow);
    return { ok: true, displayId: presenterDisplayId, dualDisplay: displays.length > 1 };
  }

  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  const wa = targetDisplay.bounds || targetDisplay.workArea;

  presenterWindow = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    show: false,
    frame: false,
    fullscreen: process.platform !== 'darwin',
    fullscreenable: true,
    backgroundColor: '#000000',
    title: 'Motion Presentation — Presenter',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  presenterWindow.setMenuBarVisibility(false);

  presenterWindow.once('ready-to-show', () => {
    if (!presenterWindow || presenterWindow.isDestroyed()) return;
    presenterWindow.show();
    if (!presenterWindow.isFullScreen()) {
      presenterWindow.setFullScreen(true);
    }
    emitWindowState(mainWindow);
  });

  presenterWindow.on('closed', () => {
    presenterWindow = null;
    pendingPresenterPayload = null;
    emitWindowState(mainWindow);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('presenter:closed', {
        slideIndex: presenterLastSlideIndex,
      });
    }
  });

  void loadAppEntry(presenterWindow, 'presenter=1');
  return { ok: true, displayId: presenterDisplayId, dualDisplay: displays.length > 1 };
}

function getRecentProjectsFilePath() {
  return path.join(app.getPath('userData'), 'recent-projects.json');
}

// ---- Autosave snapshot (crash / accidental-close protection) ----

let pendingAutosavePayload = null;

function getAutosaveDirPath() {
  return path.join(app.getPath('userData'), 'autosave');
}

function getAutosaveSessionPath() {
  return path.join(getAutosaveDirPath(), 'session.mpres');
}

function getAutosaveMetaPath() {
  return path.join(getAutosaveDirPath(), 'session.json');
}

async function readAutosaveMeta() {
  try {
    const raw = await fs.promises.readFile(getAutosaveMetaPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      savedAt: Number(parsed.savedAt) || 0,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      sourcePath: typeof parsed.sourcePath === 'string' ? parsed.sourcePath : null,
      slideCount: Number(parsed.slideCount) || 0,
    };
  } catch {
    return null;
  }
}

async function clearAutosaveFiles() {
  await fs.promises.rm(getAutosaveSessionPath(), { force: true }).catch(() => {});
  await fs.promises.rm(getAutosaveMetaPath(), { force: true }).catch(() => {});
}

/**
 * Maps the renderer's declarative asset descriptors onto concrete file paths or archive byte
 * ranges. Implemented in `./lib/streamingAssets.cjs` so it can be unit-tested without Electron.
 */
function resolveStreamingAssetsForSave(rawAssetsInput) {
  return resolveStreamingAssets(rawAssetsInput, { isApprovedMediaPath, getArchiveEntryRef });
}

/**
 * Offers recovery of the last autosave snapshot. Stale snapshots (older than the project file they
 * came from) are discarded silently so the prompt only appears when work would really be lost.
 */
async function maybeOfferAutosaveRecovery(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const meta = await readAutosaveMeta();
    const sessionPath = getAutosaveSessionPath();
    if (!meta || !fs.existsSync(sessionPath)) {
      await clearAutosaveFiles();
      return;
    }
    if (meta.sourcePath) {
      const stat = await fs.promises.stat(meta.sourcePath).catch(() => null);
      if (stat && stat.mtimeMs >= meta.savedAt) {
        await clearAutosaveFiles();
        return;
      }
    }
    const L = getMenuLabels();
    const when = new Date(meta.savedAt || Date.now()).toLocaleString();
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: L.autosaveTitle,
      message: L.autosaveMessage,
      detail: `${L.autosaveDetail} ${when}`,
      buttons: [L.autosaveRecover, L.autosaveDiscard],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) {
      await clearAutosaveFiles();
      return;
    }
    // The snapshot is handed to the renderer as bytes (not as an archive token) so the file can be
    // removed immediately: nothing keeps streaming out of it after the hand-off.
    const bytes = await fs.promises.readFile(sessionPath);
    await clearAutosaveFiles();
    const payload = {
      buffer: toArrayBuffer(bytes),
      fileName: 'autosave-recovery.mpres',
      recoveredFromAutosave: true,
    };
    if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project:recover-autosave', payload);
    } else {
      pendingAutosavePayload = payload;
    }
  } catch {
    // A corrupt snapshot must never block startup.
    await clearAutosaveFiles();
  }
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
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const next = Boolean(flag);
    if (next) {
      if (!mainWindow.isFullScreen()) {
        prePresentationMode = mainWindow.isMaximized() ? 'maximized' : 'normal';
      }
      isPresentingFullscreenInStudio = true;
      mainWindow.setFullScreen(true);
    } else {
      isPresentingFullscreenInStudio = false;
      mainWindow.setFullScreen(false);
      if (prePresentationMode === 'maximized' && !mainWindow.isMaximized()) {
        mainWindow.maximize();
      }
    }
    emitWindowState(mainWindow);
    return mainWindow.isFullScreen();
  });

  ipcMain.handle('window:is-fullscreen', () => {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false;
  });

  ipcMain.handle('window:get-state', () => {
    return getWindowStateSnapshot(mainWindow);
  });

  ipcMain.handle('window:set-zoom', (_event, factor) => {
    return applyStudioZoom(Number(factor), mainWindow);
  });

  ipcMain.handle('window:step-zoom', (_event, direction) => {
    const dir = Number(direction) >= 0 ? 1 : -1;
    return applyStudioZoom(stepZoomFactor(currentZoomFactor, dir), mainWindow);
  });

  ipcMain.handle('window:reset-zoom', () => {
    return applyStudioZoom(1.0, mainWindow);
  });

  ipcMain.handle('window:get-displays', () => {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const studioDisplay =
      mainWindow && !mainWindow.isDestroyed()
        ? screen.getDisplayMatching(mainWindow.getBounds())
        : primary;
    return displays.map((d, idx) => ({
      id: d.id,
      label: d.label || `Display ${idx + 1}`,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      isPrimary: primary ? d.id === primary.id : false,
      isStudioDisplay: studioDisplay ? d.id === studioDisplay.id : false,
    }));
  });

  ipcMain.handle('window:reload-studio', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      void loadAppEntry(mainWindow);
      return true;
    }
    return false;
  });

  ipcMain.handle('presenter:open', (_event, payload) => {
    return createPresenterWindow(payload || {});
  });

  ipcMain.handle('presenter:close', () => {
    if (presenterWindow && !presenterWindow.isDestroyed()) {
      presenterWindow.close();
      return true;
    }
    return false;
  });

  ipcMain.handle('presenter:command', (_event, command) => {
    if (command && typeof command === 'object') {
      sendPresenterCommand(command);
      return true;
    }
    return false;
  });

  ipcMain.on('presenter:ready', () => {
    if (presenterWindow && !presenterWindow.isDestroyed() && pendingPresenterPayload) {
      presenterWindow.webContents.send('presenter:init', pendingPresenterPayload);
    }
  });

  ipcMain.on('presenter:status', (_event, status) => {
    if (status && typeof status === 'object') {
      if (Number.isFinite(Number(status.slideIndex))) {
        presenterLastSlideIndex = Number(status.slideIndex);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('presenter:status', {
          ...status,
          open: Boolean(presenterWindow && !presenterWindow.isDestroyed()),
          displayId: presenterDisplayId,
        });
      }
    }
  });

  ipcMain.on('presenter:request-close', (_event, lastSlideIndex) => {
    if (Number.isFinite(Number(lastSlideIndex))) {
      presenterLastSlideIndex = Number(lastSlideIndex);
    }
    if (presenterWindow && !presenterWindow.isDestroyed()) {
      presenterWindow.close();
    }
  });

  ipcMain.handle('presenter:set-display', (_event, displayId) => {
    presenterDisplayId = displayId ?? null;
    if (presenterWindow && !presenterWindow.isDestroyed() && pendingPresenterPayload) {
      return createPresenterWindow({
        ...pendingPresenterPayload,
        displayId: presenterDisplayId,
        startSlideIndex: presenterLastSlideIndex,
      });
    }
    emitWindowState(mainWindow);
    return { ok: true, displayId: presenterDisplayId };
  });

  ipcMain.handle('window:set-title', (_event, title) => {
    if (mainWindow && !mainWindow.isDestroyed() && typeof title === 'string' && title.trim()) {
      mainWindow.setTitle(title.trim());
    }
  });

  // Unsaved-changes guard: the renderer owns the dirty flag, the main process owns the quit flow.
  ipcMain.on('window:set-project-dirty', (_event, dirty) => {
    projectDirty = Boolean(dirty);
  });

  ipcMain.on('app:confirm-quit', (_event, payload) => {
    if (!payload || payload.proceed !== true) return;
    if (!mainWindow || mainWindow.isDestroyed()) {
      app.quit();
      return;
    }
    allowMainWindowClose = true;
    mainWindow.close();
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
    if (pendingAutosavePayload) {
      const payload = pendingAutosavePayload;
      pendingAutosavePayload = null;
      return payload;
    }
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

    const { missingFiles, resolvedAssets } = resolveStreamingAssetsForSave(payload.assets);

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

  ipcMain.handle('project:autosave', async (_event, payload) => {
    if (!payload || typeof payload.manifestJson !== 'string') return { ok: false };
    const { missingFiles, resolvedAssets } = resolveStreamingAssetsForSave(payload.assets);
    if (missingFiles.length > 0) return { ok: false, code: 'MISSING_SOURCES' };
    try {
      await fs.promises.mkdir(getAutosaveDirPath(), { recursive: true });
      await writeAtomic(
        getAutosaveSessionPath(),
        (tmpPath) =>
          writeBundleToFile(
            tmpPath,
            { manifestJson: payload.manifestJson, assets: resolvedAssets },
            () => {}
          ),
        { keepBackup: false }
      );
      const meta = {
        savedAt: Date.now(),
        title: payload.meta && typeof payload.meta.title === 'string' ? payload.meta.title : '',
        sourcePath:
          payload.meta && typeof payload.meta.sourcePath === 'string' && payload.meta.sourcePath
            ? payload.meta.sourcePath
            : null,
        slideCount: payload.meta ? Number(payload.meta.slideCount) || 0 : 0,
      };
      await writeAtomic(
        getAutosaveMetaPath(),
        async (tmpPath) => {
          await fs.promises.writeFile(tmpPath, JSON.stringify(meta, null, 2), 'utf8');
        },
        { keepBackup: false }
      );
      return { ok: true, savedAt: meta.savedAt };
    } catch (err) {
      console.error('Autosave failed:', err);
      return { ok: false };
    }
  });

  ipcMain.handle('project:clear-autosave', async () => {
    await clearAutosaveFiles();
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

    screen.on('display-removed', () => {
      ensureWindowOnValidDisplay(mainWindow);
    });

    screen.on('display-metrics-changed', () => {
      ensureWindowOnValidDisplay(mainWindow);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
