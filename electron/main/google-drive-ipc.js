// Google Drive backup (see google-drive-service.js): status, link, unlink, and the upload of the
// all-topics file the window builds on every topic Save.
const MAX_BACKUP_BYTES = 250 * 1024 * 1024; // the same limit Import accepts

function registerGoogleDriveIpc({ ipcMain, operationResult, operationError, googleDriveService, focusWindow }) {
  function failed(error, fallbackMessage) {
    return operationError(error?.kind || 'FAILED', error?.message || fallbackMessage);
  }

  ipcMain.handle('drive-backup:get-status', async () => operationResult(await googleDriveService.getStatus()));

  ipcMain.handle('drive-backup:link', async () => {
    try {
      const status = await googleDriveService.link();
      focusWindow();
      return operationResult(status);
    } catch (error) {
      focusWindow();
      if (error?.kind !== 'CANCELLED') console.error('drive-backup:link error:', error);
      return failed(error, 'Could not link Google Drive.');
    }
  });

  ipcMain.handle('drive-backup:cancel-link', async () => {
    googleDriveService.cancelLink();
    return operationResult(true);
  });

  ipcMain.handle('drive-backup:upload', async (_event, input) => {
    const json = typeof input?.json === 'string' ? input.json : '';
    if (!json || Buffer.byteLength(json, 'utf8') > MAX_BACKUP_BYTES) {
      return operationError('TOO_LARGE', 'The topics file is too large to back up.');
    }
    try {
      return operationResult(await googleDriveService.backup(json));
    } catch (error) {
      console.error('drive-backup:upload error:', error?.message || error);
      return failed(error, 'Could not back up to Google Drive.');
    }
  });

  ipcMain.handle('drive-backup:unlink', async () => {
    try {
      return operationResult(await googleDriveService.unlink());
    } catch (error) {
      return failed(error, 'Could not unlink Google Drive.');
    }
  });
}

module.exports = { registerGoogleDriveIpc };
