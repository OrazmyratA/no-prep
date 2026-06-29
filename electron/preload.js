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
  toggleAppFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  setAppFullscreen: (active) => ipcRenderer.invoke('app:set-fullscreen', !!active),
  isAppFullscreen: () => ipcRenderer.invoke('app:is-fullscreen'),
  capturePageScreenshot: (input) => ipcRenderer.invoke('app:capture-page-screenshot', input ?? {}),
  confirmBookUnsavedChanges: (input) => ipcRenderer.invoke('books:confirm-unsaved-changes', input ?? {}),
  getBookRegistry: () => ipcRenderer.invoke('books:get-registry'),
  createEmptyBook: (input) => ipcRenderer.invoke('books:create-empty', input ?? {}),
  createBookFromPdf: (input) => ipcRenderer.invoke('books:create-from-pdf', input ?? {}),
  replaceBookMainPdf: (input) => ipcRenderer.invoke('books:replace-main-pdf', input ?? {}),
  addBookWorkbookFromPdf: (input) => ipcRenderer.invoke('books:add-workbook-from-pdf', input ?? {}),
  replaceBookWorkbookPdf: (input) => ipcRenderer.invoke('books:replace-workbook-pdf', input ?? {}),
  importBookFolder: () => ipcRenderer.invoke('books:import-folder'),
  exportBookToDesktop: (input) => ipcRenderer.invoke('books:export-to-desktop', input ?? {}),
  copyBook: (input) => ipcRenderer.invoke('books:copy', input ?? {}),
  combineBooks: (input) => ipcRenderer.invoke('books:combine', input ?? {}),
  deleteBook: (input) => ipcRenderer.invoke('books:delete', input ?? {}),
  cleanupBookStorage: (input) => ipcRenderer.invoke('books:cleanup-storage', input ?? {}),
  readBook: (input) => ipcRenderer.invoke('books:read', input ?? {}),
  saveBook: (input) => ipcRenderer.invoke('books:save', input ?? {}),
  readBookAnnotations: (input) => ipcRenderer.invoke('books:read-annotations', input ?? {}),
  saveBookAnnotations: (input) => ipcRenderer.invoke('books:save-annotations', input ?? {}),
  addBookAsset: (input) => ipcRenderer.invoke('books:add-asset', input ?? {}),
  saveBookAssetData: (input) => ipcRenderer.invoke('books:save-asset-data', input ?? {}),
  saveBookAudioRecording: (input) => ipcRenderer.invoke('books:save-audio-recording', input ?? {}),
  saveBookTopicSnapshot: (input) => ipcRenderer.invoke('books:save-topic-snapshot', input ?? {}),
  listAiLanguagePacks: () => ipcRenderer.invoke('ai-packs:list'),
  importAiLanguagePack: () => ipcRenderer.invoke('ai-packs:import'),
  removeAiLanguagePack: (input) => ipcRenderer.invoke('ai-packs:remove', input ?? {}),
  getAiSpeakingRuntimeStatus: (input) => ipcRenderer.invoke('ai-speaking:get-runtime-status', input ?? {}),
  aiSpeakingTranscribeAudio: (input) => ipcRenderer.invoke('ai-speaking:transcribe-audio', input ?? {}),
  aiSpeakingGenerateResponse: (input) => ipcRenderer.invoke('ai-speaking:generate-response', input ?? {}),
  aiSpeakingCloseDialogueSession: (input) => ipcRenderer.invoke('ai-speaking:close-dialogue-session', input ?? {}),
  aiSpeakingSynthesizeSpeech: (input) => ipcRenderer.invoke('ai-speaking:synthesize-speech', input ?? {}),
  getBookAssetUrl: (bookId, relativePath) => ipcRenderer.sendSync('books:get-asset-url', String(bookId ?? ''), String(relativePath ?? '')),
  getBookAssetFileUrl: (bookId, relativePath) => ipcRenderer.sendSync('books:get-asset-file-url', String(bookId ?? ''), String(relativePath ?? '')),
  getBookAssetBytes: (bookId, relativePath) => ipcRenderer.invoke('books:get-asset-bytes', String(bookId ?? ''), String(relativePath ?? '')),
  onBookOperationProgress: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('books:progress', listener);
    return () => ipcRenderer.removeListener('books:progress', listener);
  },
  onLayoutChanged: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = () => callback();
    ipcRenderer.on('layout-changed', listener);
    return () => ipcRenderer.removeListener('layout-changed', listener);
  }
});
