import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/core/src/**/*.test.ts', 'packages/core/src/**/*.test.tsx'],
    setupFiles: ['scripts/vitestSessionIsolation.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'packages/core/src/entrypoints/**',
      ],
    },
  },
})
