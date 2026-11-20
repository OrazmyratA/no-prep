const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHtmlPresentationHost } = require('./html-presentation-host');

function makeHost() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'np-html-host-'));
  const app = { getPath: () => userData };
  return { host: createHtmlPresentationHost({ app, fsp, path }), userData };
}

test('an added .html file is served from its own private address', async () => {
  const { host, userData } = makeHost();
  const address = await host.serve('link-1234-abcd', '<!doctype html><title>Animals</title><p>Cat</p>');
  assert.equal(address, 'noprep-html://link-1234-abcd/');
  assert.ok(fs.existsSync(path.join(userData, 'Presentations', 'html', 'link-1234-abcd.html')));

  const response = await host.respond(address);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(await response.text(), /<p>Cat<\/p>/);
  assert.equal((await host.respond('noprep-html://link-1234-abcd/index.html')).status, 200);
});

test('odd ids, other paths, missing files and huge files are refused', async () => {
  const { host, userData } = makeHost();
  assert.equal(await host.serve('../../evil', '<p>x</p>'), '');
  assert.equal(await host.serve('pres-123', '<p>x</p>'), '');
  assert.equal(await host.serve('link-ok', ''), '');
  assert.equal(await host.serve('link-big', 'x'.repeat(25 * 1024 * 1024 + 1)), '');

  // Nothing outside the html folder can be reached through the address.
  fs.writeFileSync(path.join(userData, 'secret.txt'), 'secret');
  for (const url of [
    'noprep-html://link-1234/../../secret.txt',
    'noprep-html://link-1234/style.css',
    'noprep-html://..%2F..%2Fsecret/',
    'noprep-html://link-missing/',
    'not a url'
  ]) {
    const response = await host.respond(url);
    assert.notEqual(response.status, 200, url);
  }
});
