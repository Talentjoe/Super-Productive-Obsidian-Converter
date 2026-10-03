import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', timeout: 30000, fullyParallel: false,
  use: { channel: 'chrome', baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 900 } },
  webServer: { command: 'npm run dev -- --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
  reporter: 'list',
});
