# No-Prep Android Release Notes

## App Identity

- App name: No-Prep
- Package name: com.orazmyrat.noprep
- Android shell: Capacitor
- Play Store artifact: Android App Bundle (`.aab`)
- Local testing artifact: debug APK (`.apk`)

## First Release Scope

- Free app
- No accounts
- No ads
- No analytics or tracking SDKs
- Local-only topic storage
- Compatible JSON import/export format
- Camera only when the user chooses to take a photo
- Microphone only when the user chooses to record audio
- Pixabay image search only when internet is available

## Build Commands

```bash
npm run android:sync
npm run android:apk
npm run android:aab
```

## Release Signing

Create one private upload keystore before the first Play Console upload:

```powershell
keytool -genkeypair -v -keystore android/no-prep-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias no-prep-upload
```

Then create `android/keystore.properties`:

```properties
storeFile=no-prep-upload.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=no-prep-upload
keyPassword=YOUR_KEY_PASSWORD
```

Keep both files private. They are ignored by Git. After this file exists, `npm run android:aab` signs the release bundle with the upload key.

## Local Toolchain Needed

This machine needs these installed or configured before Gradle can produce APK/AAB files:

- Java JDK 17 or newer
- Android SDK with platform 36 and build tools
- `JAVA_HOME` set to the JDK path
- `ANDROID_HOME` or `ANDROID_SDK_ROOT` set to the Android SDK path

Android Studio is the easiest way to install and manage the SDK.

## Play Console Notes

Use `public/privacy.html` as the starting privacy policy page. The published URL can be hosted on Netlify.
