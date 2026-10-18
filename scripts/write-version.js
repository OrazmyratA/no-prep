// Stamps the current package.json version into a bundled asset so the running app (web,
// Electron renderer, or the webview inside the Android APK) can read its own version at runtime
// without any native bridge — used by AppUpdateService to detect that a newer build exists.
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const target = path.join(__dirname, '..', 'public', 'assets', 'version.json');

fs.writeFileSync(target, JSON.stringify({ version: pkg.version }, null, 2) + '\n');
console.log(`[write-version] ${pkg.version} -> ${path.relative(process.cwd(), target)}`);
