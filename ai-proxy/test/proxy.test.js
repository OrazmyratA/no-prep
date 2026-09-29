import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import worker from '../src/index.js';
import { parseLicenseHeader, verifyLicense } from '../src/license.js';

// A throwaway key pair stands in for NoPrep's real one.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' });

function makeLicense({ machineId = 'machine-1', expiry = Date.now() + 86400000, nonce = 'n1' } = {}) {
  const signature = sign('sha256', Buffer.from(`${machineId}|${expiry}|${nonce}`), privateKey).toString('base64');
  return { machineId, expiry, nonce, signature };
}

const header = license => Buffer.from(JSON.stringify(license)).toString('base64');

// In-memory stand-in for the D1 upsert the Worker uses.
function fakeDb() {
  const rows = new Map();
  const statement = { bind: (...args) => ({ args }) };
  return {
    rows,
    prepare: () => statement,
    batch: async bound => bound.map(({ args: [key, period] }) => {
      const id = `${key}|${period}`;
      rows.set(id, (rows.get(id) ?? 0) + 1);
      return { results: [{ count: rows.get(id) }] };
    })
  };
}

function makeEnv(overrides = {}) {
  return {
    DB: fakeDb(),
    GEMINI_API_KEY: 'server-key',
    GEMINI_MODEL: 'gemini-test-model',
    LICENSE_PUBLIC_KEY: PUBLIC_PEM,
    MACHINE_HOURLY_LIMIT: '2',
    MACHINE_DAILY_LIMIT: '5',
    GLOBAL_DAILY_LIMIT: '100',
    MAX_BODY_BYTES: '1000',
    ...overrides
  };
}

function draftRequest(license, body = '{"contents":[]}') {
  return new Request('https://proxy.example/v1/topic-draft', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      ...(license ? { 'X-NoPrep-License': header(license) } : {})
    },
    body
  });
}

// Records what the Worker sends to Gemini and answers like Gemini would.
function mockGemini(status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response('{"candidates":[]}', { status, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}

test('verifyLicense accepts a genuine license and rejects tampered or expired ones', async () => {
  const license = makeLicense();
  assert.equal(await verifyLicense(license, PUBLIC_PEM), true);
  assert.equal(await verifyLicense({ ...license, machineId: 'someone-else' }, PUBLIC_PEM), false);
  assert.equal(await verifyLicense({ ...license, expiry: license.expiry + 1 }, PUBLIC_PEM), false);
  const expired = makeLicense({ expiry: Date.now() - 1000 });
  assert.equal(await verifyLicense(expired, PUBLIC_PEM), false);
});

test('parseLicenseHeader rejects malformed headers', () => {
  assert.equal(parseLicenseHeader(''), null);
  assert.equal(parseLicenseHeader('not base64 json'), null);
  assert.equal(parseLicenseHeader(header({ machineId: 'x' })), null);
  assert.deepEqual(parseLicenseHeader(header(makeLicense({ expiry: 5 }))).expiry, 5);
});

test('forwards a licensed request to the fixed model with the server key', async () => {
  const calls = mockGemini();
  const response = await worker.fetch(draftRequest(makeLicense()), makeEnv());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"candidates":[]}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent');
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'server-key');
});

test('refuses requests without a valid license, before calling Gemini', async () => {
  const calls = mockGemini();
  const env = makeEnv();
  assert.equal((await worker.fetch(draftRequest(null), env)).status, 403);
  assert.equal((await worker.fetch(draftRequest({ ...makeLicense(), nonce: 'forged' }), env)).status, 403);
  assert.equal(calls.length, 0);
});

test('slows down one machine after its hourly limit, without affecting others', async () => {
  mockGemini();
  const env = makeEnv();
  const license = makeLicense();
  assert.equal((await worker.fetch(draftRequest(license), env)).status, 200);
  assert.equal((await worker.fetch(draftRequest(license), env)).status, 200);
  const third = await worker.fetch(draftRequest(license), env);
  assert.equal(third.status, 429);
  assert.equal((await third.json()).error.code, 'SLOW_DOWN');
  assert.equal((await worker.fetch(draftRequest(makeLicense({ machineId: 'machine-2' })), env)).status, 200);
});

test('stops everyone once the global daily limit is reached', async () => {
  mockGemini();
  const env = makeEnv({ GLOBAL_DAILY_LIMIT: '1' });
  assert.equal((await worker.fetch(draftRequest(makeLicense()), env)).status, 200);
  const next = await worker.fetch(draftRequest(makeLicense({ machineId: 'machine-2' })), env);
  assert.equal(next.status, 503);
});

test('rejects oversized bodies and maps Gemini rate limits to a friendly busy error', async () => {
  mockGemini(429);
  const env = makeEnv();
  assert.equal((await worker.fetch(draftRequest(makeLicense(), 'x'.repeat(2000)), env)).status, 413);
  const busy = await worker.fetch(draftRequest(makeLicense()), env);
  assert.equal(busy.status, 503);
  assert.equal((await busy.json()).error.code, 'BUSY');
});
