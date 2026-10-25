// electron-updater is loaded on the first update check (seconds after start), not at startup.
let updater = null;

// Wraps electron-updater so the rest of main doesn't need to know its event names: every
// electron-updater event collapses to one renderer-facing 'app:update-status' message, matching
// the {available, downloading, ready, error} phases the renderer's AppUpdateService expects.
// Releases are checked against the GitHub release this app's own `gh release create` publishes
// to (see package.json's build.publish), so no separate update server is needed.
function createUpdateService({ getMainWindow }) {
  function send(status, extra = {}) {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('app:update-status', { status, ...extra });
  }

  function getUpdater() {
    if (updater) return updater;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('update-available', (info) => send('downloading', { version: info?.version }));
    autoUpdater.on('update-not-available', () => send('idle'));
    autoUpdater.on('download-progress', (progress) => send('downloading', { progress: Math.round(progress?.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => send('ready', { version: info?.version }));
    autoUpdater.on('error', (error) => send('error', { message: String(error?.message || error) }));
    updater = autoUpdater;
    return updater;
  }

  function checkForUpdates() {
    // Running from source (electron:dev/electron:local) has no packaged app-update.yml, so this
    // rejects every time there — caught here so it never reaches the renderer as a crash.
    return getUpdater().checkForUpdates().catch((error) => {
      send('error', { message: String(error?.message || error) });
    });
  }

  function installUpdate() {
    getUpdater().quitAndInstall();
  }

  return { checkForUpdates, installUpdate };
}

module.exports = { createUpdateService };
