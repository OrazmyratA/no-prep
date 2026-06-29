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
Follow the teacher prompt as the authority for the conversation.
Respond directly to the latest student message.
Use the recent conversation only as context.
Treat the transcript as evidence: never invent what the student said, planned, felt, or did.
If the student already gave their name, remember it and do not ask for it again unless you genuinely did not understand.
If the student's speech is unclear or contradictory, ask one short clarification question instead of pretending to know.
When giving feedback, mention only mistakes or strengths that are visible in the transcript.
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

  const { systemPrompt, userPrompt } = buildDialoguePrompts(request, !!request.compactRetry);
  const maxTokens = Math.round(clampNumber(dialogueConfig.maxTokens, 180, 32, 1024));
  const temperature = clampNumber(dialogueConfig.temperature, 0.4, 0, 1.5);
  const contextSize = Math.round(clampNumber(dialogueConfig.contextSize, 2048, 512, 8192));
  const threads = Math.round(clampNumber(dialogueConfig.threads, 4, 1, 16));
  const cacheRamMb = Math.round(clampNumber(dialogueConfig.cacheRamMb, 4096, 0, 32768));
  const timeoutMs = Math.round(clampNumber(dialogueConfig.timeoutSeconds, 120, 15, 600) * 1000);
  const args = [
    '-m', modelPath,
    ...(systemPrompt ? ['-sys', systemPrompt] : []),
    '-p', userPrompt,
    '-n', String(maxTokens),
    '--temp', String(temperature),
    '-c', String(contextSize),
    '-t', String(threads),
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
