// Google Drive backup for the desktop app: the teacher links their Google account once (in their
// own browser), then every topic Save uploads one "No-Prep topics.json" (the Export all file) into
// a "No-Prep backup" folder the app creates. Scope drive.file: the app sees only its own files.
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
const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email';
const FOLDER_NAME = 'No-Prep backup';
const FILE_NAME = 'No-Prep topics.json';
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
      lastError: state.lastError || ''
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

    const state = await readState();
    storeRefreshToken(state, tokens.refresh_token);
    state.email = emailFromIdToken(tokens.id_token);
    state.needsRelink = false;
    state.lastError = '';
    await writeState(state);
    accessToken = tokens.access_token || '';
    accessTokenExpiresAt = Date.now() + (Number(tokens.expires_in) || 0) * 1000 - 60_000;
    await ensureFolder();
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

  /** The "No-Prep backup" folder (made again if the teacher deleted it). */
  async function ensureFolder() {
    const state = await readState();
    if (await exists(state.folderId)) return state;
    const response = await drive(`${FILES_URL}?fields=id,webViewLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME })
    });
    if (!response.ok) throw new DriveError('GOOGLE_FAILED', `Could not make the backup folder (${response.status}).`);
    const folder = await response.json();
    state.folderId = folder.id;
    state.folderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`;
    state.fileId = '';
    await writeState(state);
    return state;
  }

  /** Resumable upload in one go (no 5 MB limit): start a session, then send the file. */
  async function uploadJson(json) {
    const state = await ensureFolder();
    const body = Buffer.from(json, 'utf8');
    const update = await exists(state.fileId);
    const start = await drive(
      update
        ? `${UPLOAD_URL}/${encodeURIComponent(state.fileId)}?uploadType=resumable`
        : `${UPLOAD_URL}?uploadType=resumable&fields=id`,
      {
        method: update ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/json',
          'X-Upload-Content-Length': String(body.length)
        },
        body: JSON.stringify(update ? {} : { name: FILE_NAME, parents: [state.folderId], mimeType: 'application/json' })
      }
    );
    const session = start.headers.get('location');
    if (!start.ok || !session) throw new DriveError('GOOGLE_FAILED', `Google refused the upload (${start.status}).`);
    const put = await fetchImpl(session, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    if (!put.ok) throw new DriveError('GOOGLE_FAILED', `The upload did not finish (${put.status}).`);
    const file = await put.json().catch(() => ({}));
    const fresh = await readState();
    if (file.id) fresh.fileId = file.id;
    fresh.lastBackupAt = new Date().toISOString();
    fresh.lastError = '';
    await writeState(fresh);
  }

  /** One upload at a time; a Save during an upload waits for it, then sends its newer file. */
  function backup(json) {
    const run = uploadChain.then(() => uploadJson(json));
    uploadChain = run.catch(() => {});
    return run.catch(async (error) => {
      const state = await readState();
      state.lastError = error.kind === 'RELINK' ? 'relink' : 'failed';
      await writeState(state).catch(() => {});
      throw error;
    }).then(getStatus);
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

  return { getStatus, link, cancelLink, backup, unlink };
}

module.exports = { createGoogleDriveService, DriveError, emailFromIdToken };
