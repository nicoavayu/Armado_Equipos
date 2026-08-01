// @ts-check
const { defineConfig } = require('@playwright/test');
const { assertSafeQaValue } = require('./scripts/qa/production-guard');

const localBaseURL = 'http://127.0.0.1:3107';
const baseURL = process.env.QA_BASE_URL || localBaseURL;
assertSafeQaValue(baseURL, 'Playwright baseURL');

const chromiumProject = (name, width, height, mobile = false) => ({
  name,
  use: {
    browserName: 'chromium',
    viewport: { width, height },
    screen: { width, height },
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
  },
});

module.exports = defineConfig({
  testDir: './tests/e2e',
  outputDir: 'artifacts/playwright/test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  reporter: [
    ['list'],
    ['html', {
      outputFolder: 'artifacts/playwright/html-report',
      open: 'never',
    }],
  ],
  globalSetup: require.resolve('./tests/e2e/global-setup'),
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    chromiumProject('chromium-desktop-1440x900', 1440, 900),
    chromiumProject('chromium-tablet-768x1024', 768, 1024),
    chromiumProject('chromium-mobile-320x700', 320, 700, true),
    chromiumProject('chromium-mobile-375x812', 375, 812, true),
    chromiumProject('chromium-mobile-430x932', 430, 932, true),
  ],
  webServer: process.env.QA_BASE_URL ? undefined : {
    command: 'npm start',
    url: localBaseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      BROWSER: 'none',
      HOST: '127.0.0.1',
      PORT: '3107',
      REACT_APP_SUPABASE_URL: 'http://127.0.0.1:54321',
      REACT_APP_SUPABASE_ANON_KEY: 'qa-local-public-anon-placeholder',
      REACT_APP_PUBLIC_APP_URL: localBaseURL,
      REACT_APP_AUTH_REDIRECT_URL: `${localBaseURL}/auth/callback`,
      REACT_APP_LOCAL_EDIT_MODE: 'false',
      REACT_APP_DEPLOY_ENV: 'development',
      REACT_APP_TORNEOS_DATA_ENV: 'local',
      REACT_APP_TORNEOS_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
      REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'true',
      REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: 'false',
      REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: 'false',
    },
  },
});
