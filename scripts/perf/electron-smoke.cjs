// End-to-end smoke test of the desktop app: runs the real electron/index.js (with the built
// dist/no-prep/browser) on a throwaway profile, then drives the renderer.
//
//   npm run build && npx electron scripts/perf/electron-smoke.cjs
//   (from Git Bash: env -u ELECTRON_RUN_AS_NODE npx electron scripts/perf/electron-smoke.cjs)
//
// Reports startup timing, then opens every game, the book creator and the book reader, switches
// language, and lists renderer errors. Never touches the real No-Prep profile.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

// Chromium still holds a few files while it shuts down; sweep what earlier runs left.
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('np-smoke-'))) { try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { } }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-smoke-'));
// app.exit() ends the process at once, so clean up on the way out (also after a crash).
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { } });
// index.js names the app (which picks the profile folder), so redirect the folder right after.
const setName = app.setName.bind(app);
app.setName = (name) => { setName(name); app.setPath('userData', profile); };

const t = () => Math.round(process.uptime() * 1000);
const timing = {};
const errors = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// A plain reload, as a teacher (or an update) would do it; index.html keeps the address on itself.
const RELOAD = "setTimeout(() => location.reload(), 0); true";

app.on('browser-window-created', (_, win) => {
  timing.windowCreated = t();
  win.once('ready-to-show', () => { timing.readyToShow = t(); });
  win.webContents.on('console-message', (event) => {
    const { level, message } = event;
    if (level === 'error' || level === 3) errors.push(message.slice(0, 200));
  });
  win.webContents.once('did-finish-load', () => run(win).catch((e) => { console.error(e); app.exit(1); }));
});

async function run(win) {
  // Runs code in the page; a call that lands while the page is navigating is retried.
  const js = async (code) => {
    for (let attempt = 0; ; attempt++) {
      try { return await win.webContents.executeJavaScript(code, true); } catch (e) { if (attempt >= 10) throw e; await sleep(300); }
    }
  };
  const waitFor = async (cond, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // A check landing mid-navigation throws; just try again.
      try { if (await js(`!!(${cond})`)) return Date.now() - start; } catch { }
      await sleep(100);
    }
    return -1;
  };
  timing.topicsPage = (await waitFor(`document.querySelector('.topics-page')`)) >= 0 ? t() : -1;
  console.log('startup (ms since process start):', JSON.stringify(timing));

  // Seed six topics with twelve words and pictures, then reload so the app reads them.
  const seeded = await js(`(async () => { try {
    const db = await new Promise(r => { const q = indexedDB.open('NoPrepDB'); q.onsuccess = () => r(q.result); });
    const c = new OffscreenCanvas(400, 300); c.getContext('2d').fillRect(0, 0, 200, 150);
    const picture = await c.convertToBlob({ type: 'image/jpeg' });
    const words = ['apple', 'house', 'water', 'green', 'table', 'chair', 'bread', 'light', 'music', 'river', 'plant', 'smile'];
    const tx = db.transaction(['topics', 'items'], 'readwrite');
    const now = new Date();
    for (let t = 1; t <= 6; t++) {
      tx.objectStore('topics').put({ id: t, name: 'Topic ' + t, createdAt: now, updatedAt: now });
      words.forEach((w, k) => tx.objectStore('items').put({ topicId: t, text: w, image: picture, order: k, createdAt: now }));
    }
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
    db.close();
    return 'ok';
  } catch (e) { return 'seed failed: ' + (e && (e.stack || e.message) || e); } })()`);
  console.log('seed:', seeded);
  await js(RELOAD);
  await sleep(1500);
  console.log('reloaded to', win.webContents.getURL());
  await waitFor(`document.querySelectorAll('.topic-card').length >= 6`);
  console.log('topics shown:', await js(`document.querySelectorAll('.topic-card').length`));

  // route -> component selector, read from the sources.
  const gamesDir = path.join(__dirname, '../../src/app/features/games');
  const routing = fs.readFileSync(path.join(gamesDir, 'games-routing.module.ts'), 'utf8');
  const games = [...routing.matchAll(/path: '([\w-]+)', loadComponent: \(\) => import\('\.\/([\w-]+)'\)/g)]
    .map(([, route, file]) => ({ route, selector: fs.readFileSync(path.join(gamesDir, file + '.ts'), 'utf8').match(/selector: '([\w-]+)'/)[1] }));
  const failed = [];
  for (const { route, selector } of games) {
    const before = errors.length;
    await js(`location.hash = '#/topics/5/activities'`);
    await waitFor(`document.querySelector('.activity-page h1')`);
    await js(`location.hash = '#/topics/5/play/${route}'`);
    const ms = await waitFor(`(document.querySelector('${selector}')?.innerHTML.length || 0) > 200`, 8000);
    await sleep(1200);
    const stayed = await js(`location.hash.includes('/play/${route}')`);
    const newErrors = errors.slice(before);
    if (ms < 0 || !stayed || newErrors.length) failed.push(`${route}: ${ms < 0 ? 'did not render' : 'rendered'}${stayed ? '' : ', then left (needs other content)'} ${newErrors.join(' | ')}`);
  }
  console.log(`games opened: ${games.length}, problems: ${failed.length ? '\n  ' + failed.join('\n  ') : 'none'}`);

  for (const route of ['#/books/new', '#/books/missing-book/read']) {
    const before = errors.length;
    await js(`location.hash = '${route}'`);
    await sleep(4000);
    const state = await js(`({ hash: location.hash, creator: !!document.querySelector('app-book-creator'), reader: !!document.querySelector('app-book-reader'), text: (document.querySelector('app-book-creator, app-book-reader')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 80) })`);
    console.log(`${route}: ${JSON.stringify(state)} errors: ${errors.slice(before).join(' | ') || 'none'}`);
  }

  await js(`location.hash = '#/topics'`);
  await waitFor(`document.querySelector('button[aria-label="Select language"]')`);
  await js(`document.querySelector('button[aria-label="Select language"]').click()`);
  await sleep(300);
  await js(`document.querySelectorAll('.language-menu button')[2].click()`);
  await sleep(800);
  console.log('after choosing the 3rd language:', await js(`[...document.querySelectorAll('.topics-page button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 3).join(' | ')`));
  await js(RELOAD);
  await sleep(1500);
  await waitFor(`document.querySelectorAll('.topic-card').length >= 6`);
  console.log('after restart (reload):', await js(`[...document.querySelectorAll('.topics-page button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 3).join(' | ')`));

  console.log(`renderer errors in total: ${errors.length}${errors.length ? '\n  ' + [...new Set(errors)].slice(0, 10).join('\n  ') : ''}`);
  app.exit(0);
}

require(path.join(__dirname, '../../electron/index.js'));
