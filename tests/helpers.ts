import fs from 'node:fs';
import path from 'node:path';
import { type IndexResult, indexRepository } from '@vectora/repository-indexer';

export const ROOT = path.resolve(__dirname, '..');
export const SAMPLE = path.join(ROOT, 'samples', 'sample-repo');
/** Scratch space for tests, inside the project so nothing is written to the system drive. */
export const TMP = path.join(ROOT, '.bench-tmp', 'tests');

let cached: Promise<IndexResult> | null = null;
export function indexSample(): Promise<IndexResult> {
  cached ??= indexRepository({ repositoryId: 'sample', repositoryName: 'Orbit Notes', rootDir: SAMPLE, inProcess: true });
  return cached;
}

export function tempDir(name: string): string {
  const dir = path.join(TMP, `${name}-${process.pid}-${Date.now().toString(36)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

export function copySample(name: string): string {
  const dir = tempDir(name);
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}
