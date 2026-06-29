# NoPrep AI Runtimes

This folder contains app-owned runtime launchers for offline AI features.

`stt-runner.cjs` is the Electron speech-to-text runner. It expects:

- a JSON request file path as its only argument
- `sherpa-onnx` available to the runner
- a WAV input file prepared by Electron
- model file paths declared by the installed AI pack manifest

`tts-runner.cjs` is the Electron text-to-speech runner. It expects:

- a JSON request file path as its only argument
- `sherpa-onnx` available to the runner
- Sherpa-ONNX TTS model file paths declared by the installed AI pack manifest
- an output WAV path prepared by Electron

`dialogue-runner.cjs` is the Electron local-dialogue runner. It expects:

- a JSON request file path as its only argument
- a llama.cpp CLI binary owned by the app or set with `NOPREP_LLAMA_CLI`
- a GGUF model file declared by the installed AI pack manifest

Do not put teacher/shared-pack executables here automatically. AI packs should contain model files and metadata only; executable runtime code belongs to the app.

For development:

```text
NOPREP_SHERPA_ONNX_MODULE=sherpa-onnx
NOPREP_FFMPEG=C:\path\to\ffmpeg.exe
NOPREP_LLAMA_CLI=C:\path\to\llama-cli.exe
```
