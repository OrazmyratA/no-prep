const { BOOKS_DIR_NAME, BOOK_REGISTRY_FILE } = require('./constants');

const STORAGE_SETTINGS_FILE = 'book-storage-settings.json';

function createBookStorageService({
  app,
  fs,
  fsp,
  path,
  dialog,
  shell,
  pathExists,
  getAvailableBytes,
  operationResult,
  operationError,
  getMainWindow
}) {
  const defaultBooksRoot = path.join(app.getPath('userData'), BOOKS_DIR_NAME);
  const settingsPath = path.join(app.getPath('userData'), STORAGE_SETTINGS_FILE);
  let settings = readSettingsSync();

  function readSettingsSync() {
    try {
      if (!fs.existsSync(settingsPath)) {
        const hasExistingDefaultLibrary = fs.existsSync(path.join(defaultBooksRoot, BOOK_REGISTRY_FILE));
        return { configured: hasExistingDefaultLibrary, useDefault: true, booksRoot: defaultBooksRoot };
      }
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return normalizeSettings(parsed);
    } catch {
      return { configured: false, useDefault: true, booksRoot: defaultBooksRoot };
    }
  }

  function normalizeSettings(value) {
    const configured = !!value?.configured;
    const useDefault = value?.useDefault !== false;
    const candidate = typeof value?.booksRoot === 'string' ? value.booksRoot.trim() : '';
    return {
      configured,
      useDefault,
      booksRoot: useDefault || !candidate ? defaultBooksRoot : path.resolve(candidate)
    };
  }

  async function writeSettings(nextSettings) {
    settings = normalizeSettings(nextSettings);
    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    await fsp.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return getStorageInfo();
  }

  function getBooksRoot() {
    return settings.useDefault ? defaultBooksRoot : settings.booksRoot;
  }

  async function canWriteToFolder(folderPath) {
    await fsp.mkdir(folderPath, { recursive: true });
    const testPath = path.join(folderPath, `.noprep-write-test-${Date.now()}`);
    await fsp.writeFile(testPath, 'ok', 'utf8');
    await fsp.rm(testPath, { force: true });
  }

  async function getStorageInfo() {
    const booksRoot = getBooksRoot();
    const available = await pathExists(booksRoot);
    let availableBytes = null;
    try {
      availableBytes = await getAvailableBytes(booksRoot);
    } catch {
      availableBytes = null;
    }
    return {
      configured: !!settings.configured,
      useDefault: !!settings.useDefault,
      isDefault: !!settings.useDefault,
      booksRoot,
      defaultBooksRoot,
      settingsPath,
      available,
      availableBytes
    };
  }

  async function chooseStorageLocation() {
    const result = await dialog.showOpenDialog(getMainWindow?.(), {
      title: 'Choose NoPrep book storage folder',
      defaultPath: settings.useDefault ? app.getPath('documents') : settings.booksRoot,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return operationError('CANCELLED');
    }

    const selectedRoot = path.resolve(result.filePaths[0]);
    try {
      await canWriteToFolder(selectedRoot);
      return operationResult(await writeSettings({
        configured: true,
        useDefault: false,
        booksRoot: selectedRoot
      }));
    } catch (error) {
      return operationError(
        'STORAGE_UNAVAILABLE',
        error?.message || 'Could not use this folder for book storage.'
      );
    }
  }

  async function useDefaultStorageLocation() {
    try {
      await canWriteToFolder(defaultBooksRoot);
      return operationResult(await writeSettings({
        configured: true,
        useDefault: true,
        booksRoot: defaultBooksRoot
      }));
    } catch (error) {
      return operationError(
        'STORAGE_UNAVAILABLE',
        error?.message || 'Could not use the default book storage folder.'
      );
    }
  }

  async function openStorageLocation() {
    const booksRoot = getBooksRoot();
    try {
      await fsp.mkdir(booksRoot, { recursive: true });
      await shell.openPath(booksRoot);
      return operationResult(await getStorageInfo());
    } catch (error) {
      return operationError(
        'STORAGE_UNAVAILABLE',
        error?.message || 'Could not open the book storage folder.'
      );
    }
  }

  return {
    getBooksRoot,
    getStorageInfo,
    chooseStorageLocation,
    useDefaultStorageLocation,
    openStorageLocation
  };
}

module.exports = {
  createBookStorageService
};
