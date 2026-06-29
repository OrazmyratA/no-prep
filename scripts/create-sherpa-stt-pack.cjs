#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function usage() {
  console.log(`Usage:
  node scripts/create-sherpa-stt-pack.cjs --source <model-folder> --out <pack-folder> --kind <whisper|sensevoice|transducer> --id <pack-id> --language <lang> --label <label> [--quality <small|standard|advanced>]

Examples:
  node scripts/create-sherpa-stt-pack.cjs --source D:\\models\\sherpa-onnx-whisper-tiny.en --out D:\\NoPrepAiPacks\\english-whisper-tiny --kind whisper --id english-whisper-tiny --language en --label "English Whisper Tiny"
  node scripts/create-sherpa-stt-pack.cjs --source D:\\models\\sherpa-onnx-sense-voice --out D:\\NoPrepAiPacks\\sensevoice --kind sensevoice --id sensevoice-multi --language multi --label "SenseVoice Multi"
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

function normalizeQualityTier(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (['advanced', 'large', 'best', 'high', 'pro'].includes(normalized)) return 'advanced';
  if (['small', 'lite', 'tiny', 'low'].includes(normalized)) return 'small';
  return 'standard';
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(source, destination) {
  await fsp.mkdir(destination, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(sourcePath, destinationPath);
    }
  }
}

async function listFiles(root) {
  const files = [];
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, entryPath).replace(/\\/g, '/'));
      }
    }
  }
  await walk(root);
  return files;
}

function findOne(files, patterns, label) {
  const found = files.find((file) => patterns.some((pattern) => pattern.test(file)));
  if (!found) {
    throw new Error(`Could not find ${label}.`);
  }
  return `stt/${found}`;
}

function findMany(files, patterns, label) {
  const found = files.filter((file) => patterns.some((pattern) => pattern.test(file)));
  if (!found.length) {
    throw new Error(`Could not find ${label}.`);
  }
  return found.map((file) => `stt/${file}`);
}

function buildSttConfig(kind, files) {
  if (kind === 'whisper') {
    const encoder = findOne(files, [/encoder.*\.onnx$/i], 'Whisper encoder ONNX');
    const decoder = findOne(files, [/decoder.*\.onnx$/i], 'Whisper decoder ONNX');
    const tokens = findOne(files, [/tokens.*\.txt$/i], 'Whisper tokens.txt');
    return {
      runtimeFiles: [encoder, decoder, tokens],
      modelConfig: {
        whisper: {
          encoder,
          decoder,
          language: '',
          task: 'transcribe',
          tailPaddings: -1
        },
        tokens
      }
    };
  }

  if (kind === 'sensevoice') {
    const model = findOne(files, [/model.*\.onnx$/i], 'SenseVoice model ONNX');
    const tokens = findOne(files, [/tokens.*\.txt$/i], 'SenseVoice tokens.txt');
    return {
      runtimeFiles: [model, tokens],
      modelConfig: {
        senseVoice: {
          model,
          language: '',
          useInverseTextNormalization: 1
        },
        tokens
      }
    };
  }

  if (kind === 'transducer') {
    const encoder = findOne(files, [/encoder.*\.onnx$/i], 'Transducer encoder ONNX');
    const decoder = findOne(files, [/decoder.*\.onnx$/i], 'Transducer decoder ONNX');
    const joiner = findOne(files, [/joiner.*\.onnx$/i], 'Transducer joiner ONNX');
    const tokens = findOne(files, [/tokens.*\.txt$/i], 'Transducer tokens.txt');
    return {
      runtimeFiles: [encoder, decoder, joiner, tokens],
      modelConfig: {
        transducer: {
          encoder,
          decoder,
          joiner
        },
        tokens,
        modelType: 'transducer'
      }
    };
  }

  throw new Error(`Unsupported kind "${kind}". Use whisper, sensevoice, or transducer.`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.source || !args.out || !args.kind || !args.id || !args.language || !args.label) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const source = path.resolve(args.source);
  const out = path.resolve(args.out);
  const kind = String(args.kind).trim().toLowerCase();
  if (!(await pathExists(source))) {
    throw new Error(`Source folder does not exist: ${source}`);
  }
  if (await pathExists(out)) {
    throw new Error(`Output folder already exists: ${out}`);
  }

  const sttFolder = path.join(out, 'stt');
  await copyDirectory(source, sttFolder);
  const files = await listFiles(sttFolder);
  const stt = buildSttConfig(kind, files);
  const manifest = {
    type: 'noprep-ai-pack',
    id: String(args.id).trim(),
    language: String(args.language).trim().toLowerCase(),
    label: String(args.label).trim(),
    engine: 'sherpa-onnx',
    qualityTier: normalizeQualityTier(args.quality),
    features: ['speech-to-text'],
    runtimeFiles: {
      stt: stt.runtimeFiles
    },
    sttConfig: {
      provider: 'sherpa-onnx',
      modelConfig: stt.modelConfig
    },
    version: String(args.version || '1.0.0')
  };

  await fsp.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Created NoPrep STT pack: ${out}`);
  console.log(`Import this folder from the reader AI pack prompt or Electron AI pack import flow.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
