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
  },
});
