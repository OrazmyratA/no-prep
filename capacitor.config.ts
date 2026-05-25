import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.orazmyrat.noprep',
  appName: 'No-Prep',
  webDir: 'dist/no-prep/browser',
  bundledWebRuntime: false,
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#ffffff'
    }
  }
};

export default config;
