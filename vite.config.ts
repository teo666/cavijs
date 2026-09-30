import { defineConfig } from 'vite';

export default defineConfig({
  // Demo/example pages live in examples/ (src/ contains only the library).
  root: 'examples',
  publicDir: '../public',
  base: '/cavijs/',
  optimizeDeps: {
    exclude: ['cavi'],
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      // Note: rollupOptions.input paths are resolved relative to the config
      // file's location (project root), not to the `root` option above.
      input: {
        main: './examples/index.html',
        basic: './examples/demo-basic.html',
        svg: './examples/demo-svg.html',
        jackPlug: './examples/demo-jack-plug.html',
        patchbay: './examples/demo-patchbay.html',
        patchbaySvg: './examples/demo-patchbay-svg.html',
        noopInteraction: './examples/demo-noop-interaction.html',
        patchbayZoom: './examples/demo-patchbay-zoom.html',
        patchbayZoomSvg: './examples/demo-patchbay-zoom-svg.html',
        d3Interaction: './examples/demo-d3-interaction.html',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    fs: {
      allow: ['..'],
    },
  },
  assetsInclude: ['**/*.wasm'],
});
