import { defineConfig } from 'vite'

export default defineConfig({
  base: '/cavijs/',
  optimizeDeps: {
    exclude: ['cavi']
  },
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        basic: './demo-basic.html',
        jackPlug: './demo-jack-plug.html',
        patchbay: './demo-patchbay.html',
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
