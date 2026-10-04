import { defineConfig } from 'vitest/config'

/**
 * Kept separate from `vite.config.ts` on purpose: that one pulls in `vite-plugin-electron`, which
 * would try to boot Electron for every test run.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    // Each suite gets a throwaway game directory, so files must never leak between them.
    isolate: true,
    restoreMocks: true
  }
})