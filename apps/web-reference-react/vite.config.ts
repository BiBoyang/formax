import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const appRoot = fileURLToPath(new URL('.', import.meta.url))
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  plugins: [tailwindcss()],
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'react-resizable-panels': fileURLToPath(
        new URL('./node_modules/react-resizable-panels/dist/react-resizable-panels.browser.esm.js', import.meta.url),
      ),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3781,
    fs: {
      allow: [appRoot, workspaceRoot],
    },
  },
})
