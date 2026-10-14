import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  use: { baseURL: 'http://127.0.0.1:5011', headless: true },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js client --host 127.0.0.1 --port 5011 --strictPort',
    url: 'http://127.0.0.1:5011',
    reuseExistingServer: false,
  },
  outputDir: '/tmp/propertyflow-onboarding-test-results',
});
