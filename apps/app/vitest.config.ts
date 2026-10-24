import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Unit tests of what in the app runs without a request — today the
 * feature-flag ladder (`src/lib/feature-flags/resolve.ts`). Nothing here
 * renders a component or reaches the API.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
