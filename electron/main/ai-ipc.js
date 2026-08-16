function registerAiIpc({
  ipcMain,
  operationResult,
  operationError,
  aiService,
  ttsService,
  saveUserGroqApiKey,
  clearUserGroqApiKey
}) {
  ipcMain.handle('ai-speaking:get-runtime-status', async () => {
    try {
      return operationResult({
        platform: 'electron',
        apiKeyConfigured: aiService.isConfigured(),
        reason: aiService.isConfigured()
          ? 'AI speaking service is configured.'
          : 'AI speaking is not configured on this device.'
      });
    } catch (error) {
      console.error('ai-speaking:get-runtime-status error:', error);
      return operationError('AI_SPEAKING_RUNTIME_FAILED', 'Could not check AI speaking status.');
    }
  });

  ipcMain.handle('ai-speaking:save-api-key', async (_event, input) => {
    try {
      const apiKey = String(input?.apiKey || '').trim();
      if (!apiKey || apiKey.length > 500) {
        return operationError('INVALID_API_KEY', 'Please paste a valid Groq API key.');
      }
      await saveUserGroqApiKey(apiKey);
      return operationResult({ apiKeyConfigured: aiService.isConfigured() });
    } catch (error) {
      console.error('ai-speaking:save-api-key error:', error);
      return operationError('API_KEY_SAVE_FAILED', 'Could not save this API key.');
    }
  });

  ipcMain.handle('ai-speaking:clear-api-key', async () => {
    try {
      await clearUserGroqApiKey();
      return operationResult({ apiKeyConfigured: aiService.isConfigured() });
    } catch (error) {
      console.error('ai-speaking:clear-api-key error:', error);
      return operationError('API_KEY_CLEAR_FAILED', 'Could not remove this API key.');
    }
  });

  ipcMain.handle('ai-speaking:transcribe-audio', async (_event, input) => {
    try {
      const result = await aiService.transcribeAudio(input);
      return operationResult(result);
    } catch (error) {
      console.error('ai-speaking:transcribe-audio error:', error);
      return operationError('AI_STT_FAILED', error?.message || 'Speech recognition failed.');
    }
  });

  ipcMain.handle('ai-speaking:generate-response', async (_event, input) => {
    try {
      const result = await aiService.generateDialogueResponse(input);
      return operationResult(result);
    } catch (error) {
      console.error('ai-speaking:generate-response error:', error);
      return operationError('AI_DIALOGUE_FAILED', error?.message || 'AI dialogue generation failed.');
    }
  });

  ipcMain.handle('ai-speaking:generate-session-feedback', async (_event, input) => {
    try {
      const result = await aiService.generateSessionFeedback(input);
      return operationResult(result);
    } catch (error) {
      console.error('ai-speaking:generate-session-feedback error:', error);
      return operationError('AI_DIALOGUE_FEEDBACK_FAILED', error?.message || 'AI speaking feedback failed.');
    }
  });

  ipcMain.handle('ai-speaking:generate-closing-feedback', async (_event, input) => {
    try {
      const result = await aiService.generateClosingFeedback(input);
      return operationResult(result);
    } catch (error) {
      console.error('ai-speaking:generate-closing-feedback error:', error);
      return operationError('AI_CLOSING_FEEDBACK_FAILED', error?.message || 'AI closing feedback failed.');
    }
  });

  ipcMain.handle('ai-speaking:synthesize-speech', async (_event, input) => {
    try {
      const result = await ttsService.synthesizeSpeech(input);
      return operationResult(result);
    } catch (error) {
      console.error('ai-speaking:synthesize-speech error:', error);
      return operationError('AI_TTS_FAILED', error?.message || 'Speech synthesis failed.');
    }
  });
}

module.exports = {
  registerAiIpc
};
