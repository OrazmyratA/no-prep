const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');

app.setName('No-Prep');
Menu.setApplicationMenu(null);

const {
  activateLicenseContent,
  checkLicense,
  writeMachineIdToDesktop
} = require('./license-service');
const { runSecureFeature } = require('./feature-service');
let mainWindow;

function resetRendererZoom() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  } catch {
    // Zoom reset is best-effort and must not block startup.
  }
}

function notifyRendererLayoutChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  resetRendererZoom();
  mainWindow.webContents.send('layout-changed');
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const isDev = !!process.env.ELECTRON_START_URL;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      allowRunningInsecureContent: false,
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
      webSecurity: true,
      preload: preloadPath
    },
  });

  mainWindow.webContents.on('did-finish-load', () => {
    resetRendererZoom();
    notifyRendererLayoutChanged();
  });
  mainWindow.webContents.on('zoom-changed', (event) => {
    event.preventDefault();
    resetRendererZoom();
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && ['+', '-', '=', '0'].includes(input.key)) {
      event.preventDefault();
      resetRendererZoom();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Open whitelisted external URLs (e.g. Google Images) in the system browser
  ipcMain.handle('open-external-url', (_event, url) => {
    try {
      const parsed = new URL(String(url ?? ''));
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(parsed.href);
      }
    } catch {
      // Ignore malformed URLs
    }
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDev = !!process.env.ELECTRON_START_URL;
    if (!isDev && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL);
  } else {
    // Correct path: from electron/index.js go up one level to dist/no-prep/browser/index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/no-prep/browser/index.html'));
  }

  ['resize', 'resized', 'maximize', 'unmaximize', 'restore', 'show', 'focus'].forEach((eventName) => {
    mainWindow.on(eventName, notifyRendererLayoutChanged);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// IPC Handlers
ipcMain.handle('get-license-status', () => checkLicense());

ipcMain.handle('request-license', async () => {
  return writeMachineIdToDesktop();
});

ipcMain.handle('enter-license-content', async (event, content) => {
  try {
    if (typeof content !== 'string') {
      return { valid: false, daysLeft: 0 };
    }
    return activateLicenseContent(content);
  } catch (err) {
    console.error('enter-license-content error:', err);
    return { valid: false, daysLeft: 0 };
  }
});

ipcMain.handle('run-secure-feature', async (event, featureName, input) => {
  if (typeof featureName !== 'string') {
    return { ok: false, error: 'INVALID_FEATURE' };
  }
  return runSecureFeature(featureName, input ?? {});
});
