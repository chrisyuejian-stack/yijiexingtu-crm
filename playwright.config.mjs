import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';

// Only inherited by the test runner and its local child server. Never bundled.
process.env.E2E_CONTROL_KEY ||= randomBytes(32).toString('hex');
const port = Number(process.env.E2E_PORT || 4380);
const reportDir = process.env.E2E_REPORT_DIR || 'work/e2e';
const executablePath = process.env.CHROME_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  outputDir: `${reportDir}/artifacts`,
  reporter: [['list'], ['html', { outputFolder: `${reportDir}/html`, open: 'never' }], ['./scripts/e2e/reporter.mjs']],
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    actionTimeout: 10_000,
    // Each role records its own trace after the local session bootstrap.
    trace: 'off',
    video: 'on',
    screenshot: 'on',
    launchOptions: { ...(executablePath ? { executablePath } : {}) },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'node scripts/e2e/server.mjs',
    url: `http://localhost:${port}/__e2e/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(port), E2E_CONTROL_KEY: process.env.E2E_CONTROL_KEY },
  },
});
