import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: 'chrome',
  manifest: {
    name: 'Image Darkista',
    version: '0.2.0',
    permissions: [
      'storage'
    ]
  }
});
