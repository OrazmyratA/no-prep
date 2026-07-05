const {
  activateLicenseContent,
  checkLicense,
  writeMachineIdToDesktop
} = require('../license-service');

function registerLicenseIpc(ipcMain) {
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
}

module.exports = {
  registerLicenseIpc
};
