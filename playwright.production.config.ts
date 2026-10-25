import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This suite uses the complete fixed production build. Build it first through
// local-validation.mjs; setup/teardown reject stale or changing build inputs.
export default defineConfig({
  testDir: './tests/ui',
  workers: 2,
  retries: 0,
  globalSetup: './scripts/local-validation.mjs',
  use: {
    baseURL: 'http://127.0.0.1:5019',
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: process.env.PF_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PF_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: 'node scripts/test-production-preview.mjs',
    url: 'http://127.0.0.1:5019',
    reuseExistingServer: false,
  },
  outputDir: mkdtempSync(join(tmpdir(), 'propertyflow-production-tests-')),
});
