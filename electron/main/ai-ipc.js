function registerAiIpc({
  ipcMain,
  dialog,
  fsp,
  path,
  getMainWindow,
  createId,
  sendBookProgress,
  makeBookProgress,
  operationResult,
  operationError,
  readAiPackRegistry,
  removeAiPackRegistryItem,
  ensureAiPacksRoot,
  getAiPacksRoot,
  installAiPackFolder,
  installAiPackManifestFile,
  getZipUncompressedSize,
  extractZipPackage,
  findAiPack,
  getMissingAiPackRuntimeFiles,
  getAiRuntimeAvailability,
  getAiRuntimesRoot,
  getFfmpegPath,
  getLlamaCliPath,
  runSttTranscription,
  runDialogueGeneration,
  closeWarmDialogueSessions,
  runTtsSynthesis
}) {
  ipcMain.handle('ai-packs:list', async () => {
    try {
      return operationResult(await readAiPackRegistry());
    } catch (error) {
      console.error('ai-packs:list error:', error);
      return operationError('AI_PACKS_READ_FAILED', 'Could not load AI language packs.');
    }
  });

  ipcMain.handle('ai-packs:import', async () => {
    const operationId = createId('ai-pack');
    let tempFolder = '';
    try {
      sendBookProgress(makeBookProgress(operationId, 'import', 'Choose AI language pack'));
      const selected = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Choose AI language pack',
        filters: [
          { name: 'NoPrep AI Packs', extensions: ['json', 'noprep-ai-pack', 'zip'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile', 'openDirectory']
      });

      if (selected.canceled || !selected.filePaths?.[0]) {
        sendBookProgress(null);
        return operationError('CANCELLED');
      }

      const sourcePath = selected.filePaths[0];
      const stat = await fsp.stat(sourcePath);
      await ensureAiPacksRoot();

      if (stat.isDirectory()) {
        const operation = makeBookProgress(operationId, 'import', 'Checking AI language pack');
        const item = await installAiPackFolder(sourcePath, operation);
        sendBookProgress(null);
        return operationResult(item);
      }

      const extension = path.extname(sourcePath).toLowerCase();
      if (extension === '.json' || extension === '.noprep-ai-pack') {
        const item = await installAiPackManifestFile(sourcePath);
        sendBookProgress(null);
        return operationResult(item);
      }

      if (extension === '.zip') {
        const uncompressedSize = await getZipUncompressedSize(sourcePath);
        const operation = makeBookProgress(operationId, 'import', 'Extracting AI language pack', 0, uncompressedSize);
        tempFolder = path.join(getAiPacksRoot(), `${createId('ai-pack')}-importing`);
        await fsp.rm(tempFolder, { recursive: true, force: true });
        await extractZipPackage(sourcePath, tempFolder, operation);
        const item = await installAiPackFolder(tempFolder, operation, path.basename(sourcePath));
        await fsp.rm(tempFolder, { recursive: true, force: true });
        sendBookProgress(null);
        return operationResult(item);
      }

      sendBookProgress(null);
      return operationError('UNSUPPORTED_AI_PACK', 'Choose an AI pack folder, manifest JSON, or zip package.');
    } catch (error) {
      sendBookProgress(null);
      if (tempFolder) {
        await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
      }
      console.error('ai-packs:import error:', error);
      return operationError('AI_PACK_IMPORT_FAILED', error?.message || 'Could not import this AI language pack.');
    }
  });

  ipcMain.handle('ai-packs:remove', async (_event, input) => {
    try {
      const packId = String(input?.packId || '');
      const registry = await readAiPackRegistry();
      const pack = registry.find((item) => item.id === packId);
      if (!pack) {
        return operationError('AI_PACK_NOT_FOUND', 'AI language pack not found.');
      }
      await fsp.rm(pack.folderPath, { recursive: true, force: true });
      await removeAiPackRegistryItem(packId);
      return operationResult(null);
    } catch (error) {
      console.error('ai-packs:remove error:', error);
      return operationError('AI_PACK_REMOVE_FAILED', 'Could not remove this AI language pack.');
    }
  });

  ipcMain.handle('ai-speaking:get-runtime-status', async (_event, input) => {
    try {
      const packId = String(input?.packId || '');
      const language = String(input?.language || '').trim().toLowerCase();
      const registry = await readAiPackRegistry();
      const pack = findAiPack(registry, packId, language);
      if (!pack) {
        return operationError('AI_PACK_NOT_FOUND', 'AI language pack not found.');
      }
      const missingRuntimeFiles = await getMissingAiPackRuntimeFiles(pack);
      const runtime = await getAiRuntimeAvailability(pack);
      return operationResult({
        platform: 'electron',
        packId: pack.id,
        language: pack.language,
        recordingAvailable: true,
        speechToTextAvailable: !!runtime.runtimeReady.stt && runtime.sttRunnerAvailable && runtime.ffmpegAvailable,
        textToSpeechAvailable: !!runtime.runtimeReady.tts && runtime.ttsRunnerAvailable,
        dialogueAvailable: !!runtime.runtimeReady.dialogue && runtime.dialogueRunnerAvailable && runtime.llamaCliAvailable,
        conversationAvailable: !!runtime.runtimeReady.stt
          && runtime.sttRunnerAvailable
          && runtime.ffmpegAvailable
          && !!runtime.runtimeReady.tts
          && runtime.ttsRunnerAvailable
          && !!runtime.runtimeReady.dialogue
          && runtime.dialogueRunnerAvailable
          && runtime.llamaCliAvailable,
        missingRuntimeFiles,
        sttRunnerAvailable: runtime.sttRunnerAvailable,
        sttRunnerPath: runtime.sttRunnerPath,
        ttsRunnerAvailable: runtime.ttsRunnerAvailable,
        ttsRunnerPath: runtime.ttsRunnerPath,
        dialogueRunnerAvailable: runtime.dialogueRunnerAvailable,
        dialogueRunnerPath: runtime.dialogueRunnerPath,
        llamaCliAvailable: runtime.llamaCliAvailable,
        llamaCliPath: runtime.llamaCliPath,
        ffmpegAvailable: runtime.ffmpegAvailable,
        ffmpegPath: runtime.ffmpegPath,
        reason: missingRuntimeFiles.length
          ? `AI pack is missing runtime files: ${missingRuntimeFiles.slice(0, 3).join(', ')}${missingRuntimeFiles.length > 3 ? '...' : ''}`
          : !runtime.sttRunnerAvailable
            ? `STT runner is not installed in ${getAiRuntimesRoot()}.`
          : !runtime.ffmpegAvailable
            ? `ffmpeg is not installed. Checked: ${getFfmpegPath().join(', ')}.`
          : !runtime.ttsRunnerAvailable && runtime.runtimeReady.tts
            ? `TTS runner is not installed in ${getAiRuntimesRoot()}.`
          : !runtime.dialogueRunnerAvailable && runtime.runtimeReady.dialogue
            ? `Dialogue runner is not installed in ${getAiRuntimesRoot()}.`
          : !runtime.llamaCliAvailable && runtime.runtimeReady.dialogue
            ? `llama.cpp CLI is not installed. Checked: ${getLlamaCliPath().join(', ')}.`
          : 'Electron offline AI runtime bridge is ready.'
      });
    } catch (error) {
      console.error('ai-speaking:get-runtime-status error:', error);
      return operationError('AI_SPEAKING_RUNTIME_FAILED', 'Could not check AI speaking runtime.');
    }
  });

  ipcMain.handle('ai-speaking:transcribe-audio', async (_event, input) => {
    try {
      const packId = String(input?.packId || '');
      const language = String(input?.language || '').trim().toLowerCase();
      const registry = await readAiPackRegistry();
      const pack = findAiPack(registry, packId, language);
      if (!pack) {
        return operationError('AI_PACK_NOT_FOUND', 'AI language pack not found.');
      }
      const result = await runSttTranscription(pack, input);
      return operationResult(result);
    } catch (error) {
      console.error('ai-speaking:transcribe-audio error:', error);
      return operationError('AI_STT_FAILED', error?.message || 'Offline speech recognition failed.');
    }
  });

  ipcMain.handle('ai-speaking:generate-response', async (_event, input) => {
    try {
      const config = input?.config && typeof input.config === 'object' ? input.config : {};
      const packId = String(input?.packId || config.packId || '');
      const language = String(input?.language || config.language || '').trim().toLowerCase();
      const registry = await readAiPackRegistry();
      const pack = findAiPack(registry, packId, language);
      if (!pack) {
        return operationError('AI_PACK_NOT_FOUND', 'AI language pack not found.');
      }
      const result = await runDialogueGeneration(pack, input);
      return operationResult(result);
    } catch (error) {
      console.error('ai-speaking:generate-response error:', error);
      return operationError('AI_DIALOGUE_FAILED', error?.message || 'Offline dialogue generation failed.');
    }
  });

  ipcMain.handle('ai-speaking:close-dialogue-session', async (_event, input) => {
    try {
      closeWarmDialogueSessions(String(input?.sessionId || ''), String(input?.packId || ''));
      return operationResult(null);
    } catch (error) {
      console.error('ai-speaking:close-dialogue-session error:', error);
      return operationError('AI_DIALOGUE_CLOSE_FAILED', 'Could not close offline dialogue session.');
    }
  });

  ipcMain.handle('ai-speaking:synthesize-speech', async (_event, input) => {
    try {
      const packId = String(input?.packId || '');
      const language = String(input?.language || '').trim().toLowerCase();
      const registry = await readAiPackRegistry();
      const pack = findAiPack(registry, packId, language);
      if (!pack) {
        return operationError('AI_PACK_NOT_FOUND', 'AI language pack not found.');
      }
      const result = await runTtsSynthesis(pack, input);
      return operationResult(result);
    } catch (error) {
      console.error('ai-speaking:synthesize-speech error:', error);
      return operationError('AI_TTS_FAILED', error?.message || 'Offline text-to-speech failed.');
    }
  });
}

module.exports = {
  registerAiIpc
};
