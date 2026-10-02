function registerAiTopicIpc({
  ipcMain,
  operationResult,
  operationError,
  aiTopicService,
  saveApiKey,
  clearApiKey,
  providers
}) {
  ipcMain.handle('ai-topic:get-status', async () => {
    try {
      return operationResult(aiTopicService.getStatus());
    } catch (error) {
      console.error('ai-topic:get-status error:', error);
      return operationError('AI_TOPIC_STATUS_FAILED', 'Could not check the AI setup.');
    }
  });

  ipcMain.handle('ai-topic:save-api-key', async (_event, input) => {
    try {
      const provider = String(input?.provider || '');
      const apiKey = String(input?.apiKey || '').trim();
      // NoPrep AI uses the license, not a key.
      if (!providers[provider] || provider === 'builtin') {
        return operationError('INVALID_PROVIDER', 'Unknown AI provider.');
      }
      if (!apiKey || apiKey.length > 500 || /\s/.test(apiKey)) {
        return operationError('INVALID_API_KEY', 'Please paste a valid API key.');
      }
      await saveApiKey(provider, apiKey);
      return operationResult(aiTopicService.getStatus());
    } catch (error) {
      console.error('ai-topic:save-api-key error:', error);
      return operationError('API_KEY_SAVE_FAILED', 'Could not save this API key.');
    }
  });

  ipcMain.handle('ai-topic:clear-api-key', async (_event, input) => {
    try {
      const provider = String(input?.provider || '');
      if (!providers[provider] || provider === 'builtin') {
        return operationError('INVALID_PROVIDER', 'Unknown AI provider.');
      }
      await clearApiKey(provider);
      return operationResult(aiTopicService.getStatus());
    } catch (error) {
      console.error('ai-topic:clear-api-key error:', error);
      return operationError('API_KEY_CLEAR_FAILED', 'Could not remove this API key.');
    }
  });

  ipcMain.handle('ai-topic:generate-draft', async (_event, input) => {
    try {
      return operationResult(await aiTopicService.generateDraft(input));
    } catch (error) {
      console.error('ai-topic:generate-draft error:', error);
      return operationError('AI_TOPIC_FAILED', error?.message || 'The AI could not create the topic.');
    }
  });

  ipcMain.handle('ai-topic:generate-image', async (_event, input) => {
    try {
      return operationResult(await aiTopicService.generateImage(input));
    } catch (error) {
      console.error('ai-topic:generate-image error:', error);
      return operationError('AI_TOPIC_IMAGE_FAILED', error?.message || 'The AI could not create the picture.');
    }
  });
}

module.exports = {
  registerAiTopicIpc
};
