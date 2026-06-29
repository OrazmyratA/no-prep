#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Could not read TTS request JSON: ${error.message}`);
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

function resolvePackPaths(packPath, value) {
  if (Array.isArray(value)) {
    return value.map((item) => resolvePackPaths(packPath, item));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = resolvePackPaths(packPath, nested);
    }
    return output;
  }
  return tryResolvePackPath(packPath, value);
}

function loadSherpaOnnx() {
  const moduleName = process.env.NOPREP_SHERPA_ONNX_MODULE || 'sherpa-onnx';
  try {
    return require(moduleName);
  } catch (error) {
    fail(`Could not load ${moduleName}. Install or bundle sherpa-onnx for this runtime. ${error.message}`);
  }
}

function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    fail('Usage: tts-runner.cjs <request.json>');
  }

  const request = readJson(requestPath);
  const packPath = String(request.packPath || '');
  const outputPath = String(request.outputPath || '');
  const text = String(request.text || '').trim();
  const ttsConfig = request.ttsConfig && typeof request.ttsConfig === 'object' ? request.ttsConfig : {};
  if (!packPath || !fs.existsSync(packPath)) {
    fail('TTS request packPath does not exist.');
  }
  if (!outputPath) {
    fail('TTS request outputPath is required.');
  }
  if (!text) {
    fail('TTS request text is required.');
  }
  if (String(ttsConfig.provider || 'sherpa-onnx').toLowerCase() !== 'sherpa-onnx') {
    fail(`Unsupported TTS provider: ${ttsConfig.provider}`);
  }
  if (!ttsConfig.offlineTtsConfig || typeof ttsConfig.offlineTtsConfig !== 'object') {
    fail('TTS config must include a sherpa-onnx offlineTtsConfig object.');
  }

  const sherpa = loadSherpaOnnx();
  const offlineTtsConfig = resolvePackPaths(packPath, ttsConfig.offlineTtsConfig);
  let tts;
  try {
    tts = sherpa.createOfflineTts(offlineTtsConfig);
    const audio = tts.generate({
      text,
      sid: Number.isFinite(Number(request.speakerId)) ? Number(request.speakerId) : Number(ttsConfig.speakerId || 0),
      speed: Number.isFinite(Number(request.speed)) ? Number(request.speed) : Number(ttsConfig.speed || 1)
    });
    tts.save(outputPath, audio);
    process.stdout.write(JSON.stringify({
      outputPath,
      mimeType: 'audio/wav',
      sampleRate: audio.sampleRate,
      sampleCount: audio.samples?.length || 0
    }));
  } catch (error) {
    fail(`TTS failed: ${error.message}`);
  } finally {
    try { tts?.free?.(); } catch {}
  }
}

main();
