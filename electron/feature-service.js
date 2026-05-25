const { getFeatureUnlockKey } = require('./license-service');
const { runFeature, assertAllowedFeature } = require('./secure/feature-loader');

async function runSecureFeature(featureName, input = {}) {
  assertAllowedFeature(featureName);
  const keyHex = getFeatureUnlockKey(featureName);
  if (!keyHex) {
    return { ok: false, error: 'LICENSE_REQUIRED' };
  }

  try {
    const result = await runFeature(featureName, keyHex, input);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: 'FEATURE_LOAD_FAILED' };
  }
}

module.exports = { runSecureFeature };
