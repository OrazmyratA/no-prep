import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.orazmyrat.noprep',
  appName: 'No-Prep',
  webDir: 'dist/no-prep/browser',
  bundledWebRuntime: false,
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      // Matches the startup splash in index.html, so the hand-off from the native splash to the
      // web one isn't a white flash.
      backgroundColor: '#eef2ff'
    }
  }
};

export default config;
