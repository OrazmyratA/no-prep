// Turns a teacher's prompt (+ optional book-page photos) into a topic draft, using either
// "NoPrep AI" (our proxy in ai-proxy/, paid by NoPrep and covered by the license) or an AI the
// teacher linked with their own API key. The prompt, the JSON schema and all validation live in
// the renderer (src/app/core/ai-topic/); this service only talks to each provider and returns the
// model's raw JSON text.
// Loaded on first use (only the Anthropic provider needs it), not while the app starts.
const loadAnthropic = () => require('@anthropic-ai/sdk');

// 12 pages covers a unit or a whole speaking test; the app shrinks each page more when many are
// sent, so a full request stays under the NoPrep AI proxy's MAX_BODY_BYTES (12 MB).
const PROVIDERS = {
  // The proxy picks the (Gemini) model itself; the app only sends a Gemini request body.
  builtin: { model: 'server', maxImages: 12 },
  openai: { model: 'gpt-6-sol', maxImages: 12 },
  gemini: { model: 'gemini-3.8-flash', maxImages: 12 },
  anthropic: { model: 'claude-opus-5', maxImages: 12 },
  // Groq's only vision model; it accepts at most 3 images per request.
  groq: { model: 'qwen/qwen3.8-27b', maxImages: 3 }
};

const REQUEST_TIMEOUT_MS = 180000;

// Google's newest Flash is sometimes "experiencing high demand" for hours: on 2026-10-26 3.8 and 3.7
// answered 503 or hung past a minute while 3.5 answered in 10 s. Then the older Flash gets one try
// instead of the teacher waiting 3 minutes for an error.
const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash';
// How long the newest Flash may take before the fallback is tried (a 12-page topic takes ~1 min).
const GEMINI_PRIMARY_TIMEOUT_MS = 90000;
const OVERLOADED_STATUSES = new Set([500, 502, 503, 504]);

// A busy AI (an overloaded model, a per-minute limit) usually frees up within seconds, so these
// answers are tried again before the teacher sees an error. The wait the AI asks for is used
// when it gives one (header or message); a wait over a minute (a daily limit) is not waited for.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [2000, 6000];
const MAX_RETRY_WAIT_MS = 60000;

// "Generate a picture" (explicit, teacher-triggered — never automatic; see ai-media-resolver.ts).
// Only these two providers can generate images; Anthropic and Groq have no image-gen API, and the
// NoPrep AI proxy has no image endpoint yet (same "not built yet" state as Android TTS).
// Model IDs checked 2026-10-26 (gpt-image-1 was shut down 2026-10-23; gemini-3-flash-image never
// existed): providers rename/retire image models often — re-check before every release.
const IMAGE_PROVIDERS = {
  openai: { model: 'gpt-image-2.5-flare' },
  gemini: { model: 'gemini-nano-banana-2.1' }
};

// Every failure says what kind it is, so the app can show the right help (docs/ai-choices-plan.md,
// "What is happening"): the teacher sees the reason at once instead of a long spinner.
const ERROR_KINDS = ['NO_CREDIT', 'NOT_IN_PLAN', 'DAILY_LIMIT', 'KEY_REJECTED', 'BUSY', 'TOO_LARGE', 'TIMEOUT', 'OFFLINE', 'CANCELLED', 'DECLINED', 'FAILED'];

function aiError(message, kind, extra = {}) {
  return Object.assign(new Error(message), { kind: ERROR_KINDS.includes(kind) ? kind : 'FAILED' }, extra);
}

/**
 * A run: `signal` cancels it (the teacher's Cancel), `onStatus` hears what is happening while it
 * waits ({ kind: 'wait', reason: 'busy' | 'minuteLimit', seconds } or { kind: 'fallback' }), and
 * `usage` is filled from the answers (tokens; Groq's requests left today).
 */
function newRun(run = {}) {
  return { signal: run.signal || null, onStatus: typeof run.onStatus === 'function' ? run.onStatus : () => {}, usage: {} };
}

function createAiTopicService({ getApiKey, getLicense = () => null, proxyUrl = '', fetchImpl, wait }) {
  const doFetch = fetchImpl || fetch;
  const sleep = wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const proxyBase = String(proxyUrl || '').replace(/\/+$/, '');

  /** A retry wait that Cancel ends at once. */
  async function pause(ms, signal) {
    if (!signal) return sleep(ms);
    if (signal.aborted) throw cancelled();
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(cancelled());
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([sleep(ms), aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  function cancelled() {
    return aiError('Cancelled.', 'CANCELLED');
  }

  function isConfigured(id) {
    if (id === 'builtin') return !!proxyBase && !!getLicense();
    return !!String(getApiKey(id) || '').trim();
  }

  function getStatus() {
    return {
      providers: Object.entries(PROVIDERS)
        // NoPrep AI is only offered once the proxy has been deployed and its URL set.
        .filter(([id]) => id !== 'builtin' || !!proxyBase)
        .map(([id, info]) => ({
          id,
          configured: isConfigured(id),
          maxImages: info.maxImages,
          supportsImageGeneration: !!IMAGE_PROVIDERS[id]
        }))
    };
  }

  function normalizeInput(input) {
    const provider = String(input?.provider || '');
    if (!PROVIDERS[provider] || (provider === 'builtin' && !proxyBase)) {
      throw new Error('Unknown AI provider.');
    }
    let apiKey = '';
    let license = null;
    if (provider === 'builtin') {
      license = getLicense();
      if (!license) {
        throw new Error('NoPrep AI needs an activated license on this computer.');
      }
    } else {
      apiKey = String(getApiKey(provider) || '').trim();
      if (!apiKey) {
        throw new Error('This AI is not linked yet. Paste your API key first.');
      }
    }
    const images = (Array.isArray(input?.images) ? input.images : [])
      .slice(0, PROVIDERS[provider].maxImages)
      .map((image) => ({
        mimeType: String(image?.mimeType || 'image/jpeg'),
        base64: String(image?.base64 || '')
      }))
      .filter((image) => image.base64);
    return {
      provider,
      apiKey,
      license,
      model: PROVIDERS[provider].model,
      systemPrompt: String(input?.systemPrompt || ''),
      userText: String(input?.userText || ''),
      schema: input?.schema && typeof input.schema === 'object' ? input.schema : null,
      images
    };
  }

  /**
   * `failWhenOverloaded`: a timeout or an overloaded answer is thrown at once (marked
   * `overloaded`) instead of being waited out, so the caller can try another model.
   */
  async function postJson(url, headers, body, { friendlyErrors = false, timeoutMs = REQUEST_TIMEOUT_MS, failWhenOverloaded = false } = {}, run = newRun()) {
    let response;
    for (let attempt = 0; ; attempt++) {
      if (run.signal?.aborted) throw cancelled();
      const timeout = AbortSignal.timeout(timeoutMs);
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
          signal: run.signal ? AbortSignal.any([timeout, run.signal]) : timeout
        });
      } catch (error) {
        if (run.signal?.aborted) throw cancelled();
        if (error?.name === 'TimeoutError' || timeout.aborted) {
          throw aiError('The AI took too long to answer. Please try again.', 'TIMEOUT', { overloaded: failWhenOverloaded });
        }
        throw aiError('Could not reach the AI service. Check your internet connection.', 'OFFLINE');
      }
      if (response.ok) {
        readLimitHeaders(response, run);
        return response.json();
      }
      const errorText = await response.text().catch(() => '');
      // Also a free plan's daily limit: Google counts it per model, so the older Flash still has its own.
      if (failWhenOverloaded && (OVERLOADED_STATUSES.has(response.status) || (response.status === 429 && isDailyLimit(errorText) && !isNotInFreePlan(errorText)))) {
        throw aiError(httpErrorMessage(response.status, errorText), errorKind(response.status, errorText), { overloaded: true });
      }
      // The NoPrep AI proxy's own 429 is an hourly or daily limit: waiting seconds will not help.
      const delay = friendlyErrors && response.status === 429 ? null : retryDelay(response, errorText, attempt);
      if (delay === null) {
        // The NoPrep AI proxy already answers with a teacher-friendly message.
        if (friendlyErrors) {
          let message = '';
          try {
            message = String(JSON.parse(errorText)?.error?.message || '');
          } catch {
            // Not our proxy's JSON (e.g. a gateway error page): fall through to the generic text.
          }
          if (message) throw aiError(message, errorKind(response.status, errorText));
        }
        throw aiError(httpErrorMessage(response.status, errorText), errorKind(response.status, errorText));
      }
      // Say why the teacher is waiting, and for how long.
      run.onStatus({ kind: 'wait', reason: response.status === 429 ? 'minuteLimit' : 'busy', seconds: Math.ceil(delay / 1000) });
      await pause(delay, run.signal);
    }
  }

  /** Groq says on every answer how many requests are left today (console.groq.com/docs/rate-limits). */
  function readLimitHeaders(response, run) {
    const remaining = Number(response.headers?.get?.('x-ratelimit-remaining-requests'));
    const limit = Number(response.headers?.get?.('x-ratelimit-limit-requests'));
    if (Number.isFinite(remaining) && response.headers?.get?.('x-ratelimit-remaining-requests') !== null) {
      run.usage.remainingToday = remaining;
      if (Number.isFinite(limit)) run.usage.limitToday = limit;
    }
  }

  function addTokens(run, count) {
    const tokens = Number(count);
    if (Number.isFinite(tokens) && tokens > 0) run.usage.tokens = (run.usage.tokens || 0) + tokens;
  }

  /** What kind of failure an AI's error answer is (see ERROR_KINDS). */
  function errorKind(status, errorText) {
    if (isNotInFreePlan(errorText)) return 'NOT_IN_PLAN';
    if (isNoCredit(errorText) || status === 402) return 'NO_CREDIT';
    if (status === 401 || status === 403) return 'KEY_REJECTED';
    if (status === 413 || (status === 429 && isTooLarge(errorText))) return 'TOO_LARGE';
    if (status === 429) return isDailyLimit(errorText) ? 'DAILY_LIMIT' : 'BUSY';
    if (OVERLOADED_STATUSES.has(status)) return 'BUSY';
    return 'FAILED';
  }

  /** How long to wait before trying a busy AI again, or null to give up now. */
  function retryDelay(response, errorText, attempt) {
    if (!RETRY_STATUSES.has(response.status) || attempt >= RETRY_DELAYS_MS.length) return null;
    // Waiting cannot help: a daily limit, a request too big for the plan, no credit, or no free plan.
    if (isDailyLimit(errorText) || isTooLarge(errorText) || isNoCredit(errorText) || isNotInFreePlan(errorText)) return null;
    const asked = askedWaitMs(response, errorText);
    if (asked !== null) return asked <= MAX_RETRY_WAIT_MS ? Math.max(asked + 500, RETRY_DELAYS_MS[attempt]) : null;
    return RETRY_DELAYS_MS[attempt];
  }

  /** The wait the AI asks for: Retry-After, Groq/OpenAI "try again in 12.5s", Gemini "retryDelay": "37s". */
  function askedWaitMs(response, errorText) {
    const header = Number(response.headers?.get?.('retry-after'));
    if (Number.isFinite(header) && header > 0) return header * 1000;
    const text = String(errorText || '');
    const minutes = text.match(/try again in (\d+)m([\d.]+)s/i);
    if (minutes) return (Number(minutes[1]) * 60 + Number(minutes[2])) * 1000;
    const seconds = text.match(/try again in ([\d.]+)\s*s/i) || text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
    if (seconds) return Number(seconds[1]) * 1000;
    const ms = text.match(/try again in ([\d.]+)\s*ms/i);
    return ms ? Number(ms[1]) : null;
  }

  /** One request is over a per-minute limit on its own (Groq's free plan): waiting cannot help. */
  function isTooLarge(errorText) {
    return /Request too large|reduce max_tokens/i.test(String(errorText || ''));
  }

  function isNoCredit(errorText) {
    return /insufficient_quota|no credits remaining|credit balance is too low/i.test(String(errorText || ''));
  }

  /** Gemini's answer for something its free plan never allows: a free-tier quota of 0 (image models). */
  function isNotInFreePlan(errorText) {
    const text = String(errorText || '');
    return /free_tier/i.test(text) && /limit: 0\b/.test(text);
  }

  function isDailyLimit(errorText) {
    return /per ?day|PerDay|daily/i.test(String(errorText || ''));
  }

  /** The AI's own short reason from its error JSON (or text), for the line under our message. */
  function providerReason(errorText) {
    const text = String(errorText || '');
    let message = '';
    try {
      const data = JSON.parse(text);
      message = String(data?.error?.message || data?.message || '');
    } catch {
      message = text;
    }
    return message.replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  function httpErrorMessage(status, errorText) {
    const reason = providerReason(errorText);
    const because = reason ? ` (${reason})` : '';
    // Checked first: these come as 429 (OpenAI, Gemini), 400 (Claude) or 402, and waiting never helps.
    if (isNotInFreePlan(errorText)) {
      return `This AI's free plan does not include this (for example drawing pictures). Add billing on its website, or pick another AI.${because}`;
    }
    if (isNoCredit(errorText)) {
      return `Your account with this AI has no credit left. Add credit on its website, or pick another AI.${because}`;
    }
    if (status === 401 || status === 403) return 'The AI rejected your API key. Check that it is correct and active.';
    if (status === 413 || (status === 429 && isTooLarge(errorText))) {
      return `This request is too big for this AI's plan. Send fewer pages, or pick another AI.${because}`;
    }
    if (status === 429) {
      if (isDailyLimit(errorText)) {
        return `This AI's free limit for today is used up. Try again tomorrow, or pick another AI.${because}`;
      }
      return `The AI is busy or your plan limit was reached. Please try again in a moment.${because}`;
    }
    if (status === 502 || status === 503 || status === 504) {
      return 'The AI is overloaded right now. Please try again in a minute, or pick another AI.';
    }
    return `AI service error (${status}): ${String(errorText || '').slice(0, 200)}`;
  }

  async function generateWithOpenAi(req, run) {
    const content = [
      { type: 'input_text', text: req.userText },
      ...req.images.map((image) => ({
        type: 'input_image',
        image_url: `data:${image.mimeType};base64,${image.base64}`
      }))
    ];
    const data = await postJson('https://api.openai.com/v1/responses', {
      Authorization: `Bearer ${req.apiKey}`
    }, {
      model: req.model,
      input: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content }
      ],
      text: {
        format: { type: 'json_schema', name: 'topic_draft', schema: req.schema, strict: true }
      }
    }, {}, run);
    addTokens(run, data?.usage?.total_tokens);
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
      return data.output_text;
    }
    const parts = (Array.isArray(data?.output) ? data.output : [])
      .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []));
    const refusal = parts.find((part) => part?.type === 'refusal');
    if (refusal) {
      throw aiError('The AI declined this request. Try rewording the prompt.', 'DECLINED');
    }
    return parts.filter((part) => part?.type === 'output_text').map((part) => part.text || '').join('');
  }

  // Gemini's responseSchema is an OpenAPI subset without `additionalProperties`.
  function toGeminiSchema(schema) {
    if (Array.isArray(schema)) return schema.map(toGeminiSchema);
    if (!schema || typeof schema !== 'object') return schema;
    const result = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'additionalProperties') continue;
      result[key] = toGeminiSchema(value);
    }
    return result;
  }

  // Shared by the Gemini provider and NoPrep AI (whose proxy forwards this body to Gemini).
  function buildGeminiBody(req) {
    return {
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents: [{
        role: 'user',
        parts: [
          { text: req.userText },
          ...req.images.map((image) => ({ inline_data: { mime_type: image.mimeType, data: image.base64 } }))
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(req.schema)
      }
    };
  }

  function readGeminiText(data, run) {
    if (run) addTokens(run, data?.usageMetadata?.totalTokenCount);
    const candidate = data?.candidates?.[0];
    if (!candidate) {
      throw aiError('The AI declined this request. Try rewording the prompt.', 'DECLINED');
    }
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
      throw aiError('The AI declined this request. Try rewording the prompt.', 'DECLINED');
    }
    return (candidate.content?.parts || []).map((part) => part?.text || '').join('');
  }

  async function generateWithGemini(req, run) {
    const url = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const headers = { 'x-goog-api-key': req.apiKey };
    const body = buildGeminiBody(req);
    let data;
    try {
      data = await postJson(url(req.model), headers, body, { timeoutMs: GEMINI_PRIMARY_TIMEOUT_MS, failWhenOverloaded: true }, run);
    } catch (error) {
      if (!error?.overloaded) throw error;
      console.warn(`Gemini ${req.model} is overloaded; trying ${GEMINI_FALLBACK_MODEL}.`);
      run.onStatus({ kind: 'fallback' });
      data = await postJson(url(GEMINI_FALLBACK_MODEL), headers, body, {}, run);
    }
    return readGeminiText(data, run);
  }

  async function generateWithBuiltin(req, run) {
    const licenseHeader = Buffer.from(JSON.stringify(req.license)).toString('base64');
    const data = await postJson(`${proxyBase}/v1/topic-draft`, { 'X-NoPrep-License': licenseHeader }, buildGeminiBody(req), {
      friendlyErrors: true
    }, run);
    return readGeminiText(data, run);
  }

  /** Anthropic's SDK errors as our kinds. */
  function anthropicError(Anthropic, error, run) {
    if (error instanceof Anthropic.APIUserAbortError || run.signal?.aborted) return cancelled();
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return aiError(httpErrorMessage(401), 'KEY_REJECTED');
    }
    if (error instanceof Anthropic.RateLimitError) {
      return aiError(httpErrorMessage(429, error.message), errorKind(429, error.message));
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return aiError('The AI took too long to answer. Please try again.', 'TIMEOUT');
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return aiError('Could not reach the AI service. Check your internet connection.', 'OFFLINE');
    }
    if (error instanceof Anthropic.APIError) {
      return aiError(httpErrorMessage(error.status, error.message), errorKind(error.status, error.message));
    }
    return error;
  }

  async function generateWithAnthropic(req, run) {
    const Anthropic = loadAnthropic();
    const client = new Anthropic({
      apiKey: req.apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
      ...(fetchImpl ? { fetch: fetchImpl } : {})
    });
    let response;
    try {
      response = await client.beta.messages.create({
        model: req.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: req.schema }
        },
        system: req.systemPrompt,
        messages: [{
          role: 'user',
          content: [
            ...req.images.map((image) => ({
              type: 'image',
              source: { type: 'base64', media_type: image.mimeType, data: image.base64 }
            })),
            { type: 'text', text: req.userText }
          ]
        }]
      }, { signal: run.signal || undefined });
    } catch (error) {
      throw anthropicError(Anthropic, error, run);
    }
    addTokens(run, (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0));
    if (response.stop_reason === 'refusal') {
      throw aiError('The AI declined this request. Try rewording the prompt.', 'DECLINED');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('The topic was too long for one request. Ask for fewer items.');
    }
    return response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  }

  async function generateWithGroq(req, run) {
    const content = [
      { type: 'text', text: req.userText },
      ...req.images.map((image) => ({
        type: 'image_url',
        image_url: { url: `data:${image.mimeType};base64,${image.base64}` }
      }))
    ];
    // Groq's vision model only offers JSON mode (no schema), so the schema goes into the prompt.
    const systemPrompt = `${req.systemPrompt}\n\nThe JSON must match this JSON Schema exactly:\n${JSON.stringify(req.schema)}`;
    const data = await postJson('https://api.groq.com/openai/v1/chat/completions', {
      Authorization: `Bearer ${req.apiKey}`
    }, {
      model: req.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content }
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 8000
    }, {}, run);
    addTokens(run, data?.usage?.total_tokens);
    const text = String(data?.choices?.[0]?.message?.content || '');
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  async function generateDraft(input, runOptions) {
    const req = normalizeInput(input);
    const run = newRun(runOptions);
    let text;
    switch (req.provider) {
      case 'builtin': text = await generateWithBuiltin(req, run); break;
      case 'openai': text = await generateWithOpenAi(req, run); break;
      case 'gemini': text = await generateWithGemini(req, run); break;
      case 'anthropic': text = await generateWithAnthropic(req, run); break;
      case 'groq': text = await generateWithGroq(req, run); break;
    }
    if (!String(text || '').trim()) {
      throw aiError('The AI returned an empty answer. Please try again.', 'FAILED');
    }
    return { text, usage: run.usage };
  }

  /**
   * "Is this key working?": one tiny request (a word in, a word out) — free on free plans, a tiny
   * fraction of a cent on paid ones. Run when a key is linked and from "Check now", so a wrong key
   * or an empty account shows at once, not after a long topic.
   */
  async function checkKey(input, runOptions) {
    const provider = String(input?.provider || '');
    if (provider === 'builtin') return { usage: {} };
    const req = normalizeInput({ provider, systemPrompt: 'Answer with one word.', userText: 'Say OK.' });
    const run = newRun(runOptions);
    const ask = { timeoutMs: 30000 };
    switch (provider) {
      case 'openai': {
        const data = await postJson('https://api.openai.com/v1/responses', { Authorization: `Bearer ${req.apiKey}` },
          { model: req.model, input: 'Say OK.', max_output_tokens: 16 }, ask, run);
        addTokens(run, data?.usage?.total_tokens);
        break;
      }
      case 'gemini': {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
        const data = await postJson(url, { 'x-goog-api-key': req.apiKey },
          { contents: [{ role: 'user', parts: [{ text: 'Say OK.' }] }], generationConfig: { maxOutputTokens: 4 } }, ask, run);
        addTokens(run, data?.usageMetadata?.totalTokenCount);
        break;
      }
      case 'anthropic': {
        const Anthropic = loadAnthropic();
        const client = new Anthropic({ apiKey: req.apiKey, timeout: 30000, maxRetries: 0, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
        try {
          const response = await client.messages.create({ model: req.model, max_tokens: 4, messages: [{ role: 'user', content: 'Say OK.' }] },
            { signal: run.signal || undefined });
          addTokens(run, (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0));
        } catch (error) {
          throw anthropicError(Anthropic, error, run);
        }
        break;
      }
      case 'groq': {
        const data = await postJson('https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${req.apiKey}` },
          { model: req.model, messages: [{ role: 'user', content: 'Say OK.' }], max_completion_tokens: 4 }, ask, run);
        addTokens(run, data?.usage?.total_tokens);
        break;
      }
    }
    return { usage: run.usage };
  }

  function normalizeImageInput(input) {
    const provider = String(input?.provider || '');
    if (!IMAGE_PROVIDERS[provider]) {
      throw aiError('This AI cannot generate pictures. Link OpenAI or Gemini for that.', 'FAILED');
    }
    const apiKey = String(getApiKey(provider) || '').trim();
    if (!apiKey) {
      throw aiError('This AI is not linked yet. Paste your API key first.', 'KEY_REJECTED');
    }
    const prompt = String(input?.prompt || '').trim().slice(0, 500);
    if (!prompt) {
      throw new Error('Nothing to draw.');
    }
    return { provider, apiKey, model: IMAGE_PROVIDERS[provider].model, prompt };
  }

  async function generateImageWithOpenAi(req, run) {
    const data = await postJson('https://api.openai.com/v1/images/generations', {
      Authorization: `Bearer ${req.apiKey}`
    }, {
      model: req.model,
      prompt: req.prompt,
      size: '1024x1024',
      // A flashcard picture: medium is clear enough and costs far less than high.
      quality: 'medium',
      n: 1
    }, {}, run);
    addTokens(run, data?.usage?.total_tokens);
    const entry = data?.data?.[0];
    if (!entry?.b64_json) {
      throw new Error('The AI did not return a picture. Please try again.');
    }
    return { imageBase64: entry.b64_json, mimeType: 'image/png' };
  }

  async function generateImageWithGemini(req, run) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
    const data = await postJson(url, { 'x-goog-api-key': req.apiKey }, {
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] }
    }, {}, run);
    addTokens(run, data?.usageMetadata?.totalTokenCount);
    const candidate = data?.candidates?.[0];
    if (!candidate || candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
      throw aiError('The AI declined this request. Try a different picture description.', 'DECLINED');
    }
    const part = (candidate.content?.parts || []).find((p) => p?.inlineData?.data);
    if (!part) {
      throw new Error('The AI did not return a picture. Please try again.');
    }
    return { imageBase64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
  }

  async function generateImage(input, runOptions) {
    const req = normalizeImageInput(input);
    const run = newRun(runOptions);
    const image = req.provider === 'openai' ? await generateImageWithOpenAi(req, run) : await generateImageWithGemini(req, run);
    return { ...image, usage: run.usage };
  }

  return { getStatus, generateDraft, generateImage, checkKey };
}

module.exports = { createAiTopicService, AI_TOPIC_PROVIDERS: PROVIDERS };
