// node --test electron/main   (npm run test:electron)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createGoogleDriveService, emailFromIdToken } = require('./google-drive-service');

const idToken = (email) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;

/** A pretend Google: tokens, the Drive files API and the resumable upload. */
function fakeGoogle() {
  const files = new Map();
  const calls = [];
  let next = 1;
  let refreshWorks = true;
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push(`${method} ${u.pathname}`);
    if (u.href.startsWith('https://oauth2.googleapis.com/token')) {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'authorization_code') {
        assert.equal(form.get('code'), 'the-code');
        assert.ok(form.get('code_verifier'));
        assert.match(form.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+$/);
        return json({ access_token: 'at1', expires_in: 3600, refresh_token: 'rt1', id_token: idToken('teacher@gmail.com') });
      }
      if (!refreshWorks) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'at2', expires_in: 3600 });
    }
    if (u.href.startsWith('https://oauth2.googleapis.com/revoke')) return json({});
    if (u.pathname.startsWith('/upload/drive/v3/files')) {
      if (u.searchParams.get('uploadType') !== 'resumable') return json({}, 400);
      const id = u.pathname.split('/')[5];
      const meta = JSON.parse(init.body);
      return json({}, 200, { location: `https://upload.example/session?${id ? `id=${id}` : `name=${encodeURIComponent(meta.name)}&parent=${meta.parents[0]}`}` });
    }
    if (u.host === 'upload.example') {
      const id = u.searchParams.get('id') || `file${next++}`;
      files.set(id, { ...(files.get(id) || { name: u.searchParams.get('name'), parent: u.searchParams.get('parent') }), content: init.body.toString('utf8') });
      return json({ id });
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      // The app's search: by name (and folder type or parent), never trashed; newest first.
      const q = u.searchParams.get('q');
      const name = /name = '([^']+)'/.exec(q)[1];
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const match = [...files.entries()].filter(([, f]) => f.name === name && !f.trashed && (!parent || f.parent === parent));
      const last = match[match.length - 1];
      return json({ files: last ? [{ id: last[0], webViewLink: `https://drive.google.com/drive/folders/${last[0]}` }] : [] });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(init.body);
      const id = `folder${next++}`;
      files.set(id, { name: meta.name, mimeType: meta.mimeType });
      return json({ id, webViewLink: `https://drive.google.com/drive/folders/${id}` });
    }
    if (u.pathname.startsWith('/drive/v3/files/')) {
      const parts = u.pathname.split('/');
      const file = files.get(decodeURIComponent(parts[4]));
      if (parts[5] === 'permissions') {
        if (!file) return json({}, 404);
        if (method === 'GET') return json({ permissions: file.anyone ? [{ id: 'anyoneWithLink', type: 'anyone' }] : [] });
        if (method === 'POST') {
          const p = JSON.parse(init.body);
          assert.deepEqual(p, { role: 'reader', type: 'anyone', allowFileDiscovery: false });
          file.anyone = true;
          return json({ id: 'anyoneWithLink' });
        }
        if (method === 'DELETE' && parts[6] === 'anyoneWithLink') {
          if (!file.anyone) return json({}, 404);
          file.anyone = false;
          return new Response(null, { status: 204 });
        }
      }
      return file ? json({ id: 'x', trashed: !!file.trashed }) : json({}, 404);
    }
    throw new Error(`unexpected ${method} ${url}`);
  }
  return { fetchImpl, files, calls, breakRefresh: () => { refreshWorks = false; } };
}

/** The teacher's browser: opening Google's page "allows" and comes back with a code. */
function browser({ allow = true } = {}) {
  return async (authUrl) => {
    const u = new URL(authUrl);
    assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file openid email');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    const back = new URL(u.searchParams.get('redirect_uri'));
    back.searchParams.set('state', u.searchParams.get('state'));
    back.searchParams.set(allow ? 'code' : 'error', allow ? 'the-code' : 'access_denied');
    setImmediate(() => http.get(back, (res) => res.resume()));
  };
}

function setup({ client = { clientId: 'cid', clientSecret: 'secret' }, allow = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-drive-'));
  const google = fakeGoogle();
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => b.toString().replace(/^enc:/, '')
  };
  const restart = () => createGoogleDriveService({
    fsp: fs.promises, path, getUserDataPath: () => dir, safeStorage,
    openExternal: browser({ allow }), loadClient: () => client, fetchImpl: google.fetchImpl
  });
  const stored = () => JSON.parse(fs.readFileSync(path.join(dir, 'google-drive.json'), 'utf8'));
  // The same teacher's Google Drive, linked from another computer (nothing stored there yet).
  const otherComputer = () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-drive-'));
    return createGoogleDriveService({
      fsp: fs.promises, path, getUserDataPath: () => otherDir, safeStorage,
      openExternal: browser({ allow }), loadClient: () => client, fetchImpl: google.fetchImpl
    });
  };
  return { service: restart(), restart, otherComputer, google, stored, dir };
}

test('without the OAuth client file the feature says "not available"', async () => {
  const { service } = setup({ client: null });
  assert.deepEqual(await service.getStatus(), { available: false, linked: false, needsRelink: false, email: '', folderUrl: '', lastBackupAt: null, lastError: '', shared: false });
  await assert.rejects(service.link(), { kind: 'NOT_AVAILABLE' });
});

test('link: the teacher allows in the browser; the folder is made and the token kept encrypted', async () => {
  const { service, google, stored } = setup();
  const status = await service.link();
  assert.equal(status.linked, true);
  assert.equal(status.email, 'teacher@gmail.com');
  assert.match(status.folderUrl, /^https:\/\/drive\.google\.com\/drive\/folders\/folder\d+$/);
  assert.equal([...google.files.values()][0].name, 'No-Prep backup');
  assert.equal(stored().refreshTokenEncrypted, true);
  assert.notEqual(stored().refreshToken, 'rt1');
});

test('link refused in the browser: nothing is stored', async () => {
  const { service } = setup({ allow: false });
  await assert.rejects(service.link(), { kind: 'CANCELLED' });
  assert.equal((await service.getStatus()).linked, false);
});

test('backup makes one file in the folder, then updates the same file', async () => {
  const { service, google } = setup();
  await service.link();
  await service.backup('{"topics":[1]}');
  await service.backup('{"topics":[1,2]}');
  const topicsFiles = [...google.files.values()].filter((f) => f.name === 'No-Prep topics.json');
  assert.equal(topicsFiles.length, 1);
  assert.equal(topicsFiles[0].content, '{"topics":[1,2]}');
  assert.ok((await service.getStatus()).lastBackupAt);
});

test('saves during an upload go one after another, the last one wins', async () => {
  const { service, google } = setup();
  await service.link();
  await Promise.all([service.backup('{"v":1}'), service.backup('{"v":2}'), service.backup('{"v":3}')]);
  const file = [...google.files.values()].find((f) => f.name === 'No-Prep topics.json');
  assert.equal(file.content, '{"v":3}');
});

test('a deleted backup folder is made again', async () => {
  const { service, google } = setup();
  await service.link();
  for (const file of google.files.values()) file.trashed = true;
  await service.backup('{"v":1}');
  const live = [...google.files.values()].filter((f) => !f.trashed);
  assert.deepEqual(live.map((f) => f.name).sort(), ['No-Prep backup', 'No-Prep topics.json']);
});

test('access removed in the Google account: the backup asks to link again', async () => {
  const { service, google, restart } = setup();
  await service.link();
  google.breakRefresh();
  // After a restart there is no access token in memory, so the stored link is used and refused.
  const restarted = restart();
  await assert.rejects(restarted.backup('{"v":1}'), { kind: 'RELINK' });
  const status = await restarted.getStatus();
  assert.equal(status.needsRelink, true);
  assert.equal(status.lastError, 'relink');
});

test('share with colleagues: the folder and the topics file become viewable by link, and back', async () => {
  const { service, google } = setup();
  await service.link();
  await service.backup('{"v":1}');
  const status = await service.setSharing(true);
  assert.equal(status.shared, true);
  assert.deepEqual([...google.files.values()].map((f) => [f.name, !!f.anyone]).sort(), [['No-Prep backup', true], ['No-Prep topics.json', true]]);
  const off = await service.setSharing(false);
  assert.equal(off.shared, false);
  assert.ok([...google.files.values()].every((f) => !f.anyone));
  // Stopping again (already stopped) is fine.
  assert.equal((await service.setSharing(false)).shared, false);
});

test('linking again from another computer finds the same folder and file, still shared', async () => {
  const { service, otherComputer, google } = setup();
  await service.link();
  await service.backup('{"from":"school"}');
  await service.setSharing(true);
  const firstUrl = (await service.getStatus()).folderUrl;

  const home = otherComputer();
  const status = await home.link();
  assert.equal(status.folderUrl, firstUrl);
  assert.equal(status.shared, true);
  await home.backup('{"from":"home"}');
  const named = (name) => [...google.files.values()].filter((f) => f.name === name);
  assert.equal(named('No-Prep backup').length, 1);
  assert.equal(named('No-Prep topics.json').length, 1);
  assert.equal(named('No-Prep topics.json')[0].content, '{"from":"home"}');
});

test('a folder made again after deletion is private, even if the old one was shared', async () => {
  const { service, google } = setup();
  await service.link();
  await service.setSharing(true);
  for (const file of google.files.values()) file.trashed = true;
  await service.backup('{"v":1}');
  assert.equal((await service.getStatus()).shared, false);
});

test('unlink revokes and forgets everything', async () => {
  const { service, google, dir } = setup();
  await service.link();
  const status = await service.unlink();
  assert.equal(status.linked, false);
  assert.ok(google.calls.some((c) => c === 'POST /revoke'));
  assert.equal(fs.existsSync(path.join(dir, 'google-drive.json')), false);
});

test('emailFromIdToken reads the email, and tolerates junk', () => {
  assert.equal(emailFromIdToken(idToken('a@b.c')), 'a@b.c');
  assert.equal(emailFromIdToken('nonsense'), '');
});
