function registerAiTopicIpc({
  ipcMain,
  operationResult,
  operationError,
  aiTopicService,
  saveApiKey,
  clearApiKey,
  providers
}) {
  // Requests the renderer can cancel, by its request id.
  const runs = new Map();

  /** A run for one request: Cancel aborts it; what it is waiting for goes to the window. */
  function startRun(event, input) {
    const requestId = String(input?.requestId || '');
    const controller = new AbortController();
    if (requestId) runs.set(requestId, controller);
    return {
      requestId,
      signal: controller.signal,
      onStatus: (status) => {
        if (requestId && !event.sender.isDestroyed()) event.sender.send('ai-topic:status', { requestId, ...status });
      }
    };
  }

  /** The error's kind (no credit, today's limit, ...) is the code, so the app can show the right help. */
  function failed(error, fallbackMessage) {
    return operationError(error?.kind || 'FAILED', error?.message || fallbackMessage);
  }

  ipcMain.handle('ai-topic:cancel', async (_event, input) => {
    runs.get(String(input?.requestId || ''))?.abort();
    return operationResult(true);
  });

  ipcMain.handle('ai-topic:check-key', async (event, input) => {
    const run = startRun(event, input);
    try {
      return operationResult(await aiTopicService.checkKey(input, run));
    } catch (error) {
      return failed(error, 'The AI could not be reached.');
    } finally {
      runs.delete(run.requestId);
    }
  });
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

  ipcMain.handle('ai-topic:generate-draft', async (event, input) => {
    const run = startRun(event, input);
    try {
      return operationResult(await aiTopicService.generateDraft(input, run));
    } catch (error) {
      if (error?.kind !== 'CANCELLED') console.error('ai-topic:generate-draft error:', error);
      return failed(error, 'The AI could not create the topic.');
    } finally {
      runs.delete(run.requestId);
    }
  });

  ipcMain.handle('ai-topic:generate-image', async (event, input) => {
    const run = startRun(event, input);
    try {
      return operationResult(await aiTopicService.generateImage(input, run));
    } catch (error) {
      if (error?.kind !== 'CANCELLED') console.error('ai-topic:generate-image error:', error);
      return failed(error, 'The AI could not create the picture.');
    } finally {
      runs.delete(run.requestId);
    }
  });
}

module.exports = {
  registerAiTopicIpc
};
