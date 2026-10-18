function registerUpdateIpc({ ipcMain, updateService }) {
  ipcMain.handle('app:check-for-updates', () => {
    void updateService.checkForUpdates();
    return true;
  });

  ipcMain.handle('app:install-update', () => {
    updateService.installUpdate();
    return true;
  });
}

module.exports = { registerUpdateIpc };
