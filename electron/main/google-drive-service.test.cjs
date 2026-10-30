// node --test electron/main   (npm run test:electron)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createGoogleDriveService, emailFromIdToken } = require('./google-drive-service');

const idToken = (email) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;

/** A pretend Google: tokens, the Drive files API (search, trash, sharing) and resumable uploads. */
function fakeGoogle() {
  const files = new Map();
  const sessions = new Map();
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
      const session = `s${next++}`;
      sessions.set(session, { id: u.pathname.split('/')[5], meta: JSON.parse(init.body) });
      return json({}, 200, { location: `https://upload.example/${session}` });
    }
    if (u.host === 'upload.example') {
      const { id: existing, meta } = sessions.get(u.pathname.slice(1));
      const id = existing || `file${next++}`;
      const before = files.get(id) || { parent: meta.parents?.[0], appProperties: meta.appProperties || {} };
      files.set(id, { ...before, name: meta.name ?? before.name, content: init.body.toString('utf8') });
      return json({ id });
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      // The app's searches: by name (+ folder type) or by its mark, maybe in a parent; not trashed.
      const q = u.searchParams.get('q');
      const name = /name = '([^']+)'/.exec(q)?.[1];
      const mark = /value='([^']+)'/.exec(q)?.[1];
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const match = [...files.entries()].filter(([, f]) => !f.trashed
        && (!name || f.name === name)
        && (!mark || f.appProperties?.noprep === mark)
        && (!parent || f.parent === parent));
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
          assert.deepEqual(JSON.parse(init.body), { role: 'reader', type: 'anyone', allowFileDiscovery: false });
          file.anyone = true;
          return json({ id: 'anyoneWithLink' });
        }
        if (method === 'DELETE' && parts[6] === 'anyoneWithLink') {
          if (!file.anyone) return json({}, 404);
          file.anyone = false;
          return new Response(null, { status: 204 });
        }
      }
      if (method === 'PATCH') {
        if (!file) return json({}, 404);
        Object.assign(file, JSON.parse(init.body));
        return json({ id: parts[4] });
      }
      return file ? json({ id: 'x', trashed: !!file.trashed }) : json({}, 404);
    }
    throw new Error(`unexpected ${method} ${url}`);
  }
  const live = () => [...files.values()].filter((f) => !f.trashed);
  return { fetchImpl, files, live, calls, breakRefresh: () => { refreshWorks = false; } };
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
  const serviceIn = (folder) => createGoogleDriveService({
    fsp: fs.promises, path, getUserDataPath: () => folder, safeStorage,
    openExternal: browser({ allow }), loadClient: () => client, fetchImpl: google.fetchImpl
  });
  const restart = () => serviceIn(dir);
  const stored = () => JSON.parse(fs.readFileSync(path.join(dir, 'google-drive.json'), 'utf8'));
  // The same teacher's Google Drive, linked from another computer (nothing stored there yet).
  const otherComputer = () => serviceIn(fs.mkdtempSync(path.join(os.tmpdir(), 'np-drive-')));
  return { service: restart(), restart, otherComputer, google, stored, dir };
}

/** What the window does on a backup: plan, upload the changed topics, remove deleted ones, finish. */
async function backupLibrary(service, library) {
  const plan = await service.plan(library.map(({ id, updatedAt }) => ({ id: String(id), updatedAt })));
  for (const id of plan.upload) {
    const topic = library.find((t) => String(t.id) === String(id));
    await service.uploadTopic({ ...topic, id: String(topic.id), json: JSON.stringify({ topics: [{ name: topic.name, v: topic.updatedAt }] }) });
  }
  for (const id of plan.remove) await service.removeTopic(id);
  await service.finishBackup();
  return plan;
}

const topic = (id, name, updatedAt = 't1') => ({ id: String(id), name, updatedAt });

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

test('each topic is its own file in the folder; a backup sends only the topics that changed', async () => {
  const { service, google } = setup();
  await service.link();
  const first = await backupLibrary(service, [topic(1, 'Animals'), topic(2, 'Colours')]);
  assert.deepEqual(first.upload, ['1', '2']);
  const folder = [...google.files.entries()].find(([, f]) => f.name === 'No-Prep backup')[0];
  assert.deepEqual(google.live().filter((f) => f.parent === folder).map((f) => f.name).sort(), ['Animals.json', 'Colours.json']);

  // Animals saved again (new updatedAt), Colours untouched: only Animals goes up.
  const second = await backupLibrary(service, [topic(1, 'Animals', 't2'), topic(2, 'Colours')]);
  assert.deepEqual(second.upload, ['1']);
  assert.equal(google.live().filter((f) => f.name === 'Animals.json').length, 1);
  assert.match(google.live().find((f) => f.name === 'Animals.json').content, /t2/);
  assert.ok((await service.getStatus()).lastBackupAt);
});

test('saved again without a change: nothing is uploaded; a real change is', async () => {
  const { service, google } = setup();
  await service.link();
  const file = (exportDate, updatedAt, cards) => JSON.stringify({ version: '1.0', exportDate, topics: [{ name: 'Animals', createdAt: 'c', updatedAt, items: cards }] });
  const uploads = () => google.calls.filter((c) => c.startsWith('PUT ')).length;
  await service.uploadTopic({ id: '1', name: 'Animals', updatedAt: 'mon', json: file('mon', 'mon', [{ text: 'cat', order: 0 }]) });
  assert.equal(uploads(), 1);
  // Tuesday: opened and saved without editing (new times, same cards).
  await service.uploadTopic({ id: '1', name: 'Animals', updatedAt: 'tue', json: file('tue', 'tue', [{ text: 'cat', order: 0 }]) });
  assert.equal(uploads(), 1);
  assert.deepEqual((await service.plan([{ id: '1', updatedAt: 'tue' }])).upload, []);
  // Wednesday: a card added.
  await service.uploadTopic({ id: '1', name: 'Animals', updatedAt: 'wed', json: file('wed', 'wed', [{ text: 'cat', order: 0 }, { text: 'dog', order: 1 }]) });
  assert.equal(uploads(), 2);
  assert.equal(google.live().filter((f) => f.name === 'Animals.json').length, 1);
});

test('a renamed topic renames its file; a deleted topic\'s file goes to the bin', async () => {
  const { service, google } = setup();
  await service.link();
  await backupLibrary(service, [topic(1, 'Animals'), topic(2, 'Colours')]);
  const plan = await backupLibrary(service, [topic(1, 'Farm animals', 't2')]);
  assert.deepEqual(plan.remove, ['2']);
  assert.deepEqual(google.live().map((f) => f.name).sort(), ['Farm animals.json', 'No-Prep backup']);
  assert.ok([...google.files.values()].some((f) => f.name === 'Colours.json' && f.trashed));
});

test('file names are safe: no slashes or other characters Windows refuses', async () => {
  const { service, google } = setup();
  await service.link();
  await backupLibrary(service, [topic(1, 'Unit 3: Food / Drinks?')]);
  assert.ok(google.live().some((f) => f.name === 'Unit 3 Food Drinks.json'));
});

test('several saves at once go one after another; the topic keeps one file', async () => {
  const { service, google } = setup();
  await service.link();
  const save = (v) => service.uploadTopic({ id: '1', name: 'Animals', updatedAt: v, json: `{"v":"${v}"}` });
  await Promise.all([save('a'), save('b'), save('c')]);
  const animals = google.live().filter((f) => f.name === 'Animals.json');
  assert.equal(animals.length, 1);
  assert.equal(animals[0].content, '{"v":"c"}');
});

test('Unlink and link again on the same computer: the files are found, not uploaded twice', async () => {
  const { service, restart, google } = setup();
  await service.link();
  await backupLibrary(service, [topic(1, 'Animals'), topic(2, 'Colours')]);
  await service.unlink();
  const again = restart();
  await again.link();
  await backupLibrary(again, [topic(1, 'Animals'), topic(2, 'Colours')]);
  assert.equal(google.live().filter((f) => f.name === 'Animals.json').length, 1);
  assert.equal(google.live().filter((f) => f.name === 'Colours.json').length, 1);
});

test('another computer uses the same folder and never removes the first computer\'s files', async () => {
  const { service, otherComputer, google } = setup();
  await service.link();
  await backupLibrary(service, [topic(1, 'Animals')]);
  await service.setSharing(true);
  const firstUrl = (await service.getStatus()).folderUrl;

  const home = otherComputer();
  const status = await home.link();
  assert.equal(status.folderUrl, firstUrl);
  assert.equal(status.shared, true);
  await backupLibrary(home, [topic(1, 'Weather')]); // its own topic 1 is a different topic
  assert.equal(google.live().filter((f) => f.name === 'No-Prep backup').length, 1);
  assert.deepEqual(google.live().filter((f) => f.name.endsWith('.json')).map((f) => f.name).sort(), ['Animals.json', 'Weather.json']);
});

test('the all-in-one file of earlier test builds goes to the bin once', async () => {
  const { service, google, dir } = setup();
  await service.link();
  google.files.set('old1', { name: 'No-Prep topics.json', parent: 'x', content: '{}' });
  const statePath = path.join(dir, 'google-drive.json');
  fs.writeFileSync(statePath, JSON.stringify({ ...JSON.parse(fs.readFileSync(statePath, 'utf8')), fileId: 'old1' }));
  await backupLibrary(service, [topic(1, 'Animals')]);
  assert.equal(google.files.get('old1').trashed, true);
});

test('a deleted backup folder is made again, private, and the topics go into it', async () => {
  const { service, google } = setup();
  await service.link();
  await backupLibrary(service, [topic(1, 'Animals')]);
  await service.setSharing(true);
  for (const file of google.files.values()) file.trashed = true;
  await backupLibrary(service, [topic(1, 'Animals', 't2')]);
  assert.deepEqual(google.live().map((f) => f.name).sort(), ['Animals.json', 'No-Prep backup']);
  assert.equal((await service.getStatus()).shared, false);
});

test('access removed in the Google account: the backup asks to link again', async () => {
  const { service, google, restart } = setup();
  await service.link();
  google.breakRefresh();
  // After a restart there is no access token in memory, so the stored link is used and refused.
  const restarted = restart();
  await assert.rejects(restarted.uploadTopic({ id: '1', name: 'Animals', updatedAt: 't', json: '{}' }), { kind: 'RELINK' });
  const status = await restarted.getStatus();
  assert.equal(status.needsRelink, true);
  assert.equal(status.lastError, 'relink');
});

test('share with colleagues: the folder becomes viewable by link (its files follow), and back', async () => {
  const { service, google } = setup();
  await service.link();
  await backupLibrary(service, [topic(1, 'Animals')]);
  assert.equal((await service.setSharing(true)).shared, true);
  assert.equal(google.live().find((f) => f.name === 'No-Prep backup').anyone, true);
  assert.equal((await service.setSharing(false)).shared, false);
  assert.ok(google.live().every((f) => !f.anyone));
  // Stopping again (already stopped) is fine.
  assert.equal((await service.setSharing(false)).shared, false);
});

test('unlink revokes and forgets the link, but keeps this computer\'s mark', async () => {
  const { service, google, dir } = setup();
  await service.link();
  await backupLibrary(service, [topic(1, 'Animals')]);
  const status = await service.unlink();
  assert.equal(status.linked, false);
  assert.ok(google.calls.some((c) => c === 'POST /revoke'));
  assert.equal(fs.existsSync(path.join(dir, 'google-drive.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'google-drive-install-id')), true);
});

test('emailFromIdToken reads the email, and tolerates junk', () => {
  assert.equal(emailFromIdToken(idToken('a@b.c')), 'a@b.c');
  assert.equal(emailFromIdToken('nonsense'), '');
});
