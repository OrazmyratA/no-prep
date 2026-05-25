const { app } = require('electron');
const { machineIdSync } = require('node-machine-id');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_LICENSE_BYTES = 16 * 1024;

function loadSecurityCore() {
  const candidates = [
    path.join(__dirname, '..', 'native', 'security-core'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'native', 'security-core'),
    path.join(process.resourcesPath || '', 'app', 'native', 'security-core')
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Continue searching common dev and packaged locations.
    }
  }

  return null;
}

const securityCore = loadSecurityCore();

function nativeCall(name, fallbackName) {
  if (!securityCore) {
    return null;
  }
  return securityCore[name] || securityCore[fallbackName] || null;
}

function getAppDataPath() {
  try {
    if (app?.getPath) {
      return path.join(app.getPath('appData'), 'No-Prep');
    }
  } catch {
    // Fall back to a deterministic user profile location.
  }
  return path.join(os.homedir(), 'AppData', 'Roaming', 'No-Prep');
}

function getLicensePath() {
  return path.join(getAppDataPath(), 'license.dat');
}

function getLastValidPath() {
  return path.join(getAppDataPath(), 'lastvalid.txt');
}

function ensureAppDataDir() {
  fs.mkdirSync(getAppDataPath(), { recursive: true });
}

function createFingerprintFallback(machine, host, platform) {
  return crypto.createHash('sha256').update(`${machine}|${host}|${platform}`).digest('hex');
}

function getMachineFingerprint() {
  const machine = machineIdSync(true);
  const host = os.hostname();
  const platform = process.platform;
  const createFingerprint = nativeCall('create_fingerprint', 'createFingerprint');
  if (createFingerprint) {
    return createFingerprint(machine, host, platform);
  }
  return createFingerprintFallback(machine, host, platform);
}

function loadLicense() {
  ensureAppDataDir();
  const licensePath = getLicensePath();
  if (!fs.existsSync(licensePath)) {
    return null;
  }

  try {
    const stat = fs.statSync(licensePath);
    if (stat.size > MAX_LICENSE_BYTES) {
      return null;
    }
    return parseLicenseContent(fs.readFileSync(licensePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseLicenseContent(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_LICENSE_BYTES) {
    return null;
  }

  let license;
  try {
    license = JSON.parse(content);
  } catch {
    return null;
  }
  if (!license || typeof license !== 'object') {
    return null;
  }

  const { machineId, expiry, nonce, signature } = license;
  if (
    typeof machineId !== 'string' ||
    !Number.isSafeInteger(expiry) ||
    typeof nonce !== 'string' ||
    typeof signature !== 'string'
  ) {
    return null;
  }

  return { machineId, expiry, nonce, signature };
}

function validateLicense(license) {
  if (!license) {
    return false;
  }

  const validateSignature = nativeCall('validate_license_signature', 'validateLicenseSignature');
  if (!validateSignature) {
    return false;
  }

  return Boolean(
    validateSignature(
      license.machineId,
      license.expiry,
      license.nonce,
      license.signature,
      getMachineFingerprint()
    )
  );
}

function checkClockRollback() {
  const lastValidPath = getLastValidPath();
  const now = Date.now();
  let lastValid = 0;

  if (fs.existsSync(lastValidPath)) {
    lastValid = Number.parseInt(fs.readFileSync(lastValidPath, 'utf8'), 10) || 0;
  }

  if (now + 60_000 < lastValid) {
    return false;
  }

  fs.writeFileSync(lastValidPath, String(now));
  return true;
}

function statusFromLicense(license) {
  if (!validateLicense(license) || !checkClockRollback()) {
    return { valid: false, daysLeft: 0 };
  }

  const daysLeft = Math.max(0, Math.ceil((license.expiry - Date.now()) / 86_400_000));
  return { valid: true, daysLeft };
}

function checkLicense() {
  return statusFromLicense(loadLicense());
}

function saveLicense(licenseData) {
  ensureAppDataDir();
  fs.writeFileSync(getLicensePath(), JSON.stringify(licenseData, null, 2));
}

function writeMachineIdToDesktop() {
  const desktopPath = path.join(os.homedir(), 'Desktop', 'machine-id.txt');
  const fingerprint = getMachineFingerprint();
  fs.writeFileSync(desktopPath, fingerprint);
  return desktopPath;
}

function activateLicenseContent(content) {
  const license = parseLicenseContent(content);
  const status = statusFromLicense(license);
  if (!status.valid) {
    return status;
  }

  saveLicense(license);
  return statusFromLicense(license);
}

function getFeatureUnlockKey(featureName) {
  const license = loadLicense();
  if (!validateLicense(license)) {
    return null;
  }

  const approveFeature = nativeCall('approve_feature_unlock', 'approveFeatureUnlock');
  if (!approveFeature) {
    return null;
  }

  return approveFeature(
    featureName,
    license.machineId,
    license.expiry,
    license.nonce,
    license.signature,
    getMachineFingerprint()
  );
}

module.exports = {
  activateLicenseContent,
  checkLicense,
  getAppDataPath,
  getFeatureUnlockKey,
  getMachineFingerprint,
  parseLicenseContent,
  saveLicense,
  validateLicense,
  writeMachineIdToDesktop
};
