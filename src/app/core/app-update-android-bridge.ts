import { registerPlugin } from '@capacitor/core';

export interface AppUpdaterDownloadProgress {
  percent: number;
}

export interface AppUpdaterPlugin {
  isPlayStoreInstall(): Promise<{ value: boolean }>;
  downloadAndInstall(options: { url: string }): Promise<void>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (data: AppUpdaterDownloadProgress) => void
  ): Promise<{ remove: () => void }>;
}

// Native half in android/app/src/main/java/com/orazmyrat/noprep/AppUpdaterPlugin.java — downloads
// the APK from our GitHub release and hands it to Android's package installer. Web/Electron never
// touch this plugin (see PlatformService gating in app-update.ts), so it's safe that it only
// exists natively on Android.
export const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');
