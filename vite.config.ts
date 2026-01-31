import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['cavi']
  },
  server: {
    fs: {
      allow: ['..']
    }
  },
  assetsInclude: ['**/*.wasm']
})
