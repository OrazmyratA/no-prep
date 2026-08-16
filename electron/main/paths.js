const path = require('path');
const {
  BOOKS_DIR_NAME,
  BOOK_REGISTRY_FILE
} = require('./constants');

function createPathHelpers(app, options = {}) {
  const resolveBooksRoot = typeof options.getBooksRoot === 'function' ? options.getBooksRoot : null;

  function getBooksRoot() {
    if (resolveBooksRoot) {
      return resolveBooksRoot();
    }
    return path.join(app.getPath('userData'), BOOKS_DIR_NAME);
  }

  function getFfmpegPath() {
    if (process.env.NOPREP_FFMPEG) {
      return [process.env.NOPREP_FFMPEG];
    }
    const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const candidates = [];
    if (app.isPackaged) {
      candidates.push(path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '@ffmpeg-installer',
        process.platform === 'win32' ? 'win32-x64' : process.platform,
        executable
      ));
    }
    try {
      const bundled = require('@ffmpeg-installer/ffmpeg')?.path;
      if (bundled) candidates.push(bundled);
    } catch {
      // Optional dependency path; the app can still use an external ffmpeg.
    }
    candidates.push(executable);
    return candidates;
  }

  function getRegistryPath() {
    return path.join(getBooksRoot(), BOOK_REGISTRY_FILE);
  }

  return {
    getBooksRoot,
    getFfmpegPath,
    getRegistryPath
  };
}

module.exports = {
  createPathHelpers
};
