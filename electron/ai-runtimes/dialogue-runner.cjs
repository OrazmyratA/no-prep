#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX_PROMPT_CHARS = 12000;
const MAX_OUTPUT_CHARS = 6000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    fail(`Could not read dialogue request JSON: ${error.message}`);
  }
}

function tryResolvePackPath(packPath, value) {
  if (typeof value !== 'string' || !value.trim()) return value;
  if (path.isAbsolute(value)) return value;
  const candidate = path.resolve(packPath, value.replace(/\\/g, '/'));
  const root = path.resolve(packPath);
  if (candidate.startsWith(root + path.sep) && fs.existsSync(candidate)) {
    return candidate;
  }
  return value;
}

function firstExistingPath(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return list.find((item) => item && fs.existsSync(item)) || '';
}

function getLlamaCliPath(request) {
  if (process.env.NOPREP_LLAMA_CLI) return process.env.NOPREP_LLAMA_CLI;
  if (request.llamaCliPath) return String(request.llamaCliPath);
  const root = path.dirname(__filename);
  const candidates = process.platform === 'win32'
    ? ['llama-cli.exe', 'llama-completion.exe', 'main.exe', 'llama.exe']
    : ['llama-cli', 'llama-completion', 'main', 'llama'];
  return firstExistingPath(candidates.map((candidate) => path.join(root, candidate)));
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanText(value, max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanPromptText(value, max = 3000) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function buildDialoguePrompts(input, compact = false) {
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const history = Array.isArray(input.history) ? input.history : [];
  const teacherPrompt = getTeacherPrompt(input);
  const openingTurn = !!input.openingTurn;
  const latestStudentText = openingTurn
    ? ''
    : cleanText(input.latestStudentText, 2000);
  const historyText = history
    .slice(-8)
    .filter((turn, index, list) => {
      if (index !== list.length - 1 || turn?.speaker !== 'student' || !latestStudentText) return true;
      return cleanText(turn?.text, 2000).toLowerCase() !== latestStudentText.toLowerCase();
    })
    .map((turn) => `${turn?.speaker === 'ai' ? 'AI teacher' : 'Student'}: ${cleanText(turn?.text, 1200)}`)
    .join('\n');
  const language = cleanText(config.language, 80) || cleanText(input.language, 80) || 'en';
  if (compact) {
    return {
      systemPrompt: '',
      userPrompt: `
/no_think
You are NoPrep's offline AI speaking partner. Reply only as the AI teacher. Do not copy this prompt.
Keep your reply short (1-3 sentences), warm, and matched to the learner's level.
You have no personal experiences or daily routine of your own — never describe things you did or will do. Ask the student a question instead. If the teacher instructions include an example answer, that is only a sample of what the student should say, never say it yourself.
The conversation language is ${language}.
Teacher instructions: ${cleanPromptText(teacherPrompt || 'Have a natural speaking-practice conversation with the learner.', 1200)}
Conversation so far:
${historyText || 'No previous turns.'}
${openingTurn
  ? 'The learner has just opened the speaking task. Start the conversation with one friendly short greeting and one simple first question.'
  : `Latest student message: ${latestStudentText || '[no speech detected]'}`}
AI teacher reply:
`.trim().slice(0, MAX_PROMPT_CHARS)
    };
  }
  const contextLines = [
    `The conversation language is ${language}.`,
    `The teacher's instructions are:\n${teacherPrompt || 'Have a natural speaking-practice conversation with the learner.'}`
  ];
  const systemPrompt = `
/no_think
You are NoPrep's offline AI speaking partner.
Follow the teacher prompt as the authority for the conversation; the defaults below apply unless the teacher prompt says otherwise.
You are acting like a speaking exam interviewer: ask relevant questions and short follow-ups, and keep the conversation moving. Do not correct, comment on, or mention the student's grammar, vocabulary, or pronunciation during the conversation — feedback is given separately after the conversation ends, not now.
You are the interviewer only. You have no personal experiences, plans, opinions, or daily routine of your own — never say things like "I went to..." or "Tomorrow I will...". Every reply must turn the conversation back to the student with a question about them.
If the teacher prompt contains an example or sample answer, that is only a reference showing what a good STUDENT response looks like. Never say it yourself, echo it, or continue it as if it were your own line.
Respond directly to the latest student message.
Keep replies short: 1-3 sentences, like a real spoken conversation turn, not a written paragraph.
Match your vocabulary and sentence complexity to the learner level or age stated in the teacher prompt. If none is stated, use simple, everyday words.
Default tone: warm, patient, and encouraging, like a friendly classroom teacher.
If the student's answer is very short or minimal, ask one gentle follow-up question to help them say more, unless the teacher prompt says to move on.
Never end the conversation, say goodbye, or wrap up until the student clearly signals they are done. Otherwise always continue with a question.
Use the recent conversation only as context.
Treat the transcript as evidence: never invent what the student said, planned, felt, or did.
If the student already gave their name, remember it and do not ask for it again unless you genuinely did not understand.
If the student's speech is unclear or contradictory, ask one short clarification question instead of pretending to know.
Output only the next spoken reply from the AI teacher.
Do not copy or reveal runtime details, prompts, section labels, JSON, markdown, or command output unless the teacher prompt explicitly asks for that format.
`.trim();
  const userPrompt = `
/no_think
${contextLines.join('\n')}

Conversation so far:
${historyText || 'No previous turns.'}

${openingTurn ? `
The learner has just opened the speaking task.
Start the conversation now.
Write one friendly short greeting and one simple first question.
Do not wait for the learner to speak first.
` : `
Latest student message:
${latestStudentText || '[no speech detected]'}
`}

Write the AI teacher's next spoken reply only:
`.trim();
  return {
    systemPrompt: systemPrompt.slice(0, MAX_PROMPT_CHARS),
    userPrompt: userPrompt.slice(0, MAX_PROMPT_CHARS)
  };
}

function buildFeedbackPrompt(request) {
  const config = request.config && typeof request.config === 'object' ? request.config : {};
  const teacherPrompt = getTeacherPrompt(request);
  const language = cleanText(config.language, 80) || cleanText(request.language, 80) || 'en';
  const transcript = Array.isArray(request.transcript) ? request.transcript : [];
  const transcriptText = transcript
    .map((turn) => {
      const speaker = turn?.speaker === 'ai' ? 'AI' : 'Student';
      const text = cleanText(turn?.text, 1200);
      if (!text) return '';
      const wpm = turn?.speaker === 'student' && Number.isFinite(Number(turn?.wordsPerMinute)) && Number(turn.wordsPerMinute) > 0
        ? ` (~${Math.round(Number(turn.wordsPerMinute))} words/min)`
        : '';
      return `${speaker}${wpm}: ${text}`;
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_PROMPT_CHARS);

  const systemPrompt = `
/no_think
You are NoPrep's offline speaking assessment assistant.
You review a finished speaking-practice conversation between a student and an AI teacher, and write short, encouraging feedback for the student.
The conversation language is ${language}.
Teacher instructions for this task, for context on the topic and level:
${teacherPrompt || 'No specific instructions were given.'}

Write feedback under exactly these four labels, each on its own line, in this order: FLUENCY:, VOCABULARY:, GRAMMAR:, SUMMARY:
For FLUENCY, VOCABULARY, and GRAMMAR:
- Write 2-3 short sentences of qualitative feedback. Do not give numeric scores, bands, or grades.
- Where useful, quote a short phrase the student actually said and suggest a stronger way to say it, using the format: You said "..." — try "...".
- Only comment on things actually shown in the transcript. Never invent mistakes or achievements that are not there.
- Approximate words-per-minute numbers are shown next to some student turns as a fluency hint; use them only as a rough guide alongside how naturally the conversation flowed.
- Do not comment on pronunciation — you only have text, not audio.
For SUMMARY, write one short encouraging closing sentence.
Keep the whole response under 200 words in total.
Output only the four labeled sections. Do not repeat these instructions, the transcript, JSON, markdown, or runtime details.
`.trim();

  const userPrompt = `
/no_think
Full conversation transcript:
${transcriptText || 'No conversation turns were recorded.'}

Write the speaking feedback now, using the FLUENCY:, VOCABULARY:, GRAMMAR:, SUMMARY: labels.
`.trim();

  return {
    systemPrompt: systemPrompt.slice(0, MAX_PROMPT_CHARS),
    userPrompt: userPrompt.slice(0, MAX_PROMPT_CHARS)
  };
}

function parseFeedbackOutput(text) {
  const cleaned = stripThinkingOutput(String(text || '').replace(/\r/g, '\n'));
  const labels = ['FLUENCY', 'VOCABULARY', 'GRAMMAR', 'SUMMARY'];
  const sections = { fluency: '', vocabulary: '', grammar: '', summary: '' };
  const pattern = new RegExp(`(${labels.join('|')})\\s*:`, 'gi');
  const matches = [...cleaned.matchAll(pattern)];
  if (!matches.length) {
    sections.summary = cleanText(cleaned, 1200);
    return sections;
  }
  for (let index = 0; index < matches.length; index += 1) {
    const label = matches[index][1].toUpperCase();
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : cleaned.length;
    const key = label.toLowerCase();
    if (key in sections) {
      sections[key] = cleanText(cleaned.slice(start, end), 900);
    }
  }
  return sections;
}

function extractJsonObject(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1].trim() : trimmed;
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return source.slice(first, last + 1);
  }
  return source;
}

function cleanGeneratedOutput(text) {
  let output = String(text || '').replace(/\r/g, '\n');
  output = stripThinkingOutput(output);
  output = output.replace(/\[[^\]]*Prompt:[\s\S]*$/i, '');
  output = output.replace(/\n?Exiting\.\s*$/i, '');
  const spokenReplyMarker = "Write the AI teacher's next spoken reply only:";
  const spokenReplyIndex = output.lastIndexOf(spokenReplyMarker);
  if (spokenReplyIndex >= 0) {
    output = output.slice(spokenReplyIndex + spokenReplyMarker.length);
  }
  const aiReplyMarker = 'AI teacher reply:';
  const aiReplyIndex = output.lastIndexOf(aiReplyMarker);
  if (spokenReplyIndex < 0 && aiReplyIndex >= 0) {
    output = output.slice(aiReplyIndex + aiReplyMarker.length);
  }
  const marker = 'Teacher response:';
  const markerIndex = output.lastIndexOf(marker);
  if (spokenReplyIndex < 0 && aiReplyIndex < 0 && markerIndex >= 0) {
    output = output.slice(markerIndex + marker.length);
  } else if (spokenReplyIndex < 0 && aiReplyIndex < 0) {
    const prompts = [...output.matchAll(/\n>\s/g)];
    if (prompts.length) {
      output = output.slice(prompts[prompts.length - 1].index + prompts[prompts.length - 1][0].length);
    }
  }
  output = output.replace(/\n(?:Your turn|Student|Student answer|Teacher response|AI teacher)\s*:[\s\S]*$/i, '');
  output = output.replace(/\s+(?:Your turn|Student|Student answer|Teacher response|AI teacher)\s*:[\s\S]*$/i, '');
  output = output.replace(/^[\s\S]*available commands:\s*/i, '');
  output = output.replace(/^I would say\s*:\s*["'“]?/i, '');
  output = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => (
      line
      && !/^Loading model/i.test(line)
      && !/^build\s*:/i.test(line)
      && !/^model\s*:/i.test(line)
      && !/^modalities\s*:/i.test(line)
      && !/^available commands/i.test(line)
      && !/^\/exit\b/i.test(line)
      && !/^\/regen\b/i.test(line)
      && !/^\/clear\b/i.test(line)
      && !/^\/read\b/i.test(line)
      && !/^\/glob\b/i.test(line)
    ))
    .join(' ')
    .trim();
  output = output.replace(/^["'`]+|["'`]+$/g, '').trim();
  output = output.replace(/^I would say\s*:\s*["'“]?/i, '').trim();
  return output;
}

function stripThinkingOutput(text) {
  let output = String(text || '');
  output = output.replace(/\[Start thinking\][\s\S]*?(?:\[End thinking\]|\[Start answer\])/gi, '');
  output = output.replace(/<think>[\s\S]*?<\/think>/gi, '');
  output = output.replace(/^\s*(?:Okay|We need|I need|The user|Looking at|Let's craft)[\s\S]*?(?:AI teacher reply:|Teacher response:)/i, '');
  return output.trim();
}

function getTeacherPrompt(input) {
  const config = input?.config && typeof input.config === 'object' ? input.config : {};
  return cleanPromptText(config.teacherPrompt || config.prompt || '', 3000);
}

function removePromptEcho(text, request) {
  let output = cleanText(text, MAX_OUTPUT_CHARS).replace(/^\/no_think\b\s*/i, '').trim();
  const hasPromptLeak = /^(Language|Teacher prompt|Recent conversation|Conversation so far|Latest student answer|Latest student message)\s*:/i.test(output)
    || /\bTeacher prompt\s*:/i.test(output)
    || /\bLatest student answer\s*:/i.test(output)
    || /\bLatest student message\s*:/i.test(output)
    || /\bThe conversation language is\b/i.test(output)
    || /\bThe teacher's instructions are\b/i.test(output)
    || /\bConversation so far\s*:/i.test(output)
    || /\bYou are NoPrep's offline AI speaking partner\b/i.test(output)
    || /\bAI teacher reply\s*:/i.test(output)
    || /\bWrite the AI teacher's next spoken reply only\s*:/i.test(output);
  if (!hasPromptLeak) return output;

  const latest = cleanText(request?.latestStudentText, 600);
  if (latest) {
    const index = output.toLowerCase().lastIndexOf(latest.toLowerCase());
    if (index >= 0) {
      output = output.slice(index + latest.length).replace(/^[\s:;,.!?-]+/, '').trim();
    }
  }
  const truncatedIndex = output.toLowerCase().lastIndexOf('(truncated)');
  if (truncatedIndex >= 0) {
    output = output.slice(truncatedIndex + '(truncated)'.length).replace(/^[\s:;,.!?-]+/, '').trim();
  }
  output = output.replace(/^[\s\S]*\bWrite the AI teacher's next spoken reply only\s*:\s*/i, '').trim();
  output = output.replace(/^[\s\S]*\bAI teacher reply\s*:\s*/i, '').trim();
  output = output.replace(/^[\s\S]*\bTeacher response\s*:\s*/i, '').trim();
  if (/^(Language|Teacher prompt|Recent conversation|Conversation so far|Latest student answer|Latest student message)\s*:/i.test(output)
    || /^The conversation language is\b/i.test(output)
    || /^The teacher's instructions are\b/i.test(output)
    || /^Conversation so far\s*:/i.test(output)
    || /^You are NoPrep's offline AI speaking partner\b/i.test(output)) {
    return '';
  }
  if (/\bThe teacher's instructions are\b/i.test(output) || /\bConversation so far\s*:/i.test(output)) {
    return '';
  }
  return output;
}

function parseDialogueOutput(text, request) {
  const source = String(text || '');
  const limited = source.slice(-MAX_OUTPUT_CHARS);
  try {
    const parsed = JSON.parse(extractJsonObject(limited));
    return {
      responseText: removePromptEcho(parsed.responseText, request).slice(0, 1200),
      feedback: parsed.feedback ? cleanText(parsed.feedback, 1200) : undefined,
      shouldEnd: !!parsed.shouldEnd
    };
  } catch {
    const cleaned = cleanGeneratedOutput(source).slice(0, MAX_OUTPUT_CHARS);
    return {
      responseText: removePromptEcho(cleaned, request).slice(0, 1200),
      feedback: undefined,
      shouldEnd: false
    };
  }
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message || 'Dialogue runtime failed.').trim()));
          return;
        }
        resolve(String(stdout || ''));
      }
    );
  });
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    fail('Usage: dialogue-runner.cjs <request.json>');
  }

  const request = readJson(requestPath);
  const packPath = String(request.packPath || '');
  const dialogueConfig = request.dialogueConfig && typeof request.dialogueConfig === 'object' ? request.dialogueConfig : {};
  if (!packPath || !fs.existsSync(packPath)) {
    fail('Dialogue request packPath does not exist.');
  }
  if (String(dialogueConfig.provider || 'llama.cpp').toLowerCase() !== 'llama.cpp') {
    fail(`Unsupported dialogue provider: ${dialogueConfig.provider}`);
  }
  const modelPath = tryResolvePackPath(packPath, dialogueConfig.model || dialogueConfig.modelPath || dialogueConfig.gguf);
  if (!modelPath || !fs.existsSync(modelPath)) {
    fail('Dialogue model file is missing.');
  }
  const llamaCli = getLlamaCliPath(request);
  if (!llamaCli || !fs.existsSync(llamaCli)) {
    fail('llama.cpp CLI is not installed. Put llama-cli beside dialogue-runner or set NOPREP_LLAMA_CLI.');
  }

  const temperature = clampNumber(dialogueConfig.temperature, 0.4, 0, 1.5);
  const threads = Math.round(clampNumber(dialogueConfig.threads, 4, 1, 16));
  const cacheRamMb = Math.round(clampNumber(dialogueConfig.cacheRamMb, 4096, 0, 32768));
  const repeatPenalty = clampNumber(dialogueConfig.repeatPenalty, 1.15, 1, 2);
  const repeatLastN = Math.round(clampNumber(dialogueConfig.repeatLastN, 256, 0, 4096));

  if (request.feedbackMode) {
    const { systemPrompt: feedbackSystemPrompt, userPrompt: feedbackUserPrompt } = buildFeedbackPrompt(request);
    const feedbackMaxTokens = Math.round(clampNumber(dialogueConfig.feedbackMaxTokens, 480, 64, 1024));
    const feedbackContextSize = Math.round(clampNumber(dialogueConfig.feedbackContextSize, 4096, 512, 8192));
    const feedbackTimeoutMs = Math.round(clampNumber(dialogueConfig.feedbackTimeoutSeconds, 180, 15, 600) * 1000);
    const feedbackArgs = [
      '-m', modelPath,
      ...(feedbackSystemPrompt ? ['-sys', feedbackSystemPrompt] : []),
      '-p', feedbackUserPrompt,
      '-n', String(feedbackMaxTokens),
      '--temp', String(temperature),
      '-c', String(feedbackContextSize),
      '-t', String(threads),
      '--repeat-penalty', String(repeatPenalty),
      '--repeat-last-n', String(repeatLastN),
      '--no-display-prompt',
      '-cnv',
      '-st',
      ...(cacheRamMb > 0 ? ['--cache-ram', String(cacheRamMb)] : []),
      '--no-warmup',
      '--no-perf',
      '--simple-io'
    ];
    try {
      const stdout = await runCommand(llamaCli, feedbackArgs, feedbackTimeoutMs);
      process.stdout.write(JSON.stringify(parseFeedbackOutput(stdout)));
    } catch (error) {
      fail(`Dialogue feedback failed: ${error.message}`);
    }
    return;
  }

  const { systemPrompt, userPrompt } = buildDialoguePrompts(request, !!request.compactRetry);
  const maxTokens = Math.round(clampNumber(dialogueConfig.maxTokens, 110, 32, 1024));
  const contextSize = Math.round(clampNumber(dialogueConfig.contextSize, 2048, 512, 8192));
  const timeoutMs = Math.round(clampNumber(dialogueConfig.timeoutSeconds, 120, 15, 600) * 1000);
  const args = [
    '-m', modelPath,
    ...(systemPrompt ? ['-sys', systemPrompt] : []),
    '-p', userPrompt,
    '-n', String(maxTokens),
    '--temp', String(temperature),
    '-c', String(contextSize),
    '-t', String(threads),
    '--repeat-penalty', String(repeatPenalty),
    '--repeat-last-n', String(repeatLastN),
    '--no-display-prompt',
    '-cnv',
    '-st',
    ...(cacheRamMb > 0 ? ['--cache-ram', String(cacheRamMb)] : []),
    '--no-warmup',
    '--no-perf',
    '--simple-io'
  ];

  try {
    const stdout = await runCommand(llamaCli, args, timeoutMs);
    let result = parseDialogueOutput(stdout, request);
    if (!result.responseText && !request.compactRetry) {
      const retryRequest = { ...request, compactRetry: true };
      const retryPrompts = buildDialoguePrompts(retryRequest, true);
      const retryArgs = [
        '-m', modelPath,
        ...(retryPrompts.systemPrompt ? ['-sys', retryPrompts.systemPrompt] : []),
        '-p', retryPrompts.userPrompt,
        '-n', String(Math.max(maxTokens, 256)),
        '--temp', String(temperature),
        '-c', String(contextSize),
        '-t', String(threads),
        '--repeat-penalty', String(repeatPenalty),
        '--repeat-last-n', String(repeatLastN),
        '--no-display-prompt',
        '-cnv',
        '-st',
        ...(cacheRamMb > 0 ? ['--cache-ram', String(cacheRamMb)] : []),
        '--no-warmup',
        '--no-perf',
        '--simple-io'
      ];
      const retryStdout = await runCommand(llamaCli, retryArgs, timeoutMs);
      result = parseDialogueOutput(retryStdout, retryRequest);
    }
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    fail(`Dialogue failed: ${error.message}`);
  }
}

main();
