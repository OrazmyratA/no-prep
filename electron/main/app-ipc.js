const ALLOWED_EXTERNAL_HOSTS = new Set([
  'www.youtube.com', 'youtube.com', 'youtu.be',
  'www.youtube-nocookie.com', 'youtube-nocookie.com',
  'www.google.com', 'google.com', 'images.google.com'
]);

function registerAppIpc({
  ipcMain,
  shell,
  app,
  dialog,
  fsp,
  path,
  getMainWindow,
  notifyRendererLayoutChanged,
  sanitizeName,
  operationResult,
  operationError
}) {
  ipcMain.handle('open-external-url', (_event, url) => {
    try {
      const parsed = new URL(String(url ?? ''));
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
        return shell.openExternal(parsed.href);
      }
    } catch {
      // Ignore malformed URLs
    }
    return false;
  });

  ipcMain.handle('app:toggle-fullscreen', () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    notifyRendererLayoutChanged();
    return mainWindow.isFullScreen();
  });

  ipcMain.handle('app:set-fullscreen', (_event, active) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    mainWindow.setFullScreen(!!active);
    notifyRendererLayoutChanged();
    return mainWindow.isFullScreen();
  });

  ipcMain.handle('app:is-fullscreen', () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    return mainWindow.isFullScreen();
  });

  ipcMain.handle('app:capture-page-screenshot', async (_event, input) => {
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return operationError('WINDOW_UNAVAILABLE', 'The app window is not available.');
      }

      const bounds = mainWindow.getContentBounds();
      const x = Math.max(0, Math.min(bounds.width - 1, Math.round(Number(input?.x || 0))));
      const y = Math.max(0, Math.min(bounds.height - 1, Math.round(Number(input?.y || 0))));
      const width = Math.max(1, Math.min(bounds.width - x, Math.round(Number(input?.width || bounds.width))));
      const height = Math.max(1, Math.min(bounds.height - y, Math.round(Number(input?.height || bounds.height))));
      const image = await mainWindow.webContents.capturePage({ x, y, width, height });
      const screenshotsDir = path.join(app.getPath('desktop'), 'No-Prep Screenshots');
      await fsp.mkdir(screenshotsDir, { recursive: true });
      const requestedName = sanitizeName(String(input?.fileName || 'NoPrep page.png'), 'NoPrep page.png');
      const baseName = requestedName.toLowerCase().endsWith('.png') ? requestedName.slice(0, -4) : requestedName;
      const filePath = path.join(screenshotsDir, `${baseName}-${Date.now()}.png`);
      await fsp.writeFile(filePath, image.toPNG());
      return operationResult({ filePath });
    } catch (error) {
      console.error('app:capture-page-screenshot error:', error);
      return operationError('SCREENSHOT_FAILED', error?.message || 'Could not save screenshot.');
    }
  });

  ipcMain.handle('books:confirm-unsaved-changes', async (_event, input) => {
    const mainWindow = getMainWindow();
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: input?.title || 'Unsaved book changes',
      message: input?.message || 'This book has unsaved changes.',
      detail: input?.detail || 'Do you want to save before leaving the create book page?',
      buttons: [input?.saveLabel || 'Save', input?.dontSaveLabel || "Don't Save", input?.cancelLabel || 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    return response.response === 0 ? 'save' : response.response === 1 ? 'discard' : 'cancel';
  });
}

module.exports = {
  registerAppIpc
};
