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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react'
          }
          if (id.includes('/@radix-ui/')) return 'vendor-radix'
          if (id.includes('/lucide-react/')) return 'vendor-icons'
          if (id.includes('/marked/') || id.includes('/dompurify/')) return 'vendor-markdown'
        },
      },
    },
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
