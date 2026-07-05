const fs = require('fs');
const path = require('path');
const {
  BOOKS_DIR_NAME,
  AI_PACKS_DIR_NAME,
  BOOK_REGISTRY_FILE,
  AI_PACK_REGISTRY_FILE
} = require('./constants');

function createPathHelpers(app, options = {}) {
  const electronRoot = options.electronRoot || path.join(__dirname, '..');

  function getBooksRoot() {
    return path.join(app.getPath('userData'), BOOKS_DIR_NAME);
  }

  function getAiPacksRoot() {
    return path.join(app.getPath('userData'), AI_PACKS_DIR_NAME);
  }

  function getAiRuntimesRoot() {
    if (process.env.NOPREP_AI_RUNTIMES_DIR) {
      return process.env.NOPREP_AI_RUNTIMES_DIR;
    }
    if (!app.isPackaged) {
      return path.join(electronRoot, 'ai-runtimes');
    }
    const resourceRuntime = path.join(process.resourcesPath, 'ai-runtimes');
    if (fs.existsSync(resourceRuntime)) {
      return resourceRuntime;
    }
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'ai-runtimes');
  }

  function getSttRunnerPath() {
    if (process.env.NOPREP_STT_RUNNER) {
      return process.env.NOPREP_STT_RUNNER;
    }
    const root = getAiRuntimesRoot();
    const candidates = process.platform === 'win32'
      ? ['stt-runner.exe', 'stt-runner.cmd', 'stt-runner.cjs', 'stt-runner.js']
      : ['stt-runner', 'stt-runner.cjs', 'stt-runner.js'];
    return candidates.map((candidate) => path.join(root, candidate));
  }

  function getTtsRunnerPath() {
    if (process.env.NOPREP_TTS_RUNNER) {
      return process.env.NOPREP_TTS_RUNNER;
    }
    const root = getAiRuntimesRoot();
    const candidates = process.platform === 'win32'
      ? ['tts-runner.exe', 'tts-runner.cmd', 'tts-runner.cjs', 'tts-runner.js']
      : ['tts-runner', 'tts-runner.cjs', 'tts-runner.js'];
    return candidates.map((candidate) => path.join(root, candidate));
  }

  function getDialogueRunnerPath() {
    if (process.env.NOPREP_DIALOGUE_RUNNER) {
      return process.env.NOPREP_DIALOGUE_RUNNER;
    }
    const root = getAiRuntimesRoot();
    const candidates = process.platform === 'win32'
      ? ['dialogue-runner.exe', 'dialogue-runner.cmd', 'dialogue-runner.cjs', 'dialogue-runner.js']
      : ['dialogue-runner', 'dialogue-runner.cjs', 'dialogue-runner.js'];
    return candidates.map((candidate) => path.join(root, candidate));
  }

  function getLlamaCliPath() {
    if (process.env.NOPREP_LLAMA_CLI) {
      return [process.env.NOPREP_LLAMA_CLI];
    }
    const root = getAiRuntimesRoot();
    const candidates = process.platform === 'win32'
      ? ['llama-completion.exe', 'llama-cli.exe', 'main.exe', 'llama.exe']
      : ['llama-completion', 'llama-cli', 'main', 'llama'];
    return candidates.map((candidate) => path.join(root, candidate));
  }

  function getFfmpegPath() {
    if (process.env.NOPREP_FFMPEG) {
      return [process.env.NOPREP_FFMPEG];
    }
    const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const candidates = [path.join(getAiRuntimesRoot(), executable)];
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

  function getAiPackRegistryPath() {
    return path.join(getAiPacksRoot(), AI_PACK_REGISTRY_FILE);
  }

  return {
    getBooksRoot,
    getAiPacksRoot,
    getAiRuntimesRoot,
    getSttRunnerPath,
    getTtsRunnerPath,
    getDialogueRunnerPath,
    getLlamaCliPath,
    getFfmpegPath,
    getRegistryPath,
    getAiPackRegistryPath
  };
}

module.exports = {
  createPathHelpers
};
