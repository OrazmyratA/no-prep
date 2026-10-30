// Google Drive backup (see google-drive-service.js): status, link, unlink, sharing, and a backup in
// steps: plan (which topics changed), upload each changed topic's file, remove deleted ones, finish.
const MAX_BACKUP_BYTES = 250 * 1024 * 1024; // the same limit Import accepts

/** A topic id from the window: a whole number, as a string (it keys the stored map). */
function topicId(value) {
  const id = String(value ?? '');
  return /^\d{1,15}$/.test(id) ? id : '';
}

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

  ipcMain.handle('drive-backup:plan', async (_event, input) => {
    const topics = (Array.isArray(input?.topics) ? input.topics : [])
      .map((t) => ({ id: topicId(t?.id), updatedAt: String(t?.updatedAt ?? '') }))
      .filter((t) => t.id);
    try {
      return operationResult(await googleDriveService.plan(topics));
    } catch (error) {
      return failed(error, 'Could not plan the backup.');
    }
  });

  ipcMain.handle('drive-backup:upload-topic', async (_event, input) => {
    const id = topicId(input?.id);
    const json = typeof input?.json === 'string' ? input.json : '';
    if (!id || !json) return operationError('INVALID', 'Nothing to back up.');
    if (Buffer.byteLength(json, 'utf8') > MAX_BACKUP_BYTES) {
      return operationError('TOO_LARGE', 'This topic is too large to back up.');
    }
    try {
      await googleDriveService.uploadTopic({ id, name: String(input?.name ?? ''), updatedAt: String(input?.updatedAt ?? ''), json });
      return operationResult(true);
    } catch (error) {
      console.error('drive-backup:upload-topic error:', error?.message || error);
      return failed(error, 'Could not back up to Google Drive.');
    }
  });

  ipcMain.handle('drive-backup:remove-topic', async (_event, input) => {
    const id = topicId(input?.id);
    if (!id) return operationError('INVALID', 'No topic.');
    try {
      await googleDriveService.removeTopic(id);
      return operationResult(true);
    } catch (error) {
      return failed(error, 'Could not remove the topic from Google Drive.');
    }
  });

  ipcMain.handle('drive-backup:finish', async () => {
    try {
      return operationResult(await googleDriveService.finishBackup());
    } catch (error) {
      return failed(error, 'Could not finish the backup.');
    }
  });

  ipcMain.handle('drive-backup:set-sharing', async (_event, input) => {
    try {
      return operationResult(await googleDriveService.setSharing(input?.on === true));
    } catch (error) {
      console.error('drive-backup:set-sharing error:', error?.message || error);
      return failed(error, 'Could not change sharing.');
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
