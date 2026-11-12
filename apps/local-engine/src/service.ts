/**
 * Engine service: repository imports, indexing jobs, graph queries, exports
 * and local data management. The HTTP layer in `server.ts` is a thin wrapper.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  type GraphIndex,
  type RepositoryAnalysis,
  Store,
  type StoredRepository,
  buildIndex,
  buildOverview,
  explore,
  exportArchitectureDoc,
  exportGraphML,
  exportJson,
  exportMarkdownAnalysis,
} from '@vectora/graph-engine';
import { type GraphEdge, type GraphNode, type KnowledgeGraph, STRUCTURAL_TYPES, normalizePath } from '@vectora/graph-schema';
import type { FileFacts } from '@vectora/language-adapters';
import { indexRepository } from '@vectora/repository-indexer';
import { SearchIndex, searchDocuments } from '@vectora/search';
import {
  type ExplorationAnswer,
  INDEX_STAGES,
  INDEX_STAGE_LABELS,
  type IndexStage,
  type JobProgress,
  type RepositoryOverview,
  type RepositoryRecord,
  type SessionState,
  type Settings,
  type SourceResponse,
  mergeSettings,
  redactSecrets,
} from '@vectora/shared';
import type { EngineConfig } from './config';
import { GitHubClient, type GitHubRef, type GitHubRepoInfo, parseGitHubUrl } from './github';
import { summarizeWithProvider } from './provider';
import { ArchiveError, CredentialVault, type ZipInspection, extractZip, inspectZip, resolveInside } from './security';

export class EngineError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

interface LoadedRepo {
  graph: KnowledgeGraph;
  index: GraphIndex;
  search: SearchIndex;
  analysis: RepositoryAnalysis | null;
  docs: { path: string; content: string }[] | null;
}

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const toRecord = (r: StoredRepository): RepositoryRecord => {
  // The absolute path of managed copies is an implementation detail; local paths are shown as the origin already.
  const { rootPath: _rootPath, managedSource: _managed, ...rest } = r;
  return rest;
};

export class Engine {
  readonly store: Store;
  readonly vault: CredentialVault;
  private jobs = new Map<string, JobProgress>();
  private queue: Promise<void> = Promise.resolve();
  private loaded = new Map<string, LoadedRepo>();
  private uploads = new Map<string, { file: string; name: string; inspection: ZipInspection; createdAt: number }>();
  readonly sourcesDir: string;
  readonly uploadsDir: string;

  constructor(
    readonly config: EngineConfig,
    private log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void } = console,
  ) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.sourcesDir = path.join(config.dataDir, 'sources');
    this.uploadsDir = path.join(config.dataDir, 'uploads');
    fs.mkdirSync(this.sourcesDir, { recursive: true });
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    this.store = new Store(path.join(config.dataDir, 'vectora.db'));
    this.vault = new CredentialVault(config.dataDir);
    // Jobs do not survive a restart: anything left mid-index is marked as failed.
    for (const r of this.store.listRepositories())
      if (r.status === 'indexing' || r.status === 'pending') this.store.updateRepository(r.id, { status: 'failed', error: 'Indexing was interrupted. Re-index to continue.' });
    this.cleanUploads(0);
  }

  close(): void {
    this.store.close();
  }

  // ---- repositories -------------------------------------------------------

  listRepositories(): RepositoryRecord[] {
    return this.store.listRepositories().map(toRecord);
  }

  private repo(id: string): StoredRepository {
    const r = this.store.getRepository(id);
    if (!r) throw new EngineError('Repository not found', 404);
    return r;
  }

  getRepository(id: string): RepositoryRecord {
    return toRecord(this.repo(id));
  }

  deleteRepository(id: string): void {
    const r = this.repo(id);
    this.store.deleteRepository(id);
    this.loaded.delete(id);
    if (r.managedSource) this.removeManagedDir(r.rootPath);
  }

  /** Deletes a directory only when it lies inside VECTORA's own sources folder. */
  private removeManagedDir(dir: string): void {
    const rel = path.relative(this.sourcesDir, path.resolve(dir));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
    const top = path.join(this.sourcesDir, rel.split(path.sep)[0]!);
    fs.rmSync(top, { recursive: true, force: true });
  }

  private createRepository(fields: Pick<StoredRepository, 'name' | 'sourceKind' | 'origin' | 'branch' | 'subdirectory' | 'rootPath' | 'managedSource'> & { id?: string }): StoredRepository {
    const repo: StoredRepository = {
      id: fields.id ?? randomUUID(),
      name: fields.name,
      sourceKind: fields.sourceKind,
      origin: fields.origin,
      branch: fields.branch,
      subdirectory: fields.subdirectory,
      rootPath: fields.rootPath,
      managedSource: fields.managedSource,
      status: 'pending',
      createdAt: new Date().toISOString(),
      lastIndexedAt: null,
      fileCount: 0,
      symbolCount: 0,
      relationshipCount: 0,
      error: null,
    };
    this.store.insertRepository(repo);
    return repo;
  }

  // ---- jobs ---------------------------------------------------------------

  getJob(id: string): JobProgress {
    const j = this.jobs.get(id);
    if (!j) throw new EngineError('Job not found', 404);
    return j;
  }

  activeJobs(): JobProgress[] {
    return [...this.jobs.values()].filter((j) => j.status === 'running');
  }

  private newJob(repositoryId: string | null): JobProgress {
    const job: JobProgress = {
      id: randomUUID(),
      repositoryId,
      status: 'running',
      stage: 'acquire',
      stageIndex: 0,
      message: 'Waiting to start',
      processed: 0,
      total: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      summary: null,
    };
    this.jobs.set(job.id, job);
    // Keep the job table small.
    if (this.jobs.size > 50) for (const [id, j] of this.jobs) if (j.status !== 'running' && this.jobs.size > 40) this.jobs.delete(id);
    return job;
  }

  private setStage(job: JobProgress, stage: IndexStage, message?: string, processed = 0, total = 0): void {
    job.stage = stage;
    job.stageIndex = INDEX_STAGES.indexOf(stage);
    job.message = message ?? INDEX_STAGE_LABELS[stage];
    job.processed = processed;
    job.total = total;
  }

  /** Runs jobs one at a time so indexing never competes with itself for memory. */
  private enqueue(job: JobProgress, work: () => Promise<void>): void {
    this.queue = this.queue.then(async () => {
      try {
        await work();
        job.status = 'completed';
      } catch (err) {
        const message = redactSecrets(err instanceof Error ? err.message : String(err));
        job.status = 'failed';
        job.error = message;
        if (job.repositoryId && this.store.getRepository(job.repositoryId)) this.store.updateRepository(job.repositoryId, { status: 'failed', error: message });
        this.log.error(`Job ${job.id} failed: ${message}`);
      } finally {
        job.finishedAt = new Date().toISOString();
      }
    });
  }

  /** Resolves when all queued jobs have finished (used by tests and shutdown). */
  idle(): Promise<void> {
    return this.queue;
  }

  private async runIndex(repo: StoredRepository, job: JobProgress, forceFull = false): Promise<void> {
    const settings = this.store.getSettings();
    if (!fs.existsSync(repo.rootPath) || !fs.statSync(repo.rootPath).isDirectory()) throw new EngineError('The repository folder no longer exists on this machine', 410);
    this.store.updateRepository(repo.id, { status: 'indexing', error: null });
    const useCache = settings.performance.indexingCache && settings.repository.incrementalIndexing && !forceFull;
    const previous = useCache ? (this.store.loadFacts<FileFacts>(repo.id) as Map<string, { hash: string; facts: FileFacts }>) : undefined;
    const result = await indexRepository({
      repositoryId: repo.id,
      repositoryName: repo.name,
      rootDir: repo.rootPath,
      ignorePatterns: settings.repository.ignorePatterns,
      maxFileSizeBytes: settings.repository.maxFileSizeKb * 1024,
      maxFiles: settings.performance.maxFiles,
      disabledLanguages: settings.repository.disabledLanguages,
      concurrency: settings.performance.workerConcurrency,
      previous: previous && previous.size ? previous : undefined,
      pythonCommand: process.env.VECTORA_PYTHON,
      onProgress: (stage, message, processed, total) => this.setStage(job, stage, message, processed, total),
    });
    this.setStage(job, 'persist');
    this.store.saveGraph(repo.id, result.graph);
    this.store.setAnalysis(repo.id, result.analysis);
    if (settings.performance.indexingCache) this.store.saveFacts(repo.id, result.facts);
    else this.store.clearFacts(repo.id);
    this.store.updateRepository(repo.id, {
      status: 'ready',
      lastIndexedAt: result.analysis.generatedAt,
      fileCount: result.graph.stats.fileCount,
      symbolCount: result.graph.stats.symbolCount,
      relationshipCount: result.graph.stats.edgeCount,
      error: null,
    });
    this.loaded.delete(repo.id);
    job.summary = result.analysis.summary;
    job.message = 'Workspace ready';
    this.log.info(`Indexed ${repo.name}: ${result.graph.stats.nodeCount} nodes, ${result.graph.stats.edgeCount} relationships in ${result.analysis.summary.durationMs} ms`);
  }

  reindex(id: string, full = false): JobProgress {
    const repo = this.repo(id);
    if (this.activeJobs().some((j) => j.repositoryId === id)) throw new EngineError('This repository is already being indexed', 409);
    const job = this.newJob(id);
    this.enqueue(job, () => this.runIndex(repo, job, full));
    return job;
  }

  // ---- imports ------------------------------------------------------------

  importLocal(dirPath: string, name?: string, kind: 'local' | 'sample' = 'local'): JobProgress {
    const abs = path.resolve(dirPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new EngineError('That folder does not exist', 404);
    }
    if (!stat.isDirectory()) throw new EngineError('The path is not a folder', 400);
    const inside = path.relative(this.config.dataDir, abs);
    if (!inside.startsWith('..') && !path.isAbsolute(inside)) throw new EngineError("VECTORA's own data folder cannot be imported", 400);
    const repo = this.createRepository({
      name: (name?.trim() || path.basename(abs) || 'repository').slice(0, 120),
      sourceKind: kind,
      origin: kind === 'sample' ? 'Bundled sample repository' : abs,
      branch: readGitBranch(abs),
      subdirectory: null,
      rootPath: abs,
      managedSource: false,
    });
    const job = this.newJob(repo.id);
    this.enqueue(job, async () => {
      this.setStage(job, 'acquire', 'Reading local folder');
      await this.runIndex(repo, job);
    });
    return job;
  }

  importSample(): JobProgress {
    if (!this.config.sampleDir) throw new EngineError('The sample repository is not part of this installation', 404);
    return this.importLocal(this.config.sampleDir, 'Orbit Notes (sample)', 'sample');
  }

  private cleanUploads(maxAgeMs: number): void {
    try {
      for (const f of fs.readdirSync(this.uploadsDir)) {
        const file = path.join(this.uploadsDir, f);
        if (maxAgeMs === 0 || Date.now() - fs.statSync(file).mtimeMs > maxAgeMs) fs.rmSync(file, { force: true });
      }
    } catch {
      // nothing to clean
    }
    for (const [id, u] of this.uploads) if (maxAgeMs === 0 || Date.now() - u.createdAt > maxAgeMs) this.uploads.delete(id);
  }

  newUploadPath(): { id: string; file: string } {
    this.cleanUploads(60 * 60 * 1000);
    const id = randomUUID();
    return { id, file: path.join(this.uploadsDir, `${id}.zip`) };
  }

  async registerUpload(id: string, file: string, originalName: string): Promise<{ uploadId: string; fileName: string } & ZipInspection> {
    try {
      const inspection = await inspectZip(file);
      // Only the base name is kept; a client-supplied path is never used.
      const name = path.basename(originalName.replace(/\\/g, '/')).replace(/[^\w .()-]/g, '_').slice(0, 120) || 'archive.zip';
      this.uploads.set(id, { file, name, inspection, createdAt: Date.now() });
      return { uploadId: id, fileName: name, ...inspection };
    } catch (err) {
      fs.rmSync(file, { force: true });
      if (err instanceof ArchiveError) throw new EngineError(err.message, err.code === 'too-large' || err.code === 'too-many-entries' ? 413 : 400);
      throw err;
    }
  }

  importZip(uploadId: string, root: string | undefined, name?: string): JobProgress {
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new EngineError('The uploaded archive has expired. Upload it again.', 404);
    const chosen = normalizePath(root ?? upload.inspection.roots[0]?.path ?? '');
    if (chosen && !upload.inspection.roots.some((r) => r.path === chosen) && !upload.inspection.tree.some((t) => t.directory && (t.path === chosen || t.path.startsWith(`${chosen}/`))))
      throw new EngineError('That folder does not exist in the archive', 400);
    const id = randomUUID();
    const dest = path.join(this.sourcesDir, id);
    const repo = this.createRepository({
      id,
      name: (name?.trim() || (chosen ? chosen.split('/').pop()! : upload.name.replace(/\.zip$/i, ''))).slice(0, 120),
      sourceKind: 'zip',
      origin: upload.name,
      branch: null,
      subdirectory: chosen || null,
      rootPath: dest,
      managedSource: true,
    });
    const job = this.newJob(repo.id);
    this.enqueue(job, async () => {
      this.setStage(job, 'acquire', 'Extracting archive');
      try {
        const settings = this.store.getSettings();
        const r = await extractZip(upload.file, dest, { root: chosen, ignorePatterns: settings.repository.ignorePatterns, limits: { maxFileBytes: settings.repository.maxFileSizeKb * 1024 } });
        this.setStage(job, 'acquire', `Extracted ${r.files} files`, r.files, r.files);
      } finally {
        fs.rmSync(upload.file, { force: true });
        this.uploads.delete(uploadId);
      }
      await this.runIndex(repo, job);
    });
    return job;
  }

  private githubToken(explicit?: string | null): string | null {
    if (explicit?.trim()) return explicit.trim();
    const stored = this.store.getCredential('github');
    if (!stored) return null;
    try {
      return this.vault.decrypt(stored);
    } catch {
      return null;
    }
  }

  async validateGitHub(url: string, token?: string | null): Promise<GitHubRepoInfo & { requested: GitHubRef; usingStoredCredential: boolean }> {
    const ref = parseGitHubUrl(url);
    const tok = this.githubToken(token);
    const client = new GitHubClient({ token: tok, fetch: this.config.fetch });
    const info = await client.describe(ref, !!tok);
    return { ...info, requested: ref, usingStoredCredential: !token?.trim() && !!tok };
  }

  importGitHub(input: { url: string; branch?: string | null; subdirectory?: string | null; token?: string | null; rememberToken?: boolean }): JobProgress {
    const ref = parseGitHubUrl(input.url);
    const token = this.githubToken(input.token);
    if (input.rememberToken && input.token?.trim()) this.setCredential('github', input.token.trim());
    const sub = normalizePath(input.subdirectory ?? ref.subdirectory ?? '');
    if (sub.split('/').some((p) => p === '..')) throw new EngineError('Invalid subdirectory', 400);
    const id = randomUUID();
    const dest = path.join(this.sourcesDir, id);
    const repo = this.createRepository({
      id,
      name: sub ? `${ref.repo}/${sub}` : ref.repo,
      sourceKind: 'github',
      origin: `https://github.com/${ref.owner}/${ref.repo}`,
      branch: input.branch ?? ref.branch,
      subdirectory: sub || null,
      rootPath: sub ? path.join(dest, ...sub.split('/')) : dest,
      managedSource: true,
    });
    const job = this.newJob(repo.id);
    this.enqueue(job, async () => {
      const client = new GitHubClient({ token, fetch: this.config.fetch });
      this.setStage(job, 'acquire', 'Contacting GitHub');
      const info = await client.describe(ref, !!token);
      const branch = input.branch ?? ref.branch ?? info.defaultBranch;
      this.store.updateRepository(repo.id, { branch });
      const archive = path.join(this.uploadsDir, `${id}.zip`);
      try {
        this.setStage(job, 'acquire', `Downloading ${info.fullName}@${branch}`);
        await client.downloadArchive(ref, branch, archive, !!token);
        this.setStage(job, 'acquire', 'Extracting archive');
        const inspection = await inspectZip(archive);
        const settings = this.store.getSettings();
        // GitHub archives wrap everything in one `<repo>-<sha>` directory.
        await extractZip(archive, dest, { root: inspection.roots[0]?.path ?? '', ignorePatterns: settings.repository.ignorePatterns, limits: { maxFileBytes: settings.repository.maxFileSizeKb * 1024 } });
      } finally {
        fs.rmSync(archive, { force: true });
      }
      if (sub && !fs.existsSync(repo.rootPath)) throw new EngineError(`The folder "${sub}" does not exist on branch ${branch}`, 404);
      await this.runIndex({ ...repo, branch }, job);
    });
    return job;
  }

  // ---- filesystem browsing for the local import dialog -------------------

  listDirectory(dir?: string): { path: string; parent: string | null; entries: { name: string; path: string; repository: boolean }[]; roots: string[] } {
    const roots: string[] = [];
    if (process.platform === 'win32') {
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZAB') if (fs.existsSync(`${letter}:\\`)) roots.push(`${letter}:\\`);
    } else roots.push('/');
    const start = dir?.trim() ? path.resolve(dir) : this.config.installRoot;
    let entries: { name: string; path: string; repository: boolean }[] = [];
    try {
      entries = fs
        .readdirSync(start, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('$') && d.name !== 'System Volume Information')
        .map((d) => {
          const p = path.join(start, d.name);
          let repository = false;
          try {
            repository = ['.git', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml'].some((m) => fs.existsSync(path.join(p, m)));
          } catch {
            repository = false;
          }
          return { name: d.name, path: p, repository };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      throw new EngineError('That folder cannot be read', 403);
    }
    const parent = path.dirname(start);
    return { path: start, parent: parent === start ? null : parent, entries, roots };
  }

  // ---- graph access -------------------------------------------------------

  private load(id: string): LoadedRepo {
    const cached = this.loaded.get(id);
    if (cached) return cached;
    this.repo(id);
    const graph = this.store.loadGraph(id);
    const entry: LoadedRepo = { graph, index: buildIndex(graph), search: new SearchIndex(graph.nodes), analysis: this.store.getAnalysis<RepositoryAnalysis>(id), docs: null };
    // Memory-aware: keep at most two repositories in memory.
    while (this.loaded.size >= 2) this.loaded.delete(this.loaded.keys().next().value!);
    this.loaded.set(id, entry);
    return entry;
  }

  getGraph(id: string, detail: 'full' | 'structure' = 'full'): KnowledgeGraph & { partial: boolean } {
    const { graph } = this.load(id);
    if (detail === 'full') return { ...graph, partial: false };
    const keep = new Set(STRUCTURAL_TYPES);
    const nodes = graph.nodes.filter((n) => keep.has(n.type));
    const ids = new Set(nodes.map((n) => n.id));
    return { ...graph, nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), partial: true };
  }

  /** Symbols of one file with every relationship touching them (lazy expansion). */
  getFileMembers(id: string, filePath: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const { graph, index } = this.load(id);
    const p = normalizePath(filePath);
    const nodes = graph.nodes.filter((n) => n.filePath === p && n.type !== 'File' && n.type !== 'Configuration');
    const edges = new Map<string, GraphEdge>();
    for (const n of nodes) for (const e of [...(index.out.get(n.id) ?? []), ...(index.in.get(n.id) ?? [])]) edges.set(e.id, e);
    return { nodes, edges: [...edges.values()] };
  }

  getOverview(id: string): RepositoryOverview {
    const l = this.load(id);
    return buildOverview(this.getRepository(id), l.graph, l.analysis, l.index);
  }

  getAnalysis(id: string): RepositoryAnalysis | null {
    return this.load(id).analysis;
  }

  getSource(id: string, filePath: string, startLine?: number, endLine?: number): SourceResponse {
    const repo = this.repo(id);
    const { index } = this.load(id);
    const p = normalizePath(filePath);
    // Only files that are part of the index can be read.
    const node = index.nodes.get(`file:${p}`);
    if (!node) throw new EngineError('That file is not part of the indexed repository', 404);
    const abs = resolveInside(repo.rootPath, p);
    if (!abs) throw new EngineError('Invalid path', 400);
    let real: string;
    try {
      real = fs.realpathSync(abs);
    } catch {
      throw new EngineError('The file no longer exists on disk. Re-index the repository.', 410);
    }
    const rootReal = fs.realpathSync(repo.rootPath);
    const rel = path.relative(rootReal, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new EngineError('Invalid path', 400);
    const stat = fs.statSync(real);
    if (!stat.isFile()) throw new EngineError('Not a file', 400);
    const truncated = stat.size > MAX_SOURCE_BYTES;
    const fd = fs.openSync(real, 'r');
    const buf = Buffer.alloc(Math.min(stat.size, MAX_SOURCE_BYTES));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const all = buf.toString('utf8').split(/\r?\n/);
    const s = Math.max(1, Math.min(startLine ?? 1, all.length));
    const e = Math.max(s, Math.min(endLine ?? all.length, all.length));
    return { path: p, language: node.language, content: all.slice(s - 1, e).join('\n'), startLine: s, endLine: e, totalLines: all.length, truncated };
  }

  private docs(id: string): { path: string; content: string }[] {
    const l = this.load(id);
    if (l.docs) return l.docs;
    const repo = this.repo(id);
    const docs: { path: string; content: string }[] = [];
    for (const n of l.graph.nodes) {
      if (n.type !== 'File' || !n.filePath || !['markdown', 'restructuredtext', 'text'].includes(n.language ?? '')) continue;
      if (docs.length >= 300) break;
      const abs = resolveInside(repo.rootPath, n.filePath);
      try {
        if (abs && fs.statSync(abs).size <= 512 * 1024) docs.push({ path: n.filePath, content: fs.readFileSync(abs, 'utf8') });
      } catch {
        // file vanished since indexing
      }
    }
    l.docs = docs;
    return docs;
  }

  listDocs(id: string): { path: string; title: string; lines: number }[] {
    return this.docs(id)
      .map((d) => ({ path: d.path, title: /^#\s+(.+)$/m.exec(d.content)?.[1]?.trim() ?? d.path.split('/').pop()!, lines: d.content.split('\n').length }))
      .sort((a, b) => {
        const rank = (p: string) => (/^readme/i.test(p) ? 0 : p.includes('/') ? 2 : 1);
        return rank(a.path) - rank(b.path) || (a.path < b.path ? -1 : 1);
      });
  }

  search(id: string, query: string, types?: string[], limit = 30) {
    const l = this.load(id);
    const hits = l.search.search(query, { types: types as never, limit: Math.min(limit, 100) });
    return {
      query,
      results: hits.map((h) => ({ id: h.node.id, name: h.node.name, type: h.node.type, filePath: h.node.filePath, line: h.node.location?.startLine ?? null, description: h.node.description ?? null, score: h.score, match: h.match })),
      documents: searchDocuments(this.docs(id), query, 12),
    };
  }

  async ask(id: string, question: string): Promise<ExplorationAnswer> {
    const l = this.load(id);
    const answer = explore(question.slice(0, 500), l.index, l.analysis, (q, limit = 10) => l.search.search(q, { limit }).map((h) => h.node));
    const settings = this.store.getSettings();
    if (settings.exploration.providerEnabled && settings.exploration.providerEndpoint && answer.statements.length) {
      const stored = this.store.getCredential('exploration-provider');
      try {
        answer.narrative = await summarizeWithProvider(
          { endpoint: settings.exploration.providerEndpoint, model: settings.exploration.providerModel, apiKey: stored ? this.vault.decrypt(stored) : null, fetch: this.config.fetch },
          answer,
        );
        answer.narrativeSource = new URL(settings.exploration.providerEndpoint).host;
      } catch (err) {
        answer.narrative = null;
        answer.caveats.push(`The optional narrative service did not respond (${redactSecrets((err as Error).message)}). The evidence above is unaffected.`);
      }
    }
    return answer;
  }

  export(id: string, format: string, includeSource: boolean): { body: string; contentType: string; fileName: string } {
    const l = this.load(id);
    const repo = this.getRepository(id);
    const base = repo.name.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'repository';
    switch (format) {
      case 'json':
        return { body: exportJson(repo, l.graph, { includeSource }), contentType: 'application/json', fileName: `${base}.vectora.json` };
      case 'graphml':
        return { body: exportGraphML(repo, l.graph, { includeSource }), contentType: 'application/xml', fileName: `${base}.graphml` };
      case 'markdown':
        return { body: exportMarkdownAnalysis(this.getOverview(id), l.graph, l.analysis), contentType: 'text/markdown', fileName: `${base}-analysis.md` };
      case 'architecture':
        return { body: exportArchitectureDoc(this.getOverview(id), l.graph, l.analysis), contentType: 'text/markdown', fileName: `${base}-architecture.md` };
      default:
        throw new EngineError('Unknown export format', 400);
    }
  }

  // ---- sessions, settings, credentials, data -----------------------------

  getSession(id: string): SessionState | null {
    this.repo(id);
    return this.store.getSession(id);
  }

  saveSession(id: string, session: SessionState): void {
    this.repo(id);
    this.store.saveSession(id, { ...session, savedAt: new Date().toISOString() });
  }

  getSettings(): Settings {
    return this.store.getSettings();
  }

  updateSettings(patch: unknown): Settings {
    const next = mergeSettings(this.store.getSettings(), patch);
    this.store.saveSettings(next);
    return next;
  }

  setCredential(name: string, value: string): void {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(name)) throw new EngineError('Invalid credential name', 400);
    if (!value || value.length > 4096) throw new EngineError('Invalid credential value', 400);
    this.store.setCredential(name, this.vault.encrypt(value));
  }

  /** Names and dates only — stored values are never returned. */
  listCredentials(): { name: string; updatedAt: string }[] {
    return this.store.listCredentials();
  }

  deleteCredential(name: string): void {
    this.store.deleteCredential(name);
  }

  clearCache(): void {
    this.store.clearFacts();
  }

  dataInfo(): { dataDir: string; databaseBytes: number; sourcesBytes: number; repositories: number; credentials: number } {
    const size = (p: string): number => {
      try {
        const st = fs.statSync(p);
        if (st.isFile()) return st.size;
        return fs.readdirSync(p).reduce((a, f) => a + size(path.join(p, f)), 0);
      } catch {
        return 0;
      }
    };
    const db = ['vectora.db', 'vectora.db-wal', 'vectora.db-shm'].reduce((a, f) => a + size(path.join(this.config.dataDir, f)), 0);
    return { dataDir: this.config.dataDir, databaseBytes: db, sourcesBytes: size(this.sourcesDir), repositories: this.store.listRepositories().length, credentials: this.store.listCredentials().length };
  }

  deleteAllData(): void {
    if (this.activeJobs().length) throw new EngineError('Wait for indexing to finish before deleting data', 409);
    this.store.deleteAllData(false);
    this.loaded.clear();
    this.jobs.clear();
    for (const dir of [this.sourcesDir, this.uploadsDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
    this.uploads.clear();
  }
}

/** Reads the checked-out branch from `.git/HEAD` without running git. */
export function readGitBranch(dir: string): string | null {
  try {
    const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim();
    const m = /^ref:\s+refs\/heads\/(.+)$/.exec(head);
    return m ? m[1]! : head.slice(0, 12);
  } catch {
    return null;
  }
}
