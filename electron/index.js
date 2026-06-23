const { app, BrowserWindow, ipcMain, shell, Menu, dialog, protocol, net, nativeImage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
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
const BOOK_REGISTRY_FILE = 'book-registry.json';
const BOOK_JSON_FILE = 'book.json';
const BOOK_ANNOTATIONS_FILE = 'student-annotations.json';
const BOOK_PACKAGE_EXTENSION = '.noprepbook';
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_RECORDING_BYTES = 100 * 1024 * 1024;
const MAX_TOPIC_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 200000;
const ZIP_IFMT = 0o170000;
const ZIP_IFLNK = 0o120000;

function getBooksRoot() {
  return path.join(app.getPath('userData'), BOOKS_DIR_NAME);
}

function getRegistryPath() {
  return path.join(getBooksRoot(), BOOK_REGISTRY_FILE);
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

async function readRegistry() {
  await ensureBooksRoot();
  try {
    const content = await fsp.readFile(getRegistryPath(), 'utf8');
    const items = JSON.parse(content);
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
  if (process.platform !== 'darwin') app.quit();
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

    const elementId = sanitizeName(String(input?.elementId || 'game'), 'game');
    const snapshot = input?.snapshot;
    if (!snapshot || typeof snapshot !== 'object') {
      return operationError('INVALID_TOPIC_SNAPSHOT', 'Topic snapshot is not valid.');
    }

    const relativePath = path.posix.join('assets', 'games', elementId, 'topic.json');
    const destination = path.join(registryItem.folderPath, 'assets', 'games', elementId, 'topic.json');
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
