import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ENGINE_PORT } from '@vectora/shared';

export interface EngineConfig {
  host: string;
  port: number;
  /** Database, imported sources, uploads and temporary files all live here. */
  dataDir: string;
  /** Browser origins allowed in addition to the engine's own origin. */
  allowedOrigins: string[];
  logLevel: string;
  /** Built web application to serve, when present. */
  webDist: string | null;
  sampleDir: string | null;
  installRoot: string;
  production: boolean;
  /** Replaceable network transport (tests supply a stub; nothing else should). */
  fetch?: typeof fetch;
}

/** Walks up from this file to the VECTORA installation root. */
export function findInstallRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        if ((JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string }).name === 'vectora') return dir;
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function loadConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  const env = process.env;
  const installRoot = overrides.installRoot ?? findInstallRoot();
  const webDist =
    [path.join(installRoot, 'dist', 'web'), path.join(installRoot, 'apps', 'web', 'dist')].find((d) =>
      fs.existsSync(path.join(d, 'index.html')),
    ) ?? null;
  const sampleDir =
    [
      path.join(installRoot, 'samples', 'sample-repo'),
      path.join(installRoot, 'dist', 'samples', 'sample-repo'),
    ].find((d) => fs.existsSync(d)) ?? null;
  const port = Number(env.VECTORA_PORT ?? DEFAULT_ENGINE_PORT);
  return {
    host: env.VECTORA_HOST ?? '127.0.0.1',
    port: Number.isFinite(port) ? port : DEFAULT_ENGINE_PORT,
    // Kept inside the installation folder by default so nothing is written to the system drive.
    dataDir: path.resolve(env.VECTORA_DATA_DIR ?? path.join(installRoot, '.vectora-data')),
    allowedOrigins: (env.VECTORA_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: env.VECTORA_LOG_LEVEL ?? 'info',
    webDist,
    sampleDir,
    installRoot,
    production: env.NODE_ENV === 'production',
    ...overrides,
  };
}
