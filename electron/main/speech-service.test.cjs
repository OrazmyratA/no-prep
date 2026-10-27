// node --test electron/main   (npm run test:electron)
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpeechService, EDGE_PAUSE_AFTER_FAILURE_MS } = require('./speech-service');
const { createCloudTtsService } = require('./cloud-tts-service');

const clip = (name) => ({ audioBase64: Buffer.from(name).toString('base64'), mimeType: 'audio/mpeg' });
const failing = (code) => async () => { throw Object.assign(new Error(code), { code }); };

function setup({ edge, cloud, hasKey = true, windows, windowsAvailable = true }) {
  let clock = 0;
  const calls = { edge: 0, cloud: 0, windows: 0 };
  const service = createSpeechService({
    edge: { synthesizeSpeech: async (i) => { calls.edge++; return edge(i); } },
    cloud: {
      hasKey: (only) => typeof hasKey === 'function' ? hasKey(only) : hasKey,
      synthesizeSpeech: async (i, only) => { calls.cloud++; return cloud(i, only); }
    },
    windows: { available: windowsAvailable, synthesizeSpeech: async (i) => { calls.windows++; return windows(i); } },
    now: () => clock
  });
  return { service, calls, advance: (ms) => { clock += ms; } };
}

test('uses Edge when it works', async () => {
  const { service, calls } = setup({ edge: async () => clip('edge'), cloud: failing('X'), windows: failing('X') });
  const result = await service.synthesizeSpeech({ text: 'apple', language: 'en-US' });
  assert.equal(result.provider, 'edge');
  assert.deepEqual(calls, { edge: 1, cloud: 0, windows: 0 });
});

test('after Edge fails it is skipped for a while, then tried again', async () => {
  const t = setup({ edge: failing('DOWN'), cloud: async () => ({ ...clip('ai'), provider: 'openai' }), windows: failing('X') });
  assert.equal((await t.service.synthesizeSpeech({ text: 'a' })).provider, 'openai');
  assert.equal((await t.service.synthesizeSpeech({ text: 'b' })).provider, 'openai');
  assert.equal(t.calls.edge, 1, 'second clip does not wait for Edge again');
  t.advance(EDGE_PAUSE_AFTER_FAILURE_MS);
  await t.service.synthesizeSpeech({ text: 'c' });
  assert.equal(t.calls.edge, 2, 'Edge is retried after the pause');
});

test('no AI key: Windows voices', async () => {
  const { service, calls } = setup({ edge: failing('DOWN'), cloud: failing('X'), hasKey: false, windows: async () => clip('win') });
  assert.equal((await service.synthesizeSpeech({ text: 'a' })).provider, 'windows');
  assert.equal(calls.cloud, 0);
});

test('AI key out of credit: falls through to Windows voices', async () => {
  const { service } = setup({ edge: failing('DOWN'), cloud: failing('NO_CREDIT'), windows: async () => clip('win') });
  assert.equal((await service.synthesizeSpeech({ text: 'a' })).provider, 'windows');
});

test('no Windows voice for the language is reported, never another language', async () => {
  const { service } = setup({ edge: failing('DOWN'), cloud: failing('NO_CREDIT'), windows: failing('NO_VOICE_FOR_LANGUAGE') });
  await assert.rejects(service.synthesizeSpeech({ text: 'elma', language: 'tr-TR' }), { code: 'NO_VOICE_FOR_LANGUAGE' });
});

test('without Windows voices the AI key reason is reported', async () => {
  const { service } = setup({ edge: failing('DOWN'), cloud: failing('KEY_REJECTED'), windows: failing('X'), windowsAvailable: false });
  await assert.rejects(service.synthesizeSpeech({ text: 'a' }), { code: 'KEY_REJECTED' });
});

test('a chosen Windows voice is the only one tried', async () => {
  const { service, calls } = setup({ edge: async () => clip('edge'), cloud: async () => clip('ai'), windows: async () => clip('win') });
  assert.equal((await service.synthesizeSpeech({ text: 'a', voice: 'windows' })).provider, 'windows');
  assert.deepEqual(calls, { edge: 0, cloud: 0, windows: 1 });
});

test('a chosen AI voice that fails is reported, not replaced by another voice', async () => {
  const { service, calls } = setup({ edge: async () => clip('edge'), cloud: failing('RATE_LIMITED'), windows: async () => clip('win') });
  await assert.rejects(service.synthesizeSpeech({ text: 'a', voice: 'gemini' }), { code: 'RATE_LIMITED' });
  assert.deepEqual(calls, { edge: 0, cloud: 1, windows: 0 });
});

test('a chosen AI voice is asked for by name', async () => {
  let asked = null;
  const { service } = setup({ edge: failing('X'), cloud: async (_i, only) => { asked = only; return { ...clip('ai'), provider: only }; }, windows: failing('X') });
  assert.equal((await service.synthesizeSpeech({ text: 'a', voice: 'openai' })).provider, 'openai');
  assert.equal(asked, 'openai');
});

test('a chosen AI voice without its key says it is not linked', async () => {
  const { service, calls } = setup({ edge: failing('X'), cloud: failing('X'), hasKey: (only) => only !== 'gemini', windows: failing('X') });
  await assert.rejects(service.synthesizeSpeech({ text: 'a', voice: 'gemini' }), { code: 'NOT_LINKED' });
  assert.equal(calls.cloud, 0);
});

// ---- cloud voices ----

function response(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => Buffer.from(text)
  };
}

function cloudWith(keys, answers) {
  const waits = [];
  const urls = [];
  let inFlight = 0, maxInFlight = 0;
  const service = createCloudTtsService({
    getApiKey: (id) => keys[id] || '',
    wait: async (ms) => { waits.push(ms); },
    fetchImpl: async (url) => {
      urls.push(url);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      return answers.shift()(url);
    }
  });
  return { service, waits, urls, maxInFlight: () => maxInFlight };
}

test('cloud: waits as asked on a rate limit, then succeeds', async () => {
  const c = cloudWith({ gemini: 'k' }, [
    () => response(429, { error: { message: 'quota', details: [{ retryDelay: '3s' }] } }),
    () => response(200, { candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(8).toString('base64') } }] } }] })
  ]);
  const result = await c.service.synthesizeSpeech({ text: 'apple' });
  assert.equal(result.provider, 'gemini');
  assert.deepEqual(c.waits, [3000]);
  const wav = Buffer.from(result.audioBase64, 'base64');
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.length, 44 + 8);
});

test('cloud: a whole WAV from Gemini keeps only its sound (no header click, no C2PA noise)', async () => {
  const sound = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(24000, 12); fmt.writeUInt32LE(48000, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
  const data = Buffer.alloc(8); data.write('data', 0); data.writeUInt32LE(sound.length, 4);
  const c2pa = Buffer.concat([Buffer.from('C2PA'), Buffer.from([6, 0, 0, 0]), Buffer.from('jumbc2')]);
  const inner = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), fmt, data, sound, c2pa]);
  const c = cloudWith({ gemini: 'k' }, [
    () => response(200, { candidates: [{ content: { parts: [{ inlineData: { data: inner.toString('base64') } }] } }] })
  ]);
  const wav = Buffer.from((await c.service.synthesizeSpeech({ text: 'apple' })).audioBase64, 'base64');
  assert.equal(wav.length, 44 + sound.length);
  assert.deepEqual(wav.subarray(44), sound);
  assert.equal(wav.readUInt32LE(24), 24000);
});

test('cloud: a daily limit is not retried', async () => {
  const c = cloudWith({ gemini: 'k' }, [() => response(429, 'Quota exceeded for GenerateRequestsPerDay')]);
  await assert.rejects(c.service.synthesizeSpeech({ text: 'a' }), { code: 'RATE_LIMITED' });
  assert.deepEqual(c.waits, []);
});

test('cloud: rejected key and missing credit have their own reasons', async () => {
  await assert.rejects(cloudWith({ openai: 'k' }, [() => response(401, 'bad key')]).service.synthesizeSpeech({ text: 'a' }), { code: 'KEY_REJECTED' });
  await assert.rejects(cloudWith({ openai: 'k' }, [() => response(429, { error: { code: 'insufficient_quota' } })]).service.synthesizeSpeech({ text: 'a' }), { code: 'NO_CREDIT' });
});

test('cloud: OpenAI first, Gemini when OpenAI fails', async () => {
  const c = cloudWith({ openai: 'o', gemini: 'g' }, [
    () => response(401, 'bad key'),
    () => response(200, { candidates: [{ content: { parts: [{ inlineData: { data: 'AAAA' } }] } }] })
  ]);
  assert.equal((await c.service.synthesizeSpeech({ text: 'a' })).provider, 'gemini');
  assert.match(c.urls[0], /openai/);
});

test('cloud: clips are requested one at a time', async () => {
  const c = cloudWith({ openai: 'o' }, Array.from({ length: 4 }, () => () => response(200, 'mp3')));
  await Promise.all(['a', 'b', 'c', 'd'].map((text) => c.service.synthesizeSpeech({ text })));
  assert.equal(c.maxInFlight(), 1);
});

test('cloud: asked for one voice, the other key is not used', async () => {
  const c = cloudWith({ openai: 'o', gemini: 'g' }, [() => response(429, 'Quota exceeded for GenerateRequestsPerDay')]);
  await assert.rejects(c.service.synthesizeSpeech({ text: 'a' }, 'gemini'), { code: 'RATE_LIMITED' });
  assert.equal(c.urls.length, 1);
  assert.match(c.urls[0], /generativelanguage/);
  assert.equal(c.service.hasKey('openai'), true);
  assert.equal(cloudWith({ gemini: 'g' }, []).service.hasKey('openai'), false);
});
