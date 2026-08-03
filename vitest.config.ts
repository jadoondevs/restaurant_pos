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
        // node:sqlite was added to Node in v22.5.0 (2024) and is not in
        // Vite 5.x's hardcoded built-in list. vite-node strips the node:
        // prefix and tries to resolve 'sqlite' as an npm package, failing
        // with "Failed to load url sqlite". Externalizing it here tells
        // vite-node to bypass its resolution pipeline and load the module
        // directly via Node's native module system.
        external: ['node:sqlite'],
      },
    },
  },
});
