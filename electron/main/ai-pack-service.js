const { createAiRuntimeRunners } = require('./ai-runtime-runners');

function createAiPackService({
  app,
  fsp,
  path,
  getAiPacksRoot,
  getAiPackRegistryPath,
  getAiRuntimesRoot,
  getSttRunnerPath,
  getTtsRunnerPath,
  getDialogueRunnerPath,
  getLlamaCliPath,
  getFfmpegPath,
  pathExists,
  isPathInside,
  getDirectorySize,
  firstExistingPath,
  execFileText,
  execRuntimeText,
  copyDirectoryWithProgress,
  sendBookProgress,
  createId,
  sanitizeName,
  extensionForMimeType,
  decodeBase64DataUrl,
  normalizeBookRelativePath,
  constants
}) {
  const {
    AI_PACK_MANIFEST_FILE,
    MAX_STT_AUDIO_BYTES,
    MAX_TTS_TEXT_CHARS
  } = constants;
  let warmDialogueService = null;

  function configureWarmDialogueService(service) {
    warmDialogueService = service || null;
  }

async function ensureAiPacksRoot() {
  await fsp.mkdir(getAiPacksRoot(), { recursive: true });
}

async function readAiPackRegistry() {
  await ensureAiPacksRoot();
  const root = getAiPacksRoot();
  let changed = false;
  let storedItems = [];
  try {
    const content = await fsp.readFile(getAiPackRegistryPath(), 'utf8');
    const items = JSON.parse(content);
    storedItems = Array.isArray(items)
      ? items.map(normalizeAiPackRegistryItem).filter(Boolean)
      : [];
  } catch {
    storedItems = [];
  }

  const byId = new Map();
  for (const item of storedItems) {
    const fallbackFolder = path.join(root, sanitizeName(item.id, 'ai-pack'));
    const folderPath = path.resolve(item.folderPath || fallbackFolder);
    const manifestPath = path.join(folderPath, AI_PACK_MANIFEST_FILE);
    if (isPathInside(root, folderPath) && await pathExists(manifestPath)) {
      byId.set(item.id, { ...item, folderPath });
    } else {
      changed = true;
    }
  }

  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderPath = path.join(root, entry.name);
      const manifestPath = path.join(folderPath, AI_PACK_MANIFEST_FILE);
      if (!(await pathExists(manifestPath))) continue;
      try {
        const manifest = await readAiPackManifest(folderPath);
        const existing = byId.get(manifest.id);
        const item = makeAiPackRegistryItem(
          manifest,
          folderPath,
          existing?.sizeBytes || 0,
          existing?.sourceName || entry.name
        );
        item.installedAt = existing?.installedAt || item.installedAt;
        if (!existing || existing.folderPath !== folderPath) {
          changed = true;
        }
        byId.set(item.id, item);
      } catch (error) {
        console.warn('Ignoring invalid AI pack folder:', folderPath, error?.message || error);
      }
    }
  } catch {
    // Keep the registry readable even if folder scanning fails.
  }

  const repaired = [...byId.values()];
  if (changed || repaired.length !== storedItems.length) {
    await writeAiPackRegistry(repaired);
  }
  return repaired;
}

async function writeAiPackRegistry(items) {
  await ensureAiPacksRoot();
  const sorted = [...items].sort((a, b) => String(b.installedAt).localeCompare(String(a.installedAt)));
  await fsp.writeFile(getAiPackRegistryPath(), JSON.stringify(sorted, null, 2), 'utf8');
  return sorted;
}

async function upsertAiPackRegistryItem(item) {
  const registry = await readAiPackRegistry();
  const next = registry.filter((existing) => existing.id !== item.id);
  next.push(item);
  await writeAiPackRegistry(next);
  return item;
}

async function removeAiPackRegistryItem(packId) {
  const registry = await readAiPackRegistry();
  await writeAiPackRegistry(registry.filter((item) => item.id !== packId));
}

function normalizeAiLanguage(language) {
  const normalized = String(language || '').trim().toLowerCase().replace('_', '-');
  const aliases = {
    english: 'en',
    eng: 'en',
    'en-us': 'en',
    'en-gb': 'en'
  };
  return aliases[normalized] || normalized;
}

function parseJsonText(text) {
  return JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
}

function normalizeAiPackRuntimeFiles(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalizeList = (items) => {
    const list = Array.isArray(items) ? items : (items ? [items] : []);
    return list
      .map((item) => normalizeBookRelativePath(String(item || '')))
      .filter(Boolean)
      .slice(0, 64);
  };
  return {
    stt: normalizeList(source.stt || source.speechToText),
    tts: normalizeList(source.tts || source.textToSpeech),
    dialogue: normalizeList(source.dialogue || source.localDialogue || source.llm)
  };
}

function normalizeAiPackSttConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const provider = String(source.provider || source.engine || 'sherpa-onnx').trim().toLowerCase();
  const modelConfig = source.modelConfig && typeof source.modelConfig === 'object' ? source.modelConfig : {};
  return {
    provider,
    modelConfig,
    decodingMethod: source.decodingMethod ? String(source.decodingMethod) : undefined,
    hotwordsFile: source.hotwordsFile ? normalizeBookRelativePath(String(source.hotwordsFile)) : undefined,
    ruleFsts: source.ruleFsts ? normalizeBookRelativePath(String(source.ruleFsts)) : undefined,
    ruleFars: source.ruleFars ? normalizeBookRelativePath(String(source.ruleFars)) : undefined
  };
}

function normalizeAiPackTtsConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const provider = String(source.provider || source.engine || 'sherpa-onnx').trim().toLowerCase();
  const offlineTtsConfig = source.offlineTtsConfig && typeof source.offlineTtsConfig === 'object'
    ? source.offlineTtsConfig
    : {};
  return {
    provider,
    offlineTtsConfig,
    speakerId: Number.isFinite(Number(source.speakerId)) ? Number(source.speakerId) : undefined,
    speed: Number.isFinite(Number(source.speed)) ? Number(source.speed) : undefined
  };
}

function normalizeAiPackDialogueConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const provider = String(source.provider || source.engine || 'llama.cpp').trim().toLowerCase();
  return {
    provider,
    model: source.model ? normalizeBookRelativePath(String(source.model)) : undefined,
    modelPath: source.modelPath ? normalizeBookRelativePath(String(source.modelPath)) : undefined,
    gguf: source.gguf ? normalizeBookRelativePath(String(source.gguf)) : undefined,
    maxTokens: Number.isFinite(Number(source.maxTokens)) ? Number(source.maxTokens) : undefined,
    temperature: Number.isFinite(Number(source.temperature)) ? Number(source.temperature) : undefined,
    contextSize: Number.isFinite(Number(source.contextSize)) ? Number(source.contextSize) : undefined,
    threads: Number.isFinite(Number(source.threads)) ? Number(source.threads) : undefined,
    timeoutSeconds: Number.isFinite(Number(source.timeoutSeconds)) ? Number(source.timeoutSeconds) : undefined
  };
}

function normalizeAiPackQualityTier(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (['advanced', 'large', 'best', 'high', 'pro'].includes(normalized)) return 'advanced';
  if (['small', 'lite', 'tiny', 'low'].includes(normalized)) return 'small';
  return 'standard';
}

function getAiPackQualityRank(pack) {
  const tier = normalizeAiPackQualityTier(pack?.qualityTier || pack?.quality || pack?.tier);
  return tier === 'advanced' ? 3 : tier === 'standard' ? 2 : 1;
}

function normalizeAiPackDeviceRequirements(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const normalizePositiveNumber = (item) => {
    const number = Number(item);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
  };
  const requirements = {};
  const minRamMb = normalizePositiveNumber(value.minRamMb ?? value.minimumRamMb ?? value.ramMb);
  const recommendedRamMb = normalizePositiveNumber(value.recommendedRamMb ?? value.recommendedMemoryMb);
  const minStorageMb = normalizePositiveNumber(value.minStorageMb ?? value.storageMb ?? value.freeStorageMb);
  const notes = value.notes || value.note ? String(value.notes || value.note).trim().slice(0, 500) : '';
  if (minRamMb !== undefined) requirements.minRamMb = minRamMb;
  if (recommendedRamMb !== undefined) requirements.recommendedRamMb = recommendedRamMb;
  if (minStorageMb !== undefined) requirements.minStorageMb = minStorageMb;
  if (notes) requirements.notes = notes;
  return Object.keys(requirements).length ? requirements : undefined;
}

function isAiConversationPack(pack) {
  const features = new Set((pack?.features || []).map((feature) => String(feature || '').trim().toLowerCase()));
  return features.has('speech-to-text') && features.has('text-to-speech') && features.has('local-dialogue');
}

function pickBestAiPack(packs) {
  return [...packs].sort((a, b) => (
    Number(isAiConversationPack(b)) - Number(isAiConversationPack(a))
    || getAiPackQualityRank(b) - getAiPackQualityRank(a)
    || Date.parse(b.installedAt || '') - Date.parse(a.installedAt || '')
    || String(a.label || a.id).localeCompare(String(b.label || b.id))
  ))[0] || null;
}

function findAiPack(registry, packId, language) {
  const id = String(packId || '').trim();
  if (id) return registry.find((item) => item.id === id) || null;
  const normalizedLanguage = normalizeAiLanguage(language);
  const exact = registry.filter((item) => normalizeAiLanguage(item.language) === normalizedLanguage);
  return pickBestAiPack(exact.filter(isAiConversationPack))
    || pickBestAiPack(exact)
    || pickBestAiPack(registry.filter(isAiConversationPack));
}

function normalizeAiPackRegistryItem(value) {
  if (!value || typeof value !== 'object') return null;
  try {
    const manifest = validateAiPackManifest({ ...value, type: 'noprep-ai-pack' });
    return {
      ...manifest,
      folderPath: value.folderPath ? String(value.folderPath) : undefined,
      sizeBytes: Number.isFinite(Number(value.sizeBytes)) ? Number(value.sizeBytes) : 0,
      sourceName: value.sourceName ? String(value.sourceName) : undefined,
      installedAt: value.installedAt ? String(value.installedAt) : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function validateAiPackManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('AI pack manifest is not valid.');
  }
  if (manifest.type !== 'noprep-ai-pack') {
    throw new Error('This is not a NoPrep AI pack.');
  }
  const id = String(manifest.id || '').trim();
  const language = normalizeAiLanguage(manifest.language);
  const label = String(manifest.label || '').trim();
  if (!id || !language || !label) {
    throw new Error('AI pack manifest must include id, language, and label.');
  }
  const features = Array.isArray(manifest.features)
    ? manifest.features.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 24)
    : [];
  const runtimeFiles = normalizeAiPackRuntimeFiles(manifest.runtimeFiles || manifest.runtime);
  const sttConfig = normalizeAiPackSttConfig(manifest.sttConfig || manifest.speechToText || manifest.sherpaOfflineAsr);
  const ttsConfig = normalizeAiPackTtsConfig(manifest.ttsConfig || manifest.textToSpeech || manifest.sherpaOfflineTts);
  const dialogueConfig = normalizeAiPackDialogueConfig(manifest.dialogueConfig || manifest.localDialogue || manifest.llm || manifest.llamaCpp);
  const qualityTier = normalizeAiPackQualityTier(manifest.qualityTier || manifest.quality || manifest.tier);
  return {
    type: 'noprep-ai-pack',
    id,
    language,
    label,
    engine: manifest.engine ? String(manifest.engine) : undefined,
    qualityTier,
    modelSizeLabel: manifest.modelSizeLabel || manifest.modelSize ? String(manifest.modelSizeLabel || manifest.modelSize) : undefined,
    deviceRequirements: normalizeAiPackDeviceRequirements(manifest.deviceRequirements || manifest.requirements || manifest.hardware),
    features,
    runtimeFiles,
    sttConfig,
    ttsConfig,
    dialogueConfig,
    version: manifest.version ? String(manifest.version) : undefined,
    minAppVersion: manifest.minAppVersion ? String(manifest.minAppVersion) : undefined
  };
}

async function readAiPackManifest(folderPath) {
  const content = await fsp.readFile(path.join(folderPath, AI_PACK_MANIFEST_FILE), 'utf8');
  return validateAiPackManifest(parseJsonText(content));
}

async function resolveAiPackFolder(sourceFolder) {
  if (await pathExists(path.join(sourceFolder, AI_PACK_MANIFEST_FILE))) {
    return sourceFolder;
  }
  const entries = await fsp.readdir(sourceFolder, { withFileTypes: true });
  const childDirs = entries.filter((entry) => entry.isDirectory());
  if (childDirs.length === 1) {
    const childFolder = path.join(sourceFolder, childDirs[0].name);
    if (await pathExists(path.join(childFolder, AI_PACK_MANIFEST_FILE))) {
      return childFolder;
    }
  }
  throw new Error('AI pack folder must contain manifest.json.');
}

function makeAiPackRegistryItem(manifest, folderPath, sizeBytes = 0, sourceName = '') {
  return {
    ...manifest,
    folderPath,
    sizeBytes,
    sourceName,
    installedAt: new Date().toISOString()
  };
}

async function getMissingAiPackRuntimeFiles(pack) {
  const missing = [];
  const root = path.resolve(pack.folderPath || '');
  const runtimeFiles = normalizeAiPackRuntimeFiles(pack.runtimeFiles || pack.runtime);
  for (const [group, files] of Object.entries(runtimeFiles)) {
    for (const relativePath of files) {
      const resolved = path.resolve(root, relativePath);
      if (!isPathInside(root, resolved) || !(await pathExists(resolved))) {
        missing.push(`${group}:${relativePath}`);
      }
    }
  }
  return missing;
}

async function getAiPackRuntimeReadiness(pack) {
  const root = path.resolve(pack.folderPath || '');
  const runtimeFiles = normalizeAiPackRuntimeFiles(pack.runtimeFiles || pack.runtime);
  const result = {};
  for (const [group, files] of Object.entries(runtimeFiles)) {
    if (!files.length) {
      result[group] = false;
      continue;
    }
    let allPresent = true;
    for (const relativePath of files) {
      const resolved = path.resolve(root, relativePath);
      if (!isPathInside(root, resolved) || !(await pathExists(resolved))) {
        allPresent = false;
        break;
      }
    }
    result[group] = allPresent;
  }
  return result;
}

async function getAiRuntimeAvailability(pack) {
  const runtimeReady = await getAiPackRuntimeReadiness(pack);
  const sttRunnerPath = await firstExistingPath(getSttRunnerPath());
  const ttsRunnerPath = await firstExistingPath(getTtsRunnerPath());
  const dialogueRunnerPath = await firstExistingPath(getDialogueRunnerPath());
  const llamaCliPath = await firstExistingPath(getLlamaCliPath());
  const ffmpegPath = await firstExistingPath(getFfmpegPath());
  return {
    runtimeReady,
    sttRunnerPath,
    sttRunnerAvailable: !!sttRunnerPath,
    ttsRunnerPath,
    ttsRunnerAvailable: !!ttsRunnerPath,
    dialogueRunnerPath,
    dialogueRunnerAvailable: !!dialogueRunnerPath,
    llamaCliPath,
    llamaCliAvailable: !!llamaCliPath,
    ffmpegPath,
    ffmpegAvailable: !!ffmpegPath
  };
}

const {
  runSttTranscription,
  runTtsSynthesis,
  runDialogueGeneration
} = createAiRuntimeRunners({
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
  getWarmDialogueService: () => warmDialogueService,
  constants: {
    MAX_STT_AUDIO_BYTES,
    MAX_TTS_TEXT_CHARS
  }
});

async function installAiPackFolder(sourceFolder, operation, sourceName = '') {
  const packFolder = await resolveAiPackFolder(sourceFolder);
  const manifest = await readAiPackManifest(packFolder);
  const safeId = sanitizeName(manifest.id, 'ai-pack');
  const destination = path.join(getAiPacksRoot(), safeId);
  const sourceSize = await getDirectorySize(packFolder);
  operation.totalBytes = sourceSize;
  operation.transferredBytes = 0;
  operation.phase = 'Copying AI language pack';
  sendBookProgress(operation);
  await fsp.rm(destination, { recursive: true, force: true });
  await copyDirectoryWithProgress(packFolder, destination, operation);
  const installedManifest = await readAiPackManifest(destination);
  const item = makeAiPackRegistryItem(installedManifest, destination, await getDirectorySize(destination), sourceName || path.basename(packFolder));
  await upsertAiPackRegistryItem(item);
  return item;
}

async function installAiPackManifestFile(sourcePath) {
  const manifest = validateAiPackManifest(parseJsonText(await fsp.readFile(sourcePath, 'utf8')));
  const safeId = sanitizeName(manifest.id, 'ai-pack');
  const destination = path.join(getAiPacksRoot(), safeId);
  await fsp.rm(destination, { recursive: true, force: true });
  await fsp.mkdir(destination, { recursive: true });
  await fsp.writeFile(path.join(destination, AI_PACK_MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8');
  const item = makeAiPackRegistryItem(manifest, destination, await getDirectorySize(destination), path.basename(sourcePath));
  await upsertAiPackRegistryItem(item);
  return item;
}
  return {
    configureWarmDialogueService,
    ensureAiPacksRoot,
    readAiPackRegistry,
    removeAiPackRegistryItem,
    installAiPackFolder,
    installAiPackManifestFile,
    findAiPack,
    getMissingAiPackRuntimeFiles,
    getAiRuntimeAvailability,
    runSttTranscription,
    runDialogueGeneration,
    runTtsSynthesis,
    normalizeAiLanguage,
    normalizeAiPackDialogueConfig
  };
}

module.exports = { createAiPackService };
