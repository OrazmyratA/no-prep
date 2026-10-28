// node --test electron/main   (npm run test:electron)
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiTopicService } = require('./ai-topic-service');

function response(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

const answer = (text) => response(200, { candidates: [{ content: { parts: [{ text }] } }] });
const draft = { provider: 'gemini', systemPrompt: 's', userText: 'u', schema: { type: 'object' }, images: [] };

function service(onFetch, keys = { gemini: 'g', openai: 'o' }) {
  const urls = [];
  const waits = [];
  const ai = createAiTopicService({
    getApiKey: (id) => keys[id] || '',
    wait: async (ms) => { waits.push(ms); },
    fetchImpl: async (url, init) => { urls.push(url); return onFetch(url, init); }
  });
  return { ai, urls, waits };
}

test('Gemini: an overloaded newest Flash falls back to the older Flash at once', async () => {
  const { ai, urls } = service((url) => /3\.8-flash/.test(url)
    ? response(503, { error: { message: 'This model is currently experiencing high demand.' } })
    : answer('{"word":"apple"}'));
  const result = await ai.generateDraft(draft);
  assert.equal(result.text, '{"word":"apple"}');
  assert.equal(urls.length, 2, 'no waiting retries on the overloaded model');
  assert.match(urls[1], /gemini-3\.5-flash:/);
});

test('Gemini: a newest Flash that does not answer in time falls back too', async () => {
  const { ai, urls } = service((url) => {
    if (/3\.8-flash/.test(url)) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    return answer('{"ok":true}');
  });
  assert.equal((await ai.generateDraft(draft)).text, '{"ok":true}');
  assert.match(urls[1], /gemini-3\.5-flash:/);
});

test('Gemini: the newest Flash at its free daily limit falls back (each model has its own)', async () => {
  const { ai, urls } = service((url) => /3\.8-flash/.test(url)
    ? response(429, { error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash. GenerateRequestsPerDayPerProjectPerModel-FreeTier' } })
    : answer('{"ok":true}'));
  assert.equal((await ai.generateDraft(draft)).text, '{"ok":true}');
  assert.match(urls[1], /gemini-3\.5-flash:/);
});

test('Gemini: a rejected key is not hidden behind the fallback', async () => {
  const { ai, urls } = service(() => response(403, 'denied'));
  await assert.rejects(ai.generateDraft(draft), /rejected your API key/);
  assert.equal(urls.length, 1);
});

test('no credit is said plainly, never "try again in a moment"', async () => {
  const { ai, urls, waits } = service(() => response(429, { error: { message: 'You have no credits remaining.', code: 'insufficient_quota' } }));
  await assert.rejects(ai.generateImage({ provider: 'openai', prompt: 'apple' }), (error) => {
    assert.match(error.message, /no credit left/);
    assert.doesNotMatch(error.message, /try again in a moment/);
    return true;
  });
  assert.deepEqual(waits, [], 'waiting cannot bring credit back');
  assert.equal(urls.length, 1);
});

test('drawing on a free Gemini key says the free plan does not include it', async () => {
  const { ai } = service(() => response(429, { error: { message: 'You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-nano-banana-2.1' } }));
  await assert.rejects(ai.generateImage({ provider: 'gemini', prompt: 'apple' }), /free plan does not include/);
});

test('drawing uses the current models, at medium quality for ChatGPT', async () => {
  const bodies = [];
  const { ai, urls } = service((url, init) => {
    bodies.push(JSON.parse(init.body));
    return /openai/.test(url)
      ? response(200, { data: [{ b64_json: 'AAAA' }] })
      : response(200, { candidates: [{ content: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'image/png' } }] } }] });
  });
  await ai.generateImage({ provider: 'openai', prompt: 'apple' });
  await ai.generateImage({ provider: 'gemini', prompt: 'apple' });
  assert.equal(bodies[0].model, 'gpt-image-2.5-flare');
  assert.equal(bodies[0].quality, 'medium');
  assert.match(urls[1], /gemini-nano-banana-2\.1:generateContent/);
});

test('says why it waits, and Cancel ends the wait at once', async () => {
  const statuses = [];
  const controller = new AbortController();
  let calls = 0;
  const ai = createAiTopicService({
    getApiKey: () => 'o',
    // The wait never ends by itself: only Cancel can end it.
    wait: () => new Promise(() => {}),
    fetchImpl: async () => { calls++; return response(429, { error: { message: 'Rate limit reached. Please try again in 12.5s.' } }); }
  });
  const run = ai.generateDraft({ ...draft, provider: 'openai' }, {
    signal: controller.signal,
    onStatus: (status) => { statuses.push(status); controller.abort(); }
  });
  await assert.rejects(run, (error) => error.kind === 'CANCELLED');
  assert.deepEqual(statuses, [{ kind: 'wait', reason: 'minuteLimit', seconds: 13 }]);
  assert.equal(calls, 1, 'nothing is sent after Cancel');
});

test('tells the Gemini fallback, and every failure says its kind', async () => {
  const statuses = [];
  const { ai } = service((url) => /3\.8-flash/.test(url) ? response(503, 'busy') : answer('{"ok":true}'));
  await ai.generateDraft(draft, { onStatus: (status) => statuses.push(status) });
  assert.deepEqual(statuses, [{ kind: 'fallback' }]);

  const kind = async (status, body) => {
    const { ai: failing } = service(() => response(status, body));
    return failing.generateDraft({ ...draft, provider: 'openai' }).catch((error) => error.kind);
  };
  assert.equal(await kind(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }), 'NO_CREDIT');
  assert.equal(await kind(401, 'bad key'), 'KEY_REJECTED');
  assert.equal(await kind(429, { error: { message: 'Requests per day limit reached' } }), 'DAILY_LIMIT');
  assert.equal(await kind(413, 'too big'), 'TOO_LARGE');
  assert.equal(await kind(400, 'nonsense'), 'FAILED');
});

test('counts the tokens used and reads Groq\'s requests left today', async () => {
  const groq = {
    ...response(200, { choices: [{ message: { content: '{"ok":true}' } }], usage: { total_tokens: 1234 } }),
    headers: { get: (name) => ({ 'x-ratelimit-remaining-requests': '14370', 'x-ratelimit-limit-requests': '14400' })[name] ?? null }
  };
  const { ai } = service(() => groq, { groq: 'q' });
  const result = await ai.generateDraft({ ...draft, provider: 'groq' });
  assert.deepEqual(result.usage, { tokens: 1234, remainingToday: 14370, limitToday: 14400 });
});

test('checking a key sends one tiny request and says what is wrong', async () => {
  const bodies = [];
  const { ai } = service((_url, init) => { bodies.push(JSON.parse(init.body)); return response(200, { usage: { total_tokens: 9 } }); });
  assert.deepEqual(await ai.checkKey({ provider: 'openai' }), { usage: { tokens: 9 } });
  assert.equal(bodies[0].max_output_tokens, 16);

  const { ai: empty } = service(() => response(429, { error: { code: 'insufficient_quota', message: 'no credits remaining' } }));
  await assert.rejects(empty.checkKey({ provider: 'openai' }), (error) => error.kind === 'NO_CREDIT');
});
