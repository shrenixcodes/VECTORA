// Production build: web application, then the engine bundle. Written as a script so it
// behaves the same in every shell (cmd, PowerShell, bash).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run([
  path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  'build',
  '--config',
  'apps/web/vite.config.ts',
]);
run([path.join(root, 'scripts', 'build-engine.mjs')]);
