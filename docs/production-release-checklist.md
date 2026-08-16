# NoPrep Production Release Checklist

Use this checklist before publishing a GitHub tag, Electron installer, or Android build.

## 1. Source Control

- Review `git status --short` and make sure every changed file belongs to the release.
- Keep generated folders out of Git: `dist/`, `release/`, Android build output, coverage.
- Do not commit private signing material or API keys:
  - `android/keystore.properties`
  - `android/*.jks`
  - `android/*.keystore`
  - `private.pem`
  - `license.dat`
  - `electron/ai-config.json` (see `docs/ai-speaking.md`)
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
- `electron/**/*` (except `electron/ai-config.json` and `electron/ai-config.example.json`,
  which are explicitly excluded — confirm they're not inside `release/win-unpacked/resources`
  after a build)
- `node_modules/@ffmpeg-installer/**/*`
- `native/security-core/*.node`

Before sharing the installer, smoke test:

- Open an existing book.
- Open reader mode.
- Play local video and fullscreen with the custom fullscreen control.
- Use draw, highlighter, text, screenshot, page navigation, zoom, rotate, and two-page mode.
- Click a game icon and return to the same reader page.
- Click a speaking icon with `NOPREP_GROQ_API_KEY` or `electron/ai-config.json` configured, and
  confirm AI Speaking responds (see `docs/ai-speaking.md`). Without either, the reader should
  show "AI Speaking unavailable" rather than erroring.

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

AI Speaking is Electron-only and requires internet access plus a configured Groq API key — see
`docs/ai-speaking.md`. It is not available on Android; the Android build does not need any AI
Speaking setup.

## 5. AI Speaking Configuration

See `docs/ai-speaking.md` for the full picture. The short version for a release build:

- `electron/ai-config.json` is gitignored and excluded from packaging on purpose — verify a
  fresh `npm run electron:build` does not bundle it (check `release/win-unpacked/resources` after
  building).
- Teachers set up their own key in-app: the AI Speaking panel shows a "Get free API key" button
  (opens `console.groq.com/keys` via `shell.openExternal`) plus a field to paste the key back in.
  The key is written to `app.getPath('userData')/ai-config.json`, never bundled in the installer.

## 6. Final Pre-Upload Check

- No local AppData book folders are copied into the repo.
- No sample student recordings or transcripts are committed.
- No real API keys, passwords, keystores, or private certificates are committed.
- `electron/ai-config.json` does not exist inside `release/win-unpacked` after packaging.
- Electron installer opens without missing runtime files.
- Android `.aab` is signed and accepted by Play Console upload validation.
- Production build artifacts are generated from a clean command run, not copied manually.
