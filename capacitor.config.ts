/// <reference types="@capacitor/keyboard" />
import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

/** Production WebView URL (Railway). Override only for local v7-1 verification — see CAPACITOR_SERVER_URL. */
const PRODUCTION_SERVER_URL = 'https://insta-map-production.up.railway.app';
const verifyServerUrl = process.env.CAPACITOR_SERVER_URL?.trim();
const serverUrl = verifyServerUrl || PRODUCTION_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.pindmap.app',
  appName: 'PindMap',
  webDir: 'public',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
  },
  ios: {
    contentInset: 'never',
  },
  plugins: {
    Keyboard: {
      resize: KeyboardResize.None,
    },
    FirebaseMessaging: {
      presentationOptions: [],
    },
  },
};

export default config;
