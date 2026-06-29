#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function usage() {
  console.log(`Usage:
  node scripts/test-dialogue-runner.cjs --pack <pack-folder> --student "I like apples." [--runner <runner-file>] [--llama <llama-cli>]

Example:
  node scripts/test-dialogue-runner.cjs --pack D:\\NoPrepAiPacks\\english-dialogue --student "I went to school yesterday."
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function parseQuestionArgs(args) {
  if (args.questions) {
    return String(args.questions).split('|').map((item) => item.trim()).filter(Boolean);
  }
  return args.question ? [String(args.question)] : [];
}

function parseHistoryArgs(args) {
  if (!args.history) return [];
  return String(args.history)
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf(':');
      if (separator < 0) return { speaker: 'student', text: item };
      const speaker = item.slice(0, separator).trim().toLowerCase();
      const text = item.slice(separator + 1).trim();
      return {
        speaker: speaker === 'ai' || speaker === 'teacher' ? 'ai' : 'student',
        text
      };
    });
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function getNodePathEnv() {
  const nodeModules = path.resolve(__dirname, '..', 'node_modules');
  const existing = process.env.NODE_PATH || '';
  return existing ? `${nodeModules}${path.delimiter}${existing}` : nodeModules;
}

function runRunner(runnerPath, requestPath, llamaCliPath) {
  const ext = path.extname(runnerPath).toLowerCase();
  const command = ext === '.js' || ext === '.cjs' ? process.execPath : runnerPath;
  const args = ext === '.js' || ext === '.cjs' ? [runnerPath, requestPath] : [requestPath];

  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: path.resolve(__dirname, '..'),
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          NODE_PATH: getNodePathEnv(),
          ...(llamaCliPath ? { NOPREP_LLAMA_CLI: llamaCliPath } : {})
        },
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr ? `\n${stderr}` : '';
          reject(new Error(`Dialogue runner failed: ${error.message}${detail}`));
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.pack || !args.student) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const packPath = path.resolve(args.pack);
  const runnerPath = path.resolve(
    args.runner || path.join(__dirname, '..', 'electron', 'ai-runtimes', 'dialogue-runner.cjs')
  );
  const manifestPath = path.join(packPath, 'manifest.json');

  if (!(await pathExists(packPath))) throw new Error(`Pack folder does not exist: ${packPath}`);
  if (!(await pathExists(manifestPath))) throw new Error(`Pack manifest not found: ${manifestPath}`);
  if (!(await pathExists(runnerPath))) throw new Error(`Runner file does not exist: ${runnerPath}`);

  const manifest = readJson(manifestPath);
  if (!manifest.dialogueConfig) {
    throw new Error('Pack manifest does not include dialogueConfig.');
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'noprep-dialogue-test-'));
  const requestPath = path.join(tempDir, 'request.json');
  const request = {
    packId: manifest.id,
    language: manifest.language,
    packPath,
    runtimeFiles: manifest.runtimeFiles || {},
    dialogueConfig: manifest.dialogueConfig,
    config: {
      language: manifest.language || 'en',
      topic: args.topic || '',
      teacherPrompt: args.prompt || 'Talk naturally with the learner about their answer.',
      questions: parseQuestionArgs(args),
      vocabulary: args.vocabulary || '',
      sampleAnswer: args.sample || '',
      maxDurationSeconds: 180
    },
    history: parseHistoryArgs(args),
    latestStudentText: String(args.student)
  };

  await fsp.writeFile(requestPath, JSON.stringify(request, null, 2), 'utf8');
  const stdout = await runRunner(runnerPath, requestPath, args.llama ? path.resolve(args.llama) : '');
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error(`Runner returned invalid JSON:\n${stdout}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
