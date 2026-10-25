// Frame rate and whole-app CPU per game in the real desktop app, with hardware graphics off (all
// drawing on the CPU, like a weak integrated GPU or tablet), and what the backdrop blurs cost:
// each game is measured as it is and with every backdrop-filter switched off.
//
//   npm run build && npx electron scripts/perf/electron-fps.cjs [game,game,…] [--gpu]
//   (from Git Bash: env -u ELECTRON_RUN_AS_NODE npx electron …)
//
// NO_BLUR='.zone' switches off only that selector's blur for the second column.
// Throwaway profile (seeded like electron-smoke.cjs); the real No-Prep profile is never touched.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const args = process.argv.slice(2).filter(a => !a.endsWith('.cjs'));
const useGpu = args.includes('--gpu');
const only = (args.find(a => !a.startsWith('--')) || '').split(',').filter(Boolean);
if (!useGpu) app.disableHardwareAcceleration();

// Chromium still holds a few files while it shuts down; sweep what earlier runs left.
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('np-fps-'))) { try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { } }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-fps-'));
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { } });
const setName = app.setName.bind(app);
app.setName = (name) => { setName(name); app.setPath('userData', profile); };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const NO_BLUR = `(() => { const s = document.createElement('style'); s.id = 'np-no-blur';
  s.textContent = '${process.env.NO_BLUR || '*, *::before, *::after'} { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';
  document.head.appendChild(s); return true; })()`;
const BLUR_BACK = `(() => { document.getElementById('np-no-blur')?.remove(); return true; })()`;

app.on('browser-window-created', (_, win) => {
  win.webContents.once('did-finish-load', () => run(win).catch((e) => { console.error(e); app.exit(1); }));
});

async function run(win) {
  const js = async (code) => {
    for (let attempt = 0; ; attempt++) {
      try { return await win.webContents.executeJavaScript(code, true); } catch (e) { if (attempt >= 10) throw e; await sleep(300); }
    }
  };
  win.setContentSize(1366, 768);
  win.webContents.setBackgroundThrottling(false);
  while (!(await js(`!!document.querySelector('.topics-page')`))) await sleep(200);
  await js(`(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('NoPrepDB'); q.onsuccess = () => r(q.result); });
    const c = new OffscreenCanvas(400, 300); const g = c.getContext('2d');
    const words = ['apple', 'house', 'water', 'green', 'table', 'chair', 'bread', 'light', 'music', 'river', 'plant', 'smile'];
    // Pictures first: a transaction closes as soon as the code awaits anything else.
    const pictures = [];
    for (let k = 0; k < words.length; k++) {
      g.fillStyle = 'hsl(' + k * 30 + ', 70%, 60%)'; g.fillRect(0, 0, 400, 300);
      pictures.push(await c.convertToBlob({ type: 'image/jpeg' }));
    }
    const tx = db.transaction(['topics', 'items'], 'readwrite');
    const now = new Date();
    tx.objectStore('topics').put({ id: 5, name: 'Topic 5', createdAt: now, updatedAt: now });
    words.forEach((w, k) => tx.objectStore('items').put({ topicId: 5, text: w, image: pictures[k], order: k, createdAt: now }));
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
    db.close(); return true;
  })()`);
  await js(`setTimeout(() => location.reload(), 0); true`);
  await sleep(2500);

  const routing = fs.readFileSync(path.join(__dirname, '../../src/app/features/games/games-routing.module.ts'), 'utf8');
  const games = [...routing.matchAll(/path: '([\w-]+)'/g)].map(m => m[1]).filter(g => !only.length || only.includes(g));

  // Frames shown and CPU of every app process (renderer, GPU/compositor, browser) over 5 s.
  const measure = async () => {
    await js(`window.__frames = 0; cancelAnimationFrame(window.__frameLoop); (function tick() { window.__frames++; window.__frameLoop = requestAnimationFrame(tick); })(); true`);
    app.getAppMetrics(); // starts the CPU window
    await sleep(5000);
    const cpu = app.getAppMetrics().reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0);
    const frames = await js(`window.__frames`);
    return { fps: Math.round(frames / 5), cpu: Math.round(cpu) };
  };

  console.log(`hardware graphics ${useGpu ? 'ON' : 'OFF (software drawing)'}, window 1366x768, ${os.cpus().length} logical CPUs`);
  console.log(`${'game'.padEnd(20)} ${'blurs'.padStart(5)}  ${'as is'.padStart(16)}  ${'no blur'.padStart(16)}`);
  for (const game of games) {
    await js(`location.hash = '#/topics/5/activities'; true`);
    await sleep(1200);
    await js(`location.hash = '#/topics/5/play/${game}'; true`);
    await sleep(6000);
    if (!(await js(`location.hash.includes('/play/${game}')`))) { console.log(`${game.padEnd(20)} (left the game: needs other content)`); continue; }
    // EXTRA_CSS (e.g. ".rps-overlay { display: none !important }") applies to both measurements.
    if (process.env.EXTRA_CSS) { await js(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(process.env.EXTRA_CSS)}; document.head.appendChild(s); return true; })()`); await sleep(500); }
    const blurs = await js(`[...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return (s.backdropFilter && s.backdropFilter !== 'none') && e.getClientRects().length; }).length`);
    if (process.env.LIST_BLUR) console.log(await js(`[...document.querySelectorAll("*")].filter(e => { const s = getComputedStyle(e); return s.backdropFilter && s.backdropFilter !== "none" && e.getClientRects().length; }).map(e => { const r = e.getBoundingClientRect(); return "  " + e.tagName.toLowerCase() + "." + [...e.classList].join(".") + " " + getComputedStyle(e).backdropFilter + " " + Math.round(r.width) + "x" + Math.round(r.height); }).join("\\n")`));
    const asIs = await measure();
    await js(NO_BLUR);
    await sleep(500);
    const noBlur = await measure();
    await js(BLUR_BACK);
    const cell = (m) => `${String(m.fps).padStart(3)} fps ${String(m.cpu).padStart(4)} % CPU`;
    console.log(`${game.padEnd(20)} ${String(blurs).padStart(5)}  ${cell(asIs)}  ${cell(noBlur)}`);
  }
  app.exit(0);
}

require(path.join(__dirname, '../../electron/index.js'));
