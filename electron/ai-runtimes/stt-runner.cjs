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
    fail(`Could not read STT request JSON: ${error.message}`);
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

function resolveModelConfigPaths(packPath, value) {
  if (Array.isArray(value)) {
    return value.map((item) => resolveModelConfigPaths(packPath, item));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = resolveModelConfigPaths(packPath, nested);
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
    fail('Usage: stt-runner.cjs <request.json>');
  }

  const request = readJson(requestPath);
  const packPath = String(request.packPath || '');
  const audioPath = String(request.audioPath || '');
  const sttConfig = request.sttConfig && typeof request.sttConfig === 'object' ? request.sttConfig : {};
  if (!packPath || !fs.existsSync(packPath)) {
    fail('STT request packPath does not exist.');
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    fail('STT request audioPath does not exist.');
  }
  if (String(sttConfig.provider || 'sherpa-onnx').toLowerCase() !== 'sherpa-onnx') {
    fail(`Unsupported STT provider: ${sttConfig.provider}`);
  }
  if (!sttConfig.modelConfig || typeof sttConfig.modelConfig !== 'object') {
    fail('STT config must include a sherpa-onnx modelConfig object.');
  }

  const sherpa = loadSherpaOnnx();
  const modelConfig = resolveModelConfigPaths(packPath, sttConfig.modelConfig);
  const recognizerConfig = { modelConfig };
  if (sttConfig.decodingMethod) {
    recognizerConfig.decodingMethod = String(sttConfig.decodingMethod);
  }
  if (sttConfig.hotwordsFile) {
    recognizerConfig.hotwordsFile = tryResolvePackPath(packPath, sttConfig.hotwordsFile);
  }
  if (sttConfig.ruleFsts) {
    recognizerConfig.ruleFsts = tryResolvePackPath(packPath, sttConfig.ruleFsts);
  }
  if (sttConfig.ruleFars) {
    recognizerConfig.ruleFars = tryResolvePackPath(packPath, sttConfig.ruleFars);
  }

  let recognizer;
  let stream;
  try {
    recognizer = sherpa.createOfflineRecognizer(recognizerConfig);
    stream = recognizer.createStream();
    const wave = sherpa.readWave(audioPath);
    stream.acceptWaveform(wave.sampleRate, wave.samples);
    recognizer.decode(stream);
    const result = recognizer.getResult(stream) || {};
    process.stdout.write(JSON.stringify({
      text: String(result.text || '').trim(),
      language: String(request.language || ''),
      confidence: Number.isFinite(Number(result.confidence)) ? Number(result.confidence) : undefined,
      segments: Array.isArray(result.segments) ? result.segments : []
    }));
  } catch (error) {
    fail(`STT failed: ${error.message}`);
  } finally {
    try { stream?.free?.(); } catch {}
    try { recognizer?.free?.(); } catch {}
  }
}

main();
