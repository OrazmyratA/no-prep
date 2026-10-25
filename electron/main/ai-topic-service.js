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

// A busy AI (an overloaded model, a per-minute limit) usually frees up within seconds, so these
// answers are tried again before the teacher sees an error. The wait the AI asks for is used
// when it gives one (header or message); a wait over a minute (a daily limit) is not waited for.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [2000, 6000];
const MAX_RETRY_WAIT_MS = 60000;

// "Generate a picture" (explicit, teacher-triggered — never automatic; see ai-media-resolver.ts).
// Only these two providers can generate images; Anthropic and Groq have no image-gen API, and the
// NoPrep AI proxy has no image endpoint yet (same "not built yet" state as Android TTS).
// Model IDs checked 2026-09-29; providers rename/retire image models often — re-check before release.
const IMAGE_PROVIDERS = {
  openai: { model: 'gpt-image-1' },
  gemini: { model: 'gemini-3-flash-image' }
};

function createAiTopicService({ getApiKey, getLicense = () => null, proxyUrl = '', fetchImpl, wait }) {
  const doFetch = fetchImpl || fetch;
  const pause = wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const proxyBase = String(proxyUrl || '').replace(/\/+$/, '');

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

  async function postJson(url, headers, body, { friendlyErrors = false } = {}) {
    let response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
      } catch (error) {
        if (error?.name === 'TimeoutError') {
          throw new Error('The AI took too long to answer. Please try again.');
        }
        throw new Error('Could not reach the AI service. Check your internet connection.');
      }
      if (response.ok) return response.json();
      const errorText = await response.text().catch(() => '');
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
          if (message) throw new Error(message);
        }
        throw new Error(httpErrorMessage(response.status, errorText));
      }
      await pause(delay);
    }
  }

  /** How long to wait before trying a busy AI again, or null to give up now. */
  function retryDelay(response, errorText, attempt) {
    if (!RETRY_STATUSES.has(response.status) || attempt >= RETRY_DELAYS_MS.length) return null;
    if (isDailyLimit(errorText) || isTooLarge(errorText)) return null;
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
    if (status === 401 || status === 403) return 'The AI rejected your API key. Check that it is correct and active.';
    const reason = providerReason(errorText);
    const because = reason ? ` (${reason})` : '';
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

  async function generateWithOpenAi(req) {
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
    });
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
      return data.output_text;
    }
    const parts = (Array.isArray(data?.output) ? data.output : [])
      .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []));
    const refusal = parts.find((part) => part?.type === 'refusal');
    if (refusal) {
      throw new Error('The AI declined this request. Try rewording the prompt.');
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

  function readGeminiText(data) {
    const candidate = data?.candidates?.[0];
    if (!candidate) {
      throw new Error('The AI declined this request. Try rewording the prompt.');
    }
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
      throw new Error('The AI declined this request. Try rewording the prompt.');
    }
    return (candidate.content?.parts || []).map((part) => part?.text || '').join('');
  }

  async function generateWithGemini(req) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
    const data = await postJson(url, { 'x-goog-api-key': req.apiKey }, buildGeminiBody(req));
    return readGeminiText(data);
  }

  async function generateWithBuiltin(req) {
    const licenseHeader = Buffer.from(JSON.stringify(req.license)).toString('base64');
    const data = await postJson(`${proxyBase}/v1/topic-draft`, { 'X-NoPrep-License': licenseHeader }, buildGeminiBody(req), {
      friendlyErrors: true
    });
    return readGeminiText(data);
  }

  async function generateWithAnthropic(req) {
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
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new Error(httpErrorMessage(401));
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new Error(httpErrorMessage(429, error.message));
      }
      if (error instanceof Anthropic.APIConnectionError) {
        throw new Error('Could not reach the AI service. Check your internet connection.');
      }
      if (error instanceof Anthropic.APIError) {
        throw new Error(httpErrorMessage(error.status, error.message));
      }
      throw error;
    }
    if (response.stop_reason === 'refusal') {
      throw new Error('The AI declined this request. Try rewording the prompt.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('The topic was too long for one request. Ask for fewer items.');
    }
    return response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  }

  async function generateWithGroq(req) {
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
    });
    const text = String(data?.choices?.[0]?.message?.content || '');
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  async function generateDraft(input) {
    const req = normalizeInput(input);
    let text;
    switch (req.provider) {
      case 'builtin': text = await generateWithBuiltin(req); break;
      case 'openai': text = await generateWithOpenAi(req); break;
      case 'gemini': text = await generateWithGemini(req); break;
      case 'anthropic': text = await generateWithAnthropic(req); break;
      case 'groq': text = await generateWithGroq(req); break;
    }
    if (!String(text || '').trim()) {
      throw new Error('The AI returned an empty answer. Please try again.');
    }
    return { text };
  }

  function normalizeImageInput(input) {
    const provider = String(input?.provider || '');
    if (!IMAGE_PROVIDERS[provider]) {
      throw new Error('This AI cannot generate pictures. Link OpenAI or Gemini for that.');
    }
    const apiKey = String(getApiKey(provider) || '').trim();
    if (!apiKey) {
      throw new Error('This AI is not linked yet. Paste your API key first.');
    }
    const prompt = String(input?.prompt || '').trim().slice(0, 500);
    if (!prompt) {
      throw new Error('Nothing to draw.');
    }
    return { provider, apiKey, model: IMAGE_PROVIDERS[provider].model, prompt };
  }

  async function generateImageWithOpenAi(req) {
    const data = await postJson('https://api.openai.com/v1/images/generations', {
      Authorization: `Bearer ${req.apiKey}`
    }, {
      model: req.model,
      prompt: req.prompt,
      size: '1024x1024',
      n: 1
    });
    const entry = data?.data?.[0];
    if (!entry?.b64_json) {
      throw new Error('The AI did not return a picture. Please try again.');
    }
    return { imageBase64: entry.b64_json, mimeType: 'image/png' };
  }

  async function generateImageWithGemini(req) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
    const data = await postJson(url, { 'x-goog-api-key': req.apiKey }, {
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] }
    });
    const candidate = data?.candidates?.[0];
    if (!candidate || candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
      throw new Error('The AI declined this request. Try a different picture description.');
    }
    const part = (candidate.content?.parts || []).find((p) => p?.inlineData?.data);
    if (!part) {
      throw new Error('The AI did not return a picture. Please try again.');
    }
    return { imageBase64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
  }

  async function generateImage(input) {
    const req = normalizeImageInput(input);
    return req.provider === 'openai' ? generateImageWithOpenAi(req) : generateImageWithGemini(req);
  }

  return { getStatus, generateDraft, generateImage };
}

module.exports = { createAiTopicService, AI_TOPIC_PROVIDERS: PROVIDERS };
