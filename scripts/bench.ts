/**
 * Performance benchmarks. Generates synthetic repositories inside the project
 * folder (.bench-tmp), indexes them and measures duration, memory and CPU.
 *
 *   npm run bench                 # 1,000 and 5,000 files + the 50k/100k graph
 *   npm run bench -- --sizes 1000,5000,10000
 *   npm run bench -- --skip-graph
 *
 * Results are written to docs/benchmarks/latest.json. They describe this
 * machine only; they are measurements, not guarantees.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, assignCommunities, buildIndex, exportJson, findCycles } from '@vectora/graph-engine';
import { layout3d } from '@vectora/graph-layout';
import {
  type GraphEdge,
  type GraphNode,
  type KnowledgeGraph,
  SCHEMA_VERSION,
  computeStats,
  edgeId,
  validateGraph,
} from '@vectora/graph-schema';
import { type IndexResult, indexRepository } from '@vectora/repository-indexer';
import { SearchIndex } from '@vectora/search';

const root = path.resolve(import.meta.dirname, '..');
const work = path.join(root, '.bench-tmp', 'bench');
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? '');
};
const sizes = (flag('--sizes') || '1000,5000').split(',').map(Number).filter(Boolean);
if (args.length) console.log(`arguments: ${args.join(' ')}`);
const concurrency = Number(flag('--workers') ?? 4);

/** A repository with `n` files: 70% TypeScript, 30% Python, each importing and calling a few others. */
function generate(n: number): string {
  const dir = path.join(work, `repo-${n}`);
  if (
    fs.existsSync(path.join(dir, '.generated')) &&
    fs.readFileSync(path.join(dir, '.generated'), 'utf8') === String(n)
  )
    return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  const tsCount = Math.round(n * 0.7);
  const pyCount = n - tsCount;
  const modules = Math.max(4, Math.round(Math.sqrt(n) / 2));
  const tsPath = (i: number) => `src/mod${i % modules}/part${Math.floor(i / modules) % 12}/file${i}.ts`;
  for (let i = 0; i < tsCount; i++) {
    const p = path.join(dir, tsPath(i));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const deps = [(i * 7 + 1) % tsCount, (i * 13 + 5) % tsCount, (i + 1) % tsCount].filter(
      (d, k, a) => d !== i && a.indexOf(d) === k,
    );
    const rel = (d: number) => {
      const r = path.posix.relative(path.posix.dirname(tsPath(i)), tsPath(d)).replace(/\.ts$/, '');
      return r.startsWith('.') ? r : `./${r}`;
    };
    fs.writeFileSync(
      p,
      [
        ...deps.map((d) => `import { compute${d}, Service${d} } from '${rel(d)}';`),
        '',
        `export interface Options${i} { level: number; label: string }`,
        `export const LIMIT_${i} = ${i % 97};`,
        `/** Computes value ${i}. */`,
        `export function compute${i}(input: number): number {`,
        `  if (input <= 0) return LIMIT_${i};`,
        `  return ${deps.length ? deps.map((d) => `compute${d}(input - 3)`).join(' + ') : 'input'} + helper${i}(input);`,
        '}',
        `function helper${i}(x: number): number { return x * 2 + LIMIT_${i}; }`,
        `export class Service${i} {`,
        `  private options: Options${i} = { level: ${i % 5}, label: 'service-${i}' };`,
        ...(deps[0] !== undefined ? [`  private peer = new Service${deps[0]}();`] : []),
        `  run(value: number): number { return compute${i}(value) + this.options.level; }`,
        `  describe(): string { return this.options.label${deps[0] !== undefined ? ' + this.peer.describe()' : ''}; }`,
        '}',
        '',
      ].join('\n'),
    );
  }
  for (let i = 0; i < pyCount; i++) {
    const p = path.join(dir, `py/pkg${i % modules}/module${i}.py`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const init = path.join(path.dirname(p), '__init__.py');
    if (!fs.existsSync(init)) fs.writeFileSync(init, '');
    const d = (i * 11 + 3) % pyCount;
    fs.writeFileSync(
      p,
      [
        `"""Module ${i}."""`,
        ...(d !== i ? [`from py.pkg${d % modules}.module${d} import transform${d}, Worker${d}`] : []),
        '',
        `THRESHOLD_${i} = ${i % 41}`,
        '',
        `def transform${i}(value):`,
        `    """Transforms a value."""`,
        `    if value <= 0:`,
        `        return THRESHOLD_${i}`,
        `    return ${d !== i ? `transform${d}(value - 2)` : 'value'} + scale${i}(value)`,
        '',
        `def scale${i}(value):`,
        `    return value * 3`,
        '',
        `class Worker${i}:`,
        `    def __init__(self):`,
        `        self.peer = ${d !== i ? `Worker${d}()` : 'None'}`,
        '',
        `    def run(self, value):`,
        `        return transform${i}(value)`,
        '',
      ].join('\n'),
    );
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `bench-${n}`, version: '1.0.0' }));
  fs.writeFileSync(path.join(dir, '.generated'), String(n));
  return dir;
}

interface Measured<T> {
  value: T;
  ms: number;
  peakRssMb: number;
  cpuPercent: number;
}

/** Runs `fn` while sampling resident memory; CPU is process time over wall time across all cores. */
async function measure<T>(fn: () => Promise<T> | T): Promise<Measured<T>> {
  global.gc?.();
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  try {
    const value = await fn();
    const ms = performance.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    peak = Math.max(peak, process.memoryUsage().rss);
    return {
      value,
      ms: Math.round(ms),
      peakRssMb: Math.round(peak / 1048576),
      cpuPercent: Math.round(((cpu.user + cpu.system) / 1000 / ms / os.cpus().length) * 1000) / 10,
    };
  } finally {
    clearInterval(timer);
  }
}

const results: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  machine: {
    cpu: os.cpus()[0]?.model.trim(),
    logicalCores: os.cpus().length,
    memoryGb: Math.round((os.totalmem() / 1073741824) * 10) / 10,
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
  },
  settings: { workers: concurrency },
  indexing: [] as unknown[],
};
const row = (cells: (string | number)[]) =>
  console.log(cells.map((c, i) => String(c).padStart(i === 0 ? 22 : 12)).join(''));

console.log(
  `\nVECTORA benchmarks — ${os.cpus().length} logical cores, ${(os.totalmem() / 1073741824).toFixed(1)} GB RAM, Node ${process.version}\n`,
);
row(['indexing', 'files', 'symbols', 'edges', 'ms', 'peak MB', 'CPU %']);
for (const n of sizes) {
  const dir = generate(n);
  const base = {
    repositoryId: `bench-${n}`,
    repositoryName: `bench-${n}`,
    rootDir: dir,
    concurrency,
    maxFiles: 200000,
  };
  let full: Measured<IndexResult>;
  try {
    full = await measure(() => indexRepository(base));
  } catch (err) {
    console.log(`  ${n} files: failed — ${(err as Error).message}`);
    (results.indexing as unknown[]).push({ files: n, error: (err as Error).message });
    continue;
  }
  const g = full.value.graph;
  row([`full index`, n, g.stats.symbolCount, g.stats.edgeCount, full.ms, full.peakRssMb, full.cpuPercent]);

  const previous = new Map(full.value.facts.map((f) => [f.path, { hash: f.hash, facts: f.facts }]));
  const unchanged = await measure(() =>
    indexRepository({ ...base, previous, previousFingerprint: full.value.analysis.fingerprint ?? '' }),
  );
  row([`re-index, no change`, n, '', '', unchanged.ms, unchanged.peakRssMb, unchanged.cpuPercent]);

  // Touch one TypeScript file that others depend on.
  const target = path.join(dir, 'src/mod1/part0/file1.ts');
  const original = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, `${original}\nexport function added1(): number { return LIMIT_1; }\n`);
  const incremental = await measure(() => indexRepository({ ...base, previous }));
  fs.writeFileSync(target, original);
  row([`re-index, 1 file`, n, '', '', incremental.ms, incremental.peakRssMb, incremental.cpuPercent]);

  const dbFile = path.join(work, `bench-${n}.db`);
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
  const store = new Store(dbFile);
  const save = await measure(() => store.saveGraph(`bench-${n}`, g));
  const load = await measure(() => store.loadGraph(`bench-${n}`));
  store.close();
  row([`save / load graph`, n, '', '', `${save.ms}/${load.ms}`, load.peakRssMb, '']);

  (results.indexing as unknown[]).push({
    files: n,
    nodes: g.stats.nodeCount,
    symbols: g.stats.symbolCount,
    relationships: g.stats.edgeCount,
    unresolved: g.stats.unresolvedCount,
    validationErrors: full.value.analysis.validation.errors,
    fullIndex: { ms: full.ms, peakRssMb: full.peakRssMb, cpuPercent: full.cpuPercent },
    reindexNoChange: { ms: unchanged.ms, detectedUnchanged: 'unchanged' in unchanged.value },
    reindexOneFile: {
      ms: incremental.ms,
      analyzedFiles: incremental.value.analysis.summary.analyzedFiles,
      reusedFiles: incremental.value.analysis.summary.reusedFiles,
    },
    saveGraphMs: save.ms,
    loadGraphMs: load.ms,
    databaseMb: Math.round((fs.statSync(dbFile).size / 1048576) * 10) / 10,
  });
}

if (!args.includes('--skip-graph')) {
  // ---- 50,000 symbols / 100,000 relationships, generated directly as a graph ----
  console.log('');
  const SYMBOLS = 50_000;
  const FILES = 2_500;
  const SUBS = 20;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const mk = (
    id: string,
    name: string,
    type: GraphNode['type'],
    filePath: string | null,
    metadata: Record<string, unknown> = {},
  ): GraphNode => ({
    id,
    name,
    type,
    repositoryId: 'big',
    filePath,
    location: filePath ? { path: filePath, startLine: 1, endLine: 10 } : null,
    language: 'typescript',
    metadata,
    extractionMethod: 'filesystem',
    confidence: 1,
    verified: true,
  });
  const link = (type: GraphEdge['type'], s: string, t: string) =>
    edges.push({
      id: `${edgeId(type, s, t)}#${edges.length}`,
      source: s,
      target: t,
      type,
      evidence: 'synthetic',
      location: null,
      extractionMethod: 'filesystem',
      confidence: 1,
      verified: true,
    });
  nodes.push(mk('repo:root', 'big', 'Repository', null));
  for (let s = 0; s < SUBS; s++) nodes.push(mk(`sub:s${s}`, `Subsystem ${s}`, 'Subsystem', `s${s}`));
  for (let f = 0; f < FILES; f++) {
    nodes.push(
      mk(`file:s${f % SUBS}/f${f}.ts`, `f${f}.ts`, 'File', `s${f % SUBS}/f${f}.ts`, {
        subsystem: `sub:s${f % SUBS}`,
      }),
    );
    link('BELONGS_TO', `file:s${f % SUBS}/f${f}.ts`, `sub:s${f % SUBS}`);
  }
  for (let i = 0; i < SYMBOLS; i++) {
    const f = i % FILES;
    const fp = `s${f % SUBS}/f${f}.ts`;
    nodes.push(
      mk(`sym:${fp}#fn${i}`, `handleRequest${i}`, i % 9 === 0 ? 'Class' : 'Function', fp, {
        subsystem: `sub:s${f % SUBS}`,
        qualifiedName: `fn${i}`,
      }),
    );
    link('CONTAINS', `file:${fp}`, `sym:${fp}#fn${i}`);
  }
  const symId = (i: number) => {
    const f = i % FILES;
    return `sym:s${f % SUBS}/f${f}.ts#fn${i}`;
  };
  let seed = 99;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  while (edges.length < 100_000) {
    const a = Math.floor(rnd() * SYMBOLS);
    // Most calls stay within a subsystem, as in real code.
    const b = rnd() < 0.8 ? (a + Math.floor(rnd() * 40) * SUBS) % SYMBOLS : Math.floor(rnd() * SYMBOLS);
    if (a !== b) link('CALLS', symId(a), symId(b));
  }
  const graph: KnowledgeGraph = {
    schemaVersion: SCHEMA_VERSION,
    repositoryId: 'big',
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    stats: computeStats(nodes, edges),
  };
  const repo = {
    id: 'big',
    name: 'big',
    sourceKind: 'local' as const,
    origin: 'synthetic',
    branch: null,
    subdirectory: null,
    status: 'ready' as const,
    createdAt: '',
    lastIndexedAt: null,
    fileCount: FILES,
    symbolCount: SYMBOLS,
    relationshipCount: edges.length,
    error: null,
  };
  row(['graph operation', 'nodes', 'symbols', 'edges', 'ms', 'peak MB', 'CPU %']);
  const out: Record<string, unknown> = {
    nodes: nodes.length,
    symbols: graph.stats.symbolCount,
    relationships: edges.length,
  };
  const step = async (name: string, key: string, fn: () => unknown) => {
    const m = await measure(async () => fn());
    row([name, nodes.length, graph.stats.symbolCount, edges.length, m.ms, m.peakRssMb, m.cpuPercent]);
    out[key] = { ms: m.ms, peakRssMb: m.peakRssMb };
    return m.value;
  };
  await step('validate', 'validate', () => validateGraph(graph));
  await step('adjacency index', 'index', () => buildIndex(graph));
  await step('communities', 'communities', () => assignCommunities(nodes, edges));
  const idx = buildIndex(graph);
  await step('cycle detection', 'cycles', () => findCycles(idx, ['CALLS']));
  const search = (await step('search index', 'searchIndex', () => new SearchIndex(nodes))) as SearchIndex;
  await step('search query x50', 'search50', () => {
    for (let i = 0; i < 50; i++) search.search(`handleRequest${i * 37}`, { limit: 20 });
  });
  await step('3D layout (all)', 'layout3d', () =>
    layout3d(
      nodes.map((n) => ({
        id: n.id,
        role:
          n.type === 'Repository'
            ? 'repository'
            : n.type === 'Subsystem'
              ? 'subsystem'
              : n.type === 'File'
                ? 'file'
                : 'symbol',
        subsystem: (n.metadata.subsystem as string) ?? null,
        parent: n.filePath ? `file:${n.filePath}` : null,
      })),
      [],
      { quality: 0.6 },
    ),
  );
  const dbFile = path.join(work, 'bench-big.db');
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
  const store = new Store(dbFile);
  await step('save to SQLite', 'save', () => store.saveGraph('big', graph));
  await step('load from SQLite', 'load', () => store.loadGraph('big'));
  await step('load structure only', 'loadStructure', () =>
    store.loadGraph('big', { types: ['Repository', 'Subsystem', 'File'] }),
  );
  store.close();
  out.databaseMb = Math.round((fs.statSync(dbFile).size / 1048576) * 10) / 10;
  const json = (await step('export JSON', 'exportJson', () => exportJson(repo, graph))) as string;
  out.exportJsonMb = Math.round((json.length / 1048576) * 10) / 10;
  results.largeGraph = out;
}

const outFile = path.join(root, 'docs', 'benchmarks', 'latest.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
// Merge with earlier runs of other sizes so one file holds every measured size.
let merged = results;
if (fs.existsSync(outFile) && args.includes('--merge')) {
  const prev = JSON.parse(fs.readFileSync(outFile, 'utf8')) as typeof results;
  const byFiles = new Map<number, unknown>(
    ((prev.indexing as { files: number }[]) ?? []).map((r) => [r.files, r]),
  );
  for (const r of results.indexing as { files: number }[]) byFiles.set(r.files, r);
  merged = {
    ...prev,
    ...results,
    indexing: [...byFiles.values()].sort(
      (a, b) => (a as { files: number }).files - (b as { files: number }).files,
    ),
    largeGraph: results.largeGraph ?? prev.largeGraph,
  };
}
fs.writeFileSync(outFile, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`\nWritten to ${path.relative(root, outFile)}`);
