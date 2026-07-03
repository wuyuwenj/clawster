import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'dev',
      testIgnore: /production-smoke/,
    },
    {
      name: 'prod',
      testIgnore: /production-smoke/,
    },
    {
      name: 'prod-bundle',
      testMatch: /production-smoke/,
    },
  ],
  webServer: process.env.E2E_MODE === 'prod' ? undefined : {
    command: 'npm run dev:renderer',
    url: 'http://localhost:5173/onboarding.html',
    reuseExistingServer: true,
    timeout: 120000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
