// Google Drive backup for the desktop app: the teacher links their Google account once (in their
// own browser); then each topic is one file ("Animals.json", importable on its own) in a
// "No-Prep backup" folder the app creates, and a Save uploads only the topics that changed.
// Scope drive.file: the app sees only its own files.
//
// The OAuth client (Desktop app type) comes from electron/main/google-oauth.local.json, which git
// ignores; the Windows release build writes it from GitHub secrets. Without it the feature reports
// "not available" and nothing else changes. See docs/google-drive-backup-setup.md.

const http = require('http');
const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SCOPES = `${DRIVE_SCOPE} openid email`;
const FOLDER_NAME = 'No-Prep backup';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const LINK_TIMEOUT_MS = 5 * 60 * 1000;

class DriveError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The email inside Google's id_token (already checked by Google; we only read it). */
function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
}

const DONE_PAGE = (ok) => `<!doctype html><meta charset="utf-8"><title>No-Prep</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0;background:#f5f7ff;color:#1f2937">
<div style="text-align:center"><div style="font-size:3rem">${ok ? '✅' : '⚠️'}</div>
<h2>${ok ? 'Google Drive is linked to No-Prep.' : 'Google Drive was not linked.'}</h2>
<p>You can close this tab and go back to No-Prep.</p></div></body>`;

function createGoogleDriveService({ fsp, path, getUserDataPath, safeStorage, openExternal, loadClient, fetchImpl = fetch }) {
  let accessToken = '';
  let accessTokenExpiresAt = 0;
  let pendingLink = null; // { server, reject }
  let uploadChain = Promise.resolve();

  const statePath = () => path.join(getUserDataPath(), 'google-drive.json');

  async function readState() {
    try {
      const parsed = JSON.parse(await fsp.readFile(statePath(), 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async function writeState(state) {
    await fsp.mkdir(path.dirname(statePath()), { recursive: true });
    await fsp.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8');
  }

  function readRefreshToken(state) {
    if (!state.refreshToken) return '';
    try {
      return state.refreshTokenEncrypted
        ? safeStorage.decryptString(Buffer.from(state.refreshToken, 'base64'))
        : String(state.refreshToken);
    } catch {
      return '';
    }
  }

  function storeRefreshToken(state, token) {
    const encrypted = safeStorage.isEncryptionAvailable();
    state.refreshTokenEncrypted = encrypted;
    state.refreshToken = encrypted ? safeStorage.encryptString(token).toString('base64') : token;
  }

  function client() {
    const value = loadClient();
    return value && value.clientId && value.clientSecret ? value : null;
  }

  async function getStatus() {
    const state = await readState();
    return {
      available: !!client(),
      linked: !!readRefreshToken(state),
      needsRelink: !!state.needsRelink,
      email: state.email || '',
      folderUrl: state.folderUrl || '',
      lastBackupAt: state.lastBackupAt || null,
      lastError: state.lastError || '',
      shared: !!state.shared
    };
  }

  async function postForm(url, fields) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const kind = body.error === 'invalid_grant' ? 'RELINK' : 'GOOGLE_FAILED';
      throw new DriveError(kind, body.error_description || body.error || `Google answered ${response.status}`);
    }
    return body;
  }

  /** Opens Google's page in the teacher's browser and waits for them to allow it. */
  async function link() {
    const oauth = client();
    if (!oauth) throw new DriveError('NOT_AVAILABLE', 'Google Drive backup is not set up in this build.');
    cancelLink();

    const verifier = base64Url(crypto.randomBytes(48));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    const stateParam = base64Url(crypto.randomBytes(16));

    let redirectUri = '';
    const code = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const ok = url.searchParams.get('state') === stateParam && !!url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE(ok));
        finish();
        if (ok) resolve(url.searchParams.get('code'));
        else reject(new DriveError('CANCELLED', url.searchParams.get('error') || 'Linking was cancelled.'));
      });
      const timer = setTimeout(() => {
        finish();
        reject(new DriveError('CANCELLED', 'Linking timed out.'));
      }, LINK_TIMEOUT_MS);
      function finish() {
        clearTimeout(timer);
        server.close();
        pendingLink = null;
      }
      pendingLink = { reject: (error) => { finish(); reject(error); } };
      server.on('error', (error) => { finish(); reject(error); });
      server.listen(0, '127.0.0.1', () => {
        redirectUri = `http://127.0.0.1:${server.address().port}`;
        const params = new URLSearchParams({
          client_id: oauth.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPES,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent',
          state: stateParam
        });
        Promise.resolve(openExternal(`${AUTH_URL}?${params}`)).catch((error) => { finish(); reject(error); });
      });
    });

    // Google checks that this is the same redirect address as in the request.
    const tokens = await postForm(TOKEN_URL, {
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });
    if (!tokens.refresh_token) throw new DriveError('GOOGLE_FAILED', 'Google did not allow offline access.');
    // Google lets people untick the Drive box and allow only their email: then nothing is linked,
    // and the teacher is told to tick it (the half-given access is handed back).
    const granted = String(tokens.scope || '').split(/\s+/);
    if (tokens.scope && !granted.includes(DRIVE_SCOPE)) {
      await fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(tokens.refresh_token)}`, { method: 'POST' }).catch(() => {});
      throw new DriveError('NO_DRIVE_ACCESS', 'Google Drive access was not allowed.');
    }

    // The folder first: only a link that works is kept (a failure here leaves nothing half-linked).
    accessToken = tokens.access_token || '';
    accessTokenExpiresAt = Date.now() + (Number(tokens.expires_in) || 0) * 1000 - 60_000;
    try {
      await ensureFolder();
    } catch (error) {
      accessToken = '';
      await fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(tokens.refresh_token)}`, { method: 'POST' }).catch(() => {});
      throw error;
    }
    const state = await readState();
    storeRefreshToken(state, tokens.refresh_token);
    state.email = emailFromIdToken(tokens.id_token);
    state.needsRelink = false;
    state.lastError = '';
    await writeState(state);
    return getStatus();
  }

  function cancelLink() {
    pendingLink?.reject(new DriveError('CANCELLED', 'Linking was cancelled.'));
  }

  async function getAccessToken() {
    if (accessToken && Date.now() < accessTokenExpiresAt) return accessToken;
    const oauth = client();
    const state = await readState();
    const refreshToken = readRefreshToken(state);
    if (!oauth || !refreshToken) throw new DriveError('NOT_LINKED', 'Google Drive is not linked.');
    try {
      const tokens = await postForm(TOKEN_URL, {
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });
      accessToken = tokens.access_token;
      accessTokenExpiresAt = Date.now() + (Number(tokens.expires_in) || 0) * 1000 - 60_000;
      return accessToken;
    } catch (error) {
      if (error.kind === 'RELINK') {
        // Access was removed in the Google account (or the test link expired): ask again.
        state.needsRelink = true;
        await writeState(state);
      }
      throw error;
    }
  }

  async function drive(url, init = {}) {
    const token = await getAccessToken();
    const response = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    if (response.status === 401) accessToken = '';
    return response;
  }

  async function exists(id) {
    if (!id) return false;
    const response = await drive(`${FILES_URL}/${encodeURIComponent(id)}?fields=id,trashed`);
    if (!response.ok) return false;
    const file = await response.json();
    return !file.trashed;
  }

  /** The newest file the app made that matches `q` (drive.file shows only the app's own files). */
  async function findOwn(q) {
    const params = new URLSearchParams({ q: `${q} and trashed = false`, orderBy: 'modifiedTime desc', pageSize: '1', fields: 'files(id,webViewLink)' });
    const response = await drive(`${FILES_URL}?${params}`);
    if (!response.ok) return null;
    const body = await response.json().catch(() => ({}));
    return body.files?.[0] || null;
  }

  /** Is "anyone with the link" on this file? (So a folder found again keeps its shared state.) */
  async function isSharedByLink(id) {
    const response = await drive(`${FILES_URL}/${encodeURIComponent(id)}/permissions?fields=permissions(id,type)`);
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({}));
    return (body.permissions || []).some((p) => p.type === 'anyone');
  }

  /**
   * The "No-Prep backup" folder. Linking again (another computer, a reinstall) finds the folder the
   * app made before, so a link shared with colleagues keeps getting new topics; it is made again
   * only if the teacher deleted it.
   */
  async function ensureFolder() {
    const state = await readState();
    if (await exists(state.folderId)) return state;
    const found = await findOwn(`name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}'`);
    if (found) {
      state.folderId = found.id;
      state.folderUrl = found.webViewLink || `https://drive.google.com/drive/folders/${found.id}`;
      state.shared = await isSharedByLink(found.id);
      state.topics = {}; // file ids are looked up again (by this computer's mark) as topics upload
      await writeState(state);
      return state;
    }
    const response = await drive(`${FILES_URL}?fields=id,webViewLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME })
    });
    if (!response.ok) throw new DriveError('GOOGLE_FAILED', `Could not make the backup folder (${response.status}).`);
    const folder = await response.json();
    state.folderId = folder.id;
    state.folderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`;
    state.topics = {};
    state.shared = false; // a new folder is private until shared again
    await writeState(state);
    return state;
  }

  /**
   * This computer's mark, put on every topic file it uploads (Drive appProperties), so linking
   * again finds its own files instead of uploading copies. Kept apart from the link (Unlink keeps it).
   */
  async function installId() {
    const file = path.join(getUserDataPath(), 'google-drive-install-id');
    try {
      const id = (await fsp.readFile(file, 'utf8')).trim();
      if (id) return id;
    } catch { /* first time */ }
    const id = base64Url(crypto.randomBytes(9));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, id, 'utf8');
    return id;
  }

  const topicMark = async (topicId) => `${await installId()}:${topicId}`;

  /** "Animals.json": a topic's file name, safe for any system a colleague downloads it to. */
  function topicFileName(name) {
    const safe = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    return `${safe || 'Topic'}.json`;
  }

  /** Resumable upload in one go (no 5 MB limit): start a session, then send the file. */
  async function sendFile(fileId, metadata, json) {
    const body = Buffer.from(json, 'utf8');
    const start = await drive(
      fileId
        ? `${UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=resumable&fields=id`
        : `${UPLOAD_URL}?uploadType=resumable&fields=id`,
      {
        method: fileId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/json',
          'X-Upload-Content-Length': String(body.length)
        },
        body: JSON.stringify(metadata)
      }
    );
    const session = start.headers.get('location');
    if (!start.ok || !session) throw new DriveError('GOOGLE_FAILED', `Google refused the upload (${start.status}).`);
    const put = await fetchImpl(session, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    if (!put.ok) throw new DriveError('GOOGLE_FAILED', `The upload did not finish (${put.status}).`);
    const file = await put.json().catch(() => ({}));
    return file.id || fileId;
  }

  /** The topic's file: known from before, or found by this computer's mark in the folder. */
  async function topicFileId(state, topicId) {
    const known = state.topics?.[topicId]?.fileId;
    if (await exists(known)) return known;
    const mark = await topicMark(topicId);
    const found = await findOwn(`appProperties has { key='noprep' and value='${mark}' } and '${state.folderId}' in parents`);
    return found?.id || '';
  }

  /**
   * Which topics need uploading (new or changed since their last upload) and which files belong
   * to topics no longer in the library. `topics`: [{ id, updatedAt }].
   */
  async function plan(topics) {
    const state = await readState();
    const known = state.topics || {};
    const ids = new Set(topics.map((t) => String(t.id)));
    return {
      upload: topics.filter((t) => known[t.id]?.updatedAt !== t.updatedAt).map((t) => t.id),
      remove: Object.keys(known).filter((id) => !ids.has(id))
    };
  }

  /** Uploads one topic's file (made, updated, or renamed with the topic). */
  async function uploadTopicFile({ id, name, updatedAt, json }) {
    const state = await ensureFolder();
    const fileId = await topicFileId(state, id);
    const fileName = topicFileName(name);
    const fingerprint = contentFingerprint(json);
    const before = state.topics?.[id];
    // Saved again without a change: the file in Drive is already this; only note the new time.
    if (fileId && before?.fileId === fileId && before.fingerprint === fingerprint && before.name === fileName) {
      const fresh = await readState();
      fresh.topics = { ...(fresh.topics || {}), [id]: { ...before, updatedAt } };
      await writeState(fresh);
      return;
    }
    const metadata = fileId
      ? { name: fileName }
      : { name: fileName, parents: [state.folderId], mimeType: 'application/json', appProperties: { noprep: await topicMark(id) } };
    const savedId = await sendFile(fileId, metadata, json);
    const fresh = await readState();
    fresh.topics = { ...(fresh.topics || {}), [id]: { fileId: savedId, updatedAt, fingerprint, name: fileName } };
    await writeState(fresh);
  }

  /** What a topic file says, leaving out when it was written (exportDate changes on every save). */
  function contentFingerprint(json) {
    let content = json;
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed?.topics)) {
        content = JSON.stringify(parsed.topics.map(({ createdAt, updatedAt, ...topic }) => topic));
      }
    } catch { /* not JSON: use it as it is */ }
    return crypto.createHash('sha256').update(content).digest('base64');
  }

  /** A topic deleted from the library: its file goes to Drive's bin (kept 30 days there). */
  async function removeTopicFile(id) {
    const state = await readState();
    const fileId = state.topics?.[id]?.fileId;
    if (fileId) {
      const response = await drive(`${FILES_URL}/${encodeURIComponent(fileId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true })
      });
      if (!response.ok && response.status !== 404) {
        throw new DriveError('GOOGLE_FAILED', `Could not remove a deleted topic's file (${response.status}).`);
      }
    }
    const fresh = await readState();
    if (fresh.topics) delete fresh.topics[id];
    await writeState(fresh);
  }

  /** Earlier test builds kept every topic in one "No-Prep topics.json": to the bin, once. */
  async function retireAllInOneFile() {
    const state = await readState();
    if (!state.fileId) return;
    await drive(`${FILES_URL}/${encodeURIComponent(state.fileId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    }).catch(() => undefined);
    const fresh = await readState();
    delete fresh.fileId;
    await writeState(fresh);
  }

  /** One change at a time, in order: a Save during an upload waits for it. */
  function queue(work) {
    const run = uploadChain.then(work);
    uploadChain = run.catch(() => {});
    return run.catch(async (error) => {
      const state = await readState();
      state.lastError = error.kind === 'RELINK' ? 'relink' : 'failed';
      await writeState(state).catch(() => {});
      throw error;
    });
  }

  const uploadTopic = (topic) => queue(() => uploadTopicFile(topic));
  const removeTopic = (id) => queue(() => removeTopicFile(String(id)));

  /** Every planned change done: the backup is up to date as of now. */
  function finishBackup() {
    return queue(async () => {
      if (!readRefreshToken(await readState())) throw new DriveError('NOT_LINKED', 'Google Drive is not linked.');
      await retireAllInOneFile();
      const state = await readState();
      state.lastBackupAt = new Date().toISOString();
      state.lastError = '';
      await writeState(state);
    }).then(getStatus);
  }

  /**
   * Share the backup folder with colleagues: "anyone with the link can view" on the folder (drive.file
   * lets the app do this for a folder it made; the topic files in it, now and later, follow the
   * folder), or take that away again.
   */
  async function setSharing(on) {
    const state = await ensureFolder();
    for (const id of [state.folderId]) {
      const url = `${FILES_URL}/${encodeURIComponent(id)}/permissions`;
      const response = on
        ? await drive(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false })
        })
        : await drive(`${url}/anyoneWithLink`, { method: 'DELETE' });
      // Taking away a link that is already gone is fine.
      if (!response.ok && !(!on && response.status === 404)) {
        throw new DriveError('GOOGLE_FAILED', `Google refused the sharing change (${response.status}).`);
      }
    }
    const fresh = await readState();
    fresh.shared = !!on;
    await writeState(fresh);
    return getStatus();
  }

  async function unlink() {
    cancelLink();
    const state = await readState();
    const refreshToken = readRefreshToken(state);
    if (refreshToken) {
      await fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => {});
    }
    accessToken = '';
    accessTokenExpiresAt = 0;
    await fsp.rm(statePath(), { force: true });
    return getStatus();
  }

  return { getStatus, link, cancelLink, plan, uploadTopic, removeTopic, finishBackup, setSharing, unlink };
}

module.exports = { createGoogleDriveService, DriveError, emailFromIdToken };
