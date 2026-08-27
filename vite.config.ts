import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['cavi']
  },
  build: {
    rollupOptions: {
      input: {
        app: './index3.html', // default
      },
    },
  },
  server: {
    host: '0.0.0.0',
    fs: {
      allow: ['..']
    }
  },
  assetsInclude: ['**/*.wasm']
})
