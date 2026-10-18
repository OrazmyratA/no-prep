const { autoUpdater } = require('electron-updater');

// Wraps electron-updater so the rest of main doesn't need to know its event names: every
// electron-updater event collapses to one renderer-facing 'app:update-status' message, matching
// the {available, downloading, ready, error} phases the renderer's AppUpdateService expects.
// Releases are checked against the GitHub release this app's own `gh release create` publishes
// to (see package.json's build.publish), so no separate update server is needed.
function createUpdateService({ getMainWindow }) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  function send(status, extra = {}) {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('app:update-status', { status, ...extra });
  }

  autoUpdater.on('update-available', (info) => send('downloading', { version: info?.version }));
  autoUpdater.on('update-not-available', () => send('idle'));
  autoUpdater.on('download-progress', (progress) => send('downloading', { progress: Math.round(progress?.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => send('ready', { version: info?.version }));
  autoUpdater.on('error', (error) => send('error', { message: String(error?.message || error) }));

  function checkForUpdates() {
    // Running from source (electron:dev/electron:local) has no packaged app-update.yml, so this
    // rejects every time there — caught here so it never reaches the renderer as a crash.
    return autoUpdater.checkForUpdates().catch((error) => {
      send('error', { message: String(error?.message || error) });
    });
  }

  function installUpdate() {
    autoUpdater.quitAndInstall();
  }

  return { checkForUpdates, installUpdate };
}

module.exports = { createUpdateService };
