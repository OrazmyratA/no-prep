const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FEATURE_KEY_SEED = 'no-prep-premium-feature-key-v1';
const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'secure-feature-src');
const outputDirs = [
  path.join(root, 'electron', 'secure', 'features'),
  path.join(root, 'encrypted')
];

const featureFiles = {
  ai: 'ai.js',
  export: 'export.js',
  editing: 'editing.js',
  import: 'import.js',
  premium: 'premium.js'
};

function keyFor(featureName) {
  return crypto.createHash('sha256').update(`${FEATURE_KEY_SEED}|${featureName}`).digest();
}

function encryptFeature(featureName, sourcePath, outputPath) {
  const plaintext = fs.readFileSync(sourcePath);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(featureName), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const artifact = {
    alg: 'aes-256-gcm',
    feature: featureName,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64')
  };
  fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2));
}

for (const outputDir of outputDirs) {
  fs.mkdirSync(outputDir, { recursive: true });
}

for (const [featureName, fileName] of Object.entries(featureFiles)) {
  encryptFeature(
    featureName,
    path.join(sourceDir, fileName),
    path.join(root, 'electron', 'secure', 'features', `${featureName}.enc`)
  );
}

encryptFeature(
  'premium',
  path.join(sourceDir, 'premium.js'),
  path.join(root, 'encrypted', 'premium-feature.enc')
);

console.log('Encrypted premium feature bundles.');
