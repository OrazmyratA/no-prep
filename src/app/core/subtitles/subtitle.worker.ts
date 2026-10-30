// Speech → timed lines, off the page's thread so the video and the app stay smooth.
// Whisper "base" (all languages, 8-bit, ~77 MB) runs on WebAssembly; the model files are fetched
// from Hugging Face once and kept in IndexedDB (the desktop app runs from file://, where the
// browser's own Cache API is not available).
import { env, pipeline } from '@huggingface/transformers';

import type { SubtitleWorkerReply, SubtitleWorkerRequest } from './subtitle-worker-messages';

const MODEL_ID = 'Xenova/whisper-base';
const DB_NAME = 'noprep-speech-model';
const STORE = 'files';

const post = (message: SubtitleWorkerReply) =>
  (self as unknown as { postMessage(message: unknown): void }).postMessage(message);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** transformers.js asks this cache before downloading, and hands it every file it downloaded. */
const modelCache = {
  async match(key: string): Promise<Response | undefined> {
    const blob = await idb<Blob | undefined>('readonly', (s) => s.get(key)).catch(() => undefined);
    return blob ? new Response(blob) : undefined;
  },
  async put(key: string, response: Response): Promise<void> {
    const blob = await response.blob();
    await idb('readwrite', (s) => s.put(blob, key)).catch(() => undefined);
  }
};

async function modelIsDownloaded(): Promise<boolean> {
  const keys = await idb<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).catch(() => []);
  return keys.some((key) => String(key).includes('encoder_model')) && keys.some((key) => String(key).includes('decoder_model'));
}

type Transcriber = (audio: Float32Array, options: object) => Promise<{ chunks?: { timestamp: [number, number | null]; text: string }[] }>;
let transcriber: Promise<Transcriber> | null = null;

function loadModel(wasmBase: string): Promise<Transcriber> {
  if (transcriber) return transcriber;
  env.allowLocalModels = false;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = modelCache;
  env.backends.onnx.wasm!.wasmPaths = wasmBase;

  // Download progress over all files (the two model files are nearly all of it).
  const files = new Map<string, { loaded: number; total: number }>();
  transcriber = pipeline('automatic-speech-recognition', MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (info.status !== 'progress' || !info.file) return;
      files.set(info.file, { loaded: info.loaded || 0, total: info.total || 0 });
      let loaded = 0;
      let total = 0;
      for (const file of files.values()) { loaded += file.loaded; total += file.total; }
      post({ type: 'model-progress', loaded, total });
    }
  }) as unknown as Promise<Transcriber>;
  transcriber.catch(() => { transcriber = null; });
  return transcriber;
}

addEventListener('message', async (event: MessageEvent<SubtitleWorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'check') {
      post({ type: 'checked', downloaded: await modelIsDownloaded() });
    } else if (message.type === 'load') {
      await loadModel(message.wasmBase);
      post({ type: 'loaded' });
    } else if (message.type === 'transcribe') {
      const run = await loadModel(message.wasmBase);
      const result = await run(message.audio, {
        return_timestamps: true,
        language: message.language,
        task: 'transcribe'
      });
      const segments = (result.chunks || []).map((chunk) => ({
        start: chunk.timestamp[0],
        end: chunk.timestamp[1],
        text: chunk.text
      }));
      post({ type: 'transcribed', id: message.id, segments });
    }
  } catch (error) {
    post({ type: 'failed', id: 'id' in message ? message.id : undefined, message: String((error as Error)?.message || error) });
  }
});
