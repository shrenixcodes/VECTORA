/**
 * Bounded worker pool for syntax analysis. Each task is one adapter run over
 * a batch of files. Falls back to in-process analysis when worker threads
 * cannot be started.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { type AnalyzeContext, type FileFacts, type SourceFileInput, type WorkspacePackage, createAdapters, emptyFacts } from '@vectora/language-adapters';

export interface AnalyzeTask {
  adapterId: string;
  files: SourceFileInput[];
  /** Files the adapter must return facts for (subset of `files`); all when omitted. */
  analyzeOnly?: string[];
}

export interface TaskContext {
  rootDir: string;
  allFiles: string[];
  workspacePackages: WorkspacePackage[];
  pythonCommand?: string;
}

export interface WorkerRequest {
  taskIndex: number;
  task: AnalyzeTask;
  ctx: TaskContext;
}
export type WorkerResponse =
  | { type: 'progress'; taskIndex: number; processed: number; total: number }
  | { type: 'done'; taskIndex: number; facts: FileFacts[] }
  | { type: 'error'; taskIndex: number; message: string };

export async function runTaskInProcess(task: AnalyzeTask, ctx: TaskContext, onProgress?: (processed: number, total: number) => void): Promise<FileFacts[]> {
  const adapter = createAdapters().find((a) => a.id === task.adapterId);
  if (!adapter) throw new Error(`Unknown adapter ${task.adapterId}`);
  const actx: AnalyzeContext = {
    rootDir: ctx.rootDir,
    allFiles: new Set(ctx.allFiles),
    analyzeOnly: task.analyzeOnly ? new Set(task.analyzeOnly) : undefined,
    workspacePackages: ctx.workspacePackages,
    pythonCommand: ctx.pythonCommand,
    onProgress,
  };
  return adapter.analyze(task.files, actx);
}

function workerEntry(): { file: string; execArgv: string[] } | null {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  if (here.endsWith('.ts')) {
    const file = path.join(dir, 'analyze-worker.ts');
    return fs.existsSync(file) ? { file, execArgv: ['--import', 'tsx'] } : null;
  }
  const file = path.join(dir, 'analyze-worker.mjs');
  return fs.existsSync(file) ? { file, execArgv: [] } : null;
}

const failedFacts = (task: AnalyzeTask, message: string): FileFacts[] =>
  task.files
    .filter((f) => !task.analyzeOnly || task.analyzeOnly.includes(f.path))
    .map((f) => {
      const facts = emptyFacts(f, task.adapterId);
      facts.errors.push({ path: f.path, message, severity: 'error' });
      return facts;
    });

export interface RunOptions {
  concurrency: number;
  inProcess?: boolean;
  onProgress?: (processed: number, total: number) => void;
}

export async function runTasks(tasks: AnalyzeTask[], ctx: TaskContext, opts: RunOptions): Promise<{ facts: FileFacts[]; usedWorkers: boolean }> {
  const totals = tasks.map((t) => (t.analyzeOnly ? t.analyzeOnly.length : t.files.length));
  const total = totals.reduce((a, b) => a + b, 0);
  const progress = tasks.map(() => 0);
  const report = (i: number, processed: number) => {
    progress[i] = Math.min(processed, totals[i]!);
    opts.onProgress?.(
      progress.reduce((a, b) => a + b, 0),
      total,
    );
  };
  const results: FileFacts[][] = tasks.map(() => []);
  if (tasks.length === 0) return { facts: [], usedWorkers: false };

  const inProcessAll = async () => {
    for (let i = 0; i < tasks.length; i++) {
      try {
        results[i] = await runTaskInProcess(tasks[i]!, ctx, (p) => report(i, p));
      } catch (err) {
        results[i] = failedFacts(tasks[i]!, `Analysis failed: ${(err as Error).message}`);
      }
      report(i, totals[i]!);
    }
    return { facts: results.flat(), usedWorkers: false };
  };

  const entry = opts.inProcess ? null : workerEntry();
  if (!entry) return inProcessAll();

  // Python analysis already runs in a separate interpreter process; keep it on the main thread.
  const pending = tasks.map((_, i) => i);
  const mainThread = pending.filter((i) => tasks[i]!.adapterId === 'python');
  const queue = pending.filter((i) => tasks[i]!.adapterId !== 'python');
  const mainWork = (async () => {
    for (const i of mainThread) {
      try {
        results[i] = await runTaskInProcess(tasks[i]!, ctx, (p) => report(i, p));
      } catch (err) {
        results[i] = failedFacts(tasks[i]!, `Analysis failed: ${(err as Error).message}`);
      }
      report(i, totals[i]!);
    }
  })();

  let startFailure = false;
  const workerCount = Math.max(1, Math.min(opts.concurrency, queue.length));
  const runWorker = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (queue.length === 0) return resolve();
      let worker: Worker;
      try {
        worker = new Worker(entry.file, { execArgv: entry.execArgv, resourceLimits: { maxOldGenerationSizeMb: 3072 } });
      } catch {
        startFailure = true;
        return resolve();
      }
      let current: number | null = null;
      let gotMessage = false;
      const next = () => {
        const i = queue.shift();
        if (i === undefined) {
          current = null;
          void worker.terminate();
          return resolve();
        }
        current = i;
        worker.postMessage({ taskIndex: i, task: tasks[i]!, ctx } satisfies WorkerRequest);
      };
      worker.on('message', (msg: WorkerResponse) => {
        gotMessage = true;
        if (msg.type === 'progress') report(msg.taskIndex, msg.processed);
        else {
          results[msg.taskIndex] = msg.type === 'done' ? msg.facts : failedFacts(tasks[msg.taskIndex]!, `Analysis failed: ${msg.message}`);
          report(msg.taskIndex, totals[msg.taskIndex]!);
          next();
        }
      });
      worker.on('error', (err) => {
        if (current !== null) {
          if (!gotMessage) {
            // The worker never came up: hand the task back and let the caller fall back.
            queue.unshift(current);
            startFailure = true;
          } else {
            results[current] = failedFacts(tasks[current]!, `Analysis worker stopped: ${err.message}`);
            report(current, totals[current]!);
          }
        }
        resolve();
      });
      next();
    });

  await Promise.all([mainWork, ...Array.from({ length: workerCount }, runWorker)]);
  if (startFailure && queue.length) {
    for (const i of queue.splice(0)) {
      try {
        results[i] = await runTaskInProcess(tasks[i]!, ctx, (p) => report(i, p));
      } catch (err) {
        results[i] = failedFacts(tasks[i]!, `Analysis failed: ${(err as Error).message}`);
      }
      report(i, totals[i]!);
    }
    return { facts: results.flat(), usedWorkers: false };
  }
  // Tasks left over because every worker died after starting.
  for (const i of queue.splice(0)) results[i] = failedFacts(tasks[i]!, 'Analysis worker stopped before this batch was processed');
  return { facts: results.flat(), usedWorkers: true };
}
