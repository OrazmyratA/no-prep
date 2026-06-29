# NoPrep Production Release Checklist

Use this checklist before publishing a GitHub tag, Electron installer, or Android build.

## 1. Source Control

- Review `git status --short` and make sure every changed file belongs to the release.
- Keep generated folders out of Git: `dist/`, `release/`, Android build output, coverage, and local AI packs.
- Do not commit private signing material:
  - `android/keystore.properties`
  - `android/*.jks`
  - `android/*.keystore`
  - `private.pem`
  - `license.dat`
- Keep binary release assets marked as binary through `.gitattributes`.

## 2. Dependency And Test Gate

Run:

```powershell
npm audit --omit=dev
npm test -- --watch=false
npm run build:prod
```

`npm audit --omit=dev` is the release security gate for shipped browser/runtime dependencies. If full `npm audit` reports dev-tool advisories, review them separately and do not use `npm audit fix --force` unless the resulting Angular versions are intentionally supported.

## 3. Electron Release

Run:

```powershell
npm run build:security-core
npm run encrypt:features
npm run electron:build
```

Check that the installer includes:

- `dist/**/*`
- `electron/**/*`
- `electron/ai-runtimes/**/*`
- `node_modules/sherpa-onnx/**/*`
- `node_modules/@ffmpeg-installer/**/*`
- `native/security-core/*.node`

Before sharing the installer, smoke test:

- Open an existing book.
- Open reader mode.
- Play local video and fullscreen with the custom fullscreen control.
- Use draw, highlighter, text, screenshot, page navigation, zoom, rotate, and two-page mode.
- Click a game icon and return to the same reader page.
- Click a speaking icon with a complete AI speaking pack installed.

## 4. Android Release

Follow `docs/android-release.md` for the signing key. Then run:

```powershell
npm run android:sync
npm run android:apk
npm run android:aab
```

Smoke test on at least one phone and one tablet or resizable emulator:

- Topics and books tabs.
- Reader single-page and two-page modes.
- Zoom in and scroll to every edge.
- Screenshot export.
- Touch drawing/highlighting/text.
- Book import/export to device storage.
- Game navigation back to the reader page.

Offline AI speaking currently depends on platform runtime availability. Treat Electron as the primary supported AI-speaking release target until Android-native STT, TTS, and dialogue runtimes are packaged and tested.

## 5. AI Speaking Pack Distribution

AI packs are not stored inside book folders. Share them separately as one folder per language/quality tier.

A complete English speaking setup needs compatible packs for:

- Listening: speech-to-text model files.
- Conversation: local dialogue GGUF model.
- Voice: text-to-speech model files.

Teachers or readers can import the pack folder from the reader UI. The app will rebuild its local AI pack registry after import, so the registry file itself should not be shared as the source of truth.

Recommended pack structure:

```text
English Speaking Pack/
  manifest.json
  stt/
  dialogue/
  tts/
```

If stronger dialogue is needed, ship a separate dialogue-only advanced pack for the same language. The app can combine the best installed listening, conversation, and voice packs for that language.

## 6. Final Pre-Upload Check

- No local AppData book folders are copied into the repo.
- No sample student recordings or transcripts are committed.
- No real API keys, passwords, keystores, or private certificates are committed.
- Electron installer opens without missing runtime files.
- Android `.aab` is signed and accepted by Play Console upload validation.
- Production build artifacts are generated from a clean command run, not copied manually.
