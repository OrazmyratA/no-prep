const { contextBridge, ipcRenderer, webFrame } = require('electron');

try {
  webFrame.setZoomFactor(1);
  webFrame.setVisualZoomLevelLimits(1, 1);
} catch {
  // Keep preload resilient if Electron changes zoom APIs.
}

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) {
    event.preventDefault();
  }
}, { capture: true });

window.addEventListener('wheel', (event) => {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
  }
}, { passive: false, capture: true });

contextBridge.exposeInMainWorld('electronAPI', {
  getLicenseStatus: () => ipcRenderer.invoke('get-license-status'),
  requestLicense: () => ipcRenderer.invoke('request-license'),
  enterLicenseContent: (content) => ipcRenderer.invoke('enter-license-content', String(content ?? '')),
  runSecureFeature: (featureName, input) => ipcRenderer.invoke('run-secure-feature', String(featureName ?? ''), input ?? {}),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', String(url ?? '')),
  onLayoutChanged: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = () => callback();
    ipcRenderer.on('layout-changed', listener);
    return () => ipcRenderer.removeListener('layout-changed', listener);
  }
});
