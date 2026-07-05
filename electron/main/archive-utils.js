const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const archiverModule = require('archiver');
const extractZip = require('extract-zip');
const yauzl = require('yauzl');
const {
  MAX_ZIP_ENTRIES,
  ZIP_IFMT,
  ZIP_IFLNK
} = require('./constants');

function createArchiveUtils({ sendProgress }) {
  async function copyFileWithProgress(source, destination, operation) {
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    return new Promise((resolve, reject) => {
      const read = fs.createReadStream(source);
      const write = fs.createWriteStream(destination);
      read.on('data', (chunk) => {
        operation.transferredBytes += chunk.length;
        sendProgress(operation);
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
        sendProgress(operation);
      });

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize().catch(reject);
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
        sendProgress(operation);
      }
    });
  }

  return {
    copyFileWithProgress,
    copyFile,
    copyDirectoryWithProgress,
    createZipPackageWithProgress,
    extractZipPackage,
    getZipUncompressedSize
  };
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

module.exports = {
  createArchiveUtils,
  createZipArchive,
  isUnsafeZipEntryPath,
  isZipEntrySymlink,
  validateZipPackageEntries,
  getZipUncompressedSize
};
