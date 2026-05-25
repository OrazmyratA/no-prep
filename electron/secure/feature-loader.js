const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const allowedFeatures = new Set(['ai', 'export', 'editing', 'import', 'premium']);
const featureDir = path.join(__dirname, 'features');

function assertAllowedFeature(featureName) {
  if (!allowedFeatures.has(featureName)) {
    throw new Error('Unknown secure feature');
  }
}

function decryptBundle(featureName, keyHex) {
  assertAllowedFeature(featureName);
  const artifactPath = path.join(featureDir, `${featureName}.enc`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  if (artifact.alg !== 'aes-256-gcm' || artifact.feature !== featureName) {
    throw new Error('Invalid secure feature artifact');
  }

  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(artifact.iv, 'base64');
  const tag = Buffer.from(artifact.tag, 'base64');
  const ciphertext = Buffer.from(artifact.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function evaluateBundle(source, featureName) {
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    Date
  };
  sandbox.exports = sandbox.module.exports;
  const script = new vm.Script(source, {
    filename: `secure-feature://${featureName}.js`,
    displayErrors: false
  });
  script.runInNewContext(sandbox, { timeout: 1000 });
  return sandbox.module.exports;
}

function loadFeature(featureName, keyHex) {
  const source = decryptBundle(featureName, keyHex);
  return evaluateBundle(source, featureName);
}

async function runFeature(featureName, keyHex, input = {}) {
  const feature = loadFeature(featureName, keyHex);
  if (!feature || typeof feature.run !== 'function') {
    throw new Error('Secure feature has no run() entrypoint');
  }
  return await feature.run(input);
}

module.exports = { loadFeature, runFeature, assertAllowedFeature };
