import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './test/browser', timeout: 90_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.TEST_BROWSER_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] } },
  webServer: { command: 'npm start', url: 'http://127.0.0.1:3000/health', reuseExistingServer: !process.env.CI },
});
