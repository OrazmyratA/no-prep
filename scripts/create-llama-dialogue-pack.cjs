#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function usage() {
  console.log(`Usage:
  node scripts/create-llama-dialogue-pack.cjs --model <model.gguf> --out <pack-folder> --id <pack-id> --language <lang> --label <label> [--quality <small|standard|advanced>]

Examples:
  node scripts/create-llama-dialogue-pack.cjs --model D:\\models\\smarter-chat.gguf --out D:\\NoPrepAiPacks\\english-advanced-dialogue --id english-advanced-dialogue --language en --label "English Advanced Dialogue" --quality advanced --recommended-ram-mb 8192
`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      index++;
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

function normalizeQualityTier(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (['advanced', 'large', 'best', 'high', 'pro'].includes(normalized)) return 'advanced';
  if (['small', 'lite', 'tiny', 'low'].includes(normalized)) return 'small';
  return 'standard';
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
}

function normalizeTemperature(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.45;
  return Math.min(1.5, Math.max(0, number));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.model || !args.out || !args.id || !args.language || !args.label) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const model = path.resolve(args.model);
  const out = path.resolve(args.out);
  if (!(await pathExists(model))) {
    throw new Error(`GGUF model does not exist: ${model}`);
  }
  if (path.extname(model).toLowerCase() !== '.gguf') {
    throw new Error('Dialogue model must be a .gguf file.');
  }
  if (await pathExists(out)) {
    throw new Error(`Output folder already exists: ${out}`);
  }

  const dialogueFolder = path.join(out, 'dialogue');
  await fsp.mkdir(dialogueFolder, { recursive: true });
  const modelFileName = path.basename(model).replace(/[^\w.\- ]+/g, '-');
  const modelDestination = path.join(dialogueFolder, modelFileName);
  await fsp.copyFile(model, modelDestination);

  const qualityTier = normalizeQualityTier(args.quality);
  const deviceRequirements = {};
  const minRamMb = normalizePositiveNumber(args['min-ram-mb']);
  const recommendedRamMb = normalizePositiveNumber(args['recommended-ram-mb']);
  const minStorageMb = normalizePositiveNumber(args['min-storage-mb']);
  if (minRamMb !== undefined) deviceRequirements.minRamMb = minRamMb;
  if (recommendedRamMb !== undefined) deviceRequirements.recommendedRamMb = recommendedRamMb;
  if (minStorageMb !== undefined) deviceRequirements.minStorageMb = minStorageMb;
  if (args.notes) deviceRequirements.notes = String(args.notes).trim().slice(0, 500);

  const relativeModelPath = `dialogue/${modelFileName}`;
  const manifest = {
    type: 'noprep-ai-pack',
    id: String(args.id).trim(),
    language: String(args.language).trim().toLowerCase(),
    label: String(args.label).trim(),
    engine: 'llama.cpp',
    qualityTier,
    modelSizeLabel: args['model-size'] ? String(args['model-size']).trim() : qualityTier === 'advanced' ? 'Advanced dialogue' : 'Dialogue',
    ...(Object.keys(deviceRequirements).length ? { deviceRequirements } : {}),
    features: ['local-dialogue'],
    runtimeFiles: {
      dialogue: [relativeModelPath]
    },
    dialogueConfig: {
      provider: 'llama.cpp',
      model: relativeModelPath,
      maxTokens: normalizePositiveNumber(args['max-tokens']) || 180,
      temperature: normalizeTemperature(args.temperature),
      contextSize: normalizePositiveNumber(args['context-size']) || 4096,
      threads: normalizePositiveNumber(args.threads) || 4,
      timeoutSeconds: normalizePositiveNumber(args.timeout) || 180
    },
    version: String(args.version || '1.0.0')
  };

  await fsp.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Created NoPrep dialogue pack: ${out}`);
  console.log('Import this folder from the reader AI pack prompt or Electron AI pack import flow.');
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
