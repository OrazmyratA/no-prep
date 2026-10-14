const ALLOWED_EXTERNAL_HOSTS = new Set([
  'www.youtube.com', 'youtube.com', 'youtu.be',
  'www.youtube-nocookie.com', 'youtube-nocookie.com',
  'www.google.com', 'google.com', 'images.google.com',
  'noprep.netlify.app',
  // "Get my API key" pages of the AI providers (AI_TOPIC_PROVIDERS in ai-topic.service.ts).
  'aistudio.google.com',
  'platform.openai.com',
  'platform.claude.com',
  'console.groq.com'
]);

// Reports (Talk Show's per-student PDF) are app-generated HTML; anything bigger is not a report.
const MAX_REPORT_HTML_CHARS = 5000000;

function registerAppIpc({
  ipcMain,
  shell,
  app,
  BrowserWindow,
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

  // Unlike open-external-url above, this isn't host-allowlisted: it's for links the
  // teacher/app-owner typed into the app's own Quick Links feature (their own Drive folders,
  // not remote/untrusted data), so any host is fine as long as the scheme is https.
  ipcMain.handle('open-external-link', (_event, url) => {
    try {
      const parsed = new URL(String(url ?? ''));
      if (parsed.protocol === 'https:') {
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

  // Saves app-generated HTML as a PDF: the teacher picks where, a hidden window with scripts off
  // draws it, and Chromium's own PDF printer keeps every script (Arabic, Chinese...) intact.
  ipcMain.handle('app:save-html-as-pdf', async (_event, input) => {
    let win = null;
    let tempFile = '';
    try {
      const html = String(input?.html || '');
      if (!html || html.length > MAX_REPORT_HTML_CHARS) {
        return operationError('INVALID_INPUT', 'There is nothing to save.');
      }
      const requested = sanitizeName(String(input?.fileName || 'NoPrep report.pdf'), 'NoPrep report.pdf');
      const fileName = requested.toLowerCase().endsWith('.pdf') ? requested : `${requested}.pdf`;
      const mainWindow = getMainWindow();
      const choice = await dialog.showSaveDialog(mainWindow, {
        defaultPath: path.join(app.getPath('documents'), fileName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (choice.canceled || !choice.filePath) return operationResult({ cancelled: true });

      tempFile = path.join(app.getPath('temp'), `noprep-report-${Date.now()}.html`);
      await fsp.writeFile(tempFile, html, 'utf8');
      win = new BrowserWindow({
        show: false,
        webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
      });
      await win.loadFile(tempFile);
      const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      await fsp.writeFile(choice.filePath, pdf);
      return operationResult({ filePath: choice.filePath });
    } catch (error) {
      console.error('app:save-html-as-pdf error:', error);
      return operationError('PDF_FAILED', error?.message || 'Could not save the PDF.');
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
      if (tempFile) await fsp.unlink(tempFile).catch(() => {});
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
