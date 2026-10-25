// Smoothness benchmark for production builds (see docs/optimisation-plan.md).
//
//   node scripts/perf/bench.mjs <buildDir> [<buildDir> ...] [--rounds 3]
//
// Serves each build (the folder with index.html, e.g. dist/no-prep/browser), drives a headless
// Chrome over the DevTools protocol with the CPU slowed (THROTTLE, default 6×), seeds a library like
// a real one (TOPICS × ITEMS, each item with a picture and two audio clips) and times the main
// teacher paths. With several builds the runs are interleaved (A B B A …) so the machine's own load
// hits all of them equally; medians are printed side by side.
//
// Env: THROTTLE, TOPICS, ITEMS, CHROME (path to chrome.exe), WINDOW (default 1366,768).
//
// ANDROID=1: run on the Chrome of a phone/tablet connected with USB debugging (adb), at its real
// speed (THROTTLE defaults to 1) with a tablet layout (ANDROID_SIZE, default 1280x800x1.5). The page
// is served from this PC through `adb reverse`; nothing is installed, and the test data is cleared
// from the device's Chrome afterwards. ADB = path to adb.exe if it is not on PATH.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const roundsAt = args.indexOf('--rounds');
const ROUNDS = roundsAt >= 0 ? Number(args.splice(roundsAt, 2)[1]) : 3;
const builds = args.map(dir => path.resolve(dir));
if (!builds.length) { console.error('usage: node scripts/perf/bench.mjs <buildDir> [...] [--rounds N]'); process.exit(1); }

const ANDROID = !!process.env.ANDROID;
const THROTTLE = Number(process.env.THROTTLE || (ANDROID ? 1 : 6));
const TOPICS = Number(process.env.TOPICS || 120);
const ITEMS = Number(process.env.ITEMS || 20);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4318, DEBUG_PORT = 9333;
if (ANDROID) {
  const { execFileSync } = await import('node:child_process');
  const adb = process.env.ADB || 'adb';
  execFileSync(adb, ['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
  execFileSync(adb, ['forward', `tcp:${DEBUG_PORT}`, 'localabstract:chrome_devtools_remote']);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webm': 'video/webm', '.mp4': 'video/mp4' };
let servedRoot = builds[0];
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(servedRoot, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT);

// ---- Chrome over CDP -------------------------------------------------------------------------
// One command on the browser-wide DevTools connection (opens its own short-lived socket).
async function browserCommand(method, params = {}) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const reply = await new Promise(resolve => {
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id === 1) resolve(m); });
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
  return reply.result;
}

async function openChrome() {
  let profile, proc;
  if (!ANDROID) {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-bench-'));
    proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, `--window-size=${process.env.WINDOW || '1366,768'}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  }
  let target;
  if (ANDROID) {
    // Chrome on Android refuses /json/new; the browser target can still open a tab.
    target = { id: (await browserCommand('Target.createTarget', { url: 'about:blank' })).targetId };
    target.webSocketDebuggerUrl = `ws://127.0.0.1:${DEBUG_PORT}/devtools/page/${target.id}`;
  }
  for (let i = 0; i < 50 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let seq = 0; const pending = new Map();
  // Replies resolve their request; protocol events go to api.onEvent when a mode sets it.
  let api = null;
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); } else if (!m.id) api?.onEvent?.(m); });
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (fn, ...a) => {
    const r = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(a)})`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__firstCard=-1;new MutationObserver((ms,o)=>{if(document.querySelector('.topic-card')){window.__firstCard=Math.round(performance.now());o.disconnect();}}).observe(document,{childList:true,subtree:true});window.__lt=[];try{new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__lt.push(e.duration))).observe({type:'longtask',buffered:true})}catch(e){}` });
  // Android: a tablet layout (1280x800 CSS px) drawn at the largest DPR that fits what the device
  // shows — it must fit, or whatever is drawn beyond the screen is garbage. With the phone landscape
  // and `fullscreen` (not kept across reloads), a 2436x1080 phone gets DPR 1.35: ~1.9 Mpx a frame,
  // close to a 1920x1200 tablet. The override itself is kept across navigations and reloads.
  const tabletView = async ({ fullscreen = false } = {}) => {
    if (!ANDROID) return;
    await send('Emulation.clearDeviceMetricsOverride');
    if (fullscreen) {
      await send('Runtime.evaluate', { expression: 'document.documentElement.requestFullscreen().catch(() => {})', userGesture: true, awaitPromise: true });
      await sleep(1000);
    }
    // Going fullscreen can briefly report the portrait size; wait for landscape (the phone must be
    // turned/set landscape, or the tablet layout would be drawn at a third of the pixels).
    let shown;
    for (let i = 0; i < 25; i++) {
      shown = await evaluate(`() => ({ w: innerWidth * devicePixelRatio, h: innerHeight * devicePixelRatio })`);
      if (shown.w > shown.h) break;
      await sleep(200);
    }
    if (shown.w <= shown.h) throw new Error(`device is in portrait (${Math.round(shown.w)}x${Math.round(shown.h)}): turn it landscape`);
    const dpr = Math.floor(Math.min(shown.w / 1280, shown.h / 800) * 100) / 100;
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: dpr, mobile: true });
    await sleep(500);
    console.log(`  tablet view 1280x800 at DPR ${dpr} (device shows ${Math.round(shown.w)}x${Math.round(shown.h)} px${fullscreen ? ', fullscreen' : ''})`);
  };
  const close = async () => {
    if (ANDROID) {
      // The phone's own Chrome profile: leave nothing of the test behind.
      await send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${PORT}`, storageTypes: 'all' });
      ws.close();
      await browserCommand('Target.closeTarget', { targetId: target.id }).catch(() => {});
      return;
    }
    ws.close(); proc.kill(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { } }, 500);
  };
  api = { send, evaluate, close, tabletView, onEvent: null };
  return api;
}

// ---- In-page helpers (stringified into the page) ----------------------------------------------
// Waits (frame by frame) until cond holds; returns ms and long-task ms in between.
const waitFor = async (hash, condSrc, timeout) => {
  const cond = new Function(`return (${condSrc})`);
  const lt0 = (window.__lt || []).reduce((a, b) => a + b, 0);
  const t0 = performance.now();
  if (hash !== null) location.hash = hash;
  while (!cond()) {
    if (performance.now() - t0 > timeout) return { ms: -1 };
    await new Promise(r => requestAnimationFrame(r));
  }
  return { ms: Math.round(performance.now() - t0), longTasks: Math.round((window.__lt || []).reduce((a, b) => a + b, 0) - lt0) };
};
const seed = async (topics, items) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('NoPrepDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const pictures = [];
  for (let i = 0; i < 6; i++) {
    const c = new OffscreenCanvas(800, 600); const g = c.getContext('2d');
    for (let k = 0; k < 400; k++) { g.fillStyle = `hsl(${(i * 60 + k) % 360},70%,${30 + (k % 50)}%)`; g.fillRect(Math.random() * 800, Math.random() * 600, 60, 60); }
    pictures.push(await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
  }
  const words = ['apple', 'house', 'water', 'green', 'table', 'chair', 'bread', 'light', 'music', 'river', 'plant', 'smile'];
  const tx = db.transaction(['topics', 'items'], 'readwrite');
  const now = new Date();
  for (let t = 1; t <= topics; t++) {
    tx.objectStore('topics').put({ id: t, name: `Topic ${t}`, createdAt: now, updatedAt: now, itemCount: items });
    for (let k = 0; k < items; k++) {
      tx.objectStore('items').put({ topicId: t, text: words[k % words.length], image: pictures[(t + k) % pictures.length], audio: new Blob([new Uint8Array(30000)], { type: 'audio/mpeg' }), audioSource: new Blob([new Uint8Array(30000)], { type: 'audio/mpeg' }), order: k, createdAt: now });
    }
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
};

// What the teacher sees first: the first row(s) of cards with the splash gone or fading out
// (the cards show through while it fades; its removal afterwards is only a timer).
const FIRST_SCREEN = `document.querySelectorAll('.topic-card').length >= ${Math.min(8, TOPICS)} && (!document.getElementById('app-splash') || document.getElementById('app-splash').classList.contains('is-hiding'))`;
const LIST_READY = `document.querySelectorAll('.topic-card').length >= ${TOPICS} && !document.getElementById('app-splash')`;
// Only covers on screen: checking them all would force layout of cards the browser may skip.
const COVERS_READY = `document.querySelectorAll('.topic-card img[src^="blob:"]').length >= ${TOPICS} && [...document.querySelectorAll('.topic-card:nth-child(-n+8) img')].every(i => i.complete && i.naturalWidth > 0)`;
const ACTIVITIES_READY = `(document.querySelector('.activity-page h1')?.textContent || '').includes('Topic 5') && document.querySelectorAll('.activity-page .np-card').length > 10`;
const GAME_READY = `(() => { const c = document.querySelector('app-spin-wheel canvas'); return !!c && c.width > 0; })()`;

async function runOnce(build) {
  servedRoot = build;
  const chrome = await openChrome();
  const { send, evaluate } = chrome;
  try {
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/topics` });
    await evaluate(waitFor.toString(), null, `!!document.querySelector('.topics-page')`, 60000);
    await chrome.tabletView();
    await evaluate(seed.toString(), TOPICS, ITEMS);
    await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await send('Performance.enable');
    await send('Page.reload', {});
    let first;
    for (let i = 0; i < 600 && !first; i++) {
      await sleep(20);
      try { first = await evaluate(`() => (${FIRST_SCREEN}) ? Math.round(performance.now()) : null`); } catch { }
    }
    const all = await evaluate(waitFor.toString(), null, LIST_READY, 60000);
    const cold = first && all.ms >= 0 ? first + all.ms : null;
    const r = { coldFirstCard: await evaluate(`() => window.__firstCard`), coldFirstScreen: first ?? -1, coldList: cold ?? -1 };
    const covers = await evaluate(waitFor.toString(), null, COVERS_READY, 60000);
    r.coldCovers = cold && covers.ms >= 0 ? cold + covers.ms : -1;
    r.coldLongTasks = await evaluate(`() => Math.round((window.__lt || []).reduce((a, b) => a + b, 0))`);
    // All main-thread work (JS, style, layout, paint) from reload until every card and cover is in.
    const metrics = Object.fromEntries((await send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    r.coldCpuMs = Math.round(metrics.TaskDuration * 1000);
    await sleep(300);
    r.enterTopic = (await evaluate(waitFor.toString(), '#/topics/5/activities', ACTIVITIES_READY, 60000)).ms;
    await sleep(300);
    const backFirst = await evaluate(waitFor.toString(), '#/topics', FIRST_SCREEN, 60000);
    const back = await evaluate(waitFor.toString(), null, LIST_READY, 60000);
    r.backFirstScreen = backFirst.ms;
    if (back.ms >= 0 && backFirst.ms >= 0) back.ms += backFirst.ms;
    const backCovers = await evaluate(waitFor.toString(), null, COVERS_READY, 60000);
    r.backToList = back.ms;
    r.backCovers = back.ms >= 0 && backCovers.ms >= 0 ? back.ms + backCovers.ms : -1;
    await sleep(300);
    await evaluate(waitFor.toString(), '#/topics/5/activities', ACTIVITIES_READY, 60000);
    await sleep(300);
    r.startGame = (await evaluate(waitFor.toString(), '#/topics/5/play/spin-wheel', GAME_READY, 60000)).ms;
    return r;
  } finally {
    await chrome.close();
    await sleep(800);
  }
}

// SHOT=<game> SHOT_OUT=<file.png> [SHOT_JS='() => …']: opens the game, waits SHOT_WAIT ms (4000),
// freezes CSS animations, optionally prints SHOT_JS's result, and saves a screenshot.
if (process.env.SHOT) {
  servedRoot = builds[0];
  const chrome = await openChrome();
  const { send, evaluate } = chrome;
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/topics` });
  await evaluate(waitFor.toString(), null, `!!document.querySelector('.topics-page')`, 60000);
  await evaluate(seed.toString(), 6, 12);
  await send('Page.reload', {});
  await sleep(1500);
  await chrome.tabletView({ fullscreen: true });
  await evaluate(`() => { location.hash = '#/topics/5/play/${process.env.SHOT}'; }`);
  await sleep(Number(process.env.SHOT_WAIT || 4000));
  await evaluate(`() => document.getAnimations().forEach(a => a.pause())`);
  if (process.env.SHOT_JS) console.log(JSON.stringify(await evaluate(process.env.SHOT_JS)));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (process.env.SHOT_OUT) fs.writeFileSync(process.env.SHOT_OUT, Buffer.from(shot.data, 'base64'));
  await chrome.close(); server.close();
  setTimeout(() => process.exit(0), 1000);
} else
// IDLE=1 (or IDLE=spin-wheel,pop-balloon): opens each game, waits for it to settle, then measures
// main-thread work over 5 s of doing nothing. A screen at rest should cost almost nothing; a high
// number means something animates or polls on the main thread for as long as the game is open.
if (process.env.IDLE) {
  servedRoot = builds[0];
  const routing = fs.readFileSync(new URL('../../src/app/features/games/games-routing.module.ts', import.meta.url), 'utf8');
  const all = [...routing.matchAll(/path: '([\w-]+)'/g)].map(m => m[1]);
  const games = process.env.IDLE === '1' ? all : process.env.IDLE.split(',');
  const chrome = await openChrome();
  const { send, evaluate } = chrome;
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/topics` });
  await evaluate(waitFor.toString(), null, `!!document.querySelector('.topics-page')`, 60000);
  await evaluate(seed.toString(), 6, 12);
  await send('Page.reload', {});
  await sleep(1500);
  await chrome.tabletView({ fullscreen: true });
  await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await send('Performance.enable');
  const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  // CPU of every Chrome process (GPU, video decoding, raster…), which the page metrics above miss.
  // Not slowed by THROTTLE: only the page's main thread is.
  // (Not available from a phone's Chrome: reported as 0 there.)
  const browserWs = ANDROID ? null : new WebSocket((await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json()).webSocketDebuggerUrl);
  if (browserWs) await new Promise(r => browserWs.addEventListener('open', r));
  const allCpu = () => !browserWs ? Promise.resolve(0) : new Promise(r => {
    browserWs.addEventListener('message', ev => r(JSON.parse(ev.data).result.processInfo.reduce((a, p) => a + p.cpuTime, 0)), { once: true });
    browserWs.send(JSON.stringify({ id: 1, method: 'SystemInfo.getProcessInfo' }));
  });
  const rows = [];
  for (const game of games) {
    await evaluate(`() => { location.hash = '#/topics/5/activities'; }`);
    await sleep(1500);
    await evaluate(`() => { location.hash = '#/topics/5/play/${game}'; }`);
    await sleep(Number(process.env.IDLE_SETTLE || 6000));
    const stayed = await evaluate(`() => location.hash.includes('/play/${game}')`);
    // IDLE_CSS=<css>: added to the game before measuring (to test a style change without a rebuild).
    if (process.env.IDLE_CSS) { await evaluate(`(css) => document.head.insertAdjacentHTML("beforeend", "<style>" + css + "</style>")`, process.env.IDLE_CSS); await sleep(1000); }
    await evaluate(`() => { window.__frames = 0; const tick = () => { window.__frames++; window.__frameLoop = requestAnimationFrame(tick); }; cancelAnimationFrame(window.__frameLoop); window.__frameLoop = requestAnimationFrame(tick); }`);
    const m0 = await metrics(), cpu0 = await allCpu();
    let events = [], traced;
    if (process.env.IDLE_TRACE) {
      traced = new Promise(r => { chrome.onEvent = (msg) => { if (msg.method === 'Tracing.dataCollected') events.push(...msg.params.value); if (msg.method === 'Tracing.tracingComplete') r(); }; });
      await send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,blink', transferMode: 'ReportEvents' });
    }
    await sleep(5000);
    const m1 = await metrics(), cpu1 = await allCpu();
    const fps = Math.round(await evaluate(`() => window.__frames`) / 5);
    if (process.env.IDLE_TRACE) {
      await send('Tracing.end'); await traced;
      // Per event name: total ms, count, and for style/layout how many elements each pass touched.
      const sums = new Map();
      for (const e of events) {
        if (e.ph !== 'X' || !e.dur) continue;
        const s = sums.get(e.name) || { ms: 0, n: 0, elements: 0 };
        s.ms += e.dur / 1000; s.n++;
        s.elements += e.args?.elementCount ?? e.args?.beginData?.dirtyObjects ?? 0;
        sums.set(e.name, s);
      }
      for (const name of ['UpdateLayoutTree', 'Layout', 'Paint', 'RasterTask', 'Decode Image', 'PrePaint', 'Layerize', 'Commit']) {
        const s = sums.get(name); if (!s) continue;
        console.log(`   ${name.padEnd(16)} ${s.ms.toFixed(0).padStart(6)} ms  ×${s.n}${s.elements ? `  avg elements/objects ${Math.round(s.elements / s.n)}` : ''}`);
      }
      const invalid = new Map();
      for (const e of events) {
        if (e.name === 'StyleRecalcInvalidationTracking' || e.name === 'StyleInvalidatorInvalidationTracking' || e.name === 'ScheduleStyleInvalidationTracking') {
          const d = e.args?.data || {}; const key = `${e.name.replace('InvalidationTracking', '')}: ${d.reason || d.changedAttribute || d.changedClass || d.changedPseudo || ''} ${d.nodeName || ''}`;
          invalid.set(key, (invalid.get(key) || 0) + 1);
        }
      }
      for (const [k, v] of [...invalid].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${String(v).padStart(6)}× ${k}`);
    }
    const ms = k => Math.round((m1[k] - m0[k]) * 1000);
    rows.push([game, stayed ? ms('TaskDuration') : -1, ms('ScriptDuration'), ms('RecalcStyleDuration'), ms('LayoutDuration')]);
    // IDLE_COUNT=<selector>: how many such elements were on screen (games with random content vary).
    if (process.env.IDLE_COUNT) console.log(`   ${process.env.IDLE_COUNT}: ${await evaluate(`() => document.querySelectorAll(${JSON.stringify(process.env.IDLE_COUNT)}).length`)}`);
    console.log(`${game.padEnd(20)} ${stayed ? String(ms('TaskDuration')).padStart(5) + ' ms busy of 5000, ' + String(fps).padStart(2) + ' fps' : '  (left the game: needs other content)'}   script ${ms('ScriptDuration')}  style ${ms('RecalcStyleDuration')}  layout ${ms('LayoutDuration')}  all processes ${Math.round((cpu1 - cpu0) * 1000)} ms CPU`);
  }
  browserWs?.close(); await chrome.close(); server.close();
  setTimeout(() => process.exit(0), 1000);
} else
// DBKEYS=1: on the seeded DB (throttled), time ways of reading item ids per topic without records.
if (process.env.DBKEYS) {
  servedRoot = builds[0];
  const chrome = await openChrome();
  const { send, evaluate } = chrome;
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/topics` });
  await evaluate(waitFor.toString(), null, `!!document.querySelector('.topics-page')`, 60000);
  await evaluate(seed.toString(), TOPICS, ITEMS);
  await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const result = await evaluate(`async () => {
    const db = await new Promise(r => { const q = indexedDB.open('NoPrepDB'); q.onsuccess = () => r(q.result); });
    const index = () => db.transaction('items').objectStore('items').index('topicId');
    const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const out = {};
    let t = performance.now();
    await new Promise(res => { let n = 0; const c = index().openKeyCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { n++; cur.continue(); } else res(n); }; });
    out.keyCursorMs = Math.round(performance.now() - t);
    const topics = await req(db.transaction('topics').objectStore('topics').getAllKeys());
    t = performance.now();
    const idx = index();
    await Promise.all(topics.map(id => req(idx.getAllKeys(IDBKeyRange.only(id)))));
    out.perTopicGetAllKeysMs = Math.round(performance.now() - t);
    t = performance.now();
    await req(db.transaction('items').objectStore('items').index('order').getAllKeys());
    out.orderIndexGetAllKeysMs = Math.round(performance.now() - t);
    db.close();
    return out;
  }`);
  console.log(JSON.stringify(result));
  await chrome.close(); server.close();
  setTimeout(() => process.exit(0), 1000);
} else
// TIMELINE=1: one throttled cold start of the first build; prints when the startup milestones
// happened (ms since navigation): scripts parsed, topics page, first card, splash gone, all cards.
if (process.env.TIMELINE) {
  servedRoot = builds[0];
  const chrome = await openChrome();
  const { send, evaluate } = chrome;
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/topics` });
  await evaluate(waitFor.toString(), null, `!!document.querySelector('.topics-page')`, 60000);
  await evaluate(seed.toString(), TOPICS, ITEMS);
  await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const marks = window.__marks = {};
    const mark = (k) => { if (!(k in marks)) marks[k] = Math.round(performance.now()); };
    new MutationObserver(() => {
      if (document.querySelector('app-root > *')) mark('appRendered');
      if (document.querySelector('.topics-page')) mark('topicsPage');
      if (document.querySelector('.topic-card')) mark('firstCard');
      if (document.body && /No topics yet/.test(document.body.innerText)) mark('emptyStateShown');
      if (document.querySelector('.topic-card img[src^="blob:"]')) mark('firstCover');
      if (document.querySelectorAll('.topic-card').length >= ${TOPICS}) mark('allCards');
      if (document.getElementById('app-splash')?.classList.contains('is-hiding')) mark('splashHiding');
      if (document.readyState !== 'loading' && !document.getElementById('app-splash')) mark('splashGone');
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('DOMContentLoaded', () => mark('domContentLoaded'));
  })();` });
  await send('Page.reload', {});
  for (let i = 0; i < 600; i++) {
    await sleep(100);
    try { if (await evaluate(`() => 'allCards' in (window.__marks || {}) && 'splashGone' in window.__marks`)) break; } catch { }
  }
  await sleep(500);
  const marks = await evaluate(`() => window.__marks`);
  for (const [k, v] of Object.entries(marks).sort((a, b) => a[1] - b[1])) console.log(String(v).padStart(7), 'ms ', k);
  await chrome.close(); server.close();
  setTimeout(() => process.exit(0), 1000);
} else
// PROFILE=1: one throttled cold start of the first build under the CPU profiler; prints where the
// main thread's time went (self time per function and per source file), then exits.
if (process.env.PROFILE) {
  servedRoot = builds[0];
  const chrome = await openChrome();
  const { send, evaluate } = chrome;
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/topics` });
  await evaluate(waitFor.toString(), null, `!!document.querySelector('.topics-page')`, 60000);
  await evaluate(seed.toString(), TOPICS, ITEMS);
  await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 250 });
  await send('Profiler.start');
  await send('Page.reload', {});
  for (let i = 0; i < 600; i++) {
    await sleep(50);
    try { if (await evaluate(`() => ${COVERS_READY}`)) break; } catch { }
  }
  const { profile } = await send('Profiler.stop');
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const fn = new Map(), file = new Map();
  profile.samples.forEach((id, i) => {
    const ms = (profile.timeDeltas[i] || 0) / 1000;
    const cf = byId.get(id).callFrame;
    const src = cf.url ? cf.url.split('/').pop() : `(${cf.functionName || 'native'})`;
    fn.set(`${cf.functionName || '(anon)'}  ${src}:${cf.lineNumber}:${cf.columnNumber}`, (fn.get(`${cf.functionName || '(anon)'}  ${src}:${cf.lineNumber}:${cf.columnNumber}`) || 0) + ms);
    file.set(src, (file.get(src) || 0) + ms);
  });
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(7)} ms  ${k}`).join('\n');
  console.log(`-- by file (${THROTTLE}× throttle)\n${top(file, 15)}\n-- by function\n${top(fn, 30)}`);
  await chrome.close(); server.close();
  setTimeout(() => process.exit(0), 1000);
} else {
const all = builds.map(() => ({}));
for (let round = 0; round < ROUNDS; round++) {
  const order = round % 2 ? [...builds.keys()].reverse() : [...builds.keys()];
  for (const b of order) {
    const r = await runOnce(builds[b]);
    for (const [k, v] of Object.entries(r)) (all[b][k] ||= []).push(v);
    process.stderr.write(`round ${round + 1}/${ROUNDS} build ${b + 1} done\n`);
  }
}
const median = a => { const s = a.filter(x => x >= 0).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : -1; };
const labels = builds.map(b => path.basename(path.dirname(b)) + '/' + path.basename(b));
console.log(`THROTTLE ${THROTTLE}×, ${TOPICS} topics × ${ITEMS} items, ${ROUNDS} rounds — medians (ms)`);
console.log('metric'.padEnd(14) + labels.map(l => l.slice(-22).padStart(24)).join(''));
for (const k of Object.keys(all[0])) console.log(k.padEnd(14) + all.map(a => String(median(a[k])).padStart(24)).join(''));
server.close();
process.exit(0);
}
