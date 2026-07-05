const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

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
      path.join(__dirname, '..', '..', 'node_modules'),
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

async function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    await execFileText(checker, [command], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
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

module.exports = {
  pathExists,
  isPathInside,
  getDirectorySize,
  getAvailableBytes,
  firstExistingPath,
  commandExists,
  ensureEnoughSpace,
  formatBytesForDialog,
  execFileText,
  execRuntimeText
};
