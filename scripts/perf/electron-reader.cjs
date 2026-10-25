// Book reader timing in the real desktop app: copies one of your books into a throwaway profile
// (your own profile and books are only read), opens it, and times page turns.
//
//   npm run build && npx electron scripts/perf/electron-reader.cjs <bookFolder> [throttle=4] [WxH=1366x768]
//   (from Git Bash: env -u ELECTRON_RUN_AS_NODE npx electron …)
//
// Reports: open → first page drawn; a calm turn (1.5 s after the previous, so prefetch had time);
// a turn the teacher makes right after arriving (before prefetch finished); 8 quick turns 150 ms
// apart (flipping to a page); and main-thread long tasks in the 1.5 s after each calm turn, which is
// the prefetch drawing the neighbours (anything the teacher taps then waits for it).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const [bookDir, throttleArg, sizeArg] = process.argv.slice(2).filter(a => !a.startsWith('--') && !a.endsWith('.cjs'));
if (!bookDir || !fs.existsSync(path.join(bookDir, 'book.json'))) { console.error('usage: electron-reader.cjs <bookFolder with book.json> [throttle] [WxH]'); process.exit(1); }
const THROTTLE = Number(throttleArg || 4);
const [WIDTH, HEIGHT] = (sizeArg || '1366x768').split('x').map(Number);

// Chromium still holds a few files while it shuts down; sweep what earlier runs left.
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('np-reader-'))) { try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { } }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-reader-'));
// app.exit() ends the process at once, so clean up on the way out (also after a crash).
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { } });
const book = JSON.parse(fs.readFileSync(path.join(bookDir, 'book.json'), 'utf8'));
const booksRoot = path.join(profile, 'Books');
const target = path.join(booksRoot, book.id);
fs.cpSync(bookDir, target, { recursive: true });
fs.writeFileSync(path.join(booksRoot, 'book-registry.json'), JSON.stringify([{ id: book.id, title: book.title, folderPath: target, coverPath: 'cover.png', pageCount: book.pages.length, createdAt: book.createdAt, updatedAt: book.updatedAt }]));
fs.writeFileSync(path.join(profile, 'book-storage-settings.json'), JSON.stringify({ configured: true, useDefault: true, booksRoot }));

const setName = app.setName.bind(app);
app.setName = (name) => { setName(name); app.setPath('userData', profile); };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : -1; };

app.on('browser-window-created', (_, win) => {
  win.webContents.on('console-message', (event) => { if (event.level === 'error' || event.level === 'warning') console.log('[renderer]', String(event.message).slice(0, 200)); });
  win.webContents.once('did-finish-load', () => run(win).catch((e) => { console.error(e); app.exit(1); }));
});

async function run(win) {
  const js = async (code) => {
    for (let attempt = 0; ; attempt++) {
      try { return await win.webContents.executeJavaScript(code, true); } catch (e) { if (attempt >= 10) throw e; await sleep(300); }
    }
  };
  const waitFor = async (cond, timeout = 30000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try { if (await js(`!!(${cond})`)) return Date.now() - start; } catch { }
      await sleep(20);
    }
    return -1;
  };
  win.setContentSize(WIDTH, HEIGHT);
  // Measured frames must keep coming even when the window is behind others.
  win.webContents.setBackgroundThrottling(false);
  win.webContents.debugger.attach('1.3');
  await waitFor(`document.querySelector('.topics-page')`);
  await win.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await js(`window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([e.startTime, e.duration]))).observe({ type: 'longtask' }); true`);


  // In-page: resolves once the primary frame shows a page other than `notId` (or exactly `id`) and,
  // for a PDF page, its canvas is drawn; after a paint. Returns ms since `t0` (performance.now()).
  // async: Angular replaces the page's Promise, and Electron only waits for a native one.
  const PAGE_DRAWN = `async ({ notId, id, t0 }) => await new Promise(resolve => {
    const check = () => {
      const frame = document.querySelector('app-book-reader-page-frame [data-page-id]');
      const pageId = frame && frame.getAttribute('data-page-id');
      const host = frame && frame.querySelector('app-pdf-page-canvas');
      const canvas = host && host.querySelector('canvas');
      const ok = pageId && (id ? pageId === id : pageId !== notId) && (!host || (canvas.classList.contains('ready') && canvas.width > 0));
      if (ok) requestAnimationFrame(() => setTimeout(() => resolve({ ms: Math.round(performance.now() - t0), id: pageId, pdf: !!host }), 0));
      else if (performance.now() - t0 > 15000) resolve({ ms: -1, id: pageId, pdf: !!host, stuck: (document.querySelector('.task-overlay, .reader-task-overlay, app-book-reader-task-overlay') ? 'task overlay open; ' : '') + 'page ' + pageId + ', canvas ' + (canvas ? canvas.className + ' ' + canvas.width : 'none') });
      else requestAnimationFrame(check);
    };
    check();
  })`;
  const current = async () => js(`document.querySelector('app-book-reader-page-frame [data-page-id]')?.getAttribute('data-page-id')`);
  const now = async () => js(`performance.now()`);
  // The reader's own next-page edge button, as a teacher taps it.
  const turn = async () => js(`document.querySelector('.reader-page-edge.next')?.click(); true`);
  // Starts waiting in the page first, then presses Right, so a fast draw is not missed.
  const turnAndWait = async () => {
    if (process.env.READER_DEBUG) console.log('  turning from', await current());
    const t0 = await now();
    const drawn = js(`(${PAGE_DRAWN})(${JSON.stringify({ notId: await current(), t0 })})`);
    await turn();
    return drawn;
  };
  const longTasksSince = async (t) => js(`Math.round(window.__lt.filter(([s]) => s >= ${t}).reduce((a, [, d]) => a + d, 0))`);
  const pdfTurns = async (count, gap, label) => {
    const times = [], afterwards = [];
    for (let i = 0; i < count; i++) {
      const start = await now();
      const r = await turnAndWait();
      if (process.env.READER_DEBUG) console.log('  turn', i, JSON.stringify(r));
      await sleep(gap);
      if (r.ms < 0) { console.log('  turn did not finish:', r.stuck); break; }
      if (!r.pdf) { i--; continue; }
      times.push(r.ms);
      afterwards.push(await longTasksSince(start));
    }
    console.log(`${label}: median ${median(times)} ms  [${times.join(', ')}]`);
    return afterwards;
  };

  // Open at an ordinary PDF page (the reader honours history.state.pageId), not the progress map.
  const startPage = book.pages.filter(p => p.type === 'pdf')[25] || book.pages[0];
  const t0 = await now();
  await js(`history.pushState({ pageId: ${JSON.stringify(startPage.id)} }, '', '#/books/${book.id}/read'); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); true`);
  const opened = await waitFor(`document.querySelector('app-book-reader-page-frame [data-page-id], app-book-reader-progress-map')`, 60000);
  if (opened < 0) {
    console.log('the book did not open:', await js(`location.hash + ' | ' + (document.querySelector('app-book-reader')?.innerText || document.body.innerText).replace(/\\s+/g, ' ').slice(0, 300)`));
    app.exit(1);
    return;
  }
  console.log(`book: ${book.title} (${book.pages.length} pages), window ${WIDTH}x${HEIGHT}, CPU ${THROTTLE}×`);
  console.log(`open → first page shown: ${opened} ms (long tasks ${await longTasksSince(t0)} ms)`);
  const shown = await js(`(${PAGE_DRAWN})(${JSON.stringify({ id: startPage.id, t0 })})`);
  console.log(`open at page ${book.pages.indexOf(startPage) + 1} → drawn: ${shown.ms} ms`);
  console.log(`page canvas: ${await js(`(() => { const c = document.querySelector('app-book-reader-page-frame [data-page-id] app-pdf-page-canvas canvas'); if (!c) return 'not a PDF page'; const r = c.getBoundingClientRect(); return c.width + 'x' + c.height + ' drawn, shown ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' CSS px at DPR ' + devicePixelRatio; })()`)}`);

  await sleep(1500);
  console.log('timing turns…');
  const after = await pdfTurns(8, 1500, 'calm turn (next page prefetched)');
  console.log(`main-thread long tasks from a calm turn until 1.5 s later: median ${median(after)} ms  [${after.join(', ')}]`);
  await pdfTurns(6, 350, 'turn 350 ms after the previous one');

  // Flipping: 8 presses 150 ms apart; time until the page they end on is drawn.
  await sleep(1500);
  const flipStart = await now();
  for (let i = 0; i < 8; i++) { await turn(); await sleep(150); }
  await sleep(50);
  const flipped = await js(`(${PAGE_DRAWN})(${JSON.stringify({ id: await current(), t0: flipStart })})`);
  console.log(`8 quick turns (150 ms apart): last page drawn ${flipped.ms} ms after the first press`);

  app.exit(0);
}

require(path.join(__dirname, '../../electron/index.js'));
