import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run in Node environment — no browser, no Electron.
    environment: 'node',
    // Glob for test files.
    include: ['tests/**/*.test.ts'],
    // Timeout per test (ms).
    testTimeout: 10_000,
    // Clear mocks between tests.
    clearMocks: true,
    restoreMocks: true,
    server: {
      deps: {
        // better-sqlite3 is a native Node addon (.node binary).
        // Vite cannot bundle native addons — it must be loaded directly
        // by Node's require() rather than processed through Vite's pipeline.
        // Without this, Vitest throws "Failed to load url better-sqlite3".
        external: ['better-sqlite3'],
      },
    },
  },
});
