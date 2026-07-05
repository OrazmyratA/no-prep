const { runSecureFeature } = require('../feature-service');

const ALLOWED_SECURE_FEATURES = new Set(['ai', 'editing', 'export', 'import', 'premium']);

function registerSecureFeatureIpc(ipcMain) {
  ipcMain.handle('run-secure-feature', async (event, featureName, input) => {
    if (typeof featureName !== 'string' || !ALLOWED_SECURE_FEATURES.has(featureName)) {
      return { ok: false, error: 'INVALID_FEATURE' };
    }
    return runSecureFeature(featureName, input ?? {});
  });
}

module.exports = {
  registerSecureFeatureIpc
};
