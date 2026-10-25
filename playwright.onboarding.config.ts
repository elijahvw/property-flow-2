import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  use: { baseURL: 'http://127.0.0.1:5012', headless: true },
  // The client API proxy targets port 5011; using that port here would proxy
  // unmocked requests back into Vite until local sockets are exhausted.
  webServer: {
    command: 'node node_modules/vite/bin/vite.js client --host 127.0.0.1 --port 5012 --strictPort',
    url: 'http://127.0.0.1:5012',
    reuseExistingServer: false,
  },
  outputDir: '/tmp/propertyflow-onboarding-test-results',
});
