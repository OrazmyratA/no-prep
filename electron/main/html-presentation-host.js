// HTML presentations (an .html file a teacher added on the Presentations tab) play in the desktop
// app from their own private address: noprep-html://<id>/. That is a different origin from
// No-Prep, so the file can never read No-Prep's data, and No-Prep's own security rules (which
// would block the fonts and scripts such lessons usually load from the internet) do not apply.
// The page keeps the file in its database; when it is played the page hands the text over and
// it is written to userData/Presentations/html/<id>.html, which this address serves.
const SCHEME = 'noprep-html';
const MAX_HTML_BYTES = 25 * 1024 * 1024;
const ID_PATTERN = /^link-[A-Za-z0-9-]{1,80}$/;

function createHtmlPresentationHost({ app, fsp, path }) {
  const folder = () => path.join(app.getPath('userData'), 'Presentations', 'html');
  const fileOf = (id) => path.join(folder(), `${id}.html`);

  /** Writes the file for this id and answers the address to show it at ('' when refused). */
  async function serve(id, html) {
    const cleanId = String(id ?? '');
    const text = String(html ?? '');
    if (!ID_PATTERN.test(cleanId) || !text || Buffer.byteLength(text, 'utf8') > MAX_HTML_BYTES) return '';
    await fsp.mkdir(folder(), { recursive: true });
    await fsp.writeFile(fileOf(cleanId), text, 'utf8');
    return `${SCHEME}://${cleanId}/`;
  }

  /** The response for noprep-html://<id>/ (only the page itself; it has no other files). */
  async function respond(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return new Response('Bad address', { status: 400 });
    }
    const id = decodeURIComponent(parsed.hostname);
    if (!ID_PATTERN.test(id) || !['', '/', '/index.html'].includes(parsed.pathname)) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const body = await fsp.readFile(fileOf(id));
      return new Response(body, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }

  function register(protocol, ipcMain, { operationResult, operationError }) {
    protocol.handle(SCHEME, (request) => respond(request.url));
    ipcMain.handle('presentations:serve-html', async (_event, input) => {
      try {
        const address = await serve(input?.id, input?.html);
        return address ? operationResult(address) : operationError('HTML_REFUSED', 'This HTML file cannot be shown.');
      } catch (error) {
        return operationError('HTML_FAILED', error?.message || 'Could not prepare the HTML file.');
      }
    });
  }

  return { serve, respond, register };
}

module.exports = { createHtmlPresentationHost, HTML_SCHEME: SCHEME };
