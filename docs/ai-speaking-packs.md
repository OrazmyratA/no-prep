# NoPrep AI Speaking Packs

AI Speaking packs are installed globally by the app, outside individual book folders. A pack folder must contain a `manifest.json` file.

Minimal manifest:

```json
{
  "type": "noprep-ai-pack",
  "id": "english-small-v1",
  "language": "en",
  "label": "English Small",
  "engine": "sherpa-onnx",
  "features": ["speech-to-text", "text-to-speech", "local-dialogue"],
  "version": "1.0.0"
}
```

Manifest with runtime file validation:

```json
{
  "type": "noprep-ai-pack",
  "id": "english-small-v1",
  "language": "en",
  "label": "English Small",
  "engine": "sherpa-onnx",
  "features": ["speech-to-text", "text-to-speech", "local-dialogue"],
  "runtimeFiles": {
    "stt": [
      "stt/model.onnx",
      "stt/tokens.txt"
    ],
    "tts": [
      "tts/model.onnx",
      "tts/tokens.txt"
    ],
    "dialogue": [
      "dialogue/model.gguf"
    ]
  },
  "sttConfig": {
    "provider": "sherpa-onnx",
    "modelConfig": {
      "senseVoice": {
        "model": "stt/model.int8.onnx",
        "language": "",
        "useInverseTextNormalization": 1
      },
      "tokens": "stt/tokens.txt"
    }
  },
  "ttsConfig": {
    "provider": "sherpa-onnx",
    "offlineTtsConfig": {
      "offlineTtsModelConfig": {
        "offlineTtsVitsModelConfig": {
          "model": "tts/model.onnx",
          "tokens": "tts/tokens.txt",
          "dataDir": "tts/espeak-ng-data"
        },
        "numThreads": 1,
        "debug": 0,
        "provider": "cpu"
      },
      "ruleFsts": "",
      "ruleFars": "",
      "maxNumSentences": 1
    },
    "speakerId": 0,
    "speed": 1
  },
  "dialogueConfig": {
    "provider": "llama.cpp",
    "model": "dialogue/model.gguf",
    "maxTokens": 90,
    "temperature": 0.4,
    "contextSize": 2048,
    "threads": 4,
    "timeoutSeconds": 120
  },
  "version": "1.0.0"
}
```

Current implementation status:

- The app can import/list/remove AI packs.
- The reader checks pack presence and runtime-file presence.
- Speaking attempts can be recorded, replayed, exported, and deleted.
- Electron speech-to-text can call the bundled Sherpa-ONNX runner when a pack includes `sttConfig`.
- Electron text-to-speech can call the bundled Sherpa-ONNX runner when a pack includes `ttsConfig`.
- Electron local dialogue can call the bundled dialogue runner when a pack includes `dialogueConfig`, a GGUF model, and an app-owned llama.cpp CLI is installed.

The runtime bridge expects these layers:

- `speech-to-text`: recorded student audio to transcript.
- `local-dialogue`: teacher prompt plus transcript history to next AI response.
- `text-to-speech`: AI response text to spoken audio.

Packs can be installed as one complete bundle or as separate feature packs. The reader will pick the best installed pack for each layer. This lets a device keep a small speech-recognition pack and a small voice pack while using a stronger advanced dialogue pack.

Quality tiers:

- `small`: fastest and lightest, best for weak devices.
- `standard`: default when a pack does not declare a tier.
- `advanced`: preferred for richer conversation when the device can handle it.

Example advanced dialogue-only manifest fields:

```json
{
  "qualityTier": "advanced",
  "modelSizeLabel": "Advanced dialogue",
  "deviceRequirements": {
    "recommendedRamMb": 8192
  },
  "features": ["local-dialogue"]
}
```

## Electron STT runner

Electron does not run executables from AI packs. AI packs contain model files only. The executable runner must belong to the app.

Development runner location:

```text
electron/ai-runtimes/stt-runner.exe
electron/ai-runtimes/stt-runner.cjs
electron/ai-runtimes/tts-runner.exe
electron/ai-runtimes/tts-runner.cjs
electron/ai-runtimes/dialogue-runner.exe
electron/ai-runtimes/dialogue-runner.cjs
electron/ai-runtimes/llama-cli.exe
```

Packaged runner location:

```text
resources/ai-runtimes/stt-runner.exe
resources/ai-runtimes/stt-runner.cjs
resources/ai-runtimes/tts-runner.exe
resources/ai-runtimes/tts-runner.cjs
resources/ai-runtimes/dialogue-runner.exe
resources/ai-runtimes/dialogue-runner.cjs
resources/ai-runtimes/llama-cli.exe
```

For development, either path can be overridden:

```text
NOPREP_STT_RUNNER=C:\path\to\stt-runner.exe
NOPREP_TTS_RUNNER=C:\path\to\tts-runner.exe
NOPREP_DIALOGUE_RUNNER=C:\path\to\dialogue-runner.exe
NOPREP_LLAMA_CLI=C:\path\to\llama-cli.exe
NOPREP_AI_RUNTIMES_DIR=C:\path\to\ai-runtimes
NOPREP_SHERPA_ONNX_MODULE=sherpa-onnx
NOPREP_FFMPEG=C:\path\to\ffmpeg.exe
```

The included `electron/ai-runtimes/stt-runner.cjs` expects the Node package `sherpa-onnx` to be available to that runtime. It follows the Sherpa-ONNX Node example pattern: create an offline recognizer, read a WAV file, decode it, and return text.

The `sttConfig.modelConfig` object is passed to Sherpa-ONNX as the recognizer model config after pack-relative file paths are resolved. For Whisper, that means keys such as `whisper` and `tokens` live under the recognizer's `modelConfig` field.

The app records WebM/M4A on many devices, so Electron converts the recording to 16 kHz mono WAV before calling the runner. Put `ffmpeg.exe` beside the runner or set `NOPREP_FFMPEG`.

The included `electron/ai-runtimes/tts-runner.cjs` follows the Sherpa-ONNX Node TTS API: create an offline TTS engine, generate audio for text, and save a WAV file. The `ttsConfig.offlineTtsConfig` object is passed to Sherpa-ONNX after pack-relative file paths are resolved.

The included `electron/ai-runtimes/dialogue-runner.cjs` calls an app-owned llama.cpp CLI in single-turn chat mode with a pack-owned GGUF model. AI packs must not include executables. Put `llama-cli` beside the runner or set `NOPREP_LLAMA_CLI`.

## Create a Sherpa STT pack

First download and extract a Sherpa-ONNX offline model folder. Then wrap it as a NoPrep pack:

```text
npm run ai:create-stt-pack -- --source D:\models\sherpa-onnx-whisper-tiny.en --out D:\NoPrepAiPacks\english-whisper-tiny --kind whisper --id english-whisper-tiny --language en --label "English Whisper Tiny"
```

Supported `--kind` values:

- `whisper`: expects encoder ONNX, decoder ONNX, and tokens.
- `sensevoice`: expects model ONNX and tokens.
- `transducer`: expects encoder ONNX, decoder ONNX, joiner ONNX, and tokens.

The tool copies the extracted model folder into `<pack>\stt`, detects the required files, and writes `<pack>\manifest.json`.

## Create a llama.cpp dialogue pack

Use this when you want to install a stronger conversation model separately from STT/TTS:

```text
npm run ai:create-dialogue-pack -- --model D:\models\smarter-chat.gguf --out D:\NoPrepAiPacks\english-advanced-dialogue --id english-advanced-dialogue --language en --label "English Advanced Dialogue" --quality advanced --recommended-ram-mb 8192
```

The tool copies the GGUF into `<pack>\dialogue`, writes `<pack>\manifest.json`, and marks the pack as `local-dialogue`. The app will prefer this pack for dialogue while still using the best installed STT and TTS packs for the same language.

## Test a pack before importing

Use a WAV sample to test the runner directly:

```text
npm run ai:test-stt-runner -- --pack D:\NoPrepAiPacks\english-whisper-tiny --audio D:\samples\hello.wav
```

If this prints JSON with a `text` field, the pack is usable by the Electron reader. If it fails here, fix the pack or model paths before testing inside the app.

## Test a TTS pack before importing

Use a short sentence to test the TTS runner directly:

```text
npm run ai:test-tts-runner -- --pack D:\NoPrepAiPacks\english-voice --text "Hello, welcome to NoPrep." --out D:\samples\noprep-ai-voice.wav
```

If this writes a WAV file and prints JSON with `sampleRate` and `sampleCount`, the pack is usable by the Electron TTS bridge.

## Test a dialogue pack before importing

Use a short student answer to test the dialogue runner directly:

```text
npm run ai:test-dialogue-runner -- --pack D:\NoPrepAiPacks\english-dialogue --student "I went to school yesterday."
```

If this prints JSON with `responseText`, the pack is usable by the Electron dialogue bridge. The runner needs a llama.cpp CLI binary and a GGUF model declared in `dialogueConfig`.

The app calls the runner with one argument: a JSON request file path.

Request example:

```json
{
  "packId": "english-small-v1",
  "language": "en",
  "packPath": "C:\\Users\\admin\\AppData\\Roaming\\No-Prep\\AI Packs\\english-small-v1",
  "runtimeFiles": {
    "stt": ["stt/model.onnx", "stt/tokens.txt"],
    "tts": ["tts/model.onnx"],
    "dialogue": ["dialogue/model.gguf"]
  },
  "audioPath": "C:\\Users\\admin\\AppData\\Local\\Temp\\noprep-stt-run\\audio.webm",
  "originalAudioPath": "C:\\Users\\admin\\AppData\\Local\\Temp\\noprep-stt-run\\audio.webm",
  "mimeType": "audio/wav",
  "originalMimeType": "audio/webm",
  "sttConfig": {
    "provider": "sherpa-onnx",
    "modelConfig": {
      "senseVoice": {
        "model": "stt/model.int8.onnx",
        "language": "",
        "useInverseTextNormalization": 1
      },
      "tokens": "stt/tokens.txt"
    }
  }
}
```

The runner must write JSON to stdout:

```json
{
  "text": "Hello, my name is Ali.",
  "language": "en",
  "confidence": 0.91,
  "segments": [
    {
      "text": "Hello, my name is Ali.",
      "startSeconds": 0,
      "endSeconds": 2.4,
      "confidence": 0.91
    }
  ]
}
```

If the runner exits non-zero or writes invalid JSON, the reader keeps the audio attempt and records the STT error in the transcript field.
