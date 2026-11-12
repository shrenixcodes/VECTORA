/**
 * The indexing pipeline: discovery → syntax analysis → relationship
 * resolution → execution flows → semantic organisation → graph generation.
 * Persistence (stage 7) is done by the caller with the returned result.
 */
import path from 'node:path';
import { type RepositoryAnalysis, assignCommunities } from '@vectora/graph-engine';
import { type KnowledgeGraph, SCHEMA_VERSION, computeStats, isSymbolType, normalizeGraph, validateGraph } from '@vectora/graph-schema';
import { type FileFacts, type SourceFileInput, SUPPORTED_LANGUAGES, createAdapters, languageName, languageTier } from '@vectora/language-adapters';
import type { IndexStage, IndexSummary } from '@vectora/shared';
import { readManifests } from './manifests';
import { organize } from './organize';
import { resolveGraph } from './resolve';
import { type ScannedFile, scanRepository } from './scan';
import { type AnalyzeTask, runTasks } from './workers';

export interface IndexOptions {
  repositoryId: string;
  repositoryName: string;
  rootDir: string;
  ignorePatterns?: string[];
  maxFileSizeBytes?: number;
  maxFiles?: number;
  disabledLanguages?: string[];
  concurrency?: number;
  /** Cached facts from the previous run, keyed by path. Enables incremental indexing. */
  previous?: Map<string, { hash: string; facts: FileFacts }>;
  inProcess?: boolean;
  pythonCommand?: string;
  onProgress?: (stage: IndexStage, message: string, processed: number, total: number) => void;
}

export interface IndexResult {
  graph: KnowledgeGraph;
  analysis: RepositoryAnalysis;
  facts: { path: string; hash: string; facts: FileFacts }[];
}

const TREE_SITTER_BATCH = 150;

export async function indexRepository(opts: IndexOptions): Promise<IndexResult> {
  const started = Date.now();
  const progress = opts.onProgress ?? (() => undefined);
  const rootDir = path.resolve(opts.rootDir);

  // ---- Stage 1: discovery -------------------------------------------------
  progress('discover', 'Scanning files', 0, 0);
  const scan = await scanRepository(rootDir, {
    ignorePatterns: opts.ignorePatterns,
    maxFileSizeBytes: opts.maxFileSizeBytes,
    maxFiles: opts.maxFiles,
    disabledLanguages: opts.disabledLanguages,
    onProgress: (p, t) => progress('discover', 'Reading files', p, t),
  });
  const files = scan.files;
  // A `.h` file is treated as C++ when the repository contains C++ sources.
  if (files.some((f) => f.language === 'cpp')) for (const f of files) if (f.language === 'c' && f.path.endsWith('.h')) f.language = 'cpp';
  const manifests = readManifests(rootDir, files);
  progress('discover', `${files.length} files`, files.length, files.length);

  // ---- Stage 2: syntax analysis ------------------------------------------
  const adapters = createAdapters();
  const adapterOf = (lang: string) => adapters.find((a) => a.languages.some((l) => l.id === lang));
  const previous = opts.previous ?? new Map<string, { hash: string; facts: FileFacts }>();
  const facts = new Map<string, FileFacts>();
  const byAdapter = new Map<string, ScannedFile[]>();
  for (const f of files) {
    if (!f.analyzable || !f.language) continue;
    const a = adapterOf(f.language);
    if (!a) continue;
    (byAdapter.get(a.id) ?? byAdapter.set(a.id, []).get(a.id)!).push(f);
  }
  const toInput = (f: ScannedFile): SourceFileInput => ({ path: f.path, absPath: f.absPath, language: f.language! });
  const currentPaths = new Set(files.map((f) => f.path));
  const tasks: AnalyzeTask[] = [];
  let reused = 0;

  for (const [adapterId, list] of byAdapter) {
    const adapter = adapters.find((a) => a.id === adapterId)!;
    const unchanged = (f: ScannedFile) => {
      const prev = previous.get(f.path);
      return prev && prev.hash === f.hash && prev.facts.adapter === adapterId && prev.facts.language === f.language ? prev.facts : null;
    };
    if (adapter.scope === 'file') {
      const todo: ScannedFile[] = [];
      for (const f of list) {
        const cached = unchanged(f);
        if (cached) {
          facts.set(f.path, cached);
          reused++;
        } else todo.push(f);
      }
      const byLang = new Map<string, ScannedFile[]>();
      for (const f of todo) (byLang.get(f.language!) ?? byLang.set(f.language!, []).get(f.language!)!).push(f);
      for (const group of byLang.values())
        for (let i = 0; i < group.length; i += TREE_SITTER_BATCH) tasks.push({ adapterId, files: group.slice(i, i + TREE_SITTER_BATCH).map(toInput) });
    } else {
      // Project-scope adapter: a file must be re-analysed when it changed or
      // when anything it resolved into changed, appeared or disappeared.
      const changed = new Set<string>();
      for (const f of list) if (!unchanged(f)) changed.add(f.path);
      const removed = new Set<string>();
      for (const p of previous.keys()) if (!currentPaths.has(p)) removed.add(p);
      const added = list.some((f) => !previous.has(f.path));
      const reanalyze = new Set(changed);
      if (changed.size || removed.size) {
        for (const f of list) {
          if (reanalyze.has(f.path)) continue;
          const prev = previous.get(f.path)!.facts;
          const touches = (p: string | null | undefined) => !!p && (changed.has(p) || removed.has(p));
          const dependsOnChange =
            prev.imports.some((i) => touches(i.resolvedPath) || (added && !i.resolvedPath && !i.builtin)) ||
            prev.references.some((r) => ('resolved' in r.target ? touches(r.target.resolved.path) : added));
          if (dependsOnChange) reanalyze.add(f.path);
        }
      }
      for (const f of list) {
        if (!reanalyze.has(f.path)) {
          facts.set(f.path, previous.get(f.path)!.facts);
          reused++;
        }
      }
      if (reanalyze.size) tasks.push({ adapterId, files: list.map(toInput), analyzeOnly: [...reanalyze] });
    }
  }

  const toAnalyze = tasks.reduce((a, t) => a + (t.analyzeOnly?.length ?? t.files.length), 0);
  progress('analyze', toAnalyze ? `Analysing ${toAnalyze} files` : 'All files unchanged', 0, toAnalyze);
  const run = await runTasks(
    tasks,
    { rootDir, allFiles: files.map((f) => f.path), workspacePackages: manifests.workspacePackages, pythonCommand: opts.pythonCommand },
    { concurrency: opts.concurrency ?? 4, inProcess: opts.inProcess, onProgress: (p, t) => progress('analyze', `Analysing ${t} files`, p, t) },
  );
  for (const ff of run.facts) facts.set(ff.path, ff);

  // ---- Stage 3: relationship resolution ----------------------------------
  progress('resolve', 'Resolving relationships', 0, 0);
  const resolved = resolveGraph({ repositoryId: opts.repositoryId, repositoryName: opts.repositoryName, files, facts, manifests });

  // ---- Stages 4–5: execution flows and semantic organisation -------------
  progress('flows', 'Tracing execution flows', 0, 0);
  const organized = organize(opts.repositoryId, opts.repositoryName, resolved.nodes, resolved.edges, manifests);
  progress('organize', `${organized.nodes.length} subsystems and concepts`, 0, 0);

  // ---- Stage 6: graph generation -----------------------------------------
  progress('graph', 'Validating graph', 0, 0);
  const normalized = normalizeGraph([...resolved.nodes, ...organized.nodes], [...resolved.edges, ...organized.edges]);
  const communities = assignCommunities(normalized.nodes, normalized.edges);
  const validation = validateGraph(normalized, { checkSchema: normalized.nodes.length <= 20000 });
  const stats = computeStats(normalized.nodes, normalized.edges, resolved.unresolvedCount);
  const generatedAt = new Date().toISOString();
  const graph: KnowledgeGraph = { schemaVersion: SCHEMA_VERSION, repositoryId: opts.repositoryId, generatedAt, nodes: normalized.nodes, edges: normalized.edges, stats };

  // ---- language coverage --------------------------------------------------
  const cov = new Map<string, RepositoryAnalysis['languages'][number]>();
  for (const f of files) {
    const lang = f.language ?? 'other';
    let c = cov.get(lang);
    if (!c) {
      const adapter = f.language ? adapterOf(f.language) : undefined;
      c = { language: lang, name: lang === 'other' ? 'Other' : languageName(lang), tier: languageTier(lang), files: 0, analyzedFiles: 0, symbols: 0, parseErrors: 0, adapter: adapter && f.analyzable ? adapter.technique : null, lines: 0 };
      cov.set(lang, c);
    }
    c.files++;
    c.lines += f.lineCount;
    const ff = facts.get(f.path);
    if (ff) {
      if (!ff.errors.some((e) => e.severity === 'error')) c.analyzedFiles++;
      c.symbols += ff.symbols.length;
      c.parseErrors += ff.errors.length;
    }
  }
  const parseIssues: RepositoryAnalysis['parseIssues'] = [];
  for (const ff of facts.values()) for (const e of ff.errors) if (parseIssues.length < 200) parseIssues.push(e);

  const summary: IndexSummary = {
    files: files.length,
    analyzedFiles: toAnalyze,
    reusedFiles: reused,
    symbols: normalized.nodes.filter((n) => isSymbolType(n.type)).length,
    relationships: normalized.edges.length,
    unresolved: resolved.unresolvedCount,
    parseErrors: parseIssues.length,
    durationMs: Date.now() - started,
    incremental: previous.size > 0,
  };
  const analysis: RepositoryAnalysis = {
    generatedAt,
    description: manifests.description,
    descriptionSource: manifests.descriptionSource,
    languages: [...cov.values()].sort((a, b) => (b.tier > 0 ? 1 : 0) - (a.tier > 0 ? 1 : 0) || b.files - a.files),
    frameworks: manifests.frameworks,
    entryPoints: organized.entryPoints,
    flows: organized.flows,
    declaredDependencies: manifests.dependencies.map((d) => ({ name: d.name, version: d.version, manifest: d.manifest, ecosystem: d.ecosystem, dev: d.dev, line: d.line })),
    unresolvedCount: resolved.unresolvedCount,
    unresolvedByReason: resolved.unresolvedByReason,
    unresolvedSamples: resolved.unresolved.slice(0, 500),
    validation: { errors: validation.errorCount, warnings: validation.warningCount, issues: validation.issues.slice(0, 50) },
    normalization: { removedNodes: normalized.removedNodes, mergedEdges: normalized.mergedEdges, droppedEdges: normalized.droppedEdges },
    skipped: scan.skipped,
    truncated: scan.truncated,
    parseIssues,
    communities,
    summary,
  };
  progress('graph', `${graph.nodes.length} nodes, ${graph.edges.length} relationships`, 1, 1);

  const hashOf = new Map(files.map((f) => [f.path, f.hash]));
  return {
    graph,
    analysis,
    facts: [...facts.values()].map((ff) => ({ path: ff.path, hash: hashOf.get(ff.path) ?? '', facts: ff })),
  };
}

export const supportedLanguages = () => SUPPORTED_LANGUAGES;
