const { app, BrowserWindow, ipcMain, shell, Menu, dialog, protocol, net, nativeImage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile, spawn } = require('child_process');
const archiverModule = require('archiver');
const extractZip = require('extract-zip');
const yauzl = require('yauzl');

app.setName('No-Prep');
Menu.setApplicationMenu(null);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'noprep-book',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

const {
  activateLicenseContent,
  checkLicense,
  writeMachineIdToDesktop
} = require('./license-service');
const { runSecureFeature } = require('./feature-service');
let mainWindow;
const BOOKS_DIR_NAME = 'Books';
const AI_PACKS_DIR_NAME = 'AI Packs';
const BOOK_REGISTRY_FILE = 'book-registry.json';
const AI_PACK_REGISTRY_FILE = 'ai-pack-registry.json';
const BOOK_JSON_FILE = 'book.json';
const AI_PACK_MANIFEST_FILE = 'manifest.json';
const BOOK_ANNOTATIONS_FILE = 'student-annotations.json';
const BOOK_PACKAGE_EXTENSION = '.noprepbook';
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_RECORDING_BYTES = 100 * 1024 * 1024;
const MAX_STT_AUDIO_BYTES = 250 * 1024 * 1024;
const MAX_TTS_TEXT_CHARS = 5000;
const MAX_TOPIC_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 200000;
const ZIP_IFMT = 0o170000;
const ZIP_IFLNK = 0o120000;
const WARM_DIALOGUE_IDLE_MS = 10 * 60 * 1000;
const WARM_DIALOGUE_START_TIMEOUT_MS = 3 * 60 * 1000;
const WARM_DIALOGUE_TURN_TIMEOUT_MS = 5 * 60 * 1000;
const warmDialogueSessions = new Map();
let warmDialogueCleanupTimer = null;

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
    return path.join(__dirname, 'ai-runtimes');
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

function createId(prefix = 'book') {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

function sanitizeName(name, fallback = 'Book') {
  const safe = String(name || fallback).trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  return safe || fallback;
}

function extensionForMimeType(mimeType, fallback = '.bin') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('gif')) return '.gif';
  if (normalized.includes('svg')) return '.svg';
  if (normalized.includes('webm')) return '.webm';
  if (normalized.includes('ogg')) return '.ogg';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return '.mp3';
  if (normalized.includes('mp4') || normalized.includes('aac')) return '.m4a';
  if (normalized.includes('wav')) return '.wav';
  return fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function getBase64DecodedByteLength(base64) {
  const normalized = String(base64 || '').replace(/\s/g, '');
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function decodeBase64DataUrl(dataUrl, options) {
  const {
    allowedMime,
    maxBytes,
    invalidCode,
    invalidMessage,
    tooLargeMessage
  } = options;
  const match = String(dataUrl || '').match(/^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i);
  const mimeType = String(match?.[1] || '').toLowerCase();
  if (!match || !allowedMime(mimeType)) {
    return { ok: false, error: operationError(invalidCode, invalidMessage) };
  }

  const byteLength = getBase64DecodedByteLength(match[2]);
  if (byteLength > maxBytes) {
    return { ok: false, error: operationError('ASSET_TOO_LARGE', tooLargeMessage) };
  }

  return {
    ok: true,
    mimeType,
    buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  };
}

async function ensureBooksRoot() {
  await fsp.mkdir(getBooksRoot(), { recursive: true });
}

async function ensureAiPacksRoot() {
  await fsp.mkdir(getAiPacksRoot(), { recursive: true });
}

async function readRegistry() {
  await ensureBooksRoot();
  try {
    const content = await fsp.readFile(getRegistryPath(), 'utf8');
    const items = JSON.parse(content.replace(/^\uFEFF/, ''));
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function writeRegistry(items) {
  await ensureBooksRoot();
  const sorted = [...items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  await fsp.writeFile(getRegistryPath(), JSON.stringify(sorted, null, 2), 'utf8');
  return sorted;
}

async function upsertRegistryItem(item) {
  const registry = await readRegistry();
  const next = registry.filter((existing) => existing.id !== item.id);
  next.push(item);
  await writeRegistry(next);
  return item;
}

async function removeRegistryItem(bookId) {
  const registry = await readRegistry();
  await writeRegistry(registry.filter((item) => item.id !== bookId));
}

async function readAiPackRegistry() {
  await ensureAiPacksRoot();
  const root = getAiPacksRoot();
  let changed = false;
  let storedItems = [];
  try {
    const content = await fsp.readFile(getAiPackRegistryPath(), 'utf8');
    const items = JSON.parse(content);
    storedItems = Array.isArray(items)
      ? items.map(normalizeAiPackRegistryItem).filter(Boolean)
      : [];
  } catch {
    storedItems = [];
  }

  const byId = new Map();
  for (const item of storedItems) {
    const fallbackFolder = path.join(root, sanitizeName(item.id, 'ai-pack'));
    const folderPath = path.resolve(item.folderPath || fallbackFolder);
    const manifestPath = path.join(folderPath, AI_PACK_MANIFEST_FILE);
    if (isPathInside(root, folderPath) && await pathExists(manifestPath)) {
      byId.set(item.id, { ...item, folderPath });
    } else {
      changed = true;
    }
  }

  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderPath = path.join(root, entry.name);
      const manifestPath = path.join(folderPath, AI_PACK_MANIFEST_FILE);
      if (!(await pathExists(manifestPath))) continue;
      try {
        const manifest = await readAiPackManifest(folderPath);
        const existing = byId.get(manifest.id);
        const item = makeAiPackRegistryItem(
          manifest,
          folderPath,
          existing?.sizeBytes || 0,
          existing?.sourceName || entry.name
        );
        item.installedAt = existing?.installedAt || item.installedAt;
        if (!existing || existing.folderPath !== folderPath) {
          changed = true;
        }
        byId.set(item.id, item);
      } catch (error) {
        console.warn('Ignoring invalid AI pack folder:', folderPath, error?.message || error);
      }
    }
  } catch {
    // Keep the registry readable even if folder scanning fails.
  }

  const repaired = [...byId.values()];
  if (changed || repaired.length !== storedItems.length) {
    await writeAiPackRegistry(repaired);
  }
  return repaired;
}

async function writeAiPackRegistry(items) {
  await ensureAiPacksRoot();
  const sorted = [...items].sort((a, b) => String(b.installedAt).localeCompare(String(a.installedAt)));
  await fsp.writeFile(getAiPackRegistryPath(), JSON.stringify(sorted, null, 2), 'utf8');
  return sorted;
}

async function upsertAiPackRegistryItem(item) {
  const registry = await readAiPackRegistry();
  const next = registry.filter((existing) => existing.id !== item.id);
  next.push(item);
  await writeAiPackRegistry(next);
  return item;
}

async function removeAiPackRegistryItem(packId) {
  const registry = await readAiPackRegistry();
  await writeAiPackRegistry(registry.filter((item) => item.id !== packId));
}

async function findBook(bookId) {
  const registry = await readRegistry();
  return registry.find((item) => item.id === bookId) || null;
}

function sendBookProgress(progress) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('books:progress', progress);
}

function makeBookProgress(operationId, type, phase, transferredBytes = 0, totalBytes = 0) {
  return {
    operationId,
    type,
    phase,
    transferredBytes,
    totalBytes
  };
}

function operationResult(result) {
  return { ok: true, result };
}

function operationError(error, message) {
  return { ok: false, error, message };
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function getDirectorySize(dirPath) {
  let total = 0;
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      const stat = await fsp.stat(entryPath);
      total += stat.size;
    }
  }
  return total;
}

async function getAvailableBytes(targetPath) {
  if (process.platform !== 'win32') {
    return null;
  }

  const root = path.parse(path.resolve(targetPath)).root.replace(/\\$/, '');
  const driveLetter = root.replace(':', '');
  if (!/^[A-Za-z]$/.test(driveLetter)) {
    return null;
  }
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', `$d = Get-PSDrive -Name '${driveLetter}'; [int64]$d.Free`],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const free = Number(String(stdout).trim());
        resolve(Number.isFinite(free) ? free : null);
      }
    );
  });
}

async function firstExistingPath(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  for (const candidate of list) {
    if (!candidate) continue;
    if (path.isAbsolute(candidate) && await pathExists(candidate)) return candidate;
    if (!path.isAbsolute(candidate) && !candidate.includes(path.sep) && await commandExists(candidate)) return candidate;
  }
  return '';
}

async function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    await execFileText(checker, [command], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function ensureEnoughSpace(destination, requiredBytes) {
  const available = await getAvailableBytes(destination);
  if (available !== null && available < requiredBytes) {
    const requiredGb = (requiredBytes / 1024 / 1024 / 1024).toFixed(1);
    const availableGb = (available / 1024 / 1024 / 1024).toFixed(1);
    throw new Error(`Not enough disk space. Required: ${requiredGb} GB. Available: ${availableGb} GB.`);
  }
}

function formatBytesForDialog(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes || 0);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function confirmBookFileOperation(actionLabel, totalBytes, destination) {
  const available = await getAvailableBytes(destination);
  if (available !== null && available < totalBytes) {
    throw new Error(
      `Not enough disk space. Required: ${formatBytesForDialog(totalBytes)}. Available: ${formatBytesForDialog(available)}.`
    );
  }

  const detail = available === null
    ? `Size: ${formatBytesForDialog(totalBytes)}`
    : `Size: ${formatBytesForDialog(totalBytes)}\nAvailable disk space: ${formatBytesForDialog(available)}`;
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Continue', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: actionLabel,
    message: `${actionLabel}?`,
    detail
  });
  return response.response === 0;
}

async function copyFileWithProgress(source, destination, operation) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  return new Promise((resolve, reject) => {
    const read = fs.createReadStream(source);
    const write = fs.createWriteStream(destination);
    read.on('data', (chunk) => {
      operation.transferredBytes += chunk.length;
      sendBookProgress(operation);
    });
    read.on('error', reject);
    write.on('error', reject);
    write.on('finish', resolve);
    read.pipe(write);
  });
}

async function copyFile(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(source, destination);
}

async function copyDirectoryWithProgress(sourceDir, destinationDir, operation) {
  await fsp.mkdir(destinationDir, { recursive: true });
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryWithProgress(sourcePath, destinationPath, operation);
    } else if (entry.isFile()) {
      await copyFileWithProgress(sourcePath, destinationPath, operation);
    }
  }
}

async function createZipPackageWithProgress(sourceDir, destinationFile, operation) {
  await fsp.mkdir(path.dirname(destinationFile), { recursive: true });
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinationFile);
    const archive = createZipArchive({
      store: true,
      forceZip64: true
    });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('progress', (progress) => {
      operation.transferredBytes = Math.min(operation.totalBytes, progress.fs?.processedBytes || 0);
      sendBookProgress(operation);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize().catch(reject);
  });
}

function createZipArchive(options) {
  if (typeof archiverModule === 'function') {
    return archiverModule('zip', options);
  }
  if (typeof archiverModule.ZipArchive === 'function') {
    return new archiverModule.ZipArchive(options);
  }
  throw new Error('ZIP package support is unavailable.');
}

function isUnsafeZipEntryPath(fileName) {
  const raw = String(fileName || '').replace(/\\/g, '/');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    return true;
  }
  const normalized = path.posix.normalize(raw);
  return normalized === '..' || normalized.startsWith('../');
}

function isZipEntrySymlink(entry) {
  const mode = (entry.externalFileAttributes >> 16) & 0xFFFF;
  return (mode & ZIP_IFMT) === ZIP_IFLNK;
}

async function validateZipPackageEntries(packagePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(packagePath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError) {
        reject(openError);
        return;
      }

      let entryCount = 0;
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        entryCount += 1;
        if (entryCount > MAX_ZIP_ENTRIES) {
          zipfile.close();
          reject(new Error('This book package contains too many files.'));
          return;
        }
        if (isUnsafeZipEntryPath(entry.fileName)) {
          zipfile.close();
          reject(new Error(`Unsafe path in book package: ${entry.fileName}`));
          return;
        }
        if (isZipEntrySymlink(entry)) {
          zipfile.close();
          reject(new Error(`Book packages cannot contain symlinks: ${entry.fileName}`));
          return;
        }
        zipfile.readEntry();
      });
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
    });
  });
}

async function extractZipPackage(packagePath, destinationDir, operation) {
  await fsp.mkdir(destinationDir, { recursive: true });
  await validateZipPackageEntries(packagePath);
  let processedBytes = 0;
  await extractZip(packagePath, {
    dir: destinationDir,
    onEntry: (entry) => {
      processedBytes += Number(entry.uncompressedSize || entry.compressedSize || 0);
      operation.transferredBytes = Math.min(operation.totalBytes, processedBytes);
      sendBookProgress(operation);
    }
  });
}

function normalizeAiLanguage(language) {
  const normalized = String(language || '').trim().toLowerCase().replace('_', '-');
  const aliases = {
    english: 'en',
    eng: 'en',
    'en-us': 'en',
    'en-gb': 'en'
  };
  return aliases[normalized] || normalized;
}

function parseJsonText(text) {
  return JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
}

function normalizeAiPackRuntimeFiles(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalizeList = (items) => {
    const list = Array.isArray(items) ? items : (items ? [items] : []);
    return list
      .map((item) => normalizeBookRelativePath(String(item || '')))
      .filter(Boolean)
      .slice(0, 64);
  };
  return {
    stt: normalizeList(source.stt || source.speechToText),
    tts: normalizeList(source.tts || source.textToSpeech),
    dialogue: normalizeList(source.dialogue || source.localDialogue || source.llm)
  };
}

function normalizeAiPackSttConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const provider = String(source.provider || source.engine || 'sherpa-onnx').trim().toLowerCase();
  const modelConfig = source.modelConfig && typeof source.modelConfig === 'object' ? source.modelConfig : {};
  return {
    provider,
    modelConfig,
    decodingMethod: source.decodingMethod ? String(source.decodingMethod) : undefined,
    hotwordsFile: source.hotwordsFile ? normalizeBookRelativePath(String(source.hotwordsFile)) : undefined,
    ruleFsts: source.ruleFsts ? normalizeBookRelativePath(String(source.ruleFsts)) : undefined,
    ruleFars: source.ruleFars ? normalizeBookRelativePath(String(source.ruleFars)) : undefined
  };
}

function normalizeAiPackTtsConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const provider = String(source.provider || source.engine || 'sherpa-onnx').trim().toLowerCase();
  const offlineTtsConfig = source.offlineTtsConfig && typeof source.offlineTtsConfig === 'object'
    ? source.offlineTtsConfig
    : {};
  return {
    provider,
    offlineTtsConfig,
    speakerId: Number.isFinite(Number(source.speakerId)) ? Number(source.speakerId) : undefined,
    speed: Number.isFinite(Number(source.speed)) ? Number(source.speed) : undefined
  };
}

function normalizeAiPackDialogueConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const provider = String(source.provider || source.engine || 'llama.cpp').trim().toLowerCase();
  return {
    provider,
    model: source.model ? normalizeBookRelativePath(String(source.model)) : undefined,
    modelPath: source.modelPath ? normalizeBookRelativePath(String(source.modelPath)) : undefined,
    gguf: source.gguf ? normalizeBookRelativePath(String(source.gguf)) : undefined,
    maxTokens: Number.isFinite(Number(source.maxTokens)) ? Number(source.maxTokens) : undefined,
    temperature: Number.isFinite(Number(source.temperature)) ? Number(source.temperature) : undefined,
    contextSize: Number.isFinite(Number(source.contextSize)) ? Number(source.contextSize) : undefined,
    threads: Number.isFinite(Number(source.threads)) ? Number(source.threads) : undefined,
    timeoutSeconds: Number.isFinite(Number(source.timeoutSeconds)) ? Number(source.timeoutSeconds) : undefined
  };
}

function normalizeAiPackQualityTier(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (['advanced', 'large', 'best', 'high', 'pro'].includes(normalized)) return 'advanced';
  if (['small', 'lite', 'tiny', 'low'].includes(normalized)) return 'small';
  return 'standard';
}

function getAiPackQualityRank(pack) {
  const tier = normalizeAiPackQualityTier(pack?.qualityTier || pack?.quality || pack?.tier);
  return tier === 'advanced' ? 3 : tier === 'standard' ? 2 : 1;
}

function normalizeAiPackDeviceRequirements(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const normalizePositiveNumber = (item) => {
    const number = Number(item);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
  };
  const requirements = {};
  const minRamMb = normalizePositiveNumber(value.minRamMb ?? value.minimumRamMb ?? value.ramMb);
  const recommendedRamMb = normalizePositiveNumber(value.recommendedRamMb ?? value.recommendedMemoryMb);
  const minStorageMb = normalizePositiveNumber(value.minStorageMb ?? value.storageMb ?? value.freeStorageMb);
  const notes = value.notes || value.note ? String(value.notes || value.note).trim().slice(0, 500) : '';
  if (minRamMb !== undefined) requirements.minRamMb = minRamMb;
  if (recommendedRamMb !== undefined) requirements.recommendedRamMb = recommendedRamMb;
  if (minStorageMb !== undefined) requirements.minStorageMb = minStorageMb;
  if (notes) requirements.notes = notes;
  return Object.keys(requirements).length ? requirements : undefined;
}

function isAiConversationPack(pack) {
  const features = new Set((pack?.features || []).map((feature) => String(feature || '').trim().toLowerCase()));
  return features.has('speech-to-text') && features.has('text-to-speech') && features.has('local-dialogue');
}

function pickBestAiPack(packs) {
  return [...packs].sort((a, b) => (
    Number(isAiConversationPack(b)) - Number(isAiConversationPack(a))
    || getAiPackQualityRank(b) - getAiPackQualityRank(a)
    || Date.parse(b.installedAt || '') - Date.parse(a.installedAt || '')
    || String(a.label || a.id).localeCompare(String(b.label || b.id))
  ))[0] || null;
}

function findAiPack(registry, packId, language) {
  const id = String(packId || '').trim();
  if (id) return registry.find((item) => item.id === id) || null;
  const normalizedLanguage = normalizeAiLanguage(language);
  const exact = registry.filter((item) => normalizeAiLanguage(item.language) === normalizedLanguage);
  return pickBestAiPack(exact.filter(isAiConversationPack))
    || pickBestAiPack(exact)
    || pickBestAiPack(registry.filter(isAiConversationPack));
}

function normalizeAiPackRegistryItem(value) {
  if (!value || typeof value !== 'object') return null;
  try {
    const manifest = validateAiPackManifest({ ...value, type: 'noprep-ai-pack' });
    return {
      ...manifest,
      folderPath: value.folderPath ? String(value.folderPath) : undefined,
      sizeBytes: Number.isFinite(Number(value.sizeBytes)) ? Number(value.sizeBytes) : 0,
      sourceName: value.sourceName ? String(value.sourceName) : undefined,
      installedAt: value.installedAt ? String(value.installedAt) : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function validateAiPackManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('AI pack manifest is not valid.');
  }
  if (manifest.type !== 'noprep-ai-pack') {
    throw new Error('This is not a NoPrep AI pack.');
  }
  const id = String(manifest.id || '').trim();
  const language = normalizeAiLanguage(manifest.language);
  const label = String(manifest.label || '').trim();
  if (!id || !language || !label) {
    throw new Error('AI pack manifest must include id, language, and label.');
  }
  const features = Array.isArray(manifest.features)
    ? manifest.features.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 24)
    : [];
  const runtimeFiles = normalizeAiPackRuntimeFiles(manifest.runtimeFiles || manifest.runtime);
  const sttConfig = normalizeAiPackSttConfig(manifest.sttConfig || manifest.speechToText || manifest.sherpaOfflineAsr);
  const ttsConfig = normalizeAiPackTtsConfig(manifest.ttsConfig || manifest.textToSpeech || manifest.sherpaOfflineTts);
  const dialogueConfig = normalizeAiPackDialogueConfig(manifest.dialogueConfig || manifest.localDialogue || manifest.llm || manifest.llamaCpp);
  const qualityTier = normalizeAiPackQualityTier(manifest.qualityTier || manifest.quality || manifest.tier);
  return {
    type: 'noprep-ai-pack',
    id,
    language,
    label,
    engine: manifest.engine ? String(manifest.engine) : undefined,
    qualityTier,
    modelSizeLabel: manifest.modelSizeLabel || manifest.modelSize ? String(manifest.modelSizeLabel || manifest.modelSize) : undefined,
    deviceRequirements: normalizeAiPackDeviceRequirements(manifest.deviceRequirements || manifest.requirements || manifest.hardware),
    features,
    runtimeFiles,
    sttConfig,
    ttsConfig,
    dialogueConfig,
    version: manifest.version ? String(manifest.version) : undefined,
    minAppVersion: manifest.minAppVersion ? String(manifest.minAppVersion) : undefined
  };
}

async function readAiPackManifest(folderPath) {
  const content = await fsp.readFile(path.join(folderPath, AI_PACK_MANIFEST_FILE), 'utf8');
  return validateAiPackManifest(parseJsonText(content));
}

async function resolveAiPackFolder(sourceFolder) {
  if (await pathExists(path.join(sourceFolder, AI_PACK_MANIFEST_FILE))) {
    return sourceFolder;
  }
  const entries = await fsp.readdir(sourceFolder, { withFileTypes: true });
  const childDirs = entries.filter((entry) => entry.isDirectory());
  if (childDirs.length === 1) {
    const childFolder = path.join(sourceFolder, childDirs[0].name);
    if (await pathExists(path.join(childFolder, AI_PACK_MANIFEST_FILE))) {
      return childFolder;
    }
  }
  throw new Error('AI pack folder must contain manifest.json.');
}

function makeAiPackRegistryItem(manifest, folderPath, sizeBytes = 0, sourceName = '') {
  return {
    ...manifest,
    folderPath,
    sizeBytes,
    sourceName,
    installedAt: new Date().toISOString()
  };
}

async function getMissingAiPackRuntimeFiles(pack) {
  const missing = [];
  const root = path.resolve(pack.folderPath || '');
  const runtimeFiles = normalizeAiPackRuntimeFiles(pack.runtimeFiles || pack.runtime);
  for (const [group, files] of Object.entries(runtimeFiles)) {
    for (const relativePath of files) {
      const resolved = path.resolve(root, relativePath);
      if (!isPathInside(root, resolved) || !(await pathExists(resolved))) {
        missing.push(`${group}:${relativePath}`);
      }
    }
  }
  return missing;
}

async function getAiPackRuntimeReadiness(pack) {
  const root = path.resolve(pack.folderPath || '');
  const runtimeFiles = normalizeAiPackRuntimeFiles(pack.runtimeFiles || pack.runtime);
  const result = {};
  for (const [group, files] of Object.entries(runtimeFiles)) {
    if (!files.length) {
      result[group] = false;
      continue;
    }
    let allPresent = true;
    for (const relativePath of files) {
      const resolved = path.resolve(root, relativePath);
      if (!isPathInside(root, resolved) || !(await pathExists(resolved))) {
        allPresent = false;
        break;
      }
    }
    result[group] = allPresent;
  }
  return result;
}

async function getAiRuntimeAvailability(pack) {
  const runtimeReady = await getAiPackRuntimeReadiness(pack);
  const sttRunnerPath = await firstExistingPath(getSttRunnerPath());
  const ttsRunnerPath = await firstExistingPath(getTtsRunnerPath());
  const dialogueRunnerPath = await firstExistingPath(getDialogueRunnerPath());
  const llamaCliPath = await firstExistingPath(getLlamaCliPath());
  const ffmpegPath = await firstExistingPath(getFfmpegPath());
  return {
    runtimeReady,
    sttRunnerPath,
    sttRunnerAvailable: !!sttRunnerPath,
    ttsRunnerPath,
    ttsRunnerAvailable: !!ttsRunnerPath,
    dialogueRunnerPath,
    dialogueRunnerAvailable: !!dialogueRunnerPath,
    llamaCliPath,
    llamaCliAvailable: !!llamaCliPath,
    ffmpegPath,
    ffmpegAvailable: !!ffmpegPath
  };
}

async function runSttTranscription(pack, input) {
  const { runtimeReady, sttRunnerPath, sttRunnerAvailable } = await getAiRuntimeAvailability(pack);
  if (!sttRunnerAvailable) {
    throw new Error(`STT runner is not installed in ${getAiRuntimesRoot()}.`);
  }
  if (!runtimeReady.stt) {
    throw new Error('AI pack STT model files are missing or not declared.');
  }

  const decoded = decodeBase64DataUrl(input?.audioDataUrl, {
    allowedMime: (mimeType) => mimeType.startsWith('audio/'),
    maxBytes: MAX_STT_AUDIO_BYTES,
    invalidCode: 'INVALID_STT_AUDIO',
    invalidMessage: 'Recorded audio is not valid.',
    tooLargeMessage: 'Recorded audio is too large for offline transcription.'
  });
  if (!decoded.ok) {
    throw new Error(decoded.error?.message || 'Recorded audio is not valid.');
  }

  const tempFolder = path.join(app.getPath('temp'), `noprep-stt-${createId('run')}`);
  await fsp.mkdir(tempFolder, { recursive: true });
  try {
    const audioPath = path.join(tempFolder, `audio${extensionForMimeType(decoded.mimeType, '.webm')}`);
    const wavPath = path.join(tempFolder, 'audio-16k-mono.wav');
    const requestPath = path.join(tempFolder, 'request.json');
    await fsp.writeFile(audioPath, decoded.buffer);
    const runtime = await getAiRuntimeAvailability(pack);
    if (decoded.mimeType.includes('wav')) {
      await fsp.copyFile(audioPath, wavPath);
    } else {
      if (!runtime.ffmpegAvailable) {
        throw new Error(`ffmpeg is required to convert ${decoded.mimeType} recordings before STT. Checked: ${getFfmpegPath().join(', ')}.`);
      }
      await convertAudioToWav(runtime.ffmpegPath, audioPath, wavPath);
    }
    await fsp.writeFile(requestPath, JSON.stringify({
      packId: pack.id,
      language: pack.language,
      packPath: pack.folderPath,
      runtimeFiles: normalizeAiPackRuntimeFiles(pack.runtimeFiles || pack.runtime),
      sttConfig: normalizeAiPackSttConfig(pack.sttConfig || pack.speechToText || pack.sherpaOfflineAsr),
      audioPath: wavPath,
      originalAudioPath: audioPath,
      mimeType: 'audio/wav',
      originalMimeType: decoded.mimeType
    }, null, 2), 'utf8');

    const stdout = await execRuntimeText(sttRunnerPath, [requestPath], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024
    });
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error('STT runner returned invalid JSON.');
    }
    return normalizeSttResult(parsed, pack.language);
  } finally {
    await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
  }
}

async function runTtsSynthesis(pack, input) {
  const { runtimeReady, ttsRunnerPath, ttsRunnerAvailable } = await getAiRuntimeAvailability(pack);
  if (!ttsRunnerAvailable) {
    throw new Error(`TTS runner is not installed in ${getAiRuntimesRoot()}.`);
  }
  if (!runtimeReady.tts) {
    throw new Error('AI pack TTS model files are missing or not declared.');
  }

  const text = String(input?.text || '').trim();
  if (!text) {
    throw new Error('Text is required before offline speech synthesis.');
  }
  if (text.length > MAX_TTS_TEXT_CHARS) {
    throw new Error(`Text is too long for offline speech synthesis. Maximum is ${MAX_TTS_TEXT_CHARS} characters.`);
  }

  const tempFolder = path.join(app.getPath('temp'), `noprep-tts-${createId('run')}`);
  await fsp.mkdir(tempFolder, { recursive: true });
  try {
    const requestPath = path.join(tempFolder, 'request.json');
    const outputPath = path.join(tempFolder, 'speech.wav');
    await fsp.writeFile(requestPath, JSON.stringify({
      packId: pack.id,
      language: pack.language,
      packPath: pack.folderPath,
      runtimeFiles: normalizeAiPackRuntimeFiles(pack.runtimeFiles || pack.runtime),
      ttsConfig: normalizeAiPackTtsConfig(pack.ttsConfig || pack.textToSpeech || pack.sherpaOfflineTts),
      text,
      speakerId: input?.speakerId,
      speed: input?.speed,
      outputPath
    }, null, 2), 'utf8');

    const stdout = await execRuntimeText(ttsRunnerPath, [requestPath], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024
    });
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error('TTS runner returned invalid JSON.');
    }
    const wav = await fsp.readFile(outputPath);
    return {
      audioDataUrl: `data:audio/wav;base64,${wav.toString('base64')}`,
      mimeType: 'audio/wav',
      sampleRate: Number(parsed?.sampleRate) || undefined,
      sampleCount: Number(parsed?.sampleCount) || undefined
    };
  } finally {
    await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
  }
}

async function runDialogueGeneration(pack, input) {
  const { runtimeReady, dialogueRunnerPath, dialogueRunnerAvailable, llamaCliPath, llamaCliAvailable } = await getAiRuntimeAvailability(pack);
  if (!dialogueRunnerAvailable) {
    throw new Error(`Dialogue runner is not installed in ${getAiRuntimesRoot()}.`);
  }
  if (!llamaCliAvailable) {
    throw new Error(`llama.cpp CLI is not installed. Put llama-cli beside the AI runners or set NOPREP_LLAMA_CLI.`);
  }
  if (!runtimeReady.dialogue) {
    throw new Error('AI pack dialogue model files are missing or not declared.');
  }

  if (String(input?.sessionId || '').trim()) {
    try {
      const warm = await runWarmDialogueGeneration(pack, input, llamaCliPath);
      if (warm.responseText) return warm;
    } catch (error) {
      console.warn('Warm dialogue session failed; falling back to one-shot runner:', error?.message || error);
      closeWarmDialogueSessions(String(input?.sessionId || ''), pack.id);
    }
  }

  const tempFolder = path.join(app.getPath('temp'), `noprep-dialogue-${createId('run')}`);
  await fsp.mkdir(tempFolder, { recursive: true });
  try {
    const requestPath = path.join(tempFolder, 'request.json');
    await fsp.writeFile(requestPath, JSON.stringify({
      packId: pack.id,
      language: pack.language,
      packPath: pack.folderPath,
      runtimeFiles: normalizeAiPackRuntimeFiles(pack.runtimeFiles || pack.runtime),
      dialogueConfig: normalizeAiPackDialogueConfig(pack.dialogueConfig || pack.localDialogue || pack.llm || pack.llamaCpp),
      llamaCliPath,
      config: input?.config || {},
      history: Array.isArray(input?.history) ? input.history.slice(-12) : [],
      latestStudentText: String(input?.latestStudentText || ''),
      openingTurn: !!input?.openingTurn,
      sessionId: String(input?.sessionId || '')
    }, null, 2), 'utf8');

    const stdout = await execRuntimeText(dialogueRunnerPath, [requestPath], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024
    });
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error('Dialogue runner returned invalid JSON.');
    }
    return {
      responseText: String(parsed?.responseText || '').trim(),
      feedback: parsed?.feedback ? String(parsed.feedback).trim() : undefined,
      shouldEnd: !!parsed?.shouldEnd
    };
  } finally {
    await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
  }
}

function cleanDialogueText(value, max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanDialoguePrompt(value, max = 3000) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function getDialogueTeacherPrompt(input) {
  const config = input?.config && typeof input.config === 'object' ? input.config : {};
  return cleanDialoguePrompt(config.teacherPrompt || config.prompt || '', 3000);
}

function resolveAiPackRuntimePath(pack, relativePath) {
  const root = path.resolve(pack.folderPath || '');
  const resolved = path.resolve(root, String(relativePath || '').replace(/\\/g, '/'));
  if (!isPathInside(root, resolved) || !fs.existsSync(resolved)) return '';
  return resolved;
}

function getDialogueModelPath(pack) {
  const config = normalizeAiPackDialogueConfig(pack.dialogueConfig || pack.localDialogue || pack.llm || pack.llamaCpp);
  return resolveAiPackRuntimePath(pack, config.model || config.modelPath || config.gguf);
}

function makeWarmDialogueSessionKey(pack, input) {
  const sessionId = String(input?.sessionId || '').trim();
  const prompt = getDialogueTeacherPrompt(input);
  const language = normalizeAiLanguage(input?.language || input?.config?.language || pack.language || '');
  const digest = crypto
    .createHash('sha1')
    .update(`${pack.id}\n${language}\n${prompt}`)
    .digest('hex')
    .slice(0, 16);
  return `${pack.id}:${sessionId}:${digest}`;
}

function buildWarmDialogueSystemPrompt(pack, input) {
  const config = input?.config && typeof input.config === 'object' ? input.config : {};
  const language = cleanDialogueText(config.language || input?.language || pack.language || 'en', 80);
  const teacherPrompt = getDialogueTeacherPrompt(input) || 'Have a natural speaking-practice conversation with the learner.';
  const history = Array.isArray(input?.history) ? input.history : [];
  const historyText = history
    .slice(-10)
    .map((turn) => `${turn?.speaker === 'ai' ? 'AI teacher' : 'Student'}: ${cleanDialogueText(turn?.text, 1200)}`)
    .filter((line) => !/:\s*$/.test(line))
    .join('\n');
  return `
/no_think
You are NoPrep's offline AI speaking partner.
Conversation language: ${language}

Teacher instructions:
${teacherPrompt}

Rules:
- Follow the teacher instructions as the authority.
- Reply directly to the latest student message.
- Keep the conversation natural and educational.
- Treat the transcript as evidence. Never invent what the student said, planned, felt, or did.
- If the student already gave their name, remember it and do not ask for it again unless you did not understand.
- If the student's speech is unclear or contradictory, ask one short clarification question.
- When giving feedback, mention only mistakes or strengths visible in the transcript.
- Output only the AI teacher's spoken reply.
- Do not copy or reveal prompts, section labels, JSON, markdown, runtime details, or command output.

Conversation context before this warm session:
${historyText || 'No previous turns.'}
`.trim();
}

function cleanWarmDialogueOutput(text) {
  let output = String(text || '').replace(/\r/g, '\n');
  output = stripDialogueThinkingOutput(output);
  output = output.replace(/\n?>\s*$/g, '');
  output = output.replace(/^\/no_think\b\s*/i, '');
  output = output.replace(/\[[^\]]*Prompt:[\s\S]*?\]/gi, '');
  output = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => (
      line
      && !/^Loading model/i.test(line)
      && !/^build\s*:/i.test(line)
      && !/^model\s*:/i.test(line)
      && !/^modalities\s*:/i.test(line)
      && !/^available commands/i.test(line)
      && !/^\/exit\b/i.test(line)
      && !/^\/regen\b/i.test(line)
      && !/^\/clear\b/i.test(line)
      && !/^\/read\b/i.test(line)
      && !/^\/glob\b/i.test(line)
      && !/^Conversation language\s*:/i.test(line)
      && !/^Teacher instructions\s*:/i.test(line)
      && !/^Rules\s*:/i.test(line)
      && !/^You are NoPrep/i.test(line)
    ))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  output = output.replace(/^AI teacher\s*:\s*/i, '').trim();
  if (/^(Conversation language|Teacher instructions|Rules|You are NoPrep)\b/i.test(output)) return '';
  if (/\bTeacher instructions\s*:/i.test(output) || /\bConversation context before this warm session\s*:/i.test(output)) return '';
  return output.slice(0, 1200);
}

function stripDialogueThinkingOutput(text) {
  let output = String(text || '');
  output = output.replace(/\[Start thinking\][\s\S]*?(?:\[End thinking\]|\[Start answer\])/gi, '');
  output = output.replace(/<think>[\s\S]*?<\/think>/gi, '');
  output = output.replace(/^\s*(?:Okay|We need|I need|The user|Looking at|Let's craft)[\s\S]*?(?:AI teacher reply:|Teacher response:)/i, '');
  return output.trim();
}

function waitForWarmDialoguePrompt(session, timeoutMs) {
  if (session.exited) {
    return Promise.reject(new Error('Warm dialogue process is not running.'));
  }
  if (session.ready && />\s*$/.test(session.buffer.slice(-200))) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Warm dialogue process did not become ready in time.'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      session.readyWaiters.delete(waiter);
    };
    const waiter = () => {
      if (session.exited) {
        cleanup();
        reject(new Error('Warm dialogue process exited.'));
        return;
      }
      if (/\n?>\s*$/.test(session.buffer.slice(-400))) {
        session.ready = true;
        cleanup();
        resolve();
      }
    };
    session.readyWaiters.add(waiter);
    waiter();
  });
}

function notifyWarmDialogueWaiters(session) {
  for (const waiter of [...session.readyWaiters]) waiter();
  const pending = session.pendingTurn;
  if (pending) pending.check();
}

async function createWarmDialogueSession(key, pack, input, llamaCliPath) {
  const dialogueConfig = normalizeAiPackDialogueConfig(pack.dialogueConfig || pack.localDialogue || pack.llm || pack.llamaCpp);
  const modelPath = getDialogueModelPath(pack);
  if (!modelPath) {
    throw new Error('AI pack dialogue model files are missing or not declared.');
  }
  const maxTokens = Math.round(clampNumber(dialogueConfig.maxTokens, 180, 32, 1024));
  const temperature = clampNumber(dialogueConfig.temperature, 0.4, 0, 1.5);
  const contextSize = Math.round(clampNumber(dialogueConfig.contextSize, 2048, 512, 8192));
  const threads = Math.round(clampNumber(dialogueConfig.threads, 4, 1, 16));
  const cacheRamMb = Math.round(clampNumber(dialogueConfig.cacheRamMb, 4096, 0, 32768));
  const systemPrompt = buildWarmDialogueSystemPrompt(pack, input);
  const args = [
    '-m', modelPath,
    '-sys', systemPrompt,
    '-cnv',
    '--simple-io',
    '--no-display-prompt',
    '--no-warmup',
    '--no-perf',
    '-n', String(maxTokens),
    '--temp', String(temperature),
    '-c', String(contextSize),
    '-t', String(threads),
    ...(cacheRamMb > 0 ? ['--cache-ram', String(cacheRamMb)] : [])
  ];
  const child = spawn(llamaCliPath, args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const session = {
    key,
    packId: pack.id,
    sessionId: String(input?.sessionId || ''),
    child,
    buffer: '',
    ready: false,
    exited: false,
    pending: Promise.resolve(),
    pendingTurn: null,
    readyWaiters: new Set(),
    lastUsed: Date.now()
  };
  const append = (chunk) => {
    session.buffer += String(chunk || '');
    if (session.buffer.length > 200000) {
      session.buffer = session.buffer.slice(-100000);
    }
    notifyWarmDialogueWaiters(session);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('exit', () => {
    session.exited = true;
    session.ready = false;
    warmDialogueSessions.delete(key);
    notifyWarmDialogueWaiters(session);
  });
  child.on('error', (error) => {
    session.exited = true;
    warmDialogueSessions.delete(key);
    session.buffer += `\n${error?.message || error}`;
    notifyWarmDialogueWaiters(session);
  });
  warmDialogueSessions.set(key, session);
  ensureWarmDialogueCleanupTimer();
  await waitForWarmDialoguePrompt(session, WARM_DIALOGUE_START_TIMEOUT_MS);
  return session;
}

async function getWarmDialogueSession(pack, input, llamaCliPath) {
  const key = makeWarmDialogueSessionKey(pack, input);
  const existing = warmDialogueSessions.get(key);
  if (existing && !existing.exited) {
    existing.lastUsed = Date.now();
    return existing;
  }
  if (existing) closeWarmDialogueSession(existing);
  return createWarmDialogueSession(key, pack, input, llamaCliPath);
}

function askWarmDialogueSession(session, message) {
  return new Promise((resolve, reject) => {
    if (session.exited || !session.child?.stdin?.writable) {
      reject(new Error('Warm dialogue process is not available.'));
      return;
    }
    const startedAt = session.buffer.length;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Warm dialogue response timed out.'));
    }, WARM_DIALOGUE_TURN_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      if (session.pendingTurn === turn) session.pendingTurn = null;
    };
    const turn = {
      check: () => {
        if (session.exited) {
          cleanup();
          reject(new Error('Warm dialogue process exited before answering.'));
          return;
        }
        const chunk = session.buffer.slice(startedAt);
        if (chunk.length > 8 && /\n>\s*$/.test(chunk)) {
          cleanup();
          resolve(cleanWarmDialogueOutput(chunk));
        }
      }
    };
    session.pendingTurn = turn;
    session.child.stdin.write(`/no_think\n${cleanDialogueText(message, 2000) || '[no speech detected]'}\n`);
    turn.check();
  });
}

async function runWarmDialogueGeneration(pack, input, llamaCliPath) {
  const session = await getWarmDialogueSession(pack, input, llamaCliPath);
  session.pending = session.pending.then(async () => {
    await waitForWarmDialoguePrompt(session, 1000);
    const message = input?.openingTurn
      ? 'The learner has just opened the speaking task. Start the conversation with one friendly short greeting and one simple first question. Do not wait for the learner to speak first.'
      : input?.latestStudentText || '';
    const responseText = await askWarmDialogueSession(session, message);
    session.lastUsed = Date.now();
    return {
      responseText,
      feedback: undefined,
      shouldEnd: false,
      warmSession: true
    };
  });
  return session.pending;
}

function closeWarmDialogueSession(session) {
  try {
    session.exited = true;
    session.child?.stdin?.write('/exit\n');
    session.child?.kill();
  } catch {
    // Process may already be gone.
  }
  warmDialogueSessions.delete(session.key);
}

function closeWarmDialogueSessions(sessionId = '', packId = '') {
  const wantedSessionId = String(sessionId || '');
  const wantedPackId = String(packId || '');
  for (const session of [...warmDialogueSessions.values()]) {
    if (wantedSessionId && session.sessionId !== wantedSessionId) continue;
    if (wantedPackId && session.packId !== wantedPackId) continue;
    closeWarmDialogueSession(session);
  }
}

function ensureWarmDialogueCleanupTimer() {
  if (warmDialogueCleanupTimer) return;
  warmDialogueCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const session of [...warmDialogueSessions.values()]) {
      if (now - session.lastUsed > WARM_DIALOGUE_IDLE_MS) {
        closeWarmDialogueSession(session);
      }
    }
    if (!warmDialogueSessions.size && warmDialogueCleanupTimer) {
      clearInterval(warmDialogueCleanupTimer);
      warmDialogueCleanupTimer = null;
    }
  }, 60 * 1000);
}

function closeAllWarmDialogueSessions() {
  for (const session of [...warmDialogueSessions.values()]) {
    closeWarmDialogueSession(session);
  }
  if (warmDialogueCleanupTimer) {
    clearInterval(warmDialogueCleanupTimer);
    warmDialogueCleanupTimer = null;
  }
}

function execFileText(filePath, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      filePath,
      args,
      {
        windowsHide: true,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        env: options.env
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message || 'Runtime failed.').trim()));
          return;
        }
        resolve(String(stdout || ''));
      }
    );
  });
}

function execRuntimeText(filePath, args, options = {}) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.js' || extension === '.cjs') {
    const nodePaths = [
      path.join(__dirname, '..', 'node_modules'),
      path.join(process.resourcesPath || '', 'app.asar', 'node_modules'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules')
    ].filter(Boolean);
    return execFileText(process.execPath, [filePath, ...args], {
      ...options,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: [process.env.NODE_PATH, ...nodePaths].filter(Boolean).join(path.delimiter),
        ...(options.env || {})
      }
    });
  }
  return execFileText(filePath, args, options);
}

async function convertAudioToWav(ffmpegPath, inputPath, outputPath) {
  await execFileText(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    outputPath
  ], {
    timeout: 5 * 60 * 1000,
    maxBuffer: 1024 * 1024
  });
}

function normalizeSttResult(value, fallbackLanguage) {
  const segments = Array.isArray(value?.segments)
    ? value.segments
      .map((segment) => ({
        text: String(segment?.text || ''),
        startSeconds: Math.max(0, Number(segment?.startSeconds) || 0),
        endSeconds: Math.max(0, Number(segment?.endSeconds) || 0),
        confidence: Number.isFinite(Number(segment?.confidence)) ? Number(segment.confidence) : undefined
      }))
      .filter((segment) => segment.text)
    : [];
  return {
    text: String(value?.text || segments.map((segment) => segment.text).join(' ')).trim(),
    language: String(value?.language || fallbackLanguage || ''),
    confidence: Number.isFinite(Number(value?.confidence)) ? Number(value.confidence) : undefined,
    segments
  };
}

async function installAiPackFolder(sourceFolder, operation, sourceName = '') {
  const packFolder = await resolveAiPackFolder(sourceFolder);
  const manifest = await readAiPackManifest(packFolder);
  const safeId = sanitizeName(manifest.id, 'ai-pack');
  const destination = path.join(getAiPacksRoot(), safeId);
  const sourceSize = await getDirectorySize(packFolder);
  operation.totalBytes = sourceSize;
  operation.transferredBytes = 0;
  operation.phase = 'Copying AI language pack';
  sendBookProgress(operation);
  await fsp.rm(destination, { recursive: true, force: true });
  await copyDirectoryWithProgress(packFolder, destination, operation);
  const installedManifest = await readAiPackManifest(destination);
  const item = makeAiPackRegistryItem(installedManifest, destination, await getDirectorySize(destination), sourceName || path.basename(packFolder));
  await upsertAiPackRegistryItem(item);
  return item;
}

async function installAiPackManifestFile(sourcePath) {
  const manifest = validateAiPackManifest(parseJsonText(await fsp.readFile(sourcePath, 'utf8')));
  const safeId = sanitizeName(manifest.id, 'ai-pack');
  const destination = path.join(getAiPacksRoot(), safeId);
  await fsp.rm(destination, { recursive: true, force: true });
  await fsp.mkdir(destination, { recursive: true });
  await fsp.writeFile(path.join(destination, AI_PACK_MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8');
  const item = makeAiPackRegistryItem(manifest, destination, await getDirectorySize(destination), path.basename(sourcePath));
  await upsertAiPackRegistryItem(item);
  return item;
}

async function getZipUncompressedSize(packagePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(packagePath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError) {
        reject(openError);
        return;
      }

      let total = 0;
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (!/\/$/.test(entry.fileName)) {
          total += Number(entry.uncompressedSize || 0);
        }
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve(total));
      zipfile.on('error', reject);
    });
  });
}

async function scanPdfProtectionAndPages(pdfPath) {
  return new Promise((resolve, reject) => {
    let count = 0;
    let encrypted = false;
    let carry = '';
    const stream = fs.createReadStream(pdfPath, { encoding: 'latin1' });
    stream.on('data', (chunk) => {
      const text = carry + chunk;
      if (text.includes('/Encrypt')) {
        encrypted = true;
      }
      const matches = text.match(/\/Type\s*\/Page\b/g);
      if (matches) {
        count += matches.length;
      }
      carry = text.slice(-32);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ encrypted, pageCount: Math.max(1, count) }));
  });
}

async function getPdfInfo(pdfPath) {
  const scan = await scanPdfProtectionAndPages(pdfPath);
  if (scan.encrypted) {
    return { encrypted: true, pageCount: scan.pageCount };
  }

  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ url: pdfPath, disableWorker: true }).promise;
    return { encrypted: false, pageCount: Math.max(1, doc.numPages) };
  } catch (error) {
    if (String(error?.name || '').includes('Password') || String(error?.message || '').toLowerCase().includes('password')) {
      return { encrypted: true, pageCount: scan.pageCount };
    }
    console.warn('PDF.js page count failed, falling back to stream scan:', error);
    return scan;
  }
}

async function generateFirstPageCover(pdfPath, bookFolder) {
  try {
    if (!nativeImage?.createThumbnailFromPath) {
      return '';
    }

    const thumbnail = await nativeImage.createThumbnailFromPath(pdfPath, { width: 420, height: 560 });
    if (!thumbnail || thumbnail.isEmpty()) {
      return '';
    }

    const coverPath = path.join(bookFolder, 'cover.png');
    await fsp.writeFile(coverPath, thumbnail.toPNG());
    return 'cover.png';
  } catch (error) {
    console.warn('Book first-page cover generation failed:', error?.message || error);
    return '';
  }
}

async function readBookJson(folderPath) {
  const jsonPath = path.join(folderPath, BOOK_JSON_FILE);
  const content = await fsp.readFile(jsonPath, 'utf8');
  return JSON.parse(content);
}

async function writeBookJson(folderPath, book) {
  await fsp.writeFile(path.join(folderPath, BOOK_JSON_FILE), JSON.stringify(book, null, 2), 'utf8');
}

function createBlankBookPage() {
  return {
    id: createId('page'),
    type: 'blank',
    backgroundColor: '#ffffff',
    elements: []
  };
}

function createPdfPages(pageCount, sourcePdf, idPrefix = 'page') {
  return Array.from({ length: pageCount }, (_unused, index) => ({
    id: createId(idPrefix),
    type: 'pdf',
    pdfPage: index + 1,
    sourcePdf,
    elements: []
  }));
}

function normalizeBookRelativePath(relativePath) {
  const raw = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw || raw.includes('\0')) {
    return '';
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    return '';
  }
  return normalized;
}

function collectRelativeAssetReferences(value, references = new Set()) {
  if (typeof value === 'string') {
    const normalized = normalizeBookRelativePath(value);
    if (normalized.startsWith('assets/')) {
      references.add(normalized);
    }
    return references;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectRelativeAssetReferences(item, references);
    }
    return references;
  }

  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      collectRelativeAssetReferences(nested, references);
    }
  }
  return references;
}

function collectBookAssetReferences(book) {
  const references = collectRelativeAssetReferences(book);
  const sourcePdf = normalizeBookRelativePath(book?.sourcePdf);
  const cover = normalizeBookRelativePath(book?.cover);
  if (sourcePdf && sourcePdf.startsWith('assets/')) references.add(sourcePdf);
  if (cover && cover.startsWith('assets/')) references.add(cover);
  if (Array.isArray(book?.workbooks)) {
    for (const workbook of book.workbooks) {
      const workbookSourcePdf = normalizeBookRelativePath(workbook?.sourcePdf);
      if (workbookSourcePdf && workbookSourcePdf.startsWith('assets/')) references.add(workbookSourcePdf);
    }
  }
  for (const page of collectBookPages(book)) {
    const pageSourcePdf = normalizeBookRelativePath(page?.sourcePdf);
    if (pageSourcePdf && pageSourcePdf.startsWith('assets/')) references.add(pageSourcePdf);
  }
  return references;
}

async function listAssetFiles(folderPath) {
  const assetsRoot = path.join(folderPath, 'assets');
  if (!(await pathExists(assetsRoot))) return [];
  const files = [];
  async function walk(dirPath, relativeBase) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      const relativePath = path.posix.join('assets', relativeBase, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath, path.posix.join(relativeBase, entry.name));
      } else if (entry.isFile()) {
        files.push({ absolutePath: entryPath, relativePath });
      }
    }
  }
  await walk(assetsRoot, '');
  return files;
}

async function removeEmptyAssetFolders(folderPath) {
  const assetsRoot = path.join(folderPath, 'assets');
  if (!(await pathExists(assetsRoot))) return;
  async function walk(dirPath) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(path.join(dirPath, entry.name));
      }
    }
    if (dirPath !== assetsRoot) {
      const remaining = await fsp.readdir(dirPath);
      if (remaining.length === 0) {
        await fsp.rmdir(dirPath).catch(() => {});
      }
    }
  }
  await walk(assetsRoot);
}

async function pruneUnusedBookAssets(book, folderPath) {
  const references = collectBookAssetReferences(book);
  const files = await listAssetFiles(folderPath);
  for (const file of files) {
    if (references.has(file.relativePath)) continue;
    await fsp.rm(file.absolutePath, { force: true }).catch(() => {});
  }
  await removeEmptyAssetFolders(folderPath);
}

function collectBookPages(book) {
  const pages = Array.isArray(book?.pages) ? [...book.pages] : [];
  const workbooks = Array.isArray(book?.workbooks) ? book.workbooks : [];
  for (const workbook of workbooks) {
    if (Array.isArray(workbook?.pages)) {
      pages.push(...workbook.pages);
    }
  }
  return pages;
}

async function listBookPdfAssets(folderPath) {
  const assetsRoot = path.join(folderPath, 'assets');
  if (!(await pathExists(assetsRoot))) {
    return [];
  }

  const pdfs = [];
  async function walk(dirPath, relativeBase) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      const relativePath = path.posix.join(relativeBase, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath, relativePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        pdfs.push(path.posix.join('assets', relativePath));
      }
    }
  }

  await walk(assetsRoot, '');
  return pdfs.sort((a, b) => {
    const aSource = path.posix.basename(a).toLowerCase() === 'source.pdf' ? 0 : 1;
    const bSource = path.posix.basename(b).toLowerCase() === 'source.pdf' ? 0 : 1;
    return aSource - bSource || a.localeCompare(b);
  });
}

function collectPageAssetPrefixes(page) {
  const references = Array.from(collectRelativeAssetReferences(page?.elements || []));
  return references
    .map((reference) => reference.split('/').slice(0, -1).join('/'))
    .filter(Boolean);
}

async function repairMissingPageSourcePdfs(book, folderPath) {
  if (!book || !Array.isArray(book.pages)) {
    return false;
  }

  const sourcePdf = normalizeBookRelativePath(book.sourcePdf);
  if (sourcePdf && (await pathExists(path.join(folderPath, sourcePdf)))) {
    return false;
  }

  const missingPdfPages = book.pages.filter((page) => page?.type === 'pdf' && !page.sourcePdf);
  if (!missingPdfPages.length) {
    return false;
  }

  const availablePdfs = await listBookPdfAssets(folderPath);
  if (!availablePdfs.length) {
    return false;
  }

  if (availablePdfs.length === 1) {
    for (const page of missingPdfPages) {
      page.sourcePdf = availablePdfs[0];
    }
    return true;
  }

  const segments = [];
  let currentSegment = null;
  let lastPdfPage = 0;
  for (const [index, page] of book.pages.entries()) {
    if (page?.type !== 'pdf' || page.sourcePdf) {
      continue;
    }

    const pdfPage = Number(page.pdfPage || 0);
    if (!currentSegment || (lastPdfPage > 0 && pdfPage > 0 && pdfPage <= lastPdfPage)) {
      currentSegment = { indexes: [], hints: new Set() };
      segments.push(currentSegment);
    }

    currentSegment.indexes.push(index);
    for (const hint of collectPageAssetPrefixes(page)) {
      currentSegment.hints.add(hint);
    }
    if (pdfPage > 0) {
      lastPdfPage = pdfPage;
    }
  }

  const used = new Set();
  let changed = false;
  for (const segment of segments) {
    const hints = Array.from(segment.hints);
    let candidates = hints.length
      ? availablePdfs.filter((pdf) => hints.some((hint) => pdf.startsWith(`${hint}/`)))
      : availablePdfs;

    if (!candidates.length) {
      candidates = availablePdfs;
    }

    const unusedCandidates = candidates.filter((pdf) => !used.has(pdf));
    if (unusedCandidates.length) {
      candidates = unusedCandidates;
    }

    const chosen = candidates.find((pdf) => path.posix.basename(pdf).toLowerCase() === 'source.pdf') || candidates[0];
    if (!chosen) {
      continue;
    }

    used.add(chosen);
    for (const index of segment.indexes) {
      book.pages[index].sourcePdf = chosen;
      changed = true;
    }
  }

  return changed;
}

async function repairBookData(book, folderPath) {
  let changed = false;
  if (await repairMissingPageSourcePdfs(book, folderPath)) {
    changed = true;
  }
  return changed;
}

async function validateBookFolder(folderPath, options = {}) {
  const label = options.label || 'This book';
  const jsonPath = path.join(folderPath, BOOK_JSON_FILE);
  if (!(await pathExists(jsonPath))) {
    throw new Error(`${label} does not contain ${BOOK_JSON_FILE}.`);
  }

  let book;
  try {
    book = await readBookJson(folderPath);
  } catch {
    throw new Error(`${label} has a broken ${BOOK_JSON_FILE}.`);
  }

  return validateBookData(book, folderPath, label, options);
}

async function validateBookData(book, folderPath, label = 'This book', options = {}) {
  if (!book || typeof book !== 'object') {
    throw new Error(`${label} is not a valid book.`);
  }
  if (!Array.isArray(book.pages)) {
    throw new Error(`${label} does not have a valid pages list.`);
  }
  if (book.pages.length < 1) {
    throw new Error(`${label} must contain at least one page.`);
  }

  if (options.repair !== false && await repairBookData(book, folderPath)) {
    await writeBookJson(folderPath, book);
  }

  const allPages = collectBookPages(book);
  const pdfPages = allPages.filter((page) => page?.type === 'pdf');
  const sourcePdf = normalizeBookRelativePath(book.sourcePdf);
  if (sourcePdf && !(await pathExists(path.join(folderPath, sourcePdf)))) {
    throw new Error(`${label} is missing source PDF: ${sourcePdf}.`);
  }
  if (Array.isArray(book.workbooks)) {
    for (const workbook of book.workbooks) {
      const workbookSourcePdf = normalizeBookRelativePath(workbook?.sourcePdf);
      if (workbookSourcePdf && !(await pathExists(path.join(folderPath, workbookSourcePdf)))) {
        throw new Error(`${label} is missing workbook PDF: ${workbookSourcePdf}.`);
      }
    }
  }
  for (const page of pdfPages) {
    const pageSourcePdf = normalizeBookRelativePath(page.sourcePdf || sourcePdf);
    if (!pageSourcePdf) {
      throw new Error(`${label} has PDF pages but no sourcePdf path.`);
    }
    if (!(await pathExists(path.join(folderPath, pageSourcePdf)))) {
      throw new Error(`${label} is missing source PDF: ${pageSourcePdf}.`);
    }
  }

  const cover = normalizeBookRelativePath(book.cover);
  if (cover && !(await pathExists(path.join(folderPath, cover)))) {
    throw new Error(`${label} is missing cover file: ${cover}.`);
  }

  const references = collectRelativeAssetReferences(allPages);
  for (const relativePath of references) {
    if (!(await pathExists(path.join(folderPath, relativePath)))) {
      throw new Error(`${label} is missing asset: ${relativePath}.`);
    }
  }

  return { book, references: Array.from(references) };
}

async function readBookAnnotations(folderPath, bookId) {
  const annotationsPath = path.join(folderPath, BOOK_ANNOTATIONS_FILE);
  try {
    const content = await fsp.readFile(annotationsPath, 'utf8');
    const annotations = JSON.parse(content);
    return {
      version: '1.0',
      bookId,
      pages: annotations && typeof annotations.pages === 'object' ? annotations.pages : {},
      updatedAt: annotations.updatedAt || new Date().toISOString()
    };
  } catch {
    return {
      version: '1.0',
      bookId,
      pages: {},
      updatedAt: new Date().toISOString()
    };
  }
}

async function writeBookAnnotations(folderPath, annotations, bookId) {
  const safeAnnotations = {
    version: '1.0',
    bookId,
    pages: annotations && typeof annotations.pages === 'object' ? annotations.pages : {},
    updatedAt: new Date().toISOString()
  };
  await fsp.writeFile(
    path.join(folderPath, BOOK_ANNOTATIONS_FILE),
    JSON.stringify(safeAnnotations, null, 2),
    'utf8'
  );
}

function makeRegistryItem(book, folderPath, sizeBytes) {
  return {
    id: book.id,
    title: book.title || 'Untitled Book',
    folderPath,
    coverPath: book.cover,
    pageCount: Array.isArray(book.pages) ? book.pages.length : 0,
    sizeBytes,
    createdAt: book.createdAt || new Date().toISOString(),
    updatedAt: book.updatedAt || new Date().toISOString()
  };
}

function getCachedSizeBytes(registryItem) {
  const size = Number(registryItem?.sizeBytes);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function hasRemovedBookAssetReferences(previousBook, nextBook) {
  const previousReferences = collectBookAssetReferences(previousBook);
  const nextReferences = collectBookAssetReferences(nextBook);
  for (const reference of previousReferences) {
    if (!nextReferences.has(reference)) {
      return true;
    }
  }
  return false;
}

async function updateRegistrySizeByDelta(registryItem, deltaBytes) {
  const current = await readBookJson(registryItem.folderPath);
  const cachedSize = getCachedSizeBytes(registryItem);
  const delta = Number(deltaBytes) || 0;
  const sizeBytes = cachedSize === null
    ? await getDirectorySize(registryItem.folderPath)
    : Math.max(0, cachedSize + delta);
  await upsertRegistryItem(makeRegistryItem(current, registryItem.folderPath, sizeBytes));
}

async function repairBookRegistryItems(items) {
  let changed = false;
  const repaired = [];

  for (const item of items) {
    let next = item;
    try {
      if (!item?.folderPath || !(await pathExists(path.join(item.folderPath, BOOK_JSON_FILE)))) {
        repaired.push(item);
        continue;
      }

      const book = await readBookJson(item.folderPath);
      const bookChanged = await repairBookData(book, item.folderPath);
      let coverChanged = false;
      let cover = normalizeBookRelativePath(book.cover);
      const hasCover = cover && (await pathExists(path.join(item.folderPath, cover)));

      if (!hasCover) {
        const firstPdfPage = Array.isArray(book.pages)
          ? book.pages.find((page) => page?.type === 'pdf')
          : null;
        const sourcePdf = normalizeBookRelativePath(firstPdfPage?.sourcePdf || book.sourcePdf);
        if (sourcePdf && (await pathExists(path.join(item.folderPath, sourcePdf)))) {
          cover = await generateFirstPageCover(path.join(item.folderPath, sourcePdf), item.folderPath);
          if (cover) {
            book.cover = cover;
            coverChanged = true;
          }
        }
      }

      if (bookChanged || coverChanged) {
        await writeBookJson(item.folderPath, book);
      }

      const pageCount = Array.isArray(book.pages) ? book.pages.length : item.pageCount || 0;
      next = {
        ...item,
        id: book.id || item.id,
        title: book.title || item.title || 'Untitled Book',
        coverPath: cover || undefined,
        pageCount,
        createdAt: book.createdAt || item.createdAt || new Date().toISOString(),
        updatedAt: book.updatedAt || item.updatedAt || new Date().toISOString()
      };

      if (
        next.id !== item.id ||
        next.title !== item.title ||
        next.coverPath !== item.coverPath ||
        next.pageCount !== item.pageCount ||
        next.createdAt !== item.createdAt ||
        next.updatedAt !== item.updatedAt
      ) {
        changed = true;
      }
    } catch (error) {
      console.warn('Book registry repair skipped:', item?.title || item?.id, error?.message || error);
    }

    repaired.push(next);
  }

  return { items: repaired, changed };
}

function rewriteRelativeAssetPaths(value, assetPrefix) {
  if (typeof value === 'string') {
    return value.startsWith('assets/') ? `assets/${assetPrefix}/${value.slice('assets/'.length)}` : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteRelativeAssetPaths(item, assetPrefix));
  }
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, nested] of Object.entries(value)) {
      next[key] = rewriteRelativeAssetPaths(nested, assetPrefix);
    }
    return next;
  }
  return value;
}

function encodeBookAssetUrl(bookId, relativePath) {
  const encodedPath = String(relativePath || '')
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `noprep-book://${encodeURIComponent(String(bookId || ''))}/${encodedPath}`;
}

function findBookSync(bookId) {
  try {
    const content = fs.existsSync(getRegistryPath()) ? fs.readFileSync(getRegistryPath(), 'utf8') : '[]';
    const registry = JSON.parse(content);
    return Array.isArray(registry)
      ? registry.find((item) => item.id === String(bookId || '')) || null
      : null;
  } catch {
    return null;
  }
}

function resolveBookAssetPath(bookId, relativePath) {
  const book = findBookSync(bookId);
  if (!book) {
    return null;
  }

  const normalizedPath = normalizeBookRelativePath(relativePath);
  if (!normalizedPath) {
    return null;
  }

  const resolved = path.resolve(book.folderPath, normalizedPath);
  const root = path.resolve(book.folderPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  try {
    const realRoot = fs.realpathSync.native(root);
    const realResolved = fs.realpathSync.native(resolved);
    const realRelative = path.relative(realRoot, realResolved);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      return null;
    }
    return realResolved;
  } catch {
    return null;
  }
}

function registerBookAssetProtocol() {
  protocol.handle('noprep-book', (request) => {
    try {
      const parsed = new URL(request.url);
      const bookId = decodeURIComponent(parsed.hostname);
      const relativePath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      const resolved = resolveBookAssetPath(bookId, relativePath);
      if (!resolved) {
        return new Response('Book asset not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(resolved).toString());
    } catch {
      return new Response('Invalid book asset URL', { status: 400 });
    }
  });
}

function resetRendererZoom() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  } catch {
    // Zoom reset is best-effort and must not block startup.
  }
}

function isTrustedAppPermissionUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || mainWindow?.webContents?.getURL?.() || ''));
    if (parsed.protocol === 'file:') {
      return true;
    }
    const devUrl = process.env.ELECTRON_START_URL ? new URL(process.env.ELECTRON_START_URL) : null;
    if (devUrl && parsed.protocol === devUrl.protocol && parsed.port === devUrl.port) {
      return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
    }
  } catch {
    return false;
  }
  return false;
}

function isTrustedMediaPermissionRequest(webContents, permission, details) {
  const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
  const wantsAudio = permission === 'media' || permission === 'microphone' || mediaTypes.includes('audio');
  if (!wantsAudio || webContents !== mainWindow?.webContents) {
    return false;
  }
  return isTrustedAppPermissionUrl(details?.requestingUrl || details?.securityOrigin || details?.embeddingOrigin);
}

function notifyRendererLayoutChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  resetRendererZoom();
  mainWindow.webContents.send('layout-changed');
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const isDev = !!process.env.ELECTRON_START_URL;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreenable: true,
    webPreferences: {
      allowRunningInsecureContent: false,
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
      webSecurity: true,
      preload: preloadPath
    },
  });

  mainWindow.webContents.on('did-finish-load', () => {
    resetRendererZoom();
    notifyRendererLayoutChanged();
  });
  mainWindow.webContents.on('zoom-changed', (event) => {
    event.preventDefault();
    resetRendererZoom();
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && ['+', '-', '=', '0'].includes(input.key)) {
      event.preventDefault();
      resetRendererZoom();
    }
  });
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isTrustedMediaPermissionRequest(webContents, permission, details));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return isTrustedMediaPermissionRequest(webContents, permission, {
      ...(details || {}),
      requestingUrl: details?.requestingUrl || requestingOrigin
    });
  });
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        '*://*.youtube.com/*',
        '*://*.youtube-nocookie.com/*',
        '*://*.googlevideo.com/*',
        '*://*.ytimg.com/*'
      ]
    },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      requestHeaders.Referer = 'https://www.youtube.com/';
      callback({ requestHeaders });
    }
  );

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' noprep-book:; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' noprep-book: data: blob: https://i.ytimg.com https://*.ytimg.com; " +
          "media-src 'self' noprep-book: blob: data:; " +
          "frame-src https://www.youtube-nocookie.com https://www.youtube.com; " +
          "connect-src 'self' noprep-book: blob:; " +
          "font-src 'self' data:; " +
          "object-src 'none';"
        ]
      }
    });
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const ALLOWED_EXTERNAL_HOSTS = new Set([
    'www.youtube.com', 'youtube.com', 'youtu.be',
    'www.youtube-nocookie.com', 'youtube-nocookie.com'
  ]);

  // Open whitelisted external URLs in the system browser
  ipcMain.handle('open-external-url', (_event, url) => {
    try {
      const parsed = new URL(String(url ?? ''));
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
        shell.openExternal(parsed.href);
      }
    } catch {
      // Ignore malformed URLs
    }
  });
  ipcMain.handle('app:toggle-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    notifyRendererLayoutChanged();
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('app:set-fullscreen', (_event, active) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    mainWindow.setFullScreen(!!active);
    notifyRendererLayoutChanged();
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('app:is-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('app:capture-page-screenshot', async (_event, input) => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return operationError('WINDOW_UNAVAILABLE', 'The app window is not available.');
      }

      const bounds = mainWindow.getContentBounds();
      const x = Math.max(0, Math.min(bounds.width - 1, Math.round(Number(input?.x || 0))));
      const y = Math.max(0, Math.min(bounds.height - 1, Math.round(Number(input?.y || 0))));
      const width = Math.max(1, Math.min(bounds.width - x, Math.round(Number(input?.width || bounds.width))));
      const height = Math.max(1, Math.min(bounds.height - y, Math.round(Number(input?.height || bounds.height))));
      const image = await mainWindow.webContents.capturePage({ x, y, width, height });
      const screenshotsDir = path.join(app.getPath('desktop'), 'No-Prep Screenshots');
      await fsp.mkdir(screenshotsDir, { recursive: true });
      const requestedName = sanitizeName(String(input?.fileName || 'NoPrep page.png'), 'NoPrep page.png');
      const baseName = requestedName.toLowerCase().endsWith('.png') ? requestedName.slice(0, -4) : requestedName;
      const filePath = path.join(screenshotsDir, `${baseName}-${Date.now()}.png`);
      await fsp.writeFile(filePath, image.toPNG());
      return operationResult({ filePath });
    } catch (error) {
      console.error('app:capture-page-screenshot error:', error);
      return operationError('SCREENSHOT_FAILED', error?.message || 'Could not save screenshot.');
    }
  });
  ipcMain.handle('books:confirm-unsaved-changes', async (_event, input) => {
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: input?.title || 'Unsaved book changes',
      message: input?.message || 'This book has unsaved changes.',
      detail: input?.detail || 'Do you want to save before leaving the create book page?',
      buttons: [input?.saveLabel || 'Save', input?.dontSaveLabel || "Don't Save", input?.cancelLabel || 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    return response.response === 0 ? 'save' : response.response === 1 ? 'discard' : 'cancel';
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDev = !!process.env.ELECTRON_START_URL;
    if (!isDev && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL);
  } else {
    // Correct path: from electron/index.js go up one level to dist/no-prep/browser/index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/no-prep/browser/index.html'));
  }

  ['resize', 'resized', 'maximize', 'unmaximize', 'restore', 'show', 'focus'].forEach((eventName) => {
    mainWindow.on(eventName, notifyRendererLayoutChanged);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  registerBookAssetProtocol();
  createWindow();
});

app.on('window-all-closed', () => {
  closeAllWarmDialogueSessions();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  closeAllWarmDialogueSessions();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// IPC Handlers
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

const ALLOWED_SECURE_FEATURES = new Set(['ai', 'editing', 'export', 'import', 'premium']);

ipcMain.handle('run-secure-feature', async (event, featureName, input) => {
  if (typeof featureName !== 'string' || !ALLOWED_SECURE_FEATURES.has(featureName)) {
    return { ok: false, error: 'INVALID_FEATURE' };
  }
  return runSecureFeature(featureName, input ?? {});
});

ipcMain.handle('books:get-registry', async () => {
  try {
    const registry = await readRegistry();
    const repaired = await repairBookRegistryItems(registry);
    if (repaired.changed) {
      await writeRegistry(repaired.items);
    }
    return operationResult(repaired.items);
  } catch (error) {
    console.error('books:get-registry error:', error);
    return operationError('REGISTRY_ERROR', 'Could not load books.');
  }
});

ipcMain.handle('ai-packs:list', async () => {
  try {
    return operationResult(await readAiPackRegistry());
  } catch (error) {
    console.error('ai-packs:list error:', error);
    return operationError('AI_PACKS_READ_FAILED', 'Could not load AI language packs.');
  }
});

ipcMain.handle('ai-packs:import', async () => {
  const operationId = createId('ai-pack');
  let tempFolder = '';
  try {
    sendBookProgress(makeBookProgress(operationId, 'import', 'Choose AI language pack'));
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose AI language pack',
      filters: [
        { name: 'NoPrep AI Packs', extensions: ['json', 'noprep-ai-pack', 'zip'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile', 'openDirectory']
    });

    if (selected.canceled || !selected.filePaths?.[0]) {
      sendBookProgress(null);
      return operationError('CANCELLED');
    }

    const sourcePath = selected.filePaths[0];
    const stat = await fsp.stat(sourcePath);
    await ensureAiPacksRoot();

    if (stat.isDirectory()) {
      const operation = makeBookProgress(operationId, 'import', 'Checking AI language pack');
      const item = await installAiPackFolder(sourcePath, operation);
      sendBookProgress(null);
      return operationResult(item);
    }

    const extension = path.extname(sourcePath).toLowerCase();
    if (extension === '.json' || extension === '.noprep-ai-pack') {
      const item = await installAiPackManifestFile(sourcePath);
      sendBookProgress(null);
      return operationResult(item);
    }

    if (extension === '.zip') {
      const uncompressedSize = await getZipUncompressedSize(sourcePath);
      const operation = makeBookProgress(operationId, 'import', 'Extracting AI language pack', 0, uncompressedSize);
      tempFolder = path.join(getAiPacksRoot(), `${createId('ai-pack')}-importing`);
      await fsp.rm(tempFolder, { recursive: true, force: true });
      await extractZipPackage(sourcePath, tempFolder, operation);
      const item = await installAiPackFolder(tempFolder, operation, path.basename(sourcePath));
      await fsp.rm(tempFolder, { recursive: true, force: true });
      sendBookProgress(null);
      return operationResult(item);
    }

    sendBookProgress(null);
    return operationError('UNSUPPORTED_AI_PACK', 'Choose an AI pack folder, manifest JSON, or zip package.');
  } catch (error) {
    sendBookProgress(null);
    if (tempFolder) {
      await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
    }
    console.error('ai-packs:import error:', error);
    return operationError('AI_PACK_IMPORT_FAILED', error?.message || 'Could not import this AI language pack.');
  }
});

ipcMain.handle('ai-packs:remove', async (_event, input) => {
  try {
    const packId = String(input?.packId || '');
    const registry = await readAiPackRegistry();
    const pack = registry.find((item) => item.id === packId);
    if (!pack) {
      return operationError('AI_PACK_NOT_FOUND', 'AI language pack not found.');
    }
    await fsp.rm(pack.folderPath, { recursive: true, force: true });
    await removeAiPackRegistryItem(packId);
    return operationResult(null);
  } catch (error) {
    console.error('ai-packs:remove error:', error);
    return operationError('AI_PACK_REMOVE_FAILED', 'Could not remove this AI language pack.');
  }
});

ipcMain.handle('ai-speaking:get-runtime-status', async (_event, input) => {
  try {
    const packId = String(input?.packId || '');
    const language = String(input?.language || '').trim().toLowerCase();
    const registry = await readAiPackRegistry();
    const pack = findAiPack(registry, packId, language);
    if (!pack) {
      return operationError('AI_PACK_NOT_FOUND', 'AI language pack not found.');
    }
    const missingRuntimeFiles = await getMissingAiPackRuntimeFiles(pack);
    const runtime = await getAiRuntimeAvailability(pack);
    return operationResult({
      platform: 'electron',
      packId: pack.id,
      language: pack.language,
      recordingAvailable: true,
      speechToTextAvailable: !!runtime.runtimeReady.stt && runtime.sttRunnerAvailable && runtime.ffmpegAvailable,
      textToSpeechAvailable: !!runtime.runtimeReady.tts && runtime.ttsRunnerAvailable,
      dialogueAvailable: !!runtime.runtimeReady.dialogue && runtime.dialogueRunnerAvailable && runtime.llamaCliAvailable,
      conversationAvailable: !!runtime.runtimeReady.stt
        && runtime.sttRunnerAvailable
        && runtime.ffmpegAvailable
        && !!runtime.runtimeReady.tts
        && runtime.ttsRunnerAvailable
        && !!runtime.runtimeReady.dialogue
        && runtime.dialogueRunnerAvailable
        && runtime.llamaCliAvailable,
      missingRuntimeFiles,
      sttRunnerAvailable: runtime.sttRunnerAvailable,
      sttRunnerPath: runtime.sttRunnerPath,
      ttsRunnerAvailable: runtime.ttsRunnerAvailable,
      ttsRunnerPath: runtime.ttsRunnerPath,
      dialogueRunnerAvailable: runtime.dialogueRunnerAvailable,
      dialogueRunnerPath: runtime.dialogueRunnerPath,
      llamaCliAvailable: runtime.llamaCliAvailable,
      llamaCliPath: runtime.llamaCliPath,
      ffmpegAvailable: runtime.ffmpegAvailable,
      ffmpegPath: runtime.ffmpegPath,
      reason: missingRuntimeFiles.length
        ? `AI pack is missing runtime files: ${missingRuntimeFiles.slice(0, 3).join(', ')}${missingRuntimeFiles.length > 3 ? '...' : ''}`
        : !runtime.sttRunnerAvailable
          ? `STT runner is not installed in ${getAiRuntimesRoot()}.`
        : !runtime.ffmpegAvailable
          ? `ffmpeg is not installed. Checked: ${getFfmpegPath().join(', ')}.`
        : !runtime.ttsRunnerAvailable && runtime.runtimeReady.tts
          ? `TTS runner is not installed in ${getAiRuntimesRoot()}.`
        : !runtime.dialogueRunnerAvailable && runtime.runtimeReady.dialogue
          ? `Dialogue runner is not installed in ${getAiRuntimesRoot()}.`
        : !runtime.llamaCliAvailable && runtime.runtimeReady.dialogue
          ? `llama.cpp CLI is not installed. Checked: ${getLlamaCliPath().join(', ')}.`
        : 'Electron offline AI runtime bridge is ready.'
    });
  } catch (error) {
    console.error('ai-speaking:get-runtime-status error:', error);
    return operationError('AI_SPEAKING_RUNTIME_FAILED', 'Could not check AI speaking runtime.');
  }
});

ipcMain.handle('ai-speaking:transcribe-audio', async (_event, input) => {
  try {
    const packId = String(input?.packId || '');
    const language = String(input?.language || '').trim().toLowerCase();
    const registry = await readAiPackRegistry();
    const pack = findAiPack(registry, packId, language);
    if (!pack) {
      return operationError('AI_PACK_NOT_FOUND', 'AI language pack not found.');
    }
    const result = await runSttTranscription(pack, input);
    return operationResult(result);
  } catch (error) {
    console.error('ai-speaking:transcribe-audio error:', error);
    return operationError('AI_STT_FAILED', error?.message || 'Offline speech recognition failed.');
  }
});

ipcMain.handle('ai-speaking:generate-response', async (_event, input) => {
  try {
    const config = input?.config && typeof input.config === 'object' ? input.config : {};
    const packId = String(input?.packId || config.packId || '');
    const language = String(input?.language || config.language || '').trim().toLowerCase();
    const registry = await readAiPackRegistry();
    const pack = findAiPack(registry, packId, language);
    if (!pack) {
      return operationError('AI_PACK_NOT_FOUND', 'AI language pack not found.');
    }
    const result = await runDialogueGeneration(pack, input);
    return operationResult(result);
  } catch (error) {
    console.error('ai-speaking:generate-response error:', error);
    return operationError('AI_DIALOGUE_FAILED', error?.message || 'Offline dialogue generation failed.');
  }
});

ipcMain.handle('ai-speaking:close-dialogue-session', async (_event, input) => {
  try {
    closeWarmDialogueSessions(String(input?.sessionId || ''), String(input?.packId || ''));
    return operationResult(null);
  } catch (error) {
    console.error('ai-speaking:close-dialogue-session error:', error);
    return operationError('AI_DIALOGUE_CLOSE_FAILED', 'Could not close offline dialogue session.');
  }
});

ipcMain.handle('ai-speaking:synthesize-speech', async (_event, input) => {
  try {
    const packId = String(input?.packId || '');
    const language = String(input?.language || '').trim().toLowerCase();
    const registry = await readAiPackRegistry();
    const pack = findAiPack(registry, packId, language);
    if (!pack) {
      return operationError('AI_PACK_NOT_FOUND', 'AI language pack not found.');
    }
    const result = await runTtsSynthesis(pack, input);
    return operationResult(result);
  } catch (error) {
    console.error('ai-speaking:synthesize-speech error:', error);
    return operationError('AI_TTS_FAILED', error?.message || 'Offline text-to-speech failed.');
  }
});

ipcMain.handle('books:create-empty', async (_event, input) => {
  try {
    const now = new Date().toISOString();
    const bookId = createId('book');
    const title = sanitizeName(input?.title, 'Untitled Book');
    const bookFolder = path.join(getBooksRoot(), bookId);
    await fsp.mkdir(path.join(bookFolder, 'assets'), { recursive: true });

    const book = {
      version: '1.0',
      id: bookId,
      title,
      pages: [createBlankBookPage()],
      workbooks: [],
      workbookLinks: {},
      createdAt: now,
      updatedAt: now
    };
    await writeBookJson(bookFolder, book);
    const sizeBytes = await getDirectorySize(bookFolder);
    const item = await upsertRegistryItem(makeRegistryItem(book, bookFolder, sizeBytes));
    return operationResult(item);
  } catch (error) {
    console.error('books:create-empty error:', error);
    return operationError('CREATE_FAILED', error?.message || 'Could not create this book.');
  }
});

ipcMain.handle('books:create-from-pdf', async (_event, input) => {
  const operationId = createId('create');
  try {
    sendBookProgress(makeBookProgress(operationId, 'create', 'Choose PDF'));
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose PDF',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile']
    });

    if (selected.canceled || !selected.filePaths?.[0]) {
      sendBookProgress(null);
      return operationError('CANCELLED');
    }

    const sourcePdf = selected.filePaths[0];
    sendBookProgress(makeBookProgress(operationId, 'create', 'Checking PDF'));
    const pdfInfo = await getPdfInfo(sourcePdf);
    if (pdfInfo.encrypted) {
      sendBookProgress(null);
      return operationError('PROTECTED_PDF', 'This PDF is protected. Please use an unlocked PDF.');
    }

    const now = new Date().toISOString();
    const bookId = createId('book');
    const title = sanitizeName(input?.title, path.basename(sourcePdf, path.extname(sourcePdf)));
    const bookFolder = path.join(getBooksRoot(), bookId);
    const assetsFolder = path.join(bookFolder, 'assets');
    const pdfDestination = path.join(assetsFolder, 'source.pdf');
    const sourceStat = await fsp.stat(sourcePdf);
    sendBookProgress(makeBookProgress(operationId, 'create', 'Checking disk space', 0, sourceStat.size));
    await ensureEnoughSpace(bookFolder, sourceStat.size);
    sendBookProgress(makeBookProgress(operationId, 'create', 'Waiting for confirmation', 0, sourceStat.size));
    if (!(await confirmBookFileOperation('Create book from PDF', sourceStat.size, bookFolder))) {
      sendBookProgress(null);
      return operationError('CANCELLED');
    }

    const operation = {
      operationId,
      type: 'create',
      phase: 'Copying PDF',
      transferredBytes: 0,
      totalBytes: sourceStat.size
    };
    sendBookProgress(operation);
    await fsp.mkdir(assetsFolder, { recursive: true });
    await copyFileWithProgress(sourcePdf, pdfDestination, operation);
    const cover = await generateFirstPageCover(pdfDestination, bookFolder);

    const pages = createPdfPages(pdfInfo.pageCount, 'assets/source.pdf');

    const book = {
      version: '1.0',
      id: bookId,
      title,
      sourcePdf: 'assets/source.pdf',
      cover,
      pages,
      createdAt: now,
      updatedAt: now
    };
    await writeBookJson(bookFolder, book);
    const sizeBytes = await getDirectorySize(bookFolder);
    const item = await upsertRegistryItem(makeRegistryItem(book, bookFolder, sizeBytes));
    sendBookProgress(null);
    return operationResult(item);
  } catch (error) {
    sendBookProgress(null);
    console.error('books:create-from-pdf error:', error);
    return operationError('CREATE_FAILED', error?.message || 'Could not create this book.');
  }
});

ipcMain.handle('books:replace-main-pdf', async (_event, input) => {
  const operationId = createId('create');
  try {
    const registryItem = await findBook(String(input?.bookId ?? ''));
    if (!registryItem) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    sendBookProgress(makeBookProgress(operationId, 'create', 'Choose student book PDF'));
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose student book PDF',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile']
    });

    if (selected.canceled || !selected.filePaths?.[0]) {
      sendBookProgress(null);
      return operationError('CANCELLED');
    }

    const sourcePdf = selected.filePaths[0];
    sendBookProgress(makeBookProgress(operationId, 'create', 'Checking student book PDF'));
    const pdfInfo = await getPdfInfo(sourcePdf);
    if (pdfInfo.encrypted) {
      sendBookProgress(null);
      return operationError('PROTECTED_PDF', 'This PDF is protected. Please use an unlocked PDF.');
    }

    const sourceStat = await fsp.stat(sourcePdf);
    sendBookProgress(makeBookProgress(operationId, 'create', 'Checking disk space', 0, sourceStat.size));
    await ensureEnoughSpace(registryItem.folderPath, sourceStat.size);
    sendBookProgress(makeBookProgress(operationId, 'create', 'Waiting for confirmation', 0, sourceStat.size));
    if (!(await confirmBookFileOperation('Add student book PDF', sourceStat.size, registryItem.folderPath))) {
      sendBookProgress(null);
      return operationError('CANCELLED');
    }

    const now = new Date().toISOString();
    const book = await readBookJson(registryItem.folderPath);
    const relativePdfPath = 'assets/source.pdf';
    const destination = path.join(registryItem.folderPath, relativePdfPath);
    const operation = {
      operationId,
      type: 'create',
      phase: 'Copying student book PDF',
      transferredBytes: 0,
      totalBytes: sourceStat.size
    };
    sendBookProgress(operation);
    await copyFileWithProgress(sourcePdf, destination, operation);

    book.title = book.title && book.title !== 'Untitled Book'
      ? book.title
      : sanitizeName(path.basename(sourcePdf, path.extname(sourcePdf)), 'Student Book');
    book.sourcePdf = relativePdfPath;
    book.cover = await generateFirstPageCover(destination, registryItem.folderPath);
    book.pages = createPdfPages(pdfInfo.pageCount, relativePdfPath);
    book.workbookLinks = {};
    book.updatedAt = now;
    await validateBookData(book, registryItem.folderPath, book.title || 'Book');
    await writeBookJson(registryItem.folderPath, book);
    const sizeBytes = await getDirectorySize(registryItem.folderPath);
    await upsertRegistryItem(makeRegistryItem(book, registryItem.folderPath, sizeBytes));
    sendBookProgress(null);
    return operationResult(book);
  } catch (error) {
    sendBookProgress(null);
    console.error('books:replace-main-pdf error:', error);
    return operationError('PDF_REPLACE_FAILED', error?.message || 'Could not add this student book PDF.');
  }
});

ipcMain.handle('books:add-workbook-from-pdf', async (_event, input) => {
  const operationId = createId('create');
  try {
    const registryItem = await findBook(String(input?.bookId ?? ''));
    if (!registryItem) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    sendBookProgress(makeBookProgress(operationId, 'create', 'Choose workbook PDF'));
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose workbook PDF',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile']
    });

    if (selected.canceled || !selected.filePaths?.[0]) {
      sendBookProgress(null);
      return operationError('CANCELLED');
    }

    const sourcePdf = selected.filePaths[0];
    sendBookProgress(makeBookProgress(operationId, 'create', 'Checking workbook PDF'));
    const pdfInfo = await getPdfInfo(sourcePdf);
    if (pdfInfo.encrypted) {
      sendBookProgress(null);
      return operationError('PROTECTED_PDF', 'This PDF is protected. Please use an unlocked PDF.');
    }

    const sourceStat = await fsp.stat(sourcePdf);
    sendBookProgress(makeBookProgress(operationId, 'create', 'Checking disk space', 0, sourceStat.size));
    await ensureEnoughSpace(registryItem.folderPath, sourceStat.size);
    sendBookProgress(makeBookProgress(operationId, 'create', 'Waiting for confirmation', 0, sourceStat.size));
    if (!(await confirmBookFileOperation('Add workbook PDF', sourceStat.size, registryItem.folderPath))) {
      sendBookProgress(null);
      return operationError('CANCELLED');
    }

    const now = new Date().toISOString();
    const book = await readBookJson(registryItem.folderPath);
    const workbookId = createId('workbook');
    const title = sanitizeName(path.basename(sourcePdf, path.extname(sourcePdf)), 'Workbook');
    const relativePdfPath = path.posix.join('assets', 'workbooks', workbookId, 'source.pdf');
    const destination = path.join(registryItem.folderPath, relativePdfPath);
    const operation = {
      operationId,
      type: 'create',
      phase: 'Copying workbook PDF',
      transferredBytes: 0,
      totalBytes: sourceStat.size
    };
    sendBookProgress(operation);
    await copyFileWithProgress(sourcePdf, destination, operation);

    const workbook = {
      id: workbookId,
      title,
      sourcePdf: relativePdfPath,
      pages: createPdfPages(pdfInfo.pageCount, relativePdfPath, 'workbook-page'),
      createdAt: now,
      updatedAt: now
    };

    book.workbooks = Array.isArray(book.workbooks) ? book.workbooks : [];
    book.workbooks.push(workbook);
    book.workbookLinks = book.workbookLinks && typeof book.workbookLinks === 'object' ? book.workbookLinks : {};
    book.updatedAt = now;
    await validateBookData(book, registryItem.folderPath, book.title || 'Book');
    await writeBookJson(registryItem.folderPath, book);
    const sizeBytes = await getDirectorySize(registryItem.folderPath);
    await upsertRegistryItem(makeRegistryItem(book, registryItem.folderPath, sizeBytes));
    sendBookProgress(null);
    return operationResult(book);
  } catch (error) {
    sendBookProgress(null);
    console.error('books:add-workbook-from-pdf error:', error);
    return operationError('WORKBOOK_CREATE_FAILED', error?.message || 'Could not add this workbook.');
  }
});

ipcMain.handle('books:replace-workbook-pdf', async (_event, input) => {
  const operationId = createId('create');
  try {
    const registryItem = await findBook(String(input?.bookId ?? ''));
    if (!registryItem) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    sendBookProgress(makeBookProgress(operationId, 'create', 'Choose workbook PDF'));
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose workbook PDF',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile']
    });

    if (selected.canceled || !selected.filePaths?.[0]) {
      sendBookProgress(null);
      return operationError('CANCELLED');
    }

    const sourcePdf = selected.filePaths[0];
    sendBookProgress(makeBookProgress(operationId, 'create', 'Checking workbook PDF'));
    const pdfInfo = await getPdfInfo(sourcePdf);
    if (pdfInfo.encrypted) {
      sendBookProgress(null);
      return operationError('PROTECTED_PDF', 'This PDF is protected. Please use an unlocked PDF.');
    }

    const sourceStat = await fsp.stat(sourcePdf);
    sendBookProgress(makeBookProgress(operationId, 'create', 'Checking disk space', 0, sourceStat.size));
    await ensureEnoughSpace(registryItem.folderPath, sourceStat.size);
    sendBookProgress(makeBookProgress(operationId, 'create', 'Waiting for confirmation', 0, sourceStat.size));
    if (!(await confirmBookFileOperation('Replace workbook PDF', sourceStat.size, registryItem.folderPath))) {
      sendBookProgress(null);
      return operationError('CANCELLED');
    }

    const now = new Date().toISOString();
    const book = await readBookJson(registryItem.folderPath);
    book.workbooks = Array.isArray(book.workbooks) ? book.workbooks : [];
    let workbook = book.workbooks.find((item) => item.id === String(input?.workbookId ?? ''));
    if (!workbook) {
      workbook = {
        id: createId('workbook'),
        title: 'Workbook',
        createdAt: now,
        updatedAt: now,
        pages: []
      };
      book.workbooks = [workbook, ...book.workbooks];
    }

    const relativePdfPath = path.posix.join('assets', 'workbooks', workbook.id, 'source.pdf');
    const destination = path.join(registryItem.folderPath, relativePdfPath);
    const operation = {
      operationId,
      type: 'create',
      phase: 'Copying workbook PDF',
      transferredBytes: 0,
      totalBytes: sourceStat.size
    };
    sendBookProgress(operation);
    await copyFileWithProgress(sourcePdf, destination, operation);

    workbook.title = sanitizeName(path.basename(sourcePdf, path.extname(sourcePdf)), 'Workbook');
    workbook.sourcePdf = relativePdfPath;
    workbook.pages = createPdfPages(pdfInfo.pageCount, relativePdfPath, 'workbook-page');
    workbook.updatedAt = now;
    book.workbookLinks = {};
    book.updatedAt = now;
    await validateBookData(book, registryItem.folderPath, book.title || 'Book');
    await writeBookJson(registryItem.folderPath, book);
    const sizeBytes = await getDirectorySize(registryItem.folderPath);
    await upsertRegistryItem(makeRegistryItem(book, registryItem.folderPath, sizeBytes));
    sendBookProgress(null);
    return operationResult(book);
  } catch (error) {
    sendBookProgress(null);
    console.error('books:replace-workbook-pdf error:', error);
    return operationError('WORKBOOK_REPLACE_FAILED', error?.message || 'Could not replace this workbook PDF.');
  }
});

ipcMain.handle('books:import-folder', async () => {
  const operationId = createId('import');
  try {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Book Folder',
      properties: ['openDirectory']
    });

    if (selected.canceled || !selected.filePaths?.[0]) {
      return operationError('CANCELLED');
    }

    const sourceFolder = selected.filePaths[0];
    await validateBookFolder(sourceFolder, { label: 'Selected folder' });

    const bookId = createId('book');
    const destinationFolder = path.join(getBooksRoot(), bookId);
    const totalBytes = await getDirectorySize(sourceFolder);
    await ensureEnoughSpace(destinationFolder, totalBytes);
    if (!(await confirmBookFileOperation('Import book', totalBytes, destinationFolder))) {
      return operationError('CANCELLED');
    }

    const operation = {
      operationId,
      type: 'import',
      phase: 'Copying book',
      transferredBytes: 0,
      totalBytes
    };
    sendBookProgress(operation);
    await copyDirectoryWithProgress(sourceFolder, destinationFolder, operation);

    const now = new Date().toISOString();
    const book = await readBookJson(destinationFolder);
    book.id = bookId;
    book.title = book.title || sanitizeName(path.basename(sourceFolder), 'Imported Book');
    book.createdAt = book.createdAt || now;
    book.updatedAt = now;
    if (!book.cover && book.sourcePdf && await pathExists(path.join(destinationFolder, book.sourcePdf))) {
      book.cover = await generateFirstPageCover(path.join(destinationFolder, book.sourcePdf), destinationFolder);
    }
    await writeBookJson(destinationFolder, book);

    const sizeBytes = await getDirectorySize(destinationFolder);
    const item = await upsertRegistryItem(makeRegistryItem(book, destinationFolder, sizeBytes));
    sendBookProgress(null);
    return operationResult(item);
  } catch (error) {
    sendBookProgress(null);
    console.error('books:import-folder error:', error);
    return operationError('IMPORT_FAILED', error?.message || 'Could not import this book.');
  }
});

ipcMain.handle('books:import-smart', async () => {
  const operationId = createId('smart-import');
  let tempFolder = '';
  try {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Import No-Prep Content',
      filters: [
        { name: 'No-Prep Books', extensions: ['noprepbook', 'zip', 'json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (selected.canceled || !selected.filePaths?.[0]) {
      return operationError('CANCELLED');
    }

    const selectedPath = selected.filePaths[0];
    const selectedStat = await fsp.stat(selectedPath);
    const selectedExtension = path.extname(selectedPath).toLowerCase();
    const sourcePath = selectedExtension === '.json' && path.basename(selectedPath).toLowerCase() === BOOK_JSON_FILE
      ? path.dirname(selectedPath)
      : selectedPath;
    const sourceStat = selectedExtension === '.json' && path.basename(selectedPath).toLowerCase() === BOOK_JSON_FILE
      ? await fsp.stat(sourcePath)
      : selectedStat;

    if (sourceStat.isDirectory()) {
      await validateBookFolder(sourcePath, { label: 'Selected folder' });

      const bookId = createId('book');
      const destinationFolder = path.join(getBooksRoot(), bookId);
      const totalBytes = await getDirectorySize(sourcePath);
      await ensureEnoughSpace(destinationFolder, totalBytes);
      if (!(await confirmBookFileOperation('Import book', totalBytes, destinationFolder))) {
        return operationError('CANCELLED');
      }

      const operation = {
        operationId,
        type: 'import',
        phase: 'Copying book',
        transferredBytes: 0,
        totalBytes
      };
      sendBookProgress(operation);
      await copyDirectoryWithProgress(sourcePath, destinationFolder, operation);

      const now = new Date().toISOString();
      const book = await readBookJson(destinationFolder);
      book.id = bookId;
      book.title = book.title || sanitizeName(path.basename(sourcePath), 'Imported Book');
      book.createdAt = book.createdAt || now;
      book.updatedAt = now;
      if (!book.cover && book.sourcePdf && await pathExists(path.join(destinationFolder, book.sourcePdf))) {
        book.cover = await generateFirstPageCover(path.join(destinationFolder, book.sourcePdf), destinationFolder);
      }
      await writeBookJson(destinationFolder, book);

      const sizeBytes = await getDirectorySize(destinationFolder);
      const item = await upsertRegistryItem(makeRegistryItem(book, destinationFolder, sizeBytes));
      sendBookProgress(null);
      return operationResult(item);
    }

    const extension = path.extname(sourcePath).toLowerCase();
    if (extension !== BOOK_PACKAGE_EXTENSION && extension !== '.zip') {
      return operationError('UNSUPPORTED_IMPORT', 'Choose a book folder, .noprepbook, or .zip package.');
    }

    const packageStat = sourceStat;
    const packageContentBytes = await getZipUncompressedSize(sourcePath);
    const totalBytes = Math.max(packageStat.size, packageContentBytes);
    const bookId = createId('book');
    tempFolder = path.join(getBooksRoot(), `${bookId}-importing`);
    const destinationFolder = path.join(getBooksRoot(), bookId);

    await ensureEnoughSpace(destinationFolder, totalBytes);
    if (!(await confirmBookFileOperation('Import book package', totalBytes, destinationFolder))) {
      return operationError('CANCELLED');
    }

    const operation = {
      operationId,
      type: 'import',
      phase: 'Extracting book package',
      transferredBytes: 0,
      totalBytes
    };
    sendBookProgress(operation);
    await extractZipPackage(sourcePath, tempFolder, operation);
    await validateBookFolder(tempFolder, { label: 'Imported package' });

    const now = new Date().toISOString();
    const book = await readBookJson(tempFolder);
    book.id = bookId;
    book.title = book.title || sanitizeName(path.basename(sourcePath, path.extname(sourcePath)), 'Imported Book');
    book.createdAt = book.createdAt || now;
    book.updatedAt = now;
    if (!book.cover && book.sourcePdf && await pathExists(path.join(tempFolder, book.sourcePdf))) {
      book.cover = await generateFirstPageCover(path.join(tempFolder, book.sourcePdf), tempFolder);
    }
    await writeBookJson(tempFolder, book);

    if (await pathExists(destinationFolder)) {
      await fsp.rm(destinationFolder, { recursive: true, force: true });
    }
    await fsp.rename(tempFolder, destinationFolder);
    tempFolder = '';

    const sizeBytes = await getDirectorySize(destinationFolder);
    const item = await upsertRegistryItem(makeRegistryItem(book, destinationFolder, sizeBytes));
    sendBookProgress(null);
    return operationResult(item);
  } catch (error) {
    sendBookProgress(null);
    if (tempFolder) {
      await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
    }
    console.error('books:import-smart error:', error);
    return operationError('IMPORT_FAILED', error?.message || 'Could not import this book.');
  }
});

ipcMain.handle('books:export-to-desktop', async (_event, input) => {
  const operationId = createId('export');
  try {
    const book = await findBook(String(input?.bookId ?? ''));
    if (!book) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }
    const validated = await validateBookFolder(book.folderPath, { label: book.title || 'Book' });
    await pruneUnusedBookAssets(validated.book, book.folderPath);
    await writeBookJson(book.folderPath, validated.book);

    const desktopRoot = path.join(app.getPath('desktop'), 'No-Prep Books');
    await fsp.mkdir(desktopRoot, { recursive: true });
    const baseName = sanitizeName(book.title, 'Book');
    let destination = path.join(desktopRoot, baseName);
    let copyIndex = 1;
    while (await pathExists(destination)) {
      copyIndex++;
      destination = path.join(desktopRoot, `${baseName} (Copy ${copyIndex})`);
    }

    const totalBytes = await getDirectorySize(book.folderPath);
    await ensureEnoughSpace(destination, totalBytes);
    if (!(await confirmBookFileOperation('Export book to Desktop', totalBytes, destination))) {
      return operationError('CANCELLED');
    }
    const operation = {
      operationId,
      type: 'export',
      phase: 'Copying to Desktop',
      transferredBytes: 0,
      totalBytes
    };
    sendBookProgress(operation);
    await copyDirectoryWithProgress(book.folderPath, destination, operation);
    sendBookProgress(null);
    return operationResult({ destination });
  } catch (error) {
    sendBookProgress(null);
    console.error('books:export-to-desktop error:', error);
    return operationError('EXPORT_FAILED', error?.message || 'Could not export this book.');
  }
});

ipcMain.handle('books:export-package-to-desktop', async (_event, input) => {
  const operationId = createId('package-export');
  try {
    const book = await findBook(String(input?.bookId ?? ''));
    if (!book) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }
    const validated = await validateBookFolder(book.folderPath, { label: book.title || 'Book' });
    await pruneUnusedBookAssets(validated.book, book.folderPath);
    await writeBookJson(book.folderPath, validated.book);

    const desktopRoot = path.join(app.getPath('desktop'), 'No-Prep Books');
    await fsp.mkdir(desktopRoot, { recursive: true });
    const baseName = sanitizeName(book.title, 'Book');
    let destination = path.join(desktopRoot, `${baseName}${BOOK_PACKAGE_EXTENSION}`);
    let copyIndex = 1;
    while (await pathExists(destination)) {
      copyIndex++;
      destination = path.join(desktopRoot, `${baseName} (Package ${copyIndex})${BOOK_PACKAGE_EXTENSION}`);
    }

    const totalBytes = await getDirectorySize(book.folderPath);
    await ensureEnoughSpace(destination, totalBytes + 64 * 1024 * 1024);
    if (!(await confirmBookFileOperation('Export book package', totalBytes, destination))) {
      return operationError('CANCELLED');
    }

    const operation = {
      operationId,
      type: 'export',
      phase: 'Creating book package',
      transferredBytes: 0,
      totalBytes
    };
    sendBookProgress(operation);
    await createZipPackageWithProgress(book.folderPath, destination, operation);
    sendBookProgress(null);
    return operationResult({ destination });
  } catch (error) {
    sendBookProgress(null);
    console.error('books:export-package-to-desktop error:', error);
    return operationError('PACKAGE_EXPORT_FAILED', error?.message || 'Could not export this book package.');
  }
});

ipcMain.handle('books:import-package', async () => {
  const operationId = createId('package-import');
  let tempFolder = '';
  try {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Book Package',
      filters: [
        { name: 'No-Prep Book Packages', extensions: ['noprepbook', 'zip'] }
      ],
      properties: ['openFile']
    });

    if (selected.canceled || !selected.filePaths?.[0]) {
      return operationError('CANCELLED');
    }

    const packagePath = selected.filePaths[0];
    const packageStat = await fsp.stat(packagePath);
    const packageContentBytes = await getZipUncompressedSize(packagePath);
    const totalBytes = Math.max(packageStat.size, packageContentBytes);
    const bookId = createId('book');
    tempFolder = path.join(getBooksRoot(), `${bookId}-importing`);
    const destinationFolder = path.join(getBooksRoot(), bookId);

    await ensureEnoughSpace(destinationFolder, totalBytes);
    if (!(await confirmBookFileOperation('Import book package', totalBytes, destinationFolder))) {
      return operationError('CANCELLED');
    }

    const operation = {
      operationId,
      type: 'import',
      phase: 'Extracting book package',
      transferredBytes: 0,
      totalBytes
    };
    sendBookProgress(operation);
    await extractZipPackage(packagePath, tempFolder, operation);
    await validateBookFolder(tempFolder, { label: 'Imported package' });

    const now = new Date().toISOString();
    const book = await readBookJson(tempFolder);
    book.id = bookId;
    book.title = book.title || sanitizeName(path.basename(packagePath, path.extname(packagePath)), 'Imported Book');
    book.createdAt = book.createdAt || now;
    book.updatedAt = now;
    if (!book.cover && book.sourcePdf && await pathExists(path.join(tempFolder, book.sourcePdf))) {
      book.cover = await generateFirstPageCover(path.join(tempFolder, book.sourcePdf), tempFolder);
    }
    await writeBookJson(tempFolder, book);

    if (await pathExists(destinationFolder)) {
      await fsp.rm(destinationFolder, { recursive: true, force: true });
    }
    await fsp.rename(tempFolder, destinationFolder);
    tempFolder = '';

    const sizeBytes = await getDirectorySize(destinationFolder);
    const item = await upsertRegistryItem(makeRegistryItem(book, destinationFolder, sizeBytes));
    sendBookProgress(null);
    return operationResult(item);
  } catch (error) {
    sendBookProgress(null);
    if (tempFolder) {
      await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
    }
    console.error('books:import-package error:', error);
    return operationError('PACKAGE_IMPORT_FAILED', error?.message || 'Could not import this book package.');
  }
});

ipcMain.handle('books:copy', async (_event, input) => {
  const operationId = createId('copy');
  try {
    const source = await findBook(String(input?.bookId ?? ''));
    if (!source) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }
    await validateBookFolder(source.folderPath, { label: source.title || 'Book' });

    const bookId = createId('book');
    const destination = path.join(getBooksRoot(), bookId);
    const totalBytes = await getDirectorySize(source.folderPath);
    await ensureEnoughSpace(destination, totalBytes);
    if (!(await confirmBookFileOperation('Copy book', totalBytes, destination))) {
      return operationError('CANCELLED');
    }
    const operation = {
      operationId,
      type: 'copy',
      phase: 'Copying book',
      transferredBytes: 0,
      totalBytes
    };
    sendBookProgress(operation);
    await copyDirectoryWithProgress(source.folderPath, destination, operation);

    const now = new Date().toISOString();
    const book = await readBookJson(destination);
    book.id = bookId;
    book.title = `${book.title || source.title} (Copy)`;
    book.createdAt = now;
    book.updatedAt = now;
    await writeBookJson(destination, book);

    const sizeBytes = await getDirectorySize(destination);
    const item = await upsertRegistryItem(makeRegistryItem(book, destination, sizeBytes));
    sendBookProgress(null);
    return operationResult(item);
  } catch (error) {
    sendBookProgress(null);
    console.error('books:copy error:', error);
    return operationError('COPY_FAILED', error?.message || 'Could not copy this book.');
  }
});

ipcMain.handle('books:combine', async (_event, input) => {
  const operationId = createId('combine');
  try {
    const ids = Array.isArray(input?.bookIds) ? input.bookIds.map(String) : [];
    if (ids.length < 2) {
      return operationError('NOT_ENOUGH_BOOKS', 'Select at least two books to combine.');
    }

    const registry = await readRegistry();
    const selected = ids.map((id) => registry.find((book) => book.id === id)).filter(Boolean);
    if (selected.length < 2) {
      return operationError('BOOK_NOT_FOUND', 'Could not find the selected books.');
    }
    for (const book of selected) {
      await validateBookFolder(book.folderPath, { label: book.title || 'Selected book' });
    }

    const totalBytes = await selected.reduce(async (sumPromise, book) => {
      return (await sumPromise) + await getDirectorySize(book.folderPath);
    }, Promise.resolve(0));

    const now = new Date().toISOString();
    const bookId = createId('book');
    const destination = path.join(getBooksRoot(), bookId);
    const destinationAssets = path.join(destination, 'assets');
    await ensureEnoughSpace(destination, totalBytes);
    if (!(await confirmBookFileOperation('Combine books', totalBytes, destination))) {
      return operationError('CANCELLED');
    }
    await fsp.mkdir(destinationAssets, { recursive: true });

    const operation = {
      operationId,
      type: 'combine',
      phase: 'Combining books',
      transferredBytes: 0,
      totalBytes
    };
    sendBookProgress(operation);

    const combinedPages = [];
    for (const source of selected) {
      const sourceBook = await readBookJson(source.folderPath);
      const sourceAssets = path.join(source.folderPath, 'assets');
      const assetPrefix = source.id;
      if (await pathExists(sourceAssets)) {
        await copyDirectoryWithProgress(sourceAssets, path.join(destinationAssets, assetPrefix), operation);
      }

      const pages = Array.isArray(sourceBook.pages) ? sourceBook.pages : [];
      for (const page of pages) {
        const rewritten = rewriteRelativeAssetPaths(page, assetPrefix);
        if (rewritten.type === 'pdf') {
          const pageSourcePdf = page.sourcePdf || sourceBook.sourcePdf;
          if (pageSourcePdf) {
            rewritten.sourcePdf = rewriteRelativeAssetPaths(pageSourcePdf, assetPrefix);
          }
        }
        combinedPages.push({
          ...rewritten,
          id: createId('page')
        });
      }
    }

    const title = sanitizeName(input?.title, selected.map((book) => book.title).join(' + '));
    const firstCoverSource = selected.find((book) => book.coverPath);
    let cover = '';
    if (firstCoverSource?.coverPath) {
      const sourceCover = path.join(firstCoverSource.folderPath, firstCoverSource.coverPath);
      if (await pathExists(sourceCover)) {
        cover = 'cover.png';
        await copyFile(sourceCover, path.join(destination, cover));
      }
    }
    const combinedBook = {
      version: '1.0',
      id: bookId,
      title,
      cover,
      pages: combinedPages,
      createdAt: now,
      updatedAt: now
    };
    await writeBookJson(destination, combinedBook);
    const sizeBytes = await getDirectorySize(destination);
    const item = await upsertRegistryItem(makeRegistryItem(combinedBook, destination, sizeBytes));
    sendBookProgress(null);
    return operationResult(item);
  } catch (error) {
    sendBookProgress(null);
    console.error('books:combine error:', error);
    return operationError('COMBINE_FAILED', error?.message || 'Could not combine these books.');
  }
});

ipcMain.handle('books:delete', async (_event, input) => {
  try {
    const book = await findBook(String(input?.bookId ?? ''));
    if (!book) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    await shell.trashItem(book.folderPath);
    await removeRegistryItem(book.id);
    return operationResult(null);
  } catch (error) {
    console.error('books:delete error:', error);
    return operationError('DELETE_FAILED', error?.message || 'Could not delete this book.');
  }
});

ipcMain.handle('books:cleanup-storage', async (_event, input) => {
  try {
    const registryItem = await findBook(String(input?.bookId ?? ''));
    if (!registryItem) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    const book = await readBookJson(registryItem.folderPath);
    await validateBookData(book, registryItem.folderPath, book.title || 'Book');
    await pruneUnusedBookAssets(book, registryItem.folderPath);
    const sizeBytes = await getDirectorySize(registryItem.folderPath);
    const item = await upsertRegistryItem(makeRegistryItem(book, registryItem.folderPath, sizeBytes));
    return operationResult(item);
  } catch (error) {
    console.error('books:cleanup-storage error:', error);
    return operationError('CLEANUP_FAILED', 'Could not clean this book storage.');
  }
});

ipcMain.handle('books:read', async (_event, input) => {
  try {
    const book = await findBook(String(input?.bookId ?? ''));
    if (!book) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }
    await validateBookFolder(book.folderPath, { label: book.title || 'Book' });
    return operationResult(await readBookJson(book.folderPath));
  } catch (error) {
    console.error('books:read error:', error);
    return operationError('READ_FAILED', 'Could not read this book.');
  }
});

ipcMain.handle('books:read-annotations', async (_event, input) => {
  try {
    const book = await findBook(String(input?.bookId ?? ''));
    if (!book) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    return operationResult(await readBookAnnotations(book.folderPath, book.id));
  } catch (error) {
    console.error('books:read-annotations error:', error);
    return operationError('READ_ANNOTATIONS_FAILED', 'Could not read reader annotations.');
  }
});

ipcMain.handle('books:save', async (_event, input) => {
  try {
    const registryItem = await findBook(String(input?.bookId ?? ''));
    if (!registryItem) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    const current = await readBookJson(registryItem.folderPath);
    const nextBook = input?.book;
    if (!nextBook || typeof nextBook !== 'object' || !Array.isArray(nextBook.pages)) {
      return operationError('INVALID_BOOK', 'Book data is not valid.');
    }

    const now = new Date().toISOString();
    const book = {
      ...nextBook,
      id: current.id,
      version: current.version || '1.0',
      createdAt: current.createdAt || now,
      updatedAt: now
    };
    await validateBookData(book, registryItem.folderPath, book.title || 'Book');
    await writeBookJson(registryItem.folderPath, book);
    let sizeBytes = getCachedSizeBytes(registryItem);
    if (hasRemovedBookAssetReferences(current, book)) {
      await pruneUnusedBookAssets(book, registryItem.folderPath);
      sizeBytes = await getDirectorySize(registryItem.folderPath);
    }
    if (sizeBytes === null) {
      sizeBytes = await getDirectorySize(registryItem.folderPath);
    }
    const item = await upsertRegistryItem(makeRegistryItem(book, registryItem.folderPath, sizeBytes));
    return operationResult(item);
  } catch (error) {
    console.error('books:save error:', error);
    return operationError('SAVE_FAILED', 'Could not save this book.');
  }
});

ipcMain.handle('books:save-annotations', async (_event, input) => {
  try {
    const book = await findBook(String(input?.bookId ?? ''));
    if (!book) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    const annotations = input?.annotations;
    if (!annotations || typeof annotations !== 'object') {
      return operationError('INVALID_ANNOTATIONS', 'Reader annotations are not valid.');
    }

    await writeBookAnnotations(book.folderPath, annotations, book.id);
    return operationResult();
  } catch (error) {
    console.error('books:save-annotations error:', error);
    return operationError('SAVE_ANNOTATIONS_FAILED', 'Could not save reader annotations.');
  }
});

ipcMain.handle('books:add-asset', async (_event, input) => {
  try {
    const registryItem = await findBook(String(input?.bookId ?? ''));
    if (!registryItem) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    const kind = String(input?.kind || 'files').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'files';
    const filters = Array.isArray(input?.filters) ? input.filters : [];
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: `Choose ${kind} file`,
      filters,
      properties: ['openFile']
    });

    if (selected.canceled || !selected.filePaths?.[0]) {
      return operationError('CANCELLED');
    }

    const sourcePath = selected.filePaths[0];
    const ext = path.extname(sourcePath);
    const safeBaseName = sanitizeName(path.basename(sourcePath, ext), 'asset');
    const fileName = `${safeBaseName}-${Date.now()}${ext}`;
    const relativePath = path.posix.join('assets', kind, fileName);
    const destination = path.join(registryItem.folderPath, 'assets', kind, fileName);
    await copyFile(sourcePath, destination);
    const stat = await fsp.stat(destination);
    await updateRegistrySizeByDelta(registryItem, stat.size);

    return operationResult({
      relativePath,
      fileName: path.basename(sourcePath),
      assetUrl: encodeBookAssetUrl(registryItem.id, relativePath)
    });
  } catch (error) {
    console.error('books:add-asset error:', error);
    return operationError('ASSET_FAILED', error?.message || 'Could not add this asset.');
  }
});

ipcMain.handle('books:save-asset-data', async (_event, input) => {
  try {
    const registryItem = await findBook(String(input?.bookId ?? ''));
    if (!registryItem) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    const kind = String(input?.kind || 'images').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'images';
    if (kind !== 'images') {
      return operationError('INVALID_ASSET_KIND', 'This asset type is not supported here.');
    }

    const decoded = decodeBase64DataUrl(input?.dataUrl, {
      allowedMime: (mimeType) => mimeType.startsWith('image/'),
      maxBytes: MAX_INLINE_IMAGE_BYTES,
      invalidCode: 'INVALID_ASSET_DATA',
      invalidMessage: 'Image data is not valid.',
      tooLargeMessage: 'Image data is too large.'
    });
    if (!decoded.ok) {
      return decoded.error;
    }

    const ext = extensionForMimeType(decoded.mimeType, '.png');
    const requestedName = String(input?.fileName || 'image');
    const safeBaseName = sanitizeName(path.basename(requestedName, path.extname(requestedName)), 'image');
    const fileName = `${safeBaseName}-${Date.now()}${ext}`;
    const relativePath = path.posix.join('assets', kind, fileName);
    const destination = path.join(registryItem.folderPath, 'assets', kind, fileName);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, decoded.buffer);
    await updateRegistrySizeByDelta(registryItem, decoded.buffer.length);

    return operationResult({
      relativePath,
      fileName,
      assetUrl: encodeBookAssetUrl(registryItem.id, relativePath)
    });
  } catch (error) {
    console.error('books:save-asset-data error:', error);
    return operationError('ASSET_SAVE_FAILED', error?.message || 'Could not save this asset.');
  }
});

ipcMain.handle('books:save-audio-recording', async (_event, input) => {
  try {
    const registryItem = await findBook(String(input?.bookId ?? ''));
    if (!registryItem) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    const decoded = decodeBase64DataUrl(input?.dataUrl, {
      allowedMime: (mimeType) => mimeType.startsWith('audio/') || mimeType === 'application/octet-stream',
      maxBytes: MAX_AUDIO_RECORDING_BYTES,
      invalidCode: 'INVALID_AUDIO',
      invalidMessage: 'Recorded audio is not valid.',
      tooLargeMessage: 'Recorded audio is too large.'
    });
    if (!decoded.ok) {
      return decoded.error;
    }

    const ext = extensionForMimeType(decoded.mimeType, '.wav');
    const fileName = `voice-${Date.now()}${ext}`;
    const relativePath = path.posix.join('assets', 'audio', fileName);
    const destination = path.join(registryItem.folderPath, 'assets', 'audio', fileName);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, decoded.buffer);
    await updateRegistrySizeByDelta(registryItem, decoded.buffer.length);

    return operationResult({
      relativePath,
      fileName,
      assetUrl: encodeBookAssetUrl(registryItem.id, relativePath)
    });
  } catch (error) {
    console.error('books:save-audio-recording error:', error);
    return operationError('RECORDING_FAILED', error?.message || 'Could not save this recording.');
  }
});

ipcMain.handle('books:save-topic-snapshot', async (_event, input) => {
  try {
    const registryItem = await findBook(String(input?.bookId ?? ''));
    if (!registryItem) {
      return operationError('BOOK_NOT_FOUND', 'Book not found.');
    }

    const snapshot = input?.snapshot;
    if (!snapshot || typeof snapshot !== 'object') {
      return operationError('INVALID_TOPIC_SNAPSHOT', 'Topic snapshot is not valid.');
    }

    const topicName = sanitizeName(
      String(input?.topicName || snapshot?.topic?.name || input?.elementId || 'Game Topic'),
      'Game Topic'
    );
    const relativePath = path.posix.join('assets', 'games', `${topicName}.json`);
    const destination = path.join(registryItem.folderPath, 'assets', 'games', `${topicName}.json`);
    const previousSize = await pathExists(destination)
      ? (await fsp.stat(destination)).size
      : 0;
    const content = JSON.stringify(snapshot, null, 2);
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > MAX_TOPIC_SNAPSHOT_BYTES) {
      return operationError('TOPIC_SNAPSHOT_TOO_LARGE', 'This topic is too large to save inside the book.');
    }
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, content, 'utf8');
    await updateRegistrySizeByDelta(registryItem, contentBytes - previousSize);

    return operationResult({
      relativePath,
      assetUrl: encodeBookAssetUrl(registryItem.id, relativePath)
    });
  } catch (error) {
    console.error('books:save-topic-snapshot error:', error);
    return operationError('TOPIC_SNAPSHOT_FAILED', error?.message || 'Could not save this topic inside the book.');
  }
});

ipcMain.on('books:get-asset-url', (event, bookId, relativePath) => {
  try {
    event.returnValue = resolveBookAssetPath(bookId, relativePath)
      ? encodeBookAssetUrl(bookId, relativePath)
      : '';
  } catch {
    event.returnValue = '';
  }
});

ipcMain.on('books:get-asset-file-url', (event, bookId, relativePath) => {
  try {
    const resolved = resolveBookAssetPath(bookId, relativePath);
    event.returnValue = resolved ? pathToFileURL(resolved).toString() : '';
  } catch {
    event.returnValue = '';
  }
});

ipcMain.handle('books:get-asset-bytes', async (_event, bookId, relativePath) => {
  try {
    const resolved = resolveBookAssetPath(String(bookId ?? ''), String(relativePath ?? ''));
    if (!resolved) {
      return operationError('ASSET_NOT_FOUND', 'Book asset not found.');
    }
    const bytes = await fsp.readFile(resolved);
    return operationResult({
      base64: bytes.toString('base64'),
      byteLength: bytes.length
    });
  } catch (error) {
    console.error('books:get-asset-bytes error:', error);
    return operationError('ASSET_BYTES_FAILED', error?.message || 'Could not read this book asset.');
  }
});
