function createAiRuntimeRunners({
  app,
  fsp,
  path,
  getAiRuntimesRoot,
  getFfmpegPath,
  createId,
  extensionForMimeType,
  decodeBase64DataUrl,
  execFileText,
  execRuntimeText,
  getAiRuntimeAvailability,
  normalizeAiPackRuntimeFiles,
  normalizeAiPackSttConfig,
  normalizeAiPackTtsConfig,
  normalizeAiPackDialogueConfig,
  getWarmDialogueService,
  constants
}) {
  const { MAX_STT_AUDIO_BYTES, MAX_TTS_TEXT_CHARS } = constants;
  const runWarmDialogueGeneration = (...args) => getWarmDialogueService()?.runWarmDialogueGeneration?.(...args);
  const closeWarmDialogueSessions = (...args) => getWarmDialogueService()?.closeWarmDialogueSessions?.(...args);

async function runSttTranscription(pack, input) {
  const { runtimeReady, sttRunnerPath, sttRunnerAvailable } = await getAiRuntimeAvailability(pack);
  if (!sttRunnerAvailable) {
    throw new Error(`STT runner is not installed in ${getAiRuntimesRoot()}.`);
  }
  if (!runtimeReady.stt) {
    throw new Error('AI pack STT model files are missing or not declared.');
  }

  const decoded = decodeBase64DataUrl(input?.audioDataUrl, {
    allowedMime: (mimeType) => mimeType.startsWith('audio/'),
    maxBytes: MAX_STT_AUDIO_BYTES,
    invalidCode: 'INVALID_STT_AUDIO',
    invalidMessage: 'Recorded audio is not valid.',
    tooLargeMessage: 'Recorded audio is too large for offline transcription.'
  });
  if (!decoded.ok) {
    throw new Error(decoded.error?.message || 'Recorded audio is not valid.');
  }

  const tempFolder = path.join(app.getPath('temp'), `noprep-stt-${createId('run')}`);
  await fsp.mkdir(tempFolder, { recursive: true });
  try {
    const audioPath = path.join(tempFolder, `audio${extensionForMimeType(decoded.mimeType, '.webm')}`);
    const wavPath = path.join(tempFolder, 'audio-16k-mono.wav');
    const requestPath = path.join(tempFolder, 'request.json');
    await fsp.writeFile(audioPath, decoded.buffer);
    const runtime = await getAiRuntimeAvailability(pack);
    if (decoded.mimeType.includes('wav')) {
      await fsp.copyFile(audioPath, wavPath);
    } else {
      if (!runtime.ffmpegAvailable) {
        throw new Error(`ffmpeg is required to convert ${decoded.mimeType} recordings before STT. Checked: ${getFfmpegPath().join(', ')}.`);
      }
      await convertAudioToWav(runtime.ffmpegPath, audioPath, wavPath);
    }
    await fsp.writeFile(requestPath, JSON.stringify({
      packId: pack.id,
      language: pack.language,
      packPath: pack.folderPath,
      runtimeFiles: normalizeAiPackRuntimeFiles(pack.runtimeFiles || pack.runtime),
      sttConfig: normalizeAiPackSttConfig(pack.sttConfig || pack.speechToText || pack.sherpaOfflineAsr),
      audioPath: wavPath,
      originalAudioPath: audioPath,
      mimeType: 'audio/wav',
      originalMimeType: decoded.mimeType
    }, null, 2), 'utf8');

    const stdout = await execRuntimeText(sttRunnerPath, [requestPath], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024
    });
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error('STT runner returned invalid JSON.');
    }
    return normalizeSttResult(parsed, pack.language);
  } finally {
    await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
  }
}

async function runTtsSynthesis(pack, input) {
  const { runtimeReady, ttsRunnerPath, ttsRunnerAvailable } = await getAiRuntimeAvailability(pack);
  if (!ttsRunnerAvailable) {
    throw new Error(`TTS runner is not installed in ${getAiRuntimesRoot()}.`);
  }
  if (!runtimeReady.tts) {
    throw new Error('AI pack TTS model files are missing or not declared.');
  }

  const text = String(input?.text || '').trim();
  if (!text) {
    throw new Error('Text is required before offline speech synthesis.');
  }
  if (text.length > MAX_TTS_TEXT_CHARS) {
    throw new Error(`Text is too long for offline speech synthesis. Maximum is ${MAX_TTS_TEXT_CHARS} characters.`);
  }

  const tempFolder = path.join(app.getPath('temp'), `noprep-tts-${createId('run')}`);
  await fsp.mkdir(tempFolder, { recursive: true });
  try {
    const requestPath = path.join(tempFolder, 'request.json');
    const outputPath = path.join(tempFolder, 'speech.wav');
    await fsp.writeFile(requestPath, JSON.stringify({
      packId: pack.id,
      language: pack.language,
      packPath: pack.folderPath,
      runtimeFiles: normalizeAiPackRuntimeFiles(pack.runtimeFiles || pack.runtime),
      ttsConfig: normalizeAiPackTtsConfig(pack.ttsConfig || pack.textToSpeech || pack.sherpaOfflineTts),
      text,
      speakerId: input?.speakerId,
      speed: input?.speed,
      outputPath
    }, null, 2), 'utf8');

    const stdout = await execRuntimeText(ttsRunnerPath, [requestPath], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024
    });
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error('TTS runner returned invalid JSON.');
    }
    const wav = await fsp.readFile(outputPath);
    return {
      audioDataUrl: `data:audio/wav;base64,${wav.toString('base64')}`,
      mimeType: 'audio/wav',
      sampleRate: Number(parsed?.sampleRate) || undefined,
      sampleCount: Number(parsed?.sampleCount) || undefined
    };
  } finally {
    await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
  }
}

async function runDialogueGeneration(pack, input) {
  const { runtimeReady, dialogueRunnerPath, dialogueRunnerAvailable, llamaCliPath, llamaCliAvailable } = await getAiRuntimeAvailability(pack);
  if (!dialogueRunnerAvailable) {
    throw new Error(`Dialogue runner is not installed in ${getAiRuntimesRoot()}.`);
  }
  if (!llamaCliAvailable) {
    throw new Error(`llama.cpp CLI is not installed. Put llama-cli beside the AI runners or set NOPREP_LLAMA_CLI.`);
  }
  if (!runtimeReady.dialogue) {
    throw new Error('AI pack dialogue model files are missing or not declared.');
  }

  if (String(input?.sessionId || '').trim()) {
    try {
      const warm = await runWarmDialogueGeneration(pack, input, llamaCliPath);
      if (warm.responseText) return warm;
    } catch (error) {
      console.warn('Warm dialogue session failed; falling back to one-shot runner:', error?.message || error);
      closeWarmDialogueSessions(String(input?.sessionId || ''), pack.id);
    }
  }

  const tempFolder = path.join(app.getPath('temp'), `noprep-dialogue-${createId('run')}`);
  await fsp.mkdir(tempFolder, { recursive: true });
  try {
    const requestPath = path.join(tempFolder, 'request.json');
    await fsp.writeFile(requestPath, JSON.stringify({
      packId: pack.id,
      language: pack.language,
      packPath: pack.folderPath,
      runtimeFiles: normalizeAiPackRuntimeFiles(pack.runtimeFiles || pack.runtime),
      dialogueConfig: normalizeAiPackDialogueConfig(pack.dialogueConfig || pack.localDialogue || pack.llm || pack.llamaCpp),
      llamaCliPath,
      config: input?.config || {},
      history: Array.isArray(input?.history) ? input.history.slice(-12) : [],
      latestStudentText: String(input?.latestStudentText || ''),
      openingTurn: !!input?.openingTurn,
      sessionId: String(input?.sessionId || '')
    }, null, 2), 'utf8');

    const stdout = await execRuntimeText(dialogueRunnerPath, [requestPath], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024
    });
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error('Dialogue runner returned invalid JSON.');
    }
    return {
      responseText: String(parsed?.responseText || '').trim(),
      feedback: parsed?.feedback ? String(parsed.feedback).trim() : undefined,
      shouldEnd: !!parsed?.shouldEnd
    };
  } finally {
    await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
  }
}

async function convertAudioToWav(ffmpegPath, inputPath, outputPath) {
  await execFileText(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    outputPath
  ], {
    timeout: 5 * 60 * 1000,
    maxBuffer: 1024 * 1024
  });
}

function normalizeSttResult(value, fallbackLanguage) {
  const segments = Array.isArray(value?.segments)
    ? value.segments
      .map((segment) => ({
        text: String(segment?.text || ''),
        startSeconds: Math.max(0, Number(segment?.startSeconds) || 0),
        endSeconds: Math.max(0, Number(segment?.endSeconds) || 0),
        confidence: Number.isFinite(Number(segment?.confidence)) ? Number(segment.confidence) : undefined
      }))
      .filter((segment) => segment.text)
    : [];
  return {
    text: String(value?.text || segments.map((segment) => segment.text).join(' ')).trim(),
    language: String(value?.language || fallbackLanguage || ''),
    confidence: Number.isFinite(Number(value?.confidence)) ? Number(value.confidence) : undefined,
    segments
  };
}

  return {
    runSttTranscription,
    runTtsSynthesis,
    runDialogueGeneration
  };
}

module.exports = { createAiRuntimeRunners };