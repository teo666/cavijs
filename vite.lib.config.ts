import { defineConfig } from 'vite';

/**
 * Library build (`pnpm build:lib`): bundles the two entry points as ES
 * modules into dist-lib/, separate from the demo-site build in
 * vite.config.ts — src/index.ts as cavijs.js (everything, custom elements
 * included) and src/core/index.ts as core.js (`cavijs/core`: the
 * simulation alone, no DOM), sharing a chunk for the code both use.
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
      entry: { cavijs: 'src/index.ts', core: 'src/core/index.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: ['cavi'],
      output: { chunkFileNames: 'shared-[hash].js' },
    },
  },
});
