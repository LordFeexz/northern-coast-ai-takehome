import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  timeout: 30000,
  workers: 1, // Sequential execution to avoid port collisions
  use: {
    baseURL: 'http://127.0.0.1:3000',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
});
