import type { CapacitorConfig } from '@capacitor/cli';

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
};

export default config;
