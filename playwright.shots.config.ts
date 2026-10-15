import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Screenshots of every example (light, dark, mobile) for visual review: npm run screenshots */
export default defineConfig({
  ...base,
  testDir: 'e2e',
  testMatch: /screenshots\.shot\.ts/,
  reporter: 'list',
  timeout: 120_000,
});
