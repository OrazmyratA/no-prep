const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const chromePath =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:4200/';
const outDir = path.resolve(process.cwd(), 'test-results', 'android-layout');
const viewports = [
  { name: 'android-landscape', width: 915, height: 412, dpr: 2.625 },
  { name: 'small-landscape', width: 740, height: 360, dpr: 2 },
];
const games = [
  'flip-tiles',
  'match-pairs',
  'watch-memorize',
  'spotlight',
  'spin-wheel',
  'reveal-game',
  'pop-balloon',
  'test-abc',
  'anagram',
  'word-search',
  'unjumble',
  'team-tug',
  'spelling-check',
  'cup-clash',
  'odd-one-out',
  'team-sentence',
  'squid-game',
  'rock-paper-scissors',
];

let seq = 0;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    ws.on('open', () => {
      const client = {
        send(method, params = {}) {
          const id = ++seq;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej, method }));
        },
        close() {
          ws.close();
        },
      };
      ws.on('message', raw => {
        const msg = JSON.parse(raw.toString());
        if (!msg.id) return;
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.error) {
          entry.rej(new Error(`${entry.method}: ${msg.error.message}`));
        } else {
          entry.res(msg.result);
        }
      });
      resolve(client);
    });
    ws.on('error', reject);
  });
}

async function evalJs(client, expression, awaitPromise = true) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const detail =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.exception?.value ||
      result.exceptionDetails.text ||
      'Runtime evaluation failed';
    throw new Error(detail);
  }
  return result.result.value;
}

async function waitFor(client, expression, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await evalJs(client, `Boolean(${expression})`);
    if (ok) return;
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function navigate(client, url) {
  await client.send('Page.navigate', { url });
  await waitFor(client, 'document.readyState === "complete"', 15000);
}

async function seedTopic(client) {
  await navigate(client, baseUrl);
  await evalJs(
    client,
    `new Promise((resolve, reject) => {
      const open = indexedDB.open('NoPrepDB');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('topics') || !db.objectStoreNames.contains('items')) {
          reject(new Error('NoPrepDB is missing topics/items stores'));
          return;
        }
        const tx = db.transaction(['topics', 'items'], 'readwrite');
        const topics = tx.objectStore('topics');
        const items = tx.objectStore('items');
        topics.clear();
        items.clear();
        const now = new Date();
        topics.put({ id: 1, name: 'Android Landscape Test', createdAt: now, updatedAt: now });
        topics.put({ id: 2, name: 'Android Phrase Test', createdAt: now, updatedAt: now });
        const words = ['apple', 'banana', 'castle', 'dragon', 'ocean', 'rocket', 'tiger', 'pencil', 'rainbow', 'window', 'school', 'teacher'];
        words.forEach((text, index) => {
          const hue = (index * 31) % 360;
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" rx="28" fill="hsl(' + hue + ',78%,58%)"/><circle cx="82" cy="78" r="38" fill="rgba(255,255,255,.32)"/><text x="160" y="138" text-anchor="middle" font-family="Arial" font-size="38" font-weight="800" fill="white">' + text.toUpperCase() + '</text></svg>';
          const image = new Blob([svg], { type: 'image/svg+xml' });
          items.put({ id: index + 1, topicId: 1, text, image, order: index, createdAt: now });
        });
        const phrases = [
          'red apple',
          'blue ocean',
          'happy teacher',
          'small rocket',
          'golden castle',
          'green dragon',
          'rainbow pencil',
          'school window'
        ];
        phrases.forEach((text, index) => {
          const hue = (index * 43 + 18) % 360;
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" rx="28" fill="hsl(' + hue + ',74%,52%)"/><circle cx="82" cy="78" r="38" fill="rgba(255,255,255,.32)"/><text x="160" y="132" text-anchor="middle" font-family="Arial" font-size="30" font-weight="800" fill="white">' + text.toUpperCase() + '</text></svg>';
          const image = new Blob([svg], { type: 'image/svg+xml' });
          items.put({ id: 101 + index, topicId: 2, text, image, order: index, createdAt: now });
        });
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => reject(tx.error);
      };
    })`
  );
}

async function auditRoute(client, game, viewport) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.dpr,
    mobile: true,
    screenOrientation: { type: 'landscapePrimary', angle: 90 },
  });
  const topicId = game === 'unjumble' || game === 'spelling-check' ? 2 : 1;
  const spellingParams = encodeURIComponent(JSON.stringify(['-a-', '-e-', '-o-']));
  const query = game === 'spelling-check' ? `?omissionRules=${spellingParams}` : '';
  const url = `${baseUrl}#/topics/${topicId}/play/${game}${query}`;
  await navigate(client, url);
  await waitFor(client, '!document.querySelector(".animate-spin, .loading-overlay, .squid-loading")', 12000).catch(() => {});

  if (game === 'team-tug') {
    await evalJs(client, `document.querySelector('.start-btn')?.click()`);
    await waitFor(client, 'document.querySelector(".game-board")', 5000).catch(() => {});
  }

  await delay(350);
  const metrics = await evalJs(
    client,
    `(() => {
      const vv = window.visualViewport;
      const vw = vv?.width || window.innerWidth;
      const vh = vv?.height || window.innerHeight;
      const doc = document.documentElement;
      const body = document.body;
      let maxRight = 0;
      let maxBottom = 0;
      let minLeft = 0;
      const offenders = [];
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        maxRight = Math.max(maxRight, r.right);
        maxBottom = Math.max(maxBottom, r.bottom);
        minLeft = Math.min(minLeft, r.left);
        const bottomOver = r.bottom - vh;
        const rightOver = r.right - vw;
        if (bottomOver > 2 || rightOver > 2 || r.left < -2 || r.top < -2) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className || '').slice(0, 80),
            text: (el.innerText || el.textContent || '').trim().slice(0, 60),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) },
            bottomOver: Math.round(bottomOver),
            rightOver: Math.round(rightOver)
          });
        }
      }
      return {
        viewport: { width: vw, height: vh },
        scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
        scrollHeight: Math.max(doc.scrollHeight, body.scrollHeight),
        maxRight: Math.round(maxRight),
        maxBottom: Math.round(maxBottom),
        minLeft: Math.round(minLeft),
        offenders: offenders.slice(0, 8),
      };
    })()`
  );

  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(outDir, `${viewport.name}-${game}.png`);
  writeFileSync(file, Buffer.from(screenshot.data, 'base64'));
  return { game, viewport: viewport.name, file, ...metrics };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'noprep-layout-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9223',
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitForJson('http://127.0.0.1:9223/json/version');
    const targets = await waitForJson('http://127.0.0.1:9223/json/list');
    const pageTarget = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error('No Chrome page target found');
    const client = await connect(pageTarget.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await seedTopic(client);

    const results = [];
    for (const viewport of viewports) {
      for (const game of games) {
        const result = await auditRoute(client, game, viewport);
        results.push(result);
        const overflowY = result.scrollHeight - result.viewport.height;
        const overflowX = result.scrollWidth - result.viewport.width;
        const status = overflowY > 2 || overflowX > 2 ? 'FAIL' : 'OK';
        console.log(`${status} ${viewport.name} ${game} scroll ${overflowX}x${overflowY} max ${result.maxRight}x${result.maxBottom}`);
        if (status === 'FAIL' && result.offenders.length) {
          console.log(JSON.stringify(result.offenders.slice(0, 3), null, 2));
        }
      }
    }

    writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));
    client.close();
  } finally {
    chrome.kill();
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn(`Could not remove temporary Chrome profile: ${userDataDir}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
