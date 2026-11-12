// Bundles the local engine for release: dist/engine/server.mjs plus the analysis worker,
// grammars, the Python helper and the sample repository.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'engine');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Packages that load files from their own folder at run time stay external and are resolved from node_modules.
const external = ['typescript', 'web-tree-sitter', 'node:*'];
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  sourcemap: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  // Some dependencies are CommonJS and expect `require` to exist.
  banner: { js: "import { createRequire as __vectoraCreateRequire } from 'node:module'; const require = __vectoraCreateRequire(import.meta.url);" },
  logLevel: 'warning',
};
await build({ ...common, entryPoints: [path.join(root, 'apps/local-engine/src/main.ts')], outfile: path.join(out, 'server.mjs') });
await build({ ...common, entryPoints: [path.join(root, 'packages/repository-indexer/src/analyze-worker.ts')], outfile: path.join(out, 'analyze-worker.mjs') });

const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
copy('packages/language-adapters/grammars', 'grammars');
copy('packages/language-adapters/python', 'python');
fs.rmSync(path.join(out, 'python', '__pycache__'), { recursive: true, force: true });

const size = (f) => `${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} kB`;
console.log(`engine bundle: dist/engine/server.mjs (${size('server.mjs')}), analyze-worker.mjs (${size('analyze-worker.mjs')})`);
