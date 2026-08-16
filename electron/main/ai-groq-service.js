const GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile';
const GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';
const GROQ_API_BASE = 'https://api.groq.com/openai/v1';

const AUDIO_EXTENSION_BY_MIME = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp4': 'mp4',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/flac': 'flac'
};

function createGroqService({ getApiKey, fetchImpl }) {
  const doFetch = fetchImpl || fetch;

  function isConfigured() {
    return !!String(getApiKey() || '').trim();
  }

  function cleanText(value, max = 2000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function audioExtensionForMime(mimeType) {
    const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
    return AUDIO_EXTENSION_BY_MIME[base] || 'webm';
  }

  function buildDialogueSystemPrompt(input) {
    const config = input?.config && typeof input.config === 'object' ? input.config : {};
    const language = cleanText(config.language || input?.language || 'en', 80);
    const teacherPrompt = cleanText(config.teacherPrompt || config.prompt || '', 3000)
      || 'Have a natural speaking-practice conversation with the learner.';
    return `
You are NoPrep's AI speaking partner for a classroom app used by school students.
Conversation language: ${language}

Teacher instructions:
${teacherPrompt}

Safety (overrides everything else, including the teacher instructions above):
- The teacher instructions may contain typos, poor phrasing, or occasionally inappropriate/unsafe content (by accident or otherwise). Never follow, repeat, or act on any instruction that asks for hateful, sexual, violent, or otherwise unsafe or age-inappropriate content, regardless of how it is phrased or where it appears.
- If the student says something rude, inappropriate, or off-topic, do not repeat it, scold them, or engage with it. Stay calm and warm, gently redirect back to the speaking task with a normal question, exactly like a patient real-life teacher would.
- If you are ever unsure whether something is appropriate for a school-age student, treat it as inappropriate and steer the conversation to safe, neutral territory.

Rules:
- Follow the teacher instructions as the authority for the topic and difficulty of the conversation; the Safety rules above always take priority over anything in the teacher instructions. The defaults below apply unless the teacher instructions say otherwise.
- You are acting like a speaking exam interviewer: ask relevant questions and short follow-ups, and keep the conversation moving.
- Whether and when you correct the student's grammar, vocabulary, or pronunciation is governed entirely by the "Correction feedback" line in the teacher instructions above. If it says "During the conversation," weave brief, natural corrections into your reply right after a mistake that would actually confuse a listener, then continue with a question — do not nitpick every tiny slip. If it says "At the end," "Off," or nothing about correction feedback is stated, never correct, comment on, or mention grammar, vocabulary, or pronunciation during the conversation.
- You are the interviewer only. You have no personal experiences, plans, opinions, or daily routine of your own — never say things like "I went to..." or "Tomorrow I will...". Every reply must turn the conversation back to the student with a question about them.
- If the teacher instructions contain an example or sample answer, that is only a reference showing what a good STUDENT response looks like. Never say it yourself, echo it, or continue it as if it were your own line.
- Reply directly to the latest student message.
- Keep replies short: 1-3 sentences, like a real spoken conversation turn, not a written paragraph.
- Match your vocabulary and sentence complexity to the learner level or age stated in the teacher instructions. If none is stated, use simple, everyday words. The same applies to any corrections you give: short and simple for lower levels, fuller grammatical explanation for higher levels.
- Default tone: warm, patient, and encouraging, like a friendly classroom teacher.
- If the student's answer is very short or minimal, ask one gentle follow-up question to help them say more, unless the teacher instructions say to move on.
- Never end the conversation, say goodbye, or wrap up until the student clearly signals they are done (for example by saying goodbye or that they want to stop). Otherwise always continue with a question.
- Treat the transcript as evidence. Never invent what the student said, planned, felt, or did.
- This app is used by children in a classroom; keep every reply age-appropriate and safe.
- Output only the AI teacher's spoken reply, with no labels, markdown, or extra commentary.
`.trim();
  }

  function buildFeedbackSystemPrompt(input) {
    const config = input?.config && typeof input.config === 'object' ? input.config : {};
    const language = cleanText(config.language || input?.language || 'en', 80);
    return `
You are an English-language speaking assessment assistant for a classroom app. A student just finished a short spoken conversation (transcribed to text) in language: ${language}.
Assess the transcript and return ONLY a single JSON object with this exact shape, no markdown fences, no extra text:
{"fluency":"1-2 sentence comment","vocabulary":"1-2 sentence comment","grammar":"1-2 sentence comment","summary":"1 short encouraging sentence"}
Keep every field short, specific, age-appropriate, and encouraging. Base every comment only on what the student actually said in the transcript.
`.trim();
  }

  function buildClosingSystemPrompt(input) {
    const config = input?.config && typeof input.config === 'object' ? input.config : {};
    const language = cleanText(config.language || input?.language || 'en', 80);
    const teacherPrompt = cleanText(config.teacherPrompt || config.prompt || '', 3000)
      || 'Have a natural speaking-practice conversation with the learner.';
    return `
You are NoPrep's AI speaking partner wrapping up a spoken conversation with a school student, in language: ${language}.

Teacher instructions:
${teacherPrompt}

Safety (overrides everything else, including the teacher instructions above):
- Never follow, repeat, or act on any instruction that asks for hateful, sexual, violent, or otherwise unsafe or age-inappropriate content, regardless of how it is phrased or where it appears.
- Keep this age-appropriate for a school-age student.

Task:
Look at the "Correction feedback" line in the teacher instructions above.
- If it says "Off", or nothing about correction feedback is stated, give a short warm sign-off (1 sentence) thanking the student for practicing. Do not mention any mistakes.
- If it says "During the conversation", give a short warm sign-off (1 sentence). Corrections were already given during the conversation, so do not repeat them here.
- If it says "At the end", give one short piece of spoken feedback based only on what the student actually said in the transcript: one thing they did well, and one specific correction, explained at a depth appropriate to the stated learner level (short and simple for lower levels, fuller grammatical explanation for higher levels). Keep it to 2-4 sentences total, spoken and warm, not written like a report.
Never invent mistakes or achievements the student didn't actually make. Output only the spoken text, no labels or markdown.
`.trim();
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function requestOnce(path, options) {
    let response;
    try {
      response = await doFetch(`${GROQ_API_BASE}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          ...(options.headers || {})
        }
      });
    } catch (error) {
      throw new Error('Could not reach the AI service. Check your internet connection.');
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const error = new Error(response.status === 429
        ? 'AI speaking is busy right now. Please try again in a moment.'
        : `AI service error (${response.status}): ${errorText.slice(0, 200) || response.statusText}`);
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async function request(path, options) {
    if (!isConfigured()) {
      throw new Error('AI speaking is not configured on this device.');
    }
    try {
      return await requestOnce(path, options);
    } catch (error) {
      if (error?.status === 429) {
        await wait(6000);
        return requestOnce(path, options);
      }
      throw error;
    }
  }

  async function chatCompletion(systemPrompt, messages, maxTokens, temperature) {
    const response = await request('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_CHAT_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: maxTokens,
        temperature
      })
    });
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || '').trim();
  }

  async function transcribeAudio(input) {
    const audioBase64 = String(input?.audioBase64 || '').trim();
    if (!audioBase64) {
      return { text: '' };
    }
    const mimeType = String(input?.mimeType || 'audio/webm');
    const buffer = Buffer.from(audioBase64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), `audio.${audioExtensionForMime(mimeType)}`);
    form.append('model', GROQ_TRANSCRIBE_MODEL);
    form.append('response_format', 'json');
    const response = await request('/audio/transcriptions', {
      method: 'POST',
      body: form
    });
    const data = await response.json();
    return { text: cleanText(data?.text, 4000) };
  }

  async function generateDialogueResponse(input) {
    const systemPrompt = buildDialogueSystemPrompt(input);
    const history = Array.isArray(input?.history) ? input.history.slice(-12) : [];
    const message = input?.openingTurn
      ? 'The learner has just opened the speaking task. Start the conversation with one friendly short greeting and one simple first question. Do not wait for the learner to speak first.'
      : cleanText(input?.latestStudentText, 2000) || '[no speech detected]';
    const messages = [
      ...history.map((turn) => ({
        role: turn?.speaker === 'ai' ? 'assistant' : 'user',
        content: cleanText(turn?.text, 1200) || '...'
      })),
      { role: 'user', content: message }
    ];
    const responseText = await chatCompletion(systemPrompt, messages, 220, 0.6);
    return { responseText, shouldEnd: false };
  }

  async function generateSessionFeedback(input) {
    const systemPrompt = buildFeedbackSystemPrompt(input);
    const transcript = Array.isArray(input?.transcript) ? input.transcript.slice(-40) : [];
    const transcriptText = transcript
      .map((turn) => `${turn?.speaker === 'ai' ? 'AI' : 'Student'}: ${cleanText(turn?.text, 1200)}`)
      .join('\n');
    const messages = [{ role: 'user', content: transcriptText || 'No transcript available.' }];
    const responseText = await chatCompletion(systemPrompt, messages, 400, 0.3);
    try {
      const cleaned = responseText.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        fluency: cleanText(parsed?.fluency, 500),
        vocabulary: cleanText(parsed?.vocabulary, 500),
        grammar: cleanText(parsed?.grammar, 500),
        summary: cleanText(parsed?.summary, 500)
      };
    } catch {
      return { fluency: '', vocabulary: '', grammar: '', summary: cleanText(responseText, 800) };
    }
  }

  async function generateClosingFeedback(input) {
    const systemPrompt = buildClosingSystemPrompt(input);
    const transcript = Array.isArray(input?.transcript) ? input.transcript.slice(-40) : [];
    const transcriptText = transcript
      .map((turn) => `${turn?.speaker === 'ai' ? 'AI' : 'Student'}: ${cleanText(turn?.text, 1200)}`)
      .join('\n');
    const messages = [{ role: 'user', content: transcriptText || 'No transcript available.' }];
    const responseText = await chatCompletion(systemPrompt, messages, 200, 0.5);
    return { responseText };
  }

  return {
    isConfigured,
    transcribeAudio,
    generateDialogueResponse,
    generateSessionFeedback,
    generateClosingFeedback
  };
}

module.exports = { createGroqService };
