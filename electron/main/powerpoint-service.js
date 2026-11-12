// Talks to Microsoft PowerPoint through the helper in powerpoint-helper-script.js. The helper is
// started on first use and kept for the session; commands are queued one at a time.
const HELPER_SCRIPT = require('./powerpoint-helper-script');

const COMMAND_TIMEOUT_MS = {
  default: 15000,
  play: 90000,     // a big presentation (25 MB+) can take a while to open
  thumb: 90000,
  slides: 120000,  // pictures of every slide, made once per presentation
  new: 60000,
  edit: 60000
};

// After this long without a command (and no show), a PowerPoint the helper started is let go.
const IDLE_QUIT_MS = 3 * 60 * 1000;

function createPowerPointService({ app, fsp, path, spawn, execFileText }) {
  let child = null;
  let idleTimer = null;
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  let available = null;

  async function isAvailable() {
    if (process.platform !== 'win32') return false;
    if (available !== null) return available;
    try {
      const text = await execFileText('reg', ['query', 'HKCR\\PowerPoint.Application\\CurVer']);
      available = /PowerPoint\.Application/i.test(String(text));
    } catch {
      available = false;
    }
    return available;
  }

  async function ensureHelper() {
    if (child && !child.killed && child.exitCode === null) return child;
    const scriptPath = path.join(app.getPath('temp'), 'noprep-powerpoint-helper.ps1');
    // UTF-8 with BOM, so Windows PowerShell 5.1 reads any non-ASCII text in the script correctly.
    await fsp.writeFile(scriptPath, '﻿' + HELPER_SCRIPT, 'utf8');
    buffer = '';
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      windowsHide: true
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line.startsWith('{')) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const entry = pending.get(message.id);
        if (!entry) continue;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        entry.resolve(message);
      }
    });
    child.stderr.on('data', (chunk) => console.warn('[powerpoint]', String(chunk).trim()));
    const exited = child;
    child.on('exit', () => {
      if (child === exited) child = null;
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ id, ok: false, error: 'PowerPoint helper stopped.' });
      }
      pending.clear();
    });
    return child;
  }

  async function send(cmd, args = {}) {
    if (!(await isAvailable())) return { ok: false, error: 'POWERPOINT_MISSING' };
    const helper = await ensureHelper();
    const id = nextId++;
    if (cmd !== 'idle') {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (child) void send('idle'); }, IDLE_QUIT_MS);
      idleTimer.unref?.();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ id, ok: false, error: 'TIMEOUT' });
      }, COMMAND_TIMEOUT_MS[cmd] ?? COMMAND_TIMEOUT_MS.default);
      pending.set(id, { resolve, timer });
      helper.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  /** Starts the helper and PowerPoint ahead of time, so the first slideshow opens sooner. */
  function warm() {
    void send('warm');
  }

  /** Ends any slideshow and lets the helper go (on app quit). Never kills PowerPoint itself. */
  async function shutdown() {
    clearTimeout(idleTimer);
    if (!child) return;
    const helper = child;
    await Promise.race([send('quit'), new Promise((r) => setTimeout(r, 4000))]);
    try { helper.stdin.end(); } catch { /* already gone */ }
  }

  return { isAvailable, send, warm, shutdown };
}

module.exports = { createPowerPointService };
