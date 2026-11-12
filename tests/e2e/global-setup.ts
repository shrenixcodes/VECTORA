import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const E2E_PORT = 4399;

/**
 * Starts the production engine bundle on an empty data directory (kept inside the
 * project folder) and stops it when the run ends. The process is started directly,
 * without a shell, so the run does not depend on the machine's shell configuration.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const server = path.join(root, 'dist', 'engine', 'server.mjs');
  if (!fs.existsSync(server) || !fs.existsSync(path.join(root, 'dist', 'web', 'index.html')))
    throw new Error('No production build found. Run "npm run build" before "npm run test:e2e".');
  const dataDir = path.join(root, '.bench-tmp', 'e2e-data');
  fs.rmSync(dataDir, { recursive: true, force: true });

  const child: ChildProcess = spawn(process.execPath, [server], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      VECTORA_PORT: String(E2E_PORT),
      VECTORA_DATA_DIR: dataDir,
      VECTORA_LOG_LEVEL: 'warn',
      NODE_ENV: 'production',
    },
  });
  let exited = false;
  child.on('exit', () => (exited = true));
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited) throw new Error('The engine stopped while starting. Is port 4399 in use?');
    try {
      if ((await fetch(`http://127.0.0.1:${E2E_PORT}/api/health`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('The engine did not start within 60 seconds');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return async () => {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
  };
}
