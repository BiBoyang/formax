import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['scripts/vitestSessionIsolation.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'src/entrypoints/**',
        'src/screens/ToolExamplesScreen.tsx',
        'src/screens/LoadingExampleScreen.tsx',
      ],
    },
  },
})
