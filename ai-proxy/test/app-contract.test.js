// The desktop app's "NoPrep AI" provider (electron/main/ai-topic-service.js) talking to this
// Worker, with only Gemini faked: checks both halves agree on the license header, the request
// body and the error messages teachers see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign } from 'node:crypto';
import worker from '../src/index.js';

const require = createRequire(import.meta.url);
const { createAiTopicService } = require('../../electron/main/ai-topic-service.js');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function makeLicense(machineId = 'teacher-pc') {
  const expiry = Date.now() + 86400000;
  const nonce = 'abc';
  const signature = sign('sha256', Buffer.from(`${machineId}|${expiry}|${nonce}`), privateKey).toString('base64');
  return { machineId, expiry, nonce, signature };
}

function setup({ license = makeLicense(), hourlyLimit = '40' } = {}) {
  const counts = new Map();
  const env = {
    DB: {
      prepare: () => ({ bind: (...args) => ({ args }) }),
      batch: async bound => bound.map(({ args: [key, period] }) => {
        counts.set(`${key}|${period}`, (counts.get(`${key}|${period}`) ?? 0) + 1);
        return { results: [{ count: counts.get(`${key}|${period}`) }] };
      })
    },
    GEMINI_API_KEY: 'noprep-key',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    LICENSE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
    MACHINE_HOURLY_LIMIT: hourlyLimit,
    MACHINE_DAILY_LIMIT: '150',
    GLOBAL_DAILY_LIMIT: '20000',
    MAX_BODY_BYTES: '12000000'
  };

  // Gemini, as seen by the Worker.
  const geminiBodies = [];
  globalThis.fetch = async (_url, init) => {
    geminiBodies.push(JSON.parse(await new Response(init.body).text()));
    const draft = { topicName: 'Fruits', language: 'en', notes: [], items: [] };
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(draft) }] } }] });
  };

  // The app's network call, delivered straight to the Worker (with the Content-Length a real
  // network request carries).
  const appFetch = async (url, init) => {
    const headers = { ...init.headers, 'Content-Length': String(Buffer.byteLength(init.body)) };
    return worker.fetch(new Request(url, { method: init.method, headers, body: init.body }), env);
  };

  const service = createAiTopicService({
    getApiKey: () => '',
    getLicense: () => license,
    proxyUrl: 'https://ai.noprep.example/',
    fetchImpl: appFetch
  });
  return { service, geminiBodies };
}

const input = {
  provider: 'builtin',
  systemPrompt: 'SYSTEM',
  userText: 'fruits',
  schema: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
  images: [{ mimeType: 'image/jpeg', base64: 'QUJD' }]
};

test('NoPrep AI shows up as ready when the proxy URL is set and the license is valid', () => {
  const { service } = setup();
  const builtin = service.getStatus().providers.find(p => p.id === 'builtin');
  assert.deepEqual(builtin, { id: 'builtin', configured: true, maxImages: 12, supportsImageGeneration: false });
});

test('a licensed app gets its draft through the proxy', async () => {
  const { service, geminiBodies } = setup();
  const result = await service.generateDraft(input);
  assert.equal(JSON.parse(result.text).topicName, 'Fruits');
  assert.equal(geminiBodies.length, 1);
  assert.equal(geminiBodies[0].systemInstruction.parts[0].text, 'SYSTEM');
  assert.equal(geminiBodies[0].contents[0].parts[1].inline_data.data, 'QUJD');
  assert.equal(geminiBodies[0].generationConfig.responseSchema.additionalProperties, undefined);
});

test('teachers see the proxy friendly message when rate-limited', async () => {
  const { service } = setup({ hourlyLimit: '1' });
  await service.generateDraft(input);
  await assert.rejects(service.generateDraft(input), /a lot of AI topics in a short time/);
});

test('a forged license is refused with a clear message', async () => {
  const { service } = setup({ license: { ...makeLicense(), machineId: 'someone-else' } });
  await assert.rejects(service.generateDraft(input), /no valid license/);
});

test('NoPrep AI is hidden until the proxy URL is set', () => {
  const service = createAiTopicService({ getApiKey: () => '', getLicense: () => makeLicense() });
  assert.equal(service.getStatus().providers.some(p => p.id === 'builtin'), false);
});

test('a busy AI is tried again before the teacher sees an error', async () => {
  const answers = [{ status: 503 }, { status: 429, retryAfter: '7' }, { status: 200 }];
  const waits = [];
  let calls = 0;
  const service = createAiTopicService({
    getApiKey: () => 'teacher-key',
    wait: async ms => { waits.push(ms); },
    fetchImpl: async () => {
      const answer = answers[Math.min(calls++, answers.length - 1)];
      return {
        ok: answer.status === 200,
        status: answer.status,
        headers: { get: name => (name === 'retry-after' ? answer.retryAfter ?? null : null) },
        text: async () => '',
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] })
      };
    }
  });
  const draft = await service.generateDraft({ provider: 'groq', systemPrompt: 's', userText: 'u', schema: { type: 'object' }, images: [] });
  assert.equal(draft.text, '{"ok":true}');
  assert.deepEqual(waits, [2000, 7500]);

  // Still overloaded after the retries: a short message, not the raw JSON.
  answers.splice(0, answers.length, { status: 503 });
  calls = 0;
  await assert.rejects(
    service.generateDraft({ provider: 'groq', systemPrompt: 's', userText: 'u', schema: { type: 'object' }, images: [] }),
    /overloaded right now/
  );
});

test('a limit message says which limit, waits as long as the AI asks, and not for a daily limit', async () => {
  let answers = [];
  const waits = [];
  let calls = 0;
  const service = createAiTopicService({
    getApiKey: () => 'teacher-key',
    wait: async ms => { waits.push(ms); },
    fetchImpl: async () => {
      const answer = answers[Math.min(calls++, answers.length - 1)];
      return {
        ok: answer.status === 200,
        status: answer.status,
        headers: { get: () => null },
        text: async () => answer.body ?? '',
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] })
      };
    }
  });
  const ask = () => service.generateDraft({ provider: 'groq', systemPrompt: 's', userText: 'u', schema: { type: 'object' }, images: [] });

  // Groq's per-minute limit: waits the 12.5 s it asks for.
  answers = [
    { status: 429, body: '{"error":{"message":"Rate limit reached on tokens per minute (TPM): Limit 6000, Used 5000, Requested 3000. Please try again in 12.5s."}}' },
    { status: 200 }
  ];
  assert.equal((await ask()).text, '{"ok":true}');
  assert.deepEqual(waits, [13000]);

  // A daily quota: no waiting, and the teacher is told why.
  answers = [{ status: 429, body: '{"error":{"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 20 per day"}}' }];
  calls = 0;
  waits.length = 0;
  await assert.rejects(ask(), /free limit for today is used up.*20 per day/);
  assert.deepEqual([calls, waits], [1, []]);
});

test('a request too large for the plan is not retried and says so', async () => {
  let calls = 0;
  const service = createAiTopicService({
    getApiKey: () => 'teacher-key',
    wait: async () => { throw new Error('should not wait'); },
    fetchImpl: async () => {
      calls++;
      return {
        ok: false,
        status: 429,
        headers: { get: () => null },
        text: async () => '{"error":{"message":"Request too large for model on output tokens per minute (OTPM): Limit 1000, Requested 2610. Please reduce max_tokens"}}'
      };
    }
  });
  await assert.rejects(
    service.generateDraft({ provider: 'groq', systemPrompt: 's', userText: 'u', schema: { type: 'object' }, images: [] }),
    /too big for this AI's plan.*OTPM/
  );
  assert.equal(calls, 1);
});
