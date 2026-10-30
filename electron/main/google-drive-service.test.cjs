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
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(init.body);
      const id = `folder${next++}`;
      files.set(id, { name: meta.name, mimeType: meta.mimeType });
      return json({ id, webViewLink: `https://drive.google.com/drive/folders/${id}` });
    }
    if (u.pathname.startsWith('/drive/v3/files/')) {
      const file = files.get(decodeURIComponent(u.pathname.split('/')[4]));
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
  return { service: restart(), restart, google, stored, dir };
}

test('without the OAuth client file the feature says "not available"', async () => {
  const { service } = setup({ client: null });
  assert.deepEqual(await service.getStatus(), { available: false, linked: false, needsRelink: false, email: '', folderUrl: '', lastBackupAt: null, lastError: '' });
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
