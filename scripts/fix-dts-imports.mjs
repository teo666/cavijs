/**
 * Gives the relative imports of the generated declarations (dist-lib/types)
 * the extension Node's ESM resolution wants: `./wire` becomes `./wire.js`,
 * `./core` (a folder) `./core/index.js`. The sources import without
 * extensions (moduleResolution "bundler"); left as they are, a consumer
 * with moduleResolution "node16"/"nodenext" can't resolve them, and with
 * skipLibCheck gets every type as `any` without a word. Run by build:lib.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist-lib/types');
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\2/g;

/** `specifier`, imported from `file`, with the extension it needs. */
function withExtension(file, specifier) {
  if (/\.(js|mjs|cjs|json)$/.test(specifier)) return specifier;
  const target = resolve(dirname(file), specifier);
  if (existsSync(`${target}.d.ts`)) return `${specifier}.js`;
  if (existsSync(join(target, 'index.d.ts'))) return `${specifier}/index.js`;
  throw new Error(`${file}: cannot resolve ${specifier}`);
}

function* declarations(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* declarations(path);
    else if (name.endsWith('.d.ts')) yield path;
  }
}

let changed = 0;
for (const file of declarations(root)) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(
    SPECIFIER,
    (_, lead, quote, specifier) => `${lead}${quote}${withExtension(file, specifier)}${quote}`
  );
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
  }
}
console.log(`fix-dts-imports: ${changed} declaration files updated in ${root}`);
