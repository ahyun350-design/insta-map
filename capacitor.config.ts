/// <reference types="@capacitor/keyboard" />
import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.pindmap.app',
  appName: 'PindMap',
  webDir: 'public',
  server: {
    url: 'https://insta-map-production.up.railway.app',
    cleartext: false,
  },
  ios: {
    contentInset: 'always',
  },
  plugins: {
    Keyboard: {
      resize: KeyboardResize.None,
    },
  },
};

export default config;
