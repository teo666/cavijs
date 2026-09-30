import { defineConfig } from 'vite';

/**
 * Library build (`pnpm build:lib`): bundles src/index.ts as an ES module
 * into dist-lib/, separate from the demo-site build in vite.config.ts.
 * `cavi` (the WASM package) stays external, so the consumer's bundler
 * resolves and serves its .wasm file itself.
 */
export default defineConfig({
  // public/ holds demo-site assets only.
  publicDir: false,
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'cavijs',
    },
    rollupOptions: {
      external: ['cavi'],
    },
  },
});
