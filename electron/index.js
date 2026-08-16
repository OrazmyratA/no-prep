const { app, BrowserWindow, ipcMain, shell, Menu, dialog, protocol, net, nativeImage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');

app.setName('No-Prep');
Menu.setApplicationMenu(null);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'noprep-book',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

const {
  BOOK_JSON_FILE,
  BOOK_ANNOTATIONS_FILE,
  BOOK_PACKAGE_EXTENSION,
  MAX_INLINE_IMAGE_BYTES,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_TOPIC_SNAPSHOT_BYTES
} = require('./main/constants');
const { operationResult, operationError } = require('./main/operation-result');
const {
  createId,
  sanitizeName,
  extensionForMimeType,
  decodeBase64DataUrl
} = require('./main/value-utils');
const { createPathHelpers } = require('./main/paths');
const {
  pathExists,
  getDirectorySize,
  getAvailableBytes,
  firstExistingPath,
  ensureEnoughSpace,
  formatBytesForDialog,
  execFileText
} = require('./main/fs-utils');
const { createArchiveUtils } = require('./main/archive-utils');
const { createBookAssetProtocol } = require('./main/book-asset-protocol');
const { createBookRegistryService } = require('./main/book-registry-service');
const { createBookService } = require('./main/book-service');
const { createBookStorageService } = require('./main/book-storage-service');
const { createGroqService } = require('./main/ai-groq-service');
const { createEdgeTtsService } = require('./main/ai-edge-tts-service');
const { registerAppIpc } = require('./main/app-ipc');
const { registerAiIpc } = require('./main/ai-ipc');
const { registerBookDataIpc } = require('./main/book-data-ipc');
const { registerBookManagementIpc } = require('./main/book-management-ipc');
const { registerBookStorageIpc } = require('./main/book-storage-ipc');
const { registerLicenseIpc } = require('./main/license-ipc');
const { registerSecureFeatureIpc } = require('./main/secure-feature-ipc');

let mainWindow;
const bookStorage = createBookStorageService({
  app,
  fs,
  fsp,
  path,
  dialog,
  shell,
  pathExists,
  getAvailableBytes,
  operationResult,
  operationError,
  getMainWindow: () => mainWindow
});
const {
  getBooksRoot,
  getFfmpegPath,
  getRegistryPath
} = createPathHelpers(app, { getBooksRoot: bookStorage.getBooksRoot });
const {
  copyFileWithProgress,
  copyFile,
  copyDirectoryWithProgress,
  createZipPackageWithProgress,
  extractZipPackage,
  getZipUncompressedSize
} = createArchiveUtils({ sendProgress: sendBookProgress });
const {
  readRegistry,
  writeRegistry,
  upsertRegistryItem,
  removeRegistryItem
} = createBookRegistryService({
  fsp,
  path,
  pathExists,
  getBooksRoot,
  getRegistryPath
});
const {
  getPdfInfo,
  generateFirstPageCover,
  readBookJson,
  writeBookJson,
  createBlankBookPage,
  createProgressMapPage,
  createPdfPages,
  normalizeBookRelativePath,
  collectBookAssetReferences,
  pruneUnusedBookAssets,
  validateBookFolder,
  validateBookData,
  readBookAnnotations,
  writeBookAnnotations,
  makeRegistryItem,
  getCachedSizeBytes,
  hasRemovedBookAssetReferences,
  updateRegistrySizeByDelta,
  repairBookRegistryItems,
  rewriteRelativeAssetPaths
} = createBookService({
  fs,
  fsp,
  path,
  nativeImage,
  pathExists,
  getDirectorySize,
  createId,
  upsertRegistryItem,
  constants: {
    BOOK_JSON_FILE,
    BOOK_ANNOTATIONS_FILE
  }
});
const {
  encodeBookAssetUrl,
  resolveBookAssetPath,
  registerBookAssetProtocol
} = createBookAssetProtocol({
  fs,
  path,
  net,
  pathToFileURL,
  getRegistryPath,
  normalizeBookRelativePath,
  protocol
});
function getUserAiConfigPath() {
  return path.join(app.getPath('userData'), 'ai-config.json');
}
function readGroqApiKeyFromFile(configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return String(parsed?.groqApiKey || '').trim();
  } catch {
    return '';
  }
}
function getGroqApiKey() {
  if (process.env.NOPREP_GROQ_API_KEY) {
    return process.env.NOPREP_GROQ_API_KEY;
  }
  const userKey = readGroqApiKeyFromFile(getUserAiConfigPath());
  if (userKey) {
    return userKey;
  }
  // Developer-only fallback for running from source; never present in a packaged build.
  return readGroqApiKeyFromFile(path.join(__dirname, 'ai-config.json'));
}
async function saveUserGroqApiKey(apiKey) {
  const configPath = getUserAiConfigPath();
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, JSON.stringify({ groqApiKey: apiKey }, null, 2), 'utf8');
}
async function clearUserGroqApiKey() {
  await fsp.rm(getUserAiConfigPath(), { force: true });
}
const aiService = createGroqService({ getApiKey: getGroqApiKey });
const ttsService = createEdgeTtsService();

async function ensureBooksRoot() {
  await fsp.mkdir(getBooksRoot(), { recursive: true });
}

async function findBook(bookId) {
  const registry = await readRegistry();
  return registry.find((item) => item.id === bookId) || null;
}

function sendBookProgress(progress) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('books:progress', progress);
}

function makeBookProgress(operationId, type, phase, transferredBytes = 0, totalBytes = 0) {
  return {
    operationId,
    type,
    phase,
    transferredBytes,
    totalBytes
  };
}

async function confirmBookFileOperation(actionLabel, totalBytes, destination) {
  const available = await getAvailableBytes(destination);
  if (available !== null && available < totalBytes) {
    throw new Error(
      `Not enough disk space. Required: ${formatBytesForDialog(totalBytes)}. Available: ${formatBytesForDialog(available)}.`
    );
  }

  const detail = available === null
    ? `Size: ${formatBytesForDialog(totalBytes)}`
    : `Size: ${formatBytesForDialog(totalBytes)}\nAvailable disk space: ${formatBytesForDialog(available)}`;
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Continue', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: actionLabel,
    message: `${actionLabel}?`,
    detail
  });
  return response.response === 0;
}

function resetRendererZoom() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  } catch {
    // Zoom reset is best-effort and must not block startup.
  }
}

function isTrustedAppPermissionUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || mainWindow?.webContents?.getURL?.() || ''));
    if (parsed.protocol === 'file:') {
      return true;
    }
    const devUrl = process.env.ELECTRON_START_URL ? new URL(process.env.ELECTRON_START_URL) : null;
    if (devUrl && parsed.protocol === devUrl.protocol && parsed.port === devUrl.port) {
      return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
    }
  } catch {
    return false;
  }
  return false;
}

function isTrustedMediaPermissionRequest(webContents, permission, details) {
  const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
  const wantsAudio = permission === 'media' || permission === 'microphone' || mediaTypes.includes('audio');
  if (!wantsAudio || webContents !== mainWindow?.webContents) {
    return false;
  }
  return isTrustedAppPermissionUrl(details?.requestingUrl || details?.securityOrigin || details?.embeddingOrigin);
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
    fullscreenable: true,
    webPreferences: {
      allowRunningInsecureContent: false,
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
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
    if (input.type === 'keyDown' && input.key === 'F12') {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    }
  });
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isTrustedMediaPermissionRequest(webContents, permission, details));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return isTrustedMediaPermissionRequest(webContents, permission, {
      ...(details || {}),
      requestingUrl: details?.requestingUrl || requestingOrigin
    });
  });
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        '*://*.youtube.com/*',
        '*://*.youtube-nocookie.com/*',
        '*://*.googlevideo.com/*',
        '*://*.ytimg.com/*'
      ]
    },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      requestHeaders.Referer = 'https://www.youtube.com/';
      callback({ requestHeaders });
    }
  );

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' noprep-book:; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' noprep-book: data: blob: https://i.ytimg.com https://*.ytimg.com; " +
          "media-src 'self' noprep-book: blob: data:; " +
          "frame-src https://www.youtube-nocookie.com https://www.youtube.com; " +
          "connect-src 'self' noprep-book: blob:; " +
          "font-src 'self' data:; " +
          "object-src 'none';"
        ]
      }
    });
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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
  registerBookAssetProtocol();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// IPC Handlers
registerAppIpc({
  ipcMain,
  shell,
  app,
  dialog,
  fsp,
  path,
  getMainWindow: () => mainWindow,
  notifyRendererLayoutChanged,
  sanitizeName,
  operationResult,
  operationError
});
registerAiIpc({
  ipcMain,
  operationResult,
  operationError,
  aiService,
  ttsService,
  saveUserGroqApiKey,
  clearUserGroqApiKey
});
registerBookDataIpc({
  ipcMain,
  dialog,
  fsp,
  path,
  pathToFileURL,
  getMainWindow: () => mainWindow,
  getFfmpegPath,
  firstExistingPath,
  execFileText,
  readRegistry,
  writeRegistry,
  repairBookRegistryItems,
  findBook,
  validateBookFolder,
  readBookJson,
  validateBookData,
  writeBookJson,
  readBookAnnotations,
  writeBookAnnotations,
  pruneUnusedBookAssets,
  getDirectorySize,
  getCachedSizeBytes,
  hasRemovedBookAssetReferences,
  upsertRegistryItem,
  makeRegistryItem,
  copyFile,
  pathExists,
  updateRegistrySizeByDelta,
  sanitizeName,
  decodeBase64DataUrl,
  extensionForMimeType,
  encodeBookAssetUrl,
  resolveBookAssetPath,
  operationResult,
  operationError,
  constants: {
    MAX_INLINE_IMAGE_BYTES,
    MAX_AUDIO_RECORDING_BYTES,
    MAX_TOPIC_SNAPSHOT_BYTES
  }
});
registerBookStorageIpc({
  ipcMain,
  bookStorage,
  operationResult,
  operationError
});
registerBookManagementIpc({
  ipcMain,
  app,
  dialog,
  shell,
  fsp,
  path,
  getMainWindow: () => mainWindow,
  getBooksRoot,
  createId,
  sanitizeName,
  operationResult,
  operationError,
  sendBookProgress,
  makeBookProgress,
  confirmBookFileOperation,
  ensureEnoughSpace,
  getDirectorySize,
  pathExists,
  copyFile,
  copyFileWithProgress,
  copyDirectoryWithProgress,
  createZipPackageWithProgress,
  extractZipPackage,
  getZipUncompressedSize,
  createBlankBookPage,
  createProgressMapPage,
  createPdfPages,
  getPdfInfo,
  generateFirstPageCover,
  readRegistry,
  upsertRegistryItem,
  removeRegistryItem,
  findBook,
  makeRegistryItem,
  readBookJson,
  writeBookJson,
  validateBookFolder,
  validateBookData,
  pruneUnusedBookAssets,
  rewriteRelativeAssetPaths,
  constants: {
    BOOK_JSON_FILE,
    BOOK_PACKAGE_EXTENSION
  }
});
registerLicenseIpc(ipcMain);
registerSecureFeatureIpc(ipcMain);
