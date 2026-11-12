/**
 * Python adapter. Delegates parsing to the Python standard-library `ast`
 * module through a helper script. The analysed code is parsed only — it is
 * never imported or executed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { assetPath } from './assets';
import {
  type AnalyzeContext,
  type FileFacts,
  type LanguageAdapter,
  type SourceFileInput,
  emptyFacts,
} from './types';

const BATCH_SIZE = 200;
let cachedCommand: { cmd: string; args: string[] } | null | undefined;

/** Finds a Python 3 interpreter. Returns null when none is installed. */
export function findPython(preferred?: string): { cmd: string; args: string[] } | null {
  if (cachedCommand !== undefined && !preferred) return cachedCommand;
  const candidates: { cmd: string; args: string[] }[] = [];
  if (preferred) candidates.push({ cmd: preferred, args: [] });
  if (process.env.VECTORA_PYTHON) candidates.push({ cmd: process.env.VECTORA_PYTHON, args: [] });
  candidates.push({ cmd: 'python3', args: [] }, { cmd: 'python', args: [] }, { cmd: 'py', args: ['-3'] });
  for (const c of candidates) {
    try {
      const r = spawnSync(c.cmd, [...c.args, '-c', 'import sys; print(sys.version_info[0])'], {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
      });
      if (r.status === 0 && r.stdout.trim() === '3') {
        if (!preferred) cachedCommand = c;
        return c;
      }
    } catch {
      // try next candidate
    }
  }
  if (!preferred) cachedCommand = null;
  return null;
}

function runBatch(
  py: { cmd: string; args: string[] },
  script: string,
  batch: SourceFileInput[],
): Promise<Map<string, Partial<FileFacts>>> {
  return new Promise((resolve, reject) => {
    // -I: isolated mode, so the interpreter does not pick up modules from the analysed repository.
    const child = spawn(py.cmd, [...py.args, '-I', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8').slice(0, 2000)));
    child.on('error', reject);
    child.on('close', (code) => {
      const out = new Map<string, Partial<FileFacts>>();
      for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as Partial<FileFacts> & { path: string };
          out.set(obj.path, obj);
        } catch {
          // ignore a malformed line; the file is reported as not analysed below
        }
      }
      if (code !== 0 && out.size === 0)
        reject(new Error(`Python analysis exited with code ${code}: ${stderr.trim()}`));
      else resolve(out);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(batch.map((f) => ({ path: f.path, abs: f.absPath }))));
  });
}

export function createPythonAdapter(): LanguageAdapter {
  return {
    id: 'python',
    technique: 'Python standard-library ast module',
    scope: 'file',
    languages: [{ id: 'python', name: 'Python', tier: 1, extensions: ['.py', '.pyi'] }],
    async analyze(files: SourceFileInput[], ctx: AnalyzeContext): Promise<FileFacts[]> {
      if (files.length === 0) return [];
      const py = findPython(ctx.pythonCommand);
      if (!py) {
        return files.map((f) => {
          const facts = emptyFacts(f, 'python');
          facts.errors.push({
            path: f.path,
            message: 'No Python 3 interpreter found; Python files were not analysed',
            severity: 'error',
          });
          return facts;
        });
      }
      const script = assetPath('python', 'extract.py');
      const results: FileFacts[] = [];
      let done = 0;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        let parsed: Map<string, Partial<FileFacts>>;
        try {
          parsed = await runBatch(py, script, batch);
        } catch (err) {
          for (const f of batch) {
            const facts = emptyFacts(f, 'python');
            facts.errors.push({ path: f.path, message: (err as Error).message, severity: 'error' });
            results.push(facts);
          }
          done += batch.length;
          ctx.onProgress?.(done, files.length);
          continue;
        }
        for (const f of batch) {
          const p = parsed.get(f.path);
          const facts = emptyFacts(f, 'python', p?.lineCount ?? 0);
          if (p) {
            facts.symbols = p.symbols ?? [];
            facts.imports = p.imports ?? [];
            facts.references = p.references ?? [];
            facts.errors = p.errors ?? [];
          } else {
            facts.errors.push({ path: f.path, message: 'No analysis result returned', severity: 'error' });
          }
          // Dotted module name derived from the path: `pkg/sub/mod.py` -> `pkg.sub.mod`.
          facts.moduleName = f.path
            .replace(/\.pyi?$/, '')
            .replace(/\/__init__$/, '')
            .replace(/\//g, '.');
          results.push(facts);
        }
        done += batch.length;
        ctx.onProgress?.(done, files.length);
      }
      return results;
    },
  };
}
