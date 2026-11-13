import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3230;
// The flows run against a fresh copy of the real synced database (tests/e2e/copy-db.ts), so
// they never touch the owner's collection, decks or settings. A server already listening on the
// port would be serving the owner's own database, so it is not reused.
const E2E_DB = path.join(process.cwd(), 'data', 'e2e-forge.db');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'tsx tests/e2e/copy-db.ts && next dev -p 3230',
    env: { SNAP_FORGE_DB: E2E_DB },
    url: `http://localhost:${PORT}/api/status`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
