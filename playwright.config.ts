import { defineConfig } from '@playwright/test';
if (process.env.QA_ISOLATED !== '1') throw new Error('Use npm run test:e2e for isolated emulators');
export default defineConfig({
  testDir: './tests/e2e', timeout: 120_000, expect: { timeout: 15_000 },
  workers: 1, retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: '.qa/playwright-results.json' }]],
  use: { actionTimeout: 10_000, baseURL: 'http://127.0.0.1:4177', trace: 'off', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --mode qa --host 127.0.0.1 --port 4177 --strictPort', url: 'http://127.0.0.1:4177', reuseExistingServer: false },
});
