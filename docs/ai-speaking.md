# NoPrep AI Speaking

AI Speaking (the conversational practice feature in the book reader) runs on cloud services
instead of a bundled local model. There is no pack to install — the feature is either
configured on a given machine or it isn't.

Current implementation status:

- Speech-to-text and the dialogue/conversation partner both call the [Groq](https://groq.com)
  API (`llama-3.3-70b-versatile` for chat, `whisper-large-v3-turbo` for transcription).
- Text-to-speech calls Microsoft Edge's read-aloud service via the `msedge-tts` package.
- Speaking attempts can still be recorded, replayed, exported, and deleted, same as before.
- This is Electron-only. Android and the web build report AI Speaking as unavailable — see
  `AiSpeakingRuntimeService.getPlatform()` in `src/app/core/ai-speaking-runtime.ts`, which gates
  every call behind `window.electronAPI`.

## Configuring a Groq API key

The app never ships with a key baked in. `electron/index.js`'s `getGroqApiKey()` looks for one
in this order:

1. `NOPREP_GROQ_API_KEY` environment variable.
2. `electron/ai-config.json` (gitignored, never committed) — copy
   `electron/ai-config.example.json` to `electron/ai-config.json` and paste in a free key from
   [console.groq.com](https://console.groq.com).

If neither is present, `aiService.isConfigured()` returns `false` and the reader shows "AI
Speaking unavailable" instead of failing — see `book-reader-speaking-ai-controller.ts`.

**`electron/ai-config.json` must never be inside the packaged app.** `package.json`'s
electron-builder `files` list explicitly excludes it
(`"!electron/ai-config.json"`) — if that exclusion is ever removed, the next
`npm run electron:build` will bundle whatever key is on the building machine into the shipped
installer, extractable by anyone via `asar extract`. There is currently no in-app settings
screen for a teacher to supply their own key; until one exists, AI Speaking only works on
machines where a developer has set up the config file or env var directly.

## Privacy note

When AI Speaking is configured and a student uses it, their recorded speech is sent to Groq's
API for transcription, and the transcript is sent to Groq for generating the AI's reply. This is
a real data flow to a third-party service — factor it into any privacy policy or compliance
review before enabling this feature broadly.

## Backend services

- `electron/main/ai-groq-service.js` — chat completion, transcription, and end-of-session
  feedback prompts. All prompts include an explicit safety section that overrides the
  teacher-authored prompt for anything unsafe or age-inappropriate.
- `electron/main/ai-edge-tts-service.js` — picks a voice for the requested language and
  synthesizes speech via `msedge-tts`.
- `electron/main/ai-ipc.js` — wires both services to the renderer over IPC
  (`ai-speaking:*` channels in `electron/preload.js`).
