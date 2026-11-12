// Starts the local engine and the Vite dev server together. Ctrl+C stops both.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => path.join(root, 'node_modules', name);
const children = [
  spawn(process.execPath, ['--import', 'tsx', '--watch-path', 'apps/local-engine/src', '--watch-path', 'packages', 'apps/local-engine/src/main.ts'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [path.join(bin('vite'), 'bin', 'vite.js'), '--config', 'apps/web/vite.config.ts'], { cwd: root, stdio: 'inherit' }),
];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
};
for (const c of children) c.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
