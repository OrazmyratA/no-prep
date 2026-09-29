// Verifies a NoPrep license the same way the desktop app's native security core does
// (native/security-core/src/lib.rs): RSA PKCS#1 v1.5 + SHA-256 over "machineId|expiry|nonce",
// checked with the public key only. The machine binding can't be checked here (the server has no
// fingerprint to compare), so rate limits per machineId are what stop a shared license file.

const keyCache = new Map();

function pemToDer(pem) {
  const base64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function importPublicKey(pem) {
  if (!keyCache.has(pem)) {
    keyCache.set(pem, crypto.subtle.importKey(
      'spki',
      pemToDer(pem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    ));
  }
  return keyCache.get(pem);
}

/** Reads the license the app sends in the X-NoPrep-License header (base64 of its JSON). */
export function parseLicenseHeader(value) {
  if (!value || value.length > 4096) return null;
  try {
    const license = JSON.parse(atob(value));
    const { machineId, expiry, nonce, signature } = license ?? {};
    if (
      typeof machineId !== 'string' || !machineId ||
      !Number.isSafeInteger(expiry) ||
      typeof nonce !== 'string' || !nonce ||
      typeof signature !== 'string' || !signature
    ) {
      return null;
    }
    return { machineId, expiry, nonce, signature };
  } catch {
    return null;
  }
}

/** True when the license is signed by NoPrep and not expired. */
export async function verifyLicense(license, publicKeyPem, nowMs = Date.now()) {
  if (!license || license.expiry <= 0 || nowMs > license.expiry) return false;
  try {
    const key = await importPublicKey(publicKeyPem);
    const signature = Uint8Array.from(atob(license.signature.trim()), c => c.charCodeAt(0));
    const payload = new TextEncoder().encode(`${license.machineId}|${license.expiry}|${license.nonce}`);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, payload);
  } catch {
    return false;
  }
}
