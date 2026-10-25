// Checks a packaged desktop build still has every module the main process needs. package.json
// "build.files" keeps renderer-only and Android packages (Angular, Capacitor, …) out of the
// installer; if main-process code starts using one of them, it works in development and breaks
// only once installed. Run with the packaged app's own Electron (it reads app.asar):
//
//   set ELECTRON_RUN_AS_NODE=1 && release\win-unpacked\No-Prep.exe scripts\check-packaged-app.cjs release\win-unpacked\resources
//   (Git Bash: ELECTRON_RUN_AS_NODE=1 release/win-unpacked/No-Prep.exe scripts/check-packaged-app.cjs release/win-unpacked/resources)
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { pathToFileURL } = require('url');

const resources = process.argv[2];
const asar = path.join(resources || '', 'app.asar');
if (!resources || !fs.existsSync(asar)) { console.error('usage: check-packaged-app.cjs <resources folder with app.asar>'); process.exit(2); }
const pkg = JSON.parse(fs.readFileSync(path.join(asar, 'package.json'), 'utf8'));
const mainRequire = Module.createRequire(path.join(asar, 'electron', 'main', 'index.js'));
const problems = [];

// 1. Every package the main process requires (or imports) by name loads from the asar.
const ownCode = [];
const walk = (dir, out) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out); else if (/\.(c?js|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
};
walk(path.join(asar, 'electron'), ownCode);
const used = new Set();
for (const file of ownCode) {
  for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(/(?:require|import)\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g)) {
    if (!Module.isBuiltin(spec) && spec !== 'electron' && !spec.startsWith('@no-prep/security-core-')) used.add(spec);
  }
}
(async () => {
  for (const spec of used) {
    try {
      if (spec.endsWith('.mjs')) await import(pathToFileURL(mainRequire.resolve(spec)).href);
      else mainRequire(spec);
      console.log('ok   ', spec);
    } catch (error) {
      problems.push(`${spec}: ${String(error.message).split('\n')[0]}`);
    }
  }

  // 2. Inside the shipped packages, nothing points at a package that build.files leaves out.
  const excluded = (pkg.build?.files || [])
    .filter(p => p.startsWith('!node_modules/'))
    .map(p => p.slice('!node_modules/'.length).replace(/\/\*\*$/, ''))
    .filter(p => p.split('/').length <= (p.startsWith('@') ? 2 : 1));
  const isExcluded = (name) => excluded.some(x => name === x || name.startsWith(x + '/'));
  for (const file of walk(path.join(asar, 'node_modules'), [])) {
    const req = Module.createRequire(file);
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(/require\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g)) {
      if (!isExcluded(spec)) continue;
      try { req.resolve(spec); } catch { problems.push(`${spec} (left out by build.files) is required by ${path.relative(asar, file)}`); }
    }
  }

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n  ` + [...new Set(problems)].join('\n  '));
    process.exit(1);
  }
  console.log(`\nAll ${used.size} main-process packages load; nothing shipped needs a left-out package.`);
})();
