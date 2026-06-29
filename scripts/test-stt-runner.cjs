#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function usage() {
  console.log(`Usage:
  node scripts/test-stt-runner.cjs --pack <pack-folder> --audio <wav-file> [--runner <runner-file>]

Example:
  node scripts/test-stt-runner.cjs --pack D:\\NoPrepAiPacks\\english-whisper-tiny --audio D:\\samples\\hello.wav

Notes:
  The test audio should be a WAV file. The Electron app converts recordings before
  calling this runner, but this standalone script sends the audio directly.
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

function runRunner(runnerPath, requestPath) {
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
          NODE_PATH: getNodePathEnv()
        },
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr ? `\n${stderr}` : '';
          reject(new Error(`STT runner failed: ${error.message}${detail}`));
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.pack || !args.audio) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const packPath = path.resolve(args.pack);
  const audioPath = path.resolve(args.audio);
  const runnerPath = path.resolve(
    args.runner || path.join(__dirname, '..', 'electron', 'ai-runtimes', 'stt-runner.cjs')
  );
  const manifestPath = path.join(packPath, 'manifest.json');

  if (!(await pathExists(packPath))) throw new Error(`Pack folder does not exist: ${packPath}`);
  if (!(await pathExists(manifestPath))) throw new Error(`Pack manifest not found: ${manifestPath}`);
  if (!(await pathExists(audioPath))) throw new Error(`Audio file does not exist: ${audioPath}`);
  if (!(await pathExists(runnerPath))) throw new Error(`Runner file does not exist: ${runnerPath}`);

  const manifest = readJson(manifestPath);
  if (!manifest.sttConfig) {
    throw new Error('Pack manifest does not include sttConfig.');
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'noprep-stt-test-'));
  const requestPath = path.join(tempDir, 'request.json');
  const request = {
    packId: manifest.id,
    language: manifest.language,
    packPath,
    runtimeFiles: manifest.runtimeFiles || {},
    audioPath,
    originalAudioPath: audioPath,
    mimeType: 'audio/wav',
    originalMimeType: 'audio/wav',
    sttConfig: manifest.sttConfig
  };

  await fsp.writeFile(requestPath, JSON.stringify(request, null, 2), 'utf8');
  const stdout = await runRunner(runnerPath, requestPath);
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
