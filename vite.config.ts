import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['cavi']
  },
  server: {
    host: '0.0.0.0',
    fs: {
      allow: ['..']
    }
  },
  assetsInclude: ['**/*.wasm']
})
